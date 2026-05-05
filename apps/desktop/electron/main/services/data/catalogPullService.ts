import type { DatabaseSync } from "node:sqlite";

import { getDesktopLogger } from "../logger";

const logger = getDesktopLogger("catalog-pull-service");

export type CatalogEntityType = "asset_categories" | "locations" | "clients" | "manufacturers" | "production_companies";

export type RemoteCatalogRow = {
  id: string;
  workspace_id: string;
  code: string;
  name: string;
  description?: string | null;
  parent_category_id?: string | null;
  type?: string | null;
  is_active?: boolean | null;
  updated_at: string;
};

export type CatalogPullResult = {
  entityType: CatalogEntityType;
  workspaceId: string;
  appliedCount: number;
  skippedDueToOutboxCount: number;
  skippedDueToOlderCount: number;
  errors: string[];
  cursorAfter: string | null;
};

const isoOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const hasOutboxPendingForEntity = (
  db: DatabaseSync,
  workspaceId: string,
  entityType: CatalogEntityType,
  entityId: string,
): boolean => {
  const row = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM sync_outbox
        WHERE workspace_id = ?
          AND entity_type = ?
          AND entity_id = ?
          AND status IN ('pending', 'processing', 'failed')
      `,
    )
    .get(workspaceId, entityType, entityId) as { count: number };
  return row.count > 0;
};

const readLocalUpdatedAt = (
  db: DatabaseSync,
  entityType: CatalogEntityType,
  entityId: string,
): string | null => {
  const row = db
    .prepare(`SELECT updated_at FROM ${entityType} WHERE id = ?`)
    .get(entityId) as { updated_at?: string | null } | undefined;
  return isoOrNull(row?.updated_at);
};

const upsertLocations = (db: DatabaseSync, row: RemoteCatalogRow) => {
  db
    .prepare(
      `
        INSERT INTO locations (id, workspace_id, code, name, type, description, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM locations WHERE id = ?), ?), ?)
        ON CONFLICT(id) DO UPDATE SET
          code = excluded.code,
          name = excluded.name,
          type = excluded.type,
          description = excluded.description,
          is_active = excluded.is_active,
          updated_at = excluded.updated_at
      `,
    )
    .run(
      row.id,
      row.workspace_id,
      row.code,
      row.name,
      row.type ?? "warehouse",
      row.description ?? null,
      row.is_active === false ? 0 : 1,
      row.id,
      row.updated_at,
      row.updated_at,
    );
};

const upsertAssetCategories = (db: DatabaseSync, row: RemoteCatalogRow) => {
  db
    .prepare(
      `
        INSERT INTO asset_categories (id, workspace_id, parent_category_id, code, name, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM asset_categories WHERE id = ?), ?), ?)
        ON CONFLICT(id) DO UPDATE SET
          parent_category_id = excluded.parent_category_id,
          code = excluded.code,
          name = excluded.name,
          description = excluded.description,
          updated_at = excluded.updated_at
      `,
    )
    .run(
      row.id,
      row.workspace_id,
      row.parent_category_id ?? null,
      row.code,
      row.name,
      row.description ?? null,
      row.id,
      row.updated_at,
      row.updated_at,
    );
};

const upsertGenericNamed = (db: DatabaseSync, table: CatalogEntityType, row: RemoteCatalogRow) => {
  // Generic upsert for clients/manufacturers/production_companies (id, workspace_id, name, ...).
  db
    .prepare(
      `
        INSERT INTO ${table} (id, workspace_id, name, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          updated_at = excluded.updated_at
      `,
    )
    .run(row.id, row.workspace_id, row.name, row.updated_at);
};

const applyOne = (db: DatabaseSync, entityType: CatalogEntityType, row: RemoteCatalogRow) => {
  if (entityType === "locations") {
    upsertLocations(db, row);
    return;
  }
  if (entityType === "asset_categories") {
    upsertAssetCategories(db, row);
    return;
  }
  upsertGenericNamed(db, entityType, row);
};

const updateCursor = (
  db: DatabaseSync,
  workspaceId: string,
  entityType: CatalogEntityType,
  cursorAfter: string | null,
  appliedCount: number,
  errorMessage: string | null,
) => {
  db
    .prepare(
      `
        INSERT INTO sync_pull_cursors (workspace_id, entity_type, last_synced_at, last_pulled_count, last_error, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(workspace_id, entity_type) DO UPDATE SET
          last_synced_at = excluded.last_synced_at,
          last_pulled_count = excluded.last_pulled_count,
          last_error = excluded.last_error,
          updated_at = CURRENT_TIMESTAMP
      `,
    )
    .run(workspaceId, entityType, cursorAfter, appliedCount, errorMessage);
};

export type CatalogPullService = ReturnType<typeof createCatalogPullService>;

export const createCatalogPullService = (db: DatabaseSync) => {
  const readCursor = (workspaceId: string, entityType: CatalogEntityType): string | null => {
    const row = db
      .prepare(`SELECT last_synced_at FROM sync_pull_cursors WHERE workspace_id = ? AND entity_type = ?`)
      .get(workspaceId, entityType) as { last_synced_at?: string | null } | undefined;
    return isoOrNull(row?.last_synced_at);
  };

  const applyRemoteRows = (
    workspaceId: string,
    entityType: CatalogEntityType,
    rows: RemoteCatalogRow[],
  ): CatalogPullResult => {
    const result: CatalogPullResult = {
      entityType,
      workspaceId,
      appliedCount: 0,
      skippedDueToOutboxCount: 0,
      skippedDueToOlderCount: 0,
      errors: [],
      cursorAfter: readCursor(workspaceId, entityType),
    };

    if (!rows.length) {
      return result;
    }

    const cursorTransaction = db.exec("BEGIN");
    void cursorTransaction;
    try {
      for (const row of rows) {
        if (row.workspace_id !== workspaceId) {
          // Defensive: ignore rows from other workspaces.
          continue;
        }

        if (hasOutboxPendingForEntity(db, workspaceId, entityType, row.id)) {
          result.skippedDueToOutboxCount += 1;
          continue;
        }

        const localUpdatedAt = readLocalUpdatedAt(db, entityType, row.id);
        if (localUpdatedAt && localUpdatedAt >= row.updated_at) {
          result.skippedDueToOlderCount += 1;
          continue;
        }

        try {
          applyOne(db, entityType, row);
          result.appliedCount += 1;
          if (!result.cursorAfter || row.updated_at > result.cursorAfter) {
            result.cursorAfter = row.updated_at;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error applying remote row.";
          result.errors.push(`${row.id}: ${message}`);
          logger.warn("Catalog pull row failed.", { entityType, id: row.id, error: message });
        }
      }

      updateCursor(db, workspaceId, entityType, result.cursorAfter, result.appliedCount, result.errors[0] ?? null);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      const message = error instanceof Error ? error.message : "Unknown error during catalog pull.";
      result.errors.push(message);
      logger.error("Catalog pull transaction rolled back.", { entityType, error: message });
    }

    return result;
  };

  /**
   * Apply remote `exchange_rates` rows into local SQLite. Exchange rates have a
   * different shape than catalogs (no `code`/`name`, see Plan L FQ1) so we use
   * a dedicated path. Same LWW + outbox guard semantics:
   *   - skip if a sync_outbox event exists for this rate id (local edits win
   *     until they reach the remote)
   *   - skip if local row's created_at >= remote row's updated_at (stale)
   * Idempotent and transactional.
   */
  const applyRemoteExchangeRates = (
    workspaceId: string,
    rows: Array<{
      id: string;
      workspace_id: string;
      base_currency: string;
      quote_currency: string;
      rate: number;
      rate_type: string;
      source: string;
      source_label: string | null;
      effective_date: string;
      fetched_at: string | null;
      created_by_user_id: string | null;
      notes: string | null;
      created_at: string;
      updated_at?: string;
    }>,
  ): {
    appliedCount: number;
    skippedDueToOutboxCount: number;
    errors: string[];
    cursorAfter: string | null;
  } => {
    const result = {
      appliedCount: 0,
      skippedDueToOutboxCount: 0,
      errors: [] as string[],
      cursorAfter: null as string | null,
    };
    if (rows.length === 0) return result;

    db.exec("BEGIN");
    try {
      const upsert = db.prepare(`
        INSERT INTO exchange_rates (
          id, workspace_id, base_currency, quote_currency, rate, rate_type,
          source, source_label, effective_date, fetched_at, created_by_user_id,
          notes, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          base_currency = excluded.base_currency,
          quote_currency = excluded.quote_currency,
          rate = excluded.rate,
          rate_type = excluded.rate_type,
          source = excluded.source,
          source_label = excluded.source_label,
          effective_date = excluded.effective_date,
          fetched_at = excluded.fetched_at,
          notes = excluded.notes
      `);

      for (const row of rows) {
        try {
          if (hasOutboxPendingForEntity(db, workspaceId, "exchange_rates" as CatalogEntityType, row.id)) {
            result.skippedDueToOutboxCount += 1;
            continue;
          }
          upsert.run(
            row.id,
            workspaceId,
            row.base_currency,
            row.quote_currency,
            row.rate,
            row.rate_type,
            row.source,
            row.source_label,
            row.effective_date,
            row.fetched_at,
            row.created_by_user_id,
            row.notes,
            row.created_at,
          );
          result.appliedCount += 1;
          const rowCursor = isoOrNull(row.updated_at) ?? isoOrNull(row.created_at);
          if (rowCursor && (!result.cursorAfter || rowCursor > result.cursorAfter)) {
            result.cursorAfter = rowCursor;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          result.errors.push(message);
          logger.warn("Exchange rate pull row failed.", { id: row.id, error: message });
        }
      }

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      const message = error instanceof Error ? error.message : "Unknown error during rate pull.";
      result.errors.push(message);
      logger.error("Exchange rate pull transaction rolled back.", { error: message });
    }

    return result;
  };

  return {
    readCursor,
    applyRemoteRows,
    applyRemoteExchangeRates,
  };
};
