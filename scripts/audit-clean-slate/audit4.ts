// Is the sync outbox stuck or merely idle? A mass deletion would add ~900
// events to this queue, so its health decides whether a clean slate is safe.
import { app } from "electron";

import { createLocalDatabaseKeyStore } from "../../apps/desktop/electron/main/services/auth/databaseKeyStore";
import { DatabaseSync } from "../../apps/desktop/electron/main/services/data/nodeSqliteShim";

const USER_DATA = `${process.env.HOME}/Library/Application Support/@bukowski/desktop`;
app.setName("bukowskiOS");
app.setPath("userData", USER_DATA);

const main = async () => {
  const key = await createLocalDatabaseKeyStore().getKey();
  if (!key) {
    console.error("NO_KEY");
    app.exit(2);
    return;
  }
  const db = new DatabaseSync(`${USER_DATA}/bukowski-foundation.sqlite`, {
    cipher: { key, profile: "sqlcipher-legacy4" },
  });
  db.exec("PRAGMA busy_timeout = 5000;");
  const all = <T,>(sql: string): T[] => db.prepare(sql).all() as T[];

  console.log("\n=== outbox por estado ===");
  for (const r of all<{ status: string; n: number; oldest: string; newest: string }>(
    `SELECT status, COUNT(*) n, MIN(created_at) oldest, MAX(created_at) newest
     FROM sync_outbox GROUP BY status ORDER BY n DESC`,
  )) {
    console.log(`   ${String(r.status).padEnd(12)} ${String(r.n).padEnd(6)} desde ${String(r.oldest).slice(0, 10)} hasta ${String(r.newest).slice(0, 10)}`);
  }

  console.log("\n=== errores recientes ===");
  for (const r of all<{ entity_type: string; attempt_count: number; last_error: string }>(
    `SELECT entity_type, attempt_count, last_error FROM sync_outbox
     WHERE last_error IS NOT NULL ORDER BY updated_at DESC LIMIT 6`,
  )) {
    console.log(`   ${r.entity_type} (intentos ${r.attempt_count}): ${String(r.last_error).slice(0, 130)}`);
  }

  console.log("\n=== conflicto pendiente ===");
  for (const r of all<Record<string, unknown>>("SELECT * FROM sync_conflicts LIMIT 2")) {
    console.log(`   ${JSON.stringify(r).slice(0, 260)}`);
  }

  app.exit(0);
};

app.whenReady().then(main).catch((e) => {
  console.error("AUDIT4_FAILED:", e);
  app.exit(1);
});
