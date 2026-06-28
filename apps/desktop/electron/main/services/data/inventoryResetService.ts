import type { DatabaseSync } from "node:sqlite";

import type { InventoryResetReport } from "@contracts";

import { getDesktopLogger } from "../logger";

const logger = getDesktopLogger("inventory-reset-service");

const safeIdentifier = (value: string): string => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQLite identifier: ${value}`);
  }
  return `"${value}"`;
};

const tableExists = (db: DatabaseSync, table: string): boolean =>
  Boolean(
    db
      .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
      .get(table),
  );

const countRows = (db: DatabaseSync, sql: string, ...params: string[]): number => {
  try {
    const row = db.prepare(sql).get(...params) as { c?: number } | undefined;
    return row?.c ?? 0;
  } catch (error) {
    logger.warn("Inventory reset count failed.", { error: error instanceof Error ? error.message : String(error) });
    return 0;
  }
};

export type AssetReference = { table: string; column: string; nullable: boolean };

/**
 * Every table with a foreign key to assets(id), discovered from the live schema
 * so a newly added dependent table is never silently missed by the reset.
 */
export const readAssetReferences = (db: DatabaseSync): AssetReference[] => {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;

  const references: AssetReference[] = [];
  for (const { name } of tables) {
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${safeIdentifier(name)})`).all() as Array<{
      table: string;
      from: string;
      to: string;
    }>;
    const columns = db.prepare(`PRAGMA table_info(${safeIdentifier(name)})`).all() as Array<{
      name: string;
      notnull: number;
      pk: number;
    }>;
    for (const foreignKey of foreignKeys) {
      if (foreignKey.table === "assets" && foreignKey.to === "id") {
        const column = columns.find((candidate) => candidate.name === foreignKey.from);
        // SQLite quirk: a (non-INTEGER) PRIMARY KEY column reports notnull=0, so a
        // PK foreign key (e.g. asset_current_state.asset_id) must be treated as
        // required — delete the row, never null it.
        references.push({
          table: name,
          column: foreignKey.from,
          nullable: column ? column.notnull === 0 && column.pk === 0 : true,
        });
      }
    }
  }
  return references.sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column));
};

const tableHasColumn = (db: DatabaseSync, table: string, column: string): boolean =>
  (db.prepare(`PRAGMA table_info(${safeIdentifier(table)})`).all() as Array<{ name: string }>).some((c) => c.name === column);

/**
 * Nullable foreign keys that point INTO the tables being deleted, from tables
 * that survive (e.g. incidents.assignment_id → asset_assignments). These must be
 * unlinked or they dangle when the asset graph is wiped.
 */
