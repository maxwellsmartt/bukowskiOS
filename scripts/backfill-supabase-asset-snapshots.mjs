#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const defaultWorkspaceId = "6e52fcda-6dae-40af-9a80-0cf22035844c";
const appDataPath = path.join(os.homedir(), "Library/Application Support/@bukowski/desktop");
const defaultDatabasePath = path.join(appDataPath, "bukowski-foundation.sqlite");
const defaultEnvPath = path.join(process.cwd(), "apps/desktop/.env.local");
const localStoragePath = path.join(appDataPath, "Local Storage/leveldb");
const authStorageKey = "sb-jmxkejpdklrrzhvzjlqm-auth-token";

const readArgs = () => {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 1) {
    const value = process.argv[index];
    if (!value.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = value.slice(2).split("=");
    if (inlineValue !== undefined) {
      args.set(key, inlineValue);
      continue;
    }

    const nextValue = process.argv[index + 1];
    if (nextValue && !nextValue.startsWith("--")) {
      args.set(key, nextValue);
      index += 1;
    } else {
      args.set(key, "true");
    }
  }
  return args;
};

const readEnvFile = (envPath) => {
  const env = {};
  const text = fs.readFileSync(envPath, "utf8");

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    env[trimmed.slice(0, separator)] = trimmed.slice(separator + 1).trim();
  }

  return env;
};

const extractJsonObject = (text, startIndex) => {
  const firstBrace = text.indexOf("{", startIndex);
  if (firstBrace === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = firstBrace; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(firstBrace, index + 1);
      }
    }
  }

  return null;
};

const readCachedSupabaseSession = () => {
  if (!fs.existsSync(localStoragePath)) {
    return null;
  }

  const sessions = [];
  const files = fs.readdirSync(localStoragePath).filter((fileName) => /\.(log|ldb)$/.test(fileName));

  for (const fileName of files) {
    const text = fs.readFileSync(path.join(localStoragePath, fileName)).toString("latin1");
    let markerIndex = -1;

    while ((markerIndex = text.indexOf(authStorageKey, markerIndex + 1)) >= 0) {
      const jsonText = extractJsonObject(text, markerIndex + authStorageKey.length);
      if (!jsonText) {
        continue;
      }

      try {
        const session = JSON.parse(jsonText);
        if (session.access_token && session.refresh_token) {
          sessions.push(session);
        }
      } catch {
        // LevelDB files may include stale or partial records; ignore partial matches.
      }
    }
  }

  sessions.sort((left, right) => (right.expires_at ?? 0) - (left.expires_at ?? 0));
  return sessions[0] ?? null;
};

const refreshAccessToken = async ({ supabaseUrl, anonKey, refreshToken }) => {
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!response.ok) {
    throw new Error(`Supabase token refresh failed (${response.status}): ${await response.text()}`);
  }

  const payload = await response.json();
  if (!payload.access_token) {
    throw new Error("Supabase token refresh did not return an access token.");
  }

  return payload.access_token;
};

const resolveAccessToken = async ({ supabaseUrl, anonKey }) => {
  if (process.env.SUPABASE_ACCESS_TOKEN) {
    return process.env.SUPABASE_ACCESS_TOKEN;
  }

  const session = readCachedSupabaseSession();
  if (!session) {
    throw new Error("No cached Supabase session found. Sign in to the app first or set SUPABASE_ACCESS_TOKEN.");
  }

  const expiresAt = Number(session.expires_at ?? 0);
  const now = Math.floor(Date.now() / 1000);
  if (expiresAt > now + 60) {
    return session.access_token;
  }

  return await refreshAccessToken({
    supabaseUrl,
    anonKey,
    refreshToken: session.refresh_token,
  });
};

const parseMetadataJson = (value) => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const toAssetRecord = (row) => ({
  ...row,
  is_active: row.is_active === 1,
});

const toAssetEventRecord = (row) => ({
  ...row,
  metadata_json: parseMetadataJson(row.metadata_json),
});

const chunk = (items, size) => {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const upsertBatch = async ({ supabaseUrl, anonKey, accessToken, table, conflictTarget, rows }) => {
  if (rows.length === 0) {
    return;
  }

  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?on_conflict=${conflictTarget}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });

  if (!response.ok) {
    throw new Error(`Failed to upsert ${table} (${response.status}): ${await response.text()}`);
  }
};

