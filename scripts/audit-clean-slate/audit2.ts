// Second read-only pass: per-workspace breakdown and sync exposure, so the
// clean-slate plan can be scoped to the right workspace and account for what
// would be pushed to Supabase (and therefore to the home machine).
import { app } from "electron";

import { createLocalDatabaseKeyStore } from "../../apps/desktop/electron/main/services/auth/databaseKeyStore";
import { DatabaseSync } from "../../apps/desktop/electron/main/services/data/nodeSqliteShim";

const USER_DATA = `${process.env.HOME}/Library/Application Support/@bukowski/desktop`;
const DB_PATH = `${USER_DATA}/bukowski-foundation.sqlite`;

app.setName("bukowskiOS");
app.setPath("userData", USER_DATA);

const main = async () => {
  const key = await createLocalDatabaseKeyStore().getKey();
  if (!key) {
    console.error("NO_KEY");
    app.exit(2);
    return;
  }
  const db = new DatabaseSync(DB_PATH, { cipher: { key, profile: "sqlcipher-legacy4" } });
  db.exec("PRAGMA busy_timeout = 5000;");

  const rows = <T,>(sql: string, params: unknown[] = []): T[] => {
    try {
      return db.prepare(sql).all(...(params as never[])) as T[];
    } catch (error) {
      console.log(`  (error: ${String(error).slice(0, 80)})`);
      return [];
    }
  };

  console.log("\n=========== POR WORKSPACE ===========");
  for (const ws of rows<{ id: string; name: string }>("SELECT id, name FROM workspaces")) {
    console.log(`\n### ${ws.name}  (${ws.id})`);
    for (const t of ["projects", "assets", "asset_assignments", "kits", "incidents", "quotes", "locations"]) {
      const r = rows<{ n: number }>(`SELECT COUNT(*) n FROM ${t} WHERE workspace_id = ?`, [ws.id]);
      console.log(`   ${t.padEnd(20)} ${r[0]?.n ?? "n/a"}`);
    }
  }

  console.log("\n=========== ASSETS: estado y categorías ===========");
  for (const r of rows<{ status: string; n: number }>(
    "SELECT COALESCE(status,'(sin estado)') status, COUNT(*) n FROM asset_current_state GROUP BY status ORDER BY n DESC",
  )) {
    console.log(`   ${String(r.status).padEnd(22)} ${r.n}`);
  }
  console.log("--- categorías (top 12) ---");
  for (const r of rows<{ c: string; n: number }>(
    "SELECT COALESCE(category,'(sin categoría)') c, COUNT(*) n FROM assets GROUP BY category ORDER BY n DESC LIMIT 12",
  )) {
    console.log(`   ${String(r.c).padEnd(28)} ${r.n}`);
  }

  console.log("\n=========== SYNC OUTBOX ===========");
  for (const r of rows<{ entity: string; op: string; status: string; n: number }>(
    "SELECT entity_type entity, operation op, status, COUNT(*) n FROM sync_outbox GROUP BY entity_type, operation, status ORDER BY n DESC LIMIT 15",
  )) {
    console.log(`   ${String(r.entity).padEnd(22)} ${String(r.op).padEnd(10)} ${String(r.status).padEnd(10)} ${r.n}`);
  }

  console.log("\n=========== TABLAS QUE EXISTEN (finanzas) ===========");
  for (const r of rows<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%treasury%' OR name LIKE '%invoice%' OR name LIKE '%payment%' OR name LIKE '%quote%') ORDER BY name",
  )) {
    const c = rows<{ n: number }>(`SELECT COUNT(*) n FROM ${r.name}`);
    console.log(`   ${r.name.padEnd(34)} ${c[0]?.n ?? "?"}`);
  }

  app.exit(0);
};

app.whenReady().then(main).catch((error) => {
  console.error("AUDIT2_FAILED:", error);
  app.exit(1);
});
