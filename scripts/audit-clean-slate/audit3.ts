// Final read-only pass: does finance data point at the projects a clean slate
// would delete, and what does the sync outbox actually carry.
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

  const cols = (t: string) =>
    (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
  const all = <T,>(sql: string): T[] => {
    try {
      return db.prepare(sql).all() as T[];
    } catch (e) {
      console.log(`   (err: ${String(e).slice(0, 70)})`);
      return [];
    }
  };

  console.log("\n=== invoice_extraction_projects ===");
  console.log("   columnas:", cols("invoice_extraction_projects").join(", "));
  for (const r of all<Record<string, unknown>>("SELECT * FROM invoice_extraction_projects LIMIT 5")) {
    console.log("   fila:", JSON.stringify(r));
  }

  console.log("\n=== ¿finanzas apunta a proyectos existentes? ===");
  for (const r of all<{ n: number }>(
    `SELECT COUNT(*) n FROM invoice_extraction_projects iep
     JOIN projects p ON p.id = iep.project_id`,
  )) {
    console.log(`   extracciones ligadas a un proyecto existente: ${r.n}`);
  }

  console.log("\n=== sync_outbox ===");
  console.log("   columnas:", cols("sync_outbox").join(", "));
  for (const r of all<Record<string, unknown>>(
    "SELECT entity_type, COUNT(*) n FROM sync_outbox GROUP BY entity_type ORDER BY n DESC LIMIT 12",
  )) {
    console.log(`   ${JSON.stringify(r)}`);
  }

  console.log("\n=== asset_current_state ===");
  console.log("   columnas:", cols("asset_current_state").join(", "));

  console.log("\n=== assets: muestra real (¿inventario viejo?) ===");
  for (const r of all<{ internal_code: string; name: string; brand: string; created_at: string }>(
    "SELECT internal_code, name, brand, created_at FROM assets ORDER BY created_at LIMIT 5",
  )) {
    console.log(`   ${r.internal_code} · ${r.name} · ${r.brand ?? "—"} · ${String(r.created_at).slice(0, 10)}`);
  }
  for (const r of all<{ d: string; n: number }>(
    "SELECT substr(created_at,1,7) d, COUNT(*) n FROM assets GROUP BY d ORDER BY d",
  )) {
    console.log(`   creados ${r.d}: ${r.n}`);
  }

  app.exit(0);
};

app.whenReady().then(main).catch((error) => {
  console.error("AUDIT3_FAILED:", error);
  app.exit(1);
});