const readRemoteCount = async ({ supabaseUrl, anonKey, accessToken, table, workspaceId }) => {
  const response = await fetch(`${supabaseUrl}/rest/v1/${table}?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=*`, {
    method: "HEAD",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      Prefer: "count=exact",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to count ${table} (${response.status}): ${await response.text()}`);
  }

  const range = response.headers.get("content-range") ?? "";
  const count = Number(range.split("/")[1] ?? Number.NaN);
  return Number.isFinite(count) ? count : null;
};

const main = async () => {
  const args = readArgs();
  const workspaceId = args.get("workspace") ?? defaultWorkspaceId;
  const databasePath = args.get("database") ?? defaultDatabasePath;
  const envPath = args.get("env") ?? defaultEnvPath;
  const batchSize = Number(args.get("batch-size") ?? 100);
  const dryRun = args.get("dry-run") === "true";

  if (!fs.existsSync(databasePath)) {
    throw new Error(`SQLite database not found: ${databasePath}`);
  }

  const env = readEnvFile(envPath);
  const supabaseUrl = (env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const anonKey = env.VITE_SUPABASE_ANON_KEY ?? "";

  if (!supabaseUrl || !anonKey) {
    throw new Error(`Supabase env is incomplete in ${envPath}`);
  }

  const database = new DatabaseSync(databasePath, { readOnly: true });
  const assets = database
    .prepare(
      `
        SELECT
          id,
          workspace_id,
          category_id,
          name,
          brand,
          model,
          serial_number,
          internal_code,
          description,
          purchase_date,
          purchase_price,
          currency,
          replacement_value,
          current_book_value,
          ownership_type,
          default_location_id,
          qr_code_value,
          notes,
          is_active,
          created_at,
          updated_at
        FROM assets
        WHERE workspace_id = ?
        ORDER BY created_at ASC, id ASC
      `,
    )
    .all(workspaceId)
    .map(toAssetRecord);
  const currentState = database
    .prepare(
      `
        SELECT
          asset_id,
          workspace_id,
          current_location_id,
          current_project_id,
          current_department_id,
          current_responsible_user_id,
          active_assignment_id,
          condition_status,
          operational_status,
          custody_status,
          last_event_id,
          version,
          updated_at,
          project_unit_id,
          total_quantity,
          available_quantity,
          assigned_quantity,
          checked_out_quantity
        FROM asset_current_state
        WHERE workspace_id = ?
        ORDER BY updated_at ASC, asset_id ASC
      `,
    )
    .all(workspaceId);
  const events = database
    .prepare(
      `
        SELECT
          id,
          workspace_id,
          asset_id,
          assignment_id,
          project_id,
          department_id,
          performed_by_user_id,
          event_type,
          location_id,
          from_location_id,
          to_location_id,
          event_timestamp,
          command_id,
          actor_type,
          source_channel,
          notes,
          metadata_json,
          created_at
        FROM asset_events
        WHERE workspace_id = ?
        ORDER BY created_at ASC, id ASC
      `,
    )
    .all(workspaceId)
    .map(toAssetEventRecord);

  database.close();

  console.log(`Workspace: ${workspaceId}`);
  console.log(`Local assets: ${assets.length}`);
  console.log(`Local current state rows: ${currentState.length}`);
  console.log(`Local asset events: ${events.length}`);

  if (dryRun) {
    console.log("Dry run only. No remote writes performed.");
    return;
  }

  const accessToken = await resolveAccessToken({ supabaseUrl, anonKey });
  const writePlan = [
    { table: "assets", conflictTarget: "id", rows: assets },
    { table: "asset_events", conflictTarget: "id", rows: events },
    { table: "asset_current_state", conflictTarget: "asset_id", rows: currentState },
  ];

  for (const item of writePlan) {
    let written = 0;
    for (const rows of chunk(item.rows, batchSize)) {
      await upsertBatch({
        supabaseUrl,
        anonKey,
        accessToken,
        table: item.table,
        conflictTarget: item.conflictTarget,
        rows,
      });
      written += rows.length;
      console.log(`Upserted ${written}/${item.rows.length} ${item.table}`);
    }
  }

  const remoteCounts = {};
  for (const table of ["assets", "asset_current_state", "asset_events"]) {
    remoteCounts[table] = await readRemoteCount({
      supabaseUrl,
      anonKey,
      accessToken,
      table,
      workspaceId,
    });
  }

  console.log("Remote counts:");
  console.log(JSON.stringify(remoteCounts, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
