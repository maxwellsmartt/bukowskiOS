// One-off ingest (applied 2026-06-10): create incidents for the equipment
// flagged in Daniel's June-2026 physical inventory report. Goes through the
// real incidentMutationService so receipts, asset events and the sync outbox
// all behave exactly as if the incidents were reported from the app.
//
// Idempotent: commandId is deterministic per target (ingest-jun2026-<code>),
// so re-runs are absorbed by the command receipt check. Dry-run by default;
// set INGEST_APPLY=1 to write.
//
// Build + run (esbuild bundles the app's TS modules; the output must live
// under apps/desktop so node resolution finds the native sqlite drivers;
// Electron is required because the DB key decrypts via safeStorage under the
// "bukowskiOS Safe Storage" keychain service):
//   node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild \
//     scripts/ingest-jun2026-incidents/ingest.ts --bundle --platform=node \
//     --format=cjs --outfile=apps/desktop/tmp-ingest.cjs --external:electron \
//     --external:better-sqlite3 --external:better-sqlite3-multiple-ciphers \
//     --external:keytar --tsconfig=apps/desktop/tsconfig.json \
//     --define:import.meta.url=__IMPORT_META_URL__ \
//     --banner:js="const __IMPORT_META_URL__ = require('url').pathToFileURL(__filename).href;"
//   INGEST_APPLY=1 apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron apps/desktop/tmp-ingest.cjs
import { app } from "electron";

import { createLocalDatabaseKeyStore } from "../../apps/desktop/electron/main/services/auth/databaseKeyStore";
import { createIncidentMutationService } from "../../apps/desktop/electron/main/services/data/incidentMutationService";
import { DatabaseSync } from "../../apps/desktop/electron/main/services/data/nodeSqliteShim";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";

import { TARGETS } from "./targets";

const USER_DATA = `${process.env.HOME}/Library/Application Support/@bukowski/desktop`;
const DB_PATH = `${USER_DATA}/bukowski-foundation.sqlite`;
const WORKSPACE_ID = "6e52fcda-6dae-40af-9a80-0cf22035844c";
const DRY_RUN = process.env.INGEST_APPLY !== "1";

app.setName("bukowskiOS");
app.setPath("userData", USER_DATA);

const main = async () => {
  const key = await createLocalDatabaseKeyStore().getKey();
  if (!key) {
    console.error("NO_KEY: aborting, never generate a fresh key here.");
    app.exit(2);
    return;
  }

  const db = new DatabaseSync(DB_PATH, { cipher: { key, profile: "sqlcipher-legacy4" } });
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");

  const service = createIncidentMutationService(db as unknown as NodeDatabaseSync);

  const bySerial = db.prepare(
    "SELECT id, internal_code AS code, name FROM assets WHERE workspace_id = ? AND serial_number = ?",
  );
  const byCode = db.prepare(
    "SELECT id, internal_code AS code, name FROM assets WHERE workspace_id = ? AND internal_code = ?",
  );

  const results: unknown[] = [];
  for (const target of TARGETS) {
    let rows = target.serial ? (bySerial.all(WORKSPACE_ID, target.serial) as Array<{ id: string; code: string; name: string }>) : [];
    if (rows.length !== 1) {
      rows = byCode.all(WORKSPACE_ID, target.code) as Array<{ id: string; code: string; name: string }>;
    }

    if (rows.length !== 1) {
      results.push({ code: target.code, status: "NO_MATCH", candidates: rows.length });
      continue;
    }

    const asset = rows[0];
    if (DRY_RUN) {
      results.push({ code: target.code, status: "DRY_RUN_OK", assetId: asset.id, assetName: asset.name, title: target.title });
      continue;
    }

    try {
      const result = service.reportIncident({
        commandId: `ingest-jun2026-${target.code}`,
        workspaceId: WORKSPACE_ID,
        assetId: asset.id,
        incidentType: target.incidentType,
        severity: target.severity,
        title: target.title,
        description: target.description,
        notes: "Origen: reporte de inventario físico jun-2026 (Daniel).",
        actorType: "user",
        sourceChannel: "desktop",
      });
      results.push({ code: target.code, status: result.repeated ? "ALREADY_APPLIED" : "CREATED", incidentId: result.incidentId });
    } catch (error) {
      results.push({ code: target.code, status: "ERROR", error: String(error).slice(0, 160) });
    }
  }

  const summary = {
    dryRun: DRY_RUN,
    total: TARGETS.length,
    created: results.filter((r) => (r as { status: string }).status === "CREATED").length,
    repeated: results.filter((r) => (r as { status: string }).status === "ALREADY_APPLIED").length,
    dryRunOk: results.filter((r) => (r as { status: string }).status === "DRY_RUN_OK").length,
    noMatch: results.filter((r) => (r as { status: string }).status === "NO_MATCH").length,
    errors: results.filter((r) => (r as { status: string }).status === "ERROR").length,
  };
  console.log(JSON.stringify({ summary, results }, null, 1));

  db.close();
  app.exit(summary.errors > 0 || summary.noMatch > 0 ? 1 : 0);
};

app.whenReady().then(main).catch((error) => {
  console.error("INGEST_FAILED:", error);
  app.exit(1);
});
