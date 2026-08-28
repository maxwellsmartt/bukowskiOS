// Read-only survey of what a projects + inventory clean slate would touch.
// Writes nothing: it only counts rows so the blast radius is known before any
// deletion plan is agreed. Finance tables are surveyed precisely because they
// must survive untouched.
//
// Build + run (same recipe as scripts/ingest-jun2026-incidents):
//   node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild \
//     scripts/audit-clean-slate/audit.ts --bundle --platform=node \
//     --format=cjs --outfile=apps/desktop/tmp-audit.cjs --external:electron \
//     --external:better-sqlite3 --external:better-sqlite3-multiple-ciphers \
//     --external:keytar --tsconfig=apps/desktop/tsconfig.json \
//     --define:import.meta.url=__IMPORT_META_URL__ \
//     --banner:js="const __IMPORT_META_URL__ = require('url').pathToFileURL(__filename).href;"
//   apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron apps/desktop/tmp-audit.cjs
import { app } from "electron";

import { createLocalDatabaseKeyStore } from "../../apps/desktop/electron/main/services/auth/databaseKeyStore";
import { DatabaseSync } from "../../apps/desktop/electron/main/services/data/nodeSqliteShim";

const USER_DATA = `${process.env.HOME}/Library/Application Support/@bukowski/desktop`;
const DB_PATH = `${USER_DATA}/bukowski-foundation.sqlite`;

app.setName("bukowskiOS");
app.setPath("userData", USER_DATA);

const main = async () => {
  console.error("STEP: app ready, requesting database key…");
  const key = await createLocalDatabaseKeyStore().getKey();
  if (!key) {
    console.error("NO_KEY: aborting, never generate a fresh key here.");
    app.exit(2);
    return;
  }
  console.error("STEP: key obtained, opening database…");

  const db = new DatabaseSync(DB_PATH, { cipher: { key, profile: "sqlcipher-legacy4" } });
  db.exec("PRAGMA busy_timeout = 5000;");

  const tableExists = (name: string) =>
    Boolean(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name) as
        | { name?: string }
        | undefined)?.name,
    );

  const count = (sql: string): number => {
    try {
      return Number((db.prepare(sql).get() as { n?: number } | undefined)?.n ?? 0);
    } catch (error) {
      console.log(`    (no consultable: ${String(error).slice(0, 60)})`);
      return -1;
    }
  };

  // Tables differ on soft vs hard delete, so every filter is introspected
  // instead of assumed.
  const hasColumn = (table: string, column: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
      (c) => c.name === column,
    );
  const liveFilter = (table: string) => (hasColumn(table, "deleted_at") ? " WHERE deleted_at IS NULL" : "");

  console.log("\n=========== PROYECTOS ===========");
  const projects = db
    .prepare(
      `SELECT id, name, status, created_at,
              (SELECT COUNT(*) FROM asset_assignments a WHERE a.project_id = p.id) AS assignments
       FROM projects p ORDER BY created_at`,
    )
    .all() as Array<{ id: string; name: string; status: string; created_at: string; assignments: number }>;
  console.log(`Total: ${projects.length}`);
  projects.forEach((p) =>
    console.log(`  • ${p.name}  [${p.status}]  asignaciones:${p.assignments}  ${p.created_at?.slice(0, 10)}`),
  );

  console.log("\n=========== INVENTARIO ===========");
  console.log(`assets vivos:  ${count(`SELECT COUNT(*) n FROM assets${liveFilter("assets")}`)}`);
  console.log(`assets total:  ${count("SELECT COUNT(*) n FROM assets")}`);
  for (const t of [
    "asset_current_state",
    "asset_assignments",
    "asset_events",
    "asset_quantity_state",
    "kits",
    "kit_assets",
    "incidents",
    "rma_cases",
    "packing_slips",
    "software_licenses",
  ]) {
    if (tableExists(t)) console.log(`${t.padEnd(28)} ${count(`SELECT COUNT(*) n FROM ${t}`)}`);
  }

  console.log("\n=========== FINANZAS (debe sobrevivir) ===========");
  for (const t of [
    "quotes",
    "invoices",
    "collaborator_payments",
    "treasury_movements",
    "treasury_accounts",
    "payment_instruments",
  ]) {
    if (!tableExists(t)) continue;
    const total = count(`SELECT COUNT(*) n FROM ${t}`);
    const linked = hasColumn(t, "project_id")
      ? count(`SELECT COUNT(*) n FROM ${t} WHERE project_id IS NOT NULL`)
      : 0;
    console.log(`${t.padEnd(24)} total:${String(total).padEnd(6)} con project_id: ${linked}`);
  }

  console.log("\n=========== SYNC ===========");
  for (const t of ["sync_outbox", "sync_conflicts"]) {
    if (tableExists(t)) console.log(`${t.padEnd(20)} ${count(`SELECT COUNT(*) n FROM ${t}`)}`);
  }

  console.log("\n=========== WORKSPACES ===========");
  const ws = db.prepare("SELECT id, name FROM workspaces").all() as Array<{ id: string; name: string }>;
  ws.forEach((w) => console.log(`  • ${w.name}  ${w.id}`));

  app.exit(0);
};

app.whenReady().then(main).catch((error) => {
  console.error("AUDIT_FAILED:", error);
  app.exit(1);
});
