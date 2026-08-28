// Clean slate for projects + inventory ahead of the real Porto Rico intake.
//
// Step 2 of the coordinated reset documented in InventoryResetDialog.tsx
// ("wipe the cloud, run this on each machine, re-import"). Step 1 — clearing
// Supabase — happens first and elsewhere; running this before the cloud is
// clean only makes the machine re-pull the old inventory.
//
// Inventory goes through inventoryResetService, which discovers every foreign
// key to assets from the live schema, nulls the optional references instead of
// deleting them (this is what keeps finance intact) and runs in one
// transaction that rolls back on any violation.
//
// Projects go through projectMutationService, honouring its guardrails:
// archive first, then hard delete with backup confirmation.
//
// Preserved on purpose: invoice extractions, software licences and every other
// finance record. Quotes and invoices are dev leftovers and go.
//
// Preview by default; set CLEAN_SLATE_APPLY=1 to write.
//
// Build + run:
//   node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild \
//     scripts/clean-slate-2026-08/clean-slate.ts --bundle --platform=node \
//     --format=cjs --outfile=apps/desktop/tmp-clean-slate.cjs --external:electron \
//     --external:better-sqlite3 --external:better-sqlite3-multiple-ciphers \
//     --external:keytar --tsconfig=apps/desktop/tsconfig.json \
//     --define:import.meta.url=__IMPORT_META_URL__ \
//     --banner:js="const __IMPORT_META_URL__ = require('url').pathToFileURL(__filename).href;"
//   CLEAN_SLATE_APPLY=1 apps/desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron apps/desktop/tmp-clean-slate.cjs
import { app } from "electron";

import { createLocalDatabaseKeyStore } from "../../apps/desktop/electron/main/services/auth/databaseKeyStore";
import { createInventoryResetService } from "../../apps/desktop/electron/main/services/data/inventoryResetService";
import { createProjectMutationService } from "../../apps/desktop/electron/main/services/data/projectMutationService";
import { DatabaseSync } from "../../apps/desktop/electron/main/services/data/nodeSqliteShim";
import type { DatabaseSync as NodeDatabaseSync } from "node:sqlite";

const USER_DATA = `${process.env.HOME}/Library/Application Support/@bukowski/desktop`;
const DB_PATH = `${USER_DATA}/bukowski-foundation.sqlite`;
const DRY_RUN = process.env.CLEAN_SLATE_APPLY !== "1";

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
  db.exec("PRAGMA busy_timeout = 10000;");
  db.exec("PRAGMA foreign_keys = ON;");
  const node = db as unknown as NodeDatabaseSync;

  const inventory = createInventoryResetService(node);
  const projects = createProjectMutationService(node);
  const all = <T,>(sql: string): T[] => db.prepare(sql).all() as T[];

  console.log(`\n${DRY_RUN ? "===== PREVISUALIZACIÓN (no escribe nada) =====" : "===== APLICANDO =====" }`);

  // ---------- inventory, per workspace ----------
  const workspaces = all<{ id: string; name: string }>("SELECT id, name FROM workspaces ORDER BY name");
  for (const workspace of workspaces) {
    console.log(`\n--- INVENTARIO · ${workspace.name} ---`);
    const report = DRY_RUN
      ? inventory.previewInventoryReset(workspace.id)
      : inventory.resetInventory(workspace.id);
    console.log(`   activos: ${report.assetCount}   (en uso: ${report.inUseCount})`);
    console.log(`   códigos escaneables: ${report.scannableCodes} · outbox a limpiar: ${report.clearedOutbox}`);
    // "null" means the row survives with its asset link cleared — that is the
    // branch finance rows travel through.
    for (const reference of report.references) {
      if (reference.rowCount > 0) {
        const verb = reference.action === "null" ? "desvincula" : "BORRA";
        console.log(`   ${verb.padEnd(11)} ${`${reference.table}.${reference.column}`.padEnd(42)} ${reference.rowCount}`);
      }
    }
  }

  // ---------- projects ----------
  const projectRows = all<{ id: string; name: string; status: string; archived_at: string | null }>(
    "SELECT id, name, status, archived_at FROM projects ORDER BY name",
  );
  console.log(`\n--- PROYECTOS (${projectRows.length}) ---`);
  let deleted = 0;
  const failures: string[] = [];
  for (const project of projectRows) {
    if (DRY_RUN) {
      console.log(`   [previsual] ${project.name} · ${project.status}`);
      continue;
    }
    try {
      if (!project.archived_at) projects.archiveProject({ projectId: project.id });
      projects.deleteProject({ projectId: project.id, confirmedWithBackup: true });
      deleted += 1;
      console.log(`   ✓ ${project.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${project.name}: ${message}`);
      console.log(`   ✗ ${project.name} — ${message}`);
    }
  }

  // ---------- dev-only finance leftovers ----------
  const quotes = all<{ n: number }>("SELECT COUNT(*) n FROM quotes")[0]?.n ?? 0;
  const invoices = all<{ n: number }>("SELECT COUNT(*) n FROM invoices")[0]?.n ?? 0;
  console.log(`\n--- PRESUPUESTOS/FACTURAS de desarrollo: ${quotes} + ${invoices} ---`);
  if (!DRY_RUN && quotes + invoices > 0) {
    for (const table of ["quote_items", "quote_versions", "quotes", "invoice_items", "invoice_payments", "invoices"]) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    console.log("   ✓ eliminados");
  }

  console.log("\n--- DEBE SOBREVIVIR ---");
  for (const table of ["invoice_extractions", "software_licenses", "treasury_undo_journal"]) {
    console.log(`   ${table.padEnd(24)} ${all<{ n: number }>(`SELECT COUNT(*) n FROM ${table}`)[0]?.n ?? "?"}`);
  }

  if (!DRY_RUN) {
    console.log(`\nRESUMEN: proyectos ${deleted}/${projectRows.length}`);
    if (failures.length) console.log(`FALLOS:\n  ${failures.join("\n  ")}`);
  } else {
    console.log("\n(previsualización: no se escribió nada. CLEAN_SLATE_APPLY=1 para aplicar)");
  }

  db.close();
  app.exit(failures.length ? 1 : 0);
};

app.whenReady().then(main).catch((error) => {
  console.error("CLEAN_SLATE_FAILED:", error);
  app.exit(1);
});
