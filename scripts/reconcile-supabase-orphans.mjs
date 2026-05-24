#!/usr/bin/env node
// Reconcile Supabase financial tables against the local SQLite source of truth.
//
// The desktop sync is upsert-only: when an import batch (or any row) is deleted
// locally, the cloud copy is left behind as an orphan. This one-off tool finds
// rows that exist in Supabase for a workspace but no longer exist locally and
// deletes them, so a second machine that PULLS won't resurrect stale data.
//
// SAFE BY DEFAULT: runs as a dry-run (reports counts only). Pass --apply to
// actually delete. Requires a service-role key (RLS would otherwise block the
// cross-row delete).
//
// Usage:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node scripts/reconcile-supabase-orphans.mjs \
//     --workspace 6e52fcda-6dae-40af-9a80-0cf22035844c \
//     [--db "~/Library/Application Support/@bukowski/desktop/bukowski-foundation.sqlite"] \
//     [--apply]
//
// Requires the `sqlite3` CLI (preinstalled on macOS) to read the local ids.

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

const supabaseUrl = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const workspaceId = getFlag("workspace");
const dbPath = expandHome(
  getFlag("db") ||
    path.join(os.homedir(), "Library", "Application Support", "@bukowski", "desktop", "bukowski-foundation.sqlite"),
);

if (!supabaseUrl || !serviceKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.");
  process.exit(1);
}
if (!workspaceId) {
  console.error("Pass --workspace <uuid>.");
  process.exit(1);
}
if (!fs.existsSync(dbPath)) {
  console.error(`Local database not found: ${dbPath}`);
  process.exit(1);
}

// table -> id column. Children first so FK deletes (if any) don't block parents.
const TABLES = [
  { table: "bank_transactions", idColumn: "id" },
  { table: "transaction_annotations", idColumn: "transaction_id" },
  { table: "transaction_project_allocations", idColumn: "id" },
  { table: "bank_statement_imports", idColumn: "id" },
  { table: "bank_accounts", idColumn: "id" },
  { table: "counterparty_rules", idColumn: "id" },
  { table: "invoice_payments", idColumn: "id" },
  { table: "invoice_items", idColumn: "id" },
  { table: "invoices", idColumn: "id" },
  { table: "quote_items", idColumn: "id" },
  { table: "quotes", idColumn: "id" },
  { table: "collaborator_payments", idColumn: "id" },
  { table: "collaborator_fees", idColumn: "id" },
  { table: "financial_entries", idColumn: "id" },
];

const localIds = (table, idColumn) => {
  // Some child tables have no workspace_id column; fall back to all rows.
  const hasWorkspace =
    execFileSync("sqlite3", [dbPath, `SELECT COUNT(*) FROM pragma_table_info('${table}') WHERE name='workspace_id';`], {
      encoding: "utf8",
    }).trim() === "1";
  const sql = hasWorkspace
    ? `SELECT ${idColumn} FROM ${table} WHERE workspace_id='${workspaceId}';`
    : `SELECT ${idColumn} FROM ${table};`;
  const out = execFileSync("sqlite3", [dbPath, sql], { encoding: "utf8" });
  return new Set(out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
};

const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

const remoteIds = async (table, idColumn) => {
  const url = `${supabaseUrl}/rest/v1/${table}?select=${idColumn}&workspace_id=eq.${workspaceId}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${table} failed (${res.status}): ${await res.text()}`);
  const rows = await res.json();
  return rows.map((r) => String(r[idColumn]));
};

const deleteIds = async (table, idColumn, ids) => {
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const list = batch.map((id) => `"${id}"`).join(",");
    const url = `${supabaseUrl}/rest/v1/${table}?${idColumn}=in.(${list})`;
    const res = await fetch(url, { method: "DELETE", headers: { ...headers, Prefer: "return=minimal" } });
    if (!res.ok) throw new Error(`DELETE ${table} failed (${res.status}): ${await res.text()}`);
  }
};

console.log(`Reconciling workspace ${workspaceId}`);
console.log(`Local DB: ${dbPath}`);
console.log(apply ? "MODE: APPLY (will delete)\n" : "MODE: dry-run (no changes; pass --apply to delete)\n");

let totalOrphans = 0;
for (const { table, idColumn } of TABLES) {
  let local;
  try {
    local = localIds(table, idColumn);
  } catch {
    console.log(`${table}: (skipped — not present locally)`);
    continue;
  }
  let remote;
  try {
    remote = await remoteIds(table, idColumn);
  } catch (error) {
    console.log(`${table}: ERROR reading remote — ${error.message}`);
    continue;
  }
  const orphans = remote.filter((id) => !local.has(id));
  totalOrphans += orphans.length;
  console.log(`${table}: local=${local.size} remote=${remote.length} orphans=${orphans.length}`);
  if (orphans.length && apply) {
    await deleteIds(table, idColumn, orphans);
    console.log(`  deleted ${orphans.length} orphan rows`);
  }
}

console.log(`\n${apply ? "Done." : "Dry-run complete."} Total orphans: ${totalOrphans}`);
if (!apply && totalOrphans > 0) console.log("Re-run with --apply to delete them.");