const readExternalNullableReferences = (
  db: DatabaseSync,
  targetTables: Set<string>,
): Array<{ table: string; column: string }> => {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  const refs: Array<{ table: string; column: string }> = [];
  for (const { name } of tables) {
    if (targetTables.has(name)) continue;
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${safeIdentifier(name)})`).all() as Array<{ table: string; from: string }>;
    const columns = db.prepare(`PRAGMA table_info(${safeIdentifier(name)})`).all() as Array<{ name: string; notnull: number; pk: number }>;
    for (const foreignKey of foreignKeys) {
      if (!targetTables.has(foreignKey.table)) continue;
      const column = columns.find((candidate) => candidate.name === foreignKey.from);
      if (column && column.notnull === 0 && column.pk === 0) refs.push({ table: name, column: foreignKey.from });
    }
  }
  return refs;
};

const workspaceAssetFilter = (column: string) =>
  `${safeIdentifier(column)} IN (SELECT id FROM assets WHERE workspace_id = ?)`;

const buildReport = (db: DatabaseSync, workspaceId: string, dryRun: boolean): InventoryResetReport => {
  const assetCount = countRows(db, "SELECT COUNT(*) AS c FROM assets WHERE workspace_id = ?", workspaceId);

  const inUseCount = countRows(
    db,
    `SELECT COUNT(*) AS c
       FROM assets a
       JOIN asset_current_state s ON s.asset_id = a.id
       LEFT JOIN projects p ON p.id = s.current_project_id
      WHERE a.workspace_id = ? AND a.is_active = 1
        AND ((p.id IS NOT NULL AND p.status <> 'Wrapped')
             OR s.active_assignment_id IS NOT NULL
             OR COALESCE(s.custody_status, 'available') <> 'available'
             OR COALESCE(s.assigned_quantity, 0) > 0
             OR COALESCE(s.checked_out_quantity, 0) > 0)`,
    workspaceId,
  );

  const references = readAssetReferences(db).map((reference) => {
    const rowCount = countRows(
      db,
      `SELECT COUNT(*) AS c FROM ${safeIdentifier(reference.table)} WHERE ${workspaceAssetFilter(reference.column)}`,
      workspaceId,
    );
    // A required asset link can't survive without its asset → delete the row.
    // An optional link is unlinked (nulled) so the operational record survives.
    return { table: reference.table, column: reference.column, rowCount, action: reference.nullable ? "null" as const : "delete" as const };
  });

  return {
    workspaceId,
    dryRun,
    assetCount,
    inUseCount,
    references,
    legacyImports: countRows(db, "SELECT COUNT(*) AS c FROM legacy_rentman_imports WHERE workspace_id = ?", workspaceId),
    legacyItems: countRows(db, "SELECT COUNT(*) AS c FROM legacy_rentman_items WHERE workspace_id = ?", workspaceId),
    scannableCodes: countRows(
      db,
      "SELECT COUNT(*) AS c FROM scannable_codes WHERE workspace_id = ? AND entity_type = 'asset'",
      workspaceId,
    ),
    clearedOutbox: countRows(
      db,
      "SELECT COUNT(*) AS c FROM sync_outbox WHERE workspace_id = ? AND entity_type LIKE 'asset%'",
      workspaceId,
    ),
  };
};

/**
 * Wipes a workspace's entire equipment inventory locally so a clean re-import can
 * recreate it from scratch. Deletes the asset graph (state, events, assignments,
 * files, kit memberships, the legacy Rentman import records) and unlinks any
 * optional operational references (incidents, financial entries) so those records
 * survive. Clears the asset outbox and resets the asset pull cursor so the machine
 * re-pulls a clean inventory from the (separately wiped) cloud.
 *
 * `dryRun` returns the exact counts without deleting anything — always preview first.
 */
export const resetWorkspaceInventory = (
  db: DatabaseSync,
  input: { workspaceId: string; dryRun: boolean },
): InventoryResetReport => {
  const report = buildReport(db, input.workspaceId, input.dryRun);
  if (input.dryRun) {
    return report;
  }

  const { workspaceId } = input;
  const references = readAssetReferences(db);
  // Tables fully removed: assets, the legacy import records, and every table whose
  // asset link is required (state, events, assignments, files, kit memberships…).
  const deletedTables = new Set<string>(["assets", "legacy_rentman_items", "legacy_rentman_imports"]);
  for (const reference of references) {
    if (!reference.nullable) deletedTables.add(reference.table);
  }

  db.exec("BEGIN");
  db.exec("PRAGMA defer_foreign_keys = ON");
  try {
    // Unlink optional asset references on surviving records (incidents.asset_id,
    // financial_entries.asset_id…).
    for (const reference of references) {
      if (reference.nullable) {
        db.prepare(
          `UPDATE ${safeIdentifier(reference.table)} SET ${safeIdentifier(reference.column)} = NULL WHERE ${workspaceAssetFilter(reference.column)}`,
        ).run(workspaceId);
      }
    }

    // Unlink optional references that point into the asset graph from surviving
    // tables (e.g. incidents.assignment_id → asset_assignments), scoped to the
    // workspace whose entire asset graph is being wiped.
    for (const external of readExternalNullableReferences(db, deletedTables)) {
      if (tableHasColumn(db, external.table, "workspace_id")) {
        db.prepare(
          `UPDATE ${safeIdentifier(external.table)} SET ${safeIdentifier(external.column)} = NULL WHERE workspace_id = ? AND ${safeIdentifier(external.column)} IS NOT NULL`,
        ).run(workspaceId);
      }
    }

    // Delete every required asset link (these can't survive without their asset).
    for (const reference of references) {
      if (!reference.nullable) {
        db.prepare(`DELETE FROM ${safeIdentifier(reference.table)} WHERE ${workspaceAssetFilter(reference.column)}`).run(workspaceId);
      }
    }

    if (tableExists(db, "scannable_codes")) {
      db.prepare("DELETE FROM scannable_codes WHERE workspace_id = ? AND entity_type = 'asset'").run(workspaceId);
    }
    // Legacy Rentman import records are local-only and only describe assets.
    for (const table of ["legacy_rentman_items", "legacy_rentman_imports"]) {
      if (tableExists(db, table)) {
        db.prepare(`DELETE FROM ${safeIdentifier(table)} WHERE workspace_id = ?`).run(workspaceId);
      }
    }

    db.prepare("DELETE FROM assets WHERE workspace_id = ?").run(workspaceId);

    // Drop any queued asset pushes so the wipe never propagates as outbound edits,
    // and reset the asset pull cursor so the machine re-pulls a clean inventory.
    db.prepare("DELETE FROM sync_outbox WHERE workspace_id = ? AND entity_type LIKE 'asset%'").run(workspaceId);
    db.prepare("DELETE FROM sync_pull_cursors WHERE workspace_id = ? AND entity_type IN ('asset_snapshots', 'asset_current_state')").run(workspaceId);

    db.exec("COMMIT");
    logger.info("Workspace inventory reset.", { workspaceId, assetCount: report.assetCount });
  } catch (error) {
    let message = error instanceof Error ? error.message : "Unknown inventory reset error.";
    if (/foreign key/i.test(message)) {
      try {
        const violations = db.prepare("PRAGMA foreign_key_check").all() as Array<{ table?: string; parent?: string }>;
        const detail = Array.from(new Set(violations.slice(0, 8).map((violation) => `${violation.table ?? "?"} → ${violation.parent ?? "?"}`))).join("; ");
        if (detail) message = `${message}: ${detail}`;
      } catch {
        /* best effort */
      }
    }
    db.exec("ROLLBACK");
    logger.error("Inventory reset rolled back.", { workspaceId, error: message });
    throw new Error(`Inventory reset failed: ${message}`);
  }

  return report;
};

export type InventoryResetService = ReturnType<typeof createInventoryResetService>;

export const createInventoryResetService = (db: DatabaseSync) => ({
  previewInventoryReset: (workspaceId: string): InventoryResetReport =>
    resetWorkspaceInventory(db, { workspaceId, dryRun: true }),
  resetInventory: (workspaceId: string): InventoryResetReport =>
    resetWorkspaceInventory(db, { workspaceId, dryRun: false }),
});
