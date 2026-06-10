import { app } from "electron";
import { createLocalDatabaseKeyStore } from "../../apps/desktop/electron/main/services/auth/databaseKeyStore";
import { DatabaseSync } from "../../apps/desktop/electron/main/services/data/nodeSqliteShim";

const USER_DATA = `${process.env.HOME}/Library/Application Support/@bukowski/desktop`;
app.setName("bukowskiOS");
app.setPath("userData", USER_DATA);

app.whenReady().then(async () => {
  const key = await createLocalDatabaseKeyStore().getKey();
  if (!key) { console.error("NO_KEY"); app.exit(2); return; }
  const db = new DatabaseSync(`${USER_DATA}/bukowski-foundation.sqlite`, { cipher: { key, profile: "sqlcipher-legacy4" } });
  const q = (sql: string, ...p: unknown[]) => db.prepare(sql).all(...(p as never[]));
  console.log(JSON.stringify({
    incidentCount: q("SELECT COUNT(*) AS n, severity FROM incidents WHERE workspace_id='6e52fcda-6dae-40af-9a80-0cf22035844c' GROUP BY severity"),
    outbox: q("SELECT entity_type, status, COUNT(*) AS n FROM sync_outbox WHERE entity_id LIKE 'incident-ingest-jun2026%' GROUP BY entity_type, status"),
    events: q("SELECT COUNT(*) AS n FROM asset_events WHERE command_id LIKE 'ingest-jun2026%'"),
    sample: q("SELECT incidents.title, assets.internal_code, incidents.severity, incidents.status FROM incidents JOIN assets ON assets.id = incidents.asset_id WHERE incidents.id LIKE 'incident-ingest%' ORDER BY incidents.severity DESC LIMIT 6"),
  }, null, 1));
  db.close(); app.exit(0);
});
