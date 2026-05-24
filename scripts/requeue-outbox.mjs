#!/usr/bin/env node
// Re-queue already-"sent" sync_outbox rows so the (now fixed) transport pushes
// their domain data again. Needed for rows that were marked sent by the old
// upsert-only transport before it materialized the real Supabase tables (e.g.
// quotes). SAFE BY DEFAULT: dry-run unless --apply is passed.
//
// Usage:
//   node scripts/requeue-outbox.mjs --types quote[,invoice,...] \
//     --workspace 6e52fcda-6dae-40af-9a80-0cf22035844c \
//     [--db "~/Library/Application Support/@bukowski/desktop/bukowski-foundation.sqlite"] \
//     [--apply]
//
// Restart the desktop app first so the corrected transport is the one running.
// Requires the `sqlite3` CLI (preinstalled on macOS).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const getFlag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const apply = argv.includes("--apply");
const expandHome = (p) => (p?.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p);

const workspaceId = getFlag("workspace");
const types = (getFlag("types") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const dbPath = expandHome(
  getFlag("db") ||
    path.join(os.homedir(), "Library", "Application Support", "@bukowski", "desktop", "bukowski-foundation.sqlite"),
);

if (!workspaceId || types.length === 0) {
  console.error("Pass --workspace <uuid> and --types <comma,separated,entity_types>.");
  process.exit(1);
}
if (!fs.existsSync(dbPath)) {
  console.error(`Local database not found: ${dbPath}`);
  process.exit(1);
}

const sqlite = (sql) => execFileSync("sqlite3", [dbPath, sql], { encoding: "utf8" }).trim();
const inList = types.map((t) => `'${t.replace(/'/g, "''")}'`).join(",");
const whereClause = `workspace_id='${workspaceId}' AND status='sent' AND entity_type IN (${inList})`;

const before = sqlite(
  `SELECT entity_type || ': ' || COUNT(*) FROM sync_outbox WHERE ${whereClause} GROUP BY entity_type;`,
);
const total = Number(sqlite(`SELECT COUNT(*) FROM sync_outbox WHERE ${whereClause};`) || "0");

console.log(`Local DB: ${dbPath}`);
console.log(`Workspace: ${workspaceId}`);
console.log(`Entity types: ${types.join(", ")}`);
console.log(apply ? "MODE: APPLY\n" : "MODE: dry-run (pass --apply to re-queue)\n");
console.log(before || "(no matching 'sent' rows)");
console.log(`\nTotal to re-queue: ${total}`);

if (apply && total > 0) {
  sqlite(
    `UPDATE sync_outbox SET status='pending', attempt_count=0, last_error=NULL, next_retry_at=created_at WHERE ${whereClause};`,
  );
  console.log(`Re-queued ${total} rows. The sync worker will push them on its next pass (~60s).`);
} else if (!apply && total > 0) {
  console.log("Re-run with --apply to re-queue them.");
}
