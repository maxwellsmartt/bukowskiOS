import type { DatabaseSync } from "node:sqlite";

import { getDesktopLogger } from "../logger";
import { isLocalTimestampAtLeastAsNew } from "./syncTimestampPolicy";

const logger = getDesktopLogger("catalog-pull-service");

export type CatalogEntityType =
  | "asset_categories"
  | "locations"
  | "clients"
  | "manufacturers"
  | "production_companies"
  | "crew_members"
  | "departments";

export type RemoteCatalogRow = {
  id: string;
  workspace_id: string;
  code?: string | null;
  name?: string | null;
  description?: string | null;
  parent_category_id?: string | null;
  type?: string | null;
  is_active?: boolean | number | null;
  updated_at: string;
  // Business-catalog fields (clients / manufacturers / production_companies).
  contact_name?: string | null;
  email?: string | null;
  support_email?: string | null;
  phone?: string | null;
  rnc?: string | null;
  pur?: string | null;
  notes?: string | null;
  // crew_members
  full_name?: string | null;
  role_label?: string | null;
  default_daily_rate?: number | null;
  default_weekly_rate?: number | null;
  default_overtime_rate?: number | null;
  rate_currency?: string | null;
};

// departments is the only synced catalog without a local updated_at column
// (it tracks created_at only); the remote mirror carries updated_at for the
// pull cursor, and locally we fall back to created_at for the staleness check.
const localTimestampColumn = (entityType: CatalogEntityType) => (entityType === "departments" ? "created_at" : "updated_at");

export type CatalogPullResult = {
  entityType: CatalogEntityType;
  workspaceId: string;
  appliedCount: number;
  skippedDueToOutboxCount: number;
  skippedDueToOlderCount: number;
  errors: string[];
  cursorAfter: string | null;
};

const outboxEntityTypeByCatalog: Record<CatalogEntityType, string> = {
  asset_categories: "category",
  locations: "location",
  clients: "client",
  manufacturers: "manufacturer",
  production_companies: "production_company",
  crew_members: "crew",
  departments: "department",
};

const naturalKeyByCatalog: Partial<Record<CatalogEntityType, "code" | "name">> = {
  asset_categories: "code",
  locations: "code",
  clients: "name",
  manufacturers: "name",
  production_companies: "name",
  departments: "code",
};

const safeIdentifier = (value: string): string => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe SQLite identifier: ${value}`);
  }
  return `"${value}"`;
};

type ForeignKeyReference = { table: string; from: string; to: string };

const readForeignKeyReferences = (db: DatabaseSync, parentTable: string): ForeignKeyReference[] => {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  ).all() as Array<{ name: string }>;

  return tables.flatMap(({ name }) => {
    const table = safeIdentifier(name);
    const foreignKeys = db.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{
      table: string;
      from: string;
      to: string;
    }>;
    return foreignKeys
      .filter((foreignKey) => foreignKey.table === parentTable && foreignKey.to === "id")
      .map((foreignKey) => ({ table: name, from: foreignKey.from, to: foreignKey.to }));
  });
};

const mergeSafeRelationshipTables = new Set(["project_departments", "project_unit_departments"]);

/**
 * Replaces a workstation-local catalog id with the server-authoritative id.
 * Every FK is discovered from SQLite so newly added dependent tables are not
 * silently missed. The caller must already be inside a transaction.
 */
export const adoptCanonicalCatalogId = (
  db: DatabaseSync,
  input: {
    workspaceId: string;
    entityType: CatalogEntityType;
    localId: string;
    canonicalId: string;
  },
) => {
  if (input.localId === input.canonicalId) return;

  db.exec("PRAGMA defer_foreign_keys = ON");
  for (const reference of readForeignKeyReferences(db, input.entityType)) {
    const table = safeIdentifier(reference.table);
    const column = safeIdentifier(reference.from);
    if (mergeSafeRelationshipTables.has(reference.table)) {
      db.prepare(`UPDATE OR IGNORE ${table} SET ${column} = ? WHERE ${column} = ?`)
        .run(input.canonicalId, input.localId);
      db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(input.localId);
      continue;
    }
    db.prepare(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`)
      .run(input.canonicalId, input.localId);
  }

  db.prepare(`UPDATE ${safeIdentifier(input.entityType)} SET id = ? WHERE id = ? AND workspace_id = ?`)
    .run(input.canonicalId, input.localId, input.workspaceId);
  db.prepare(
    `UPDATE sync_outbox
     SET entity_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE workspace_id = ? AND entity_type = ? AND entity_id = ?
       AND status IN ('pending', 'processing', 'failed')`,
  ).run(
    input.canonicalId,
    input.workspaceId,
    outboxEntityTypeByCatalog[input.entityType],
    input.localId,
  );
};

const reconcileNaturalKeyIdentity = (
  db: DatabaseSync,
  entityType: CatalogEntityType,
  row: RemoteCatalogRow,
) => {
  const naturalKey = naturalKeyByCatalog[entityType];
  const naturalValue = naturalKey ? row[naturalKey] : null;
  if (!naturalKey || typeof naturalValue !== "string" || !naturalValue.trim()) return;

  const collision = db.prepare(
    `SELECT id FROM ${safeIdentifier(entityType)}
     WHERE workspace_id = ? AND id <> ? AND lower(${safeIdentifier(naturalKey)}) = lower(?)
     LIMIT 1`,
  ).get(row.workspace_id, row.id, naturalValue.trim()) as { id: string } | undefined;
  if (!collision) return;

  adoptCanonicalCatalogId(db, {
    workspaceId: row.workspace_id,
    entityType,
    localId: collision.id,
    canonicalId: row.id,
  });
};

const isoOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const hasOutboxPendingForEntity = (
  db: DatabaseSync,
  workspaceId: string,
  entityType: CatalogEntityType | "exchange_rate",
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
    .get(
      workspaceId,
      entityType === "exchange_rate" ? entityType : outboxEntityTypeByCatalog[entityType],
      entityId,
    ) as { count: number };
  return row.count > 0;
};

const readLocalUpdatedAt = (
  db: DatabaseSync,
  entityType: CatalogEntityType,
  entityId: string,
): string | null => {
  const column = localTimestampColumn(entityType);
  const row = db
    .prepare(`SELECT ${column} AS ts FROM ${entityType} WHERE id = ?`)
    .get(entityId) as { ts?: string | null } | undefined;
  return isoOrNull(row?.ts);
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
      row.code ?? "",
      row.name ?? "",
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
      row.code ?? "",
      row.name ?? "",
      row.description ?? null,
      row.id,
      row.updated_at,
      row.updated_at,
    );
};

// Accept boolean (locations) or integer (crew_members/clients…) is_active; only
// an explicit false / 0 means inactive.
const activeFlag = (row: RemoteCatalogRow) => (row.is_active === false || row.is_active === 0 ? 0 : 1);

const upsertClients = (db: DatabaseSync, row: RemoteCatalogRow) => {
  db
    .prepare(
      `
        INSERT INTO clients (id, workspace_id, name, contact_name, email, phone, rnc, notes, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM clients WHERE id = ?), ?), ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          contact_name = excluded.contact_name,
          email = excluded.email,
          phone = excluded.phone,
          rnc = excluded.rnc,
          notes = excluded.notes,
          is_active = excluded.is_active,
          updated_at = excluded.updated_at
      `,
    )
    .run(
      row.id,
      row.workspace_id,
      row.name ?? "",
      row.contact_name ?? null,
      row.email ?? null,
      row.phone ?? null,
      row.rnc ?? null,
      row.notes ?? null,
      activeFlag(row),
      row.id,
      row.updated_at,
      row.updated_at,
    );
};

const upsertManufacturers = (db: DatabaseSync, row: RemoteCatalogRow) => {
  db
    .prepare(
      `
        INSERT INTO manufacturers (id, workspace_id, name, contact_name, support_email, phone, notes, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM manufacturers WHERE id = ?), ?), ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          contact_name = excluded.contact_name,
          support_email = excluded.support_email,
          phone = excluded.phone,
          notes = excluded.notes,
          is_active = excluded.is_active,
          updated_at = excluded.updated_at
      `,
    )
    .run(
      row.id,
      row.workspace_id,
      row.name ?? "",
      row.contact_name ?? null,
      row.support_email ?? null,
      row.phone ?? null,
      row.notes ?? null,
      activeFlag(row),
      row.id,
      row.updated_at,
      row.updated_at,
    );
};

const upsertProductionCompanies = (db: DatabaseSync, row: RemoteCatalogRow) => {
  db
    .prepare(
      `
        INSERT INTO production_companies (id, workspace_id, name, contact_name, email, phone, pur, notes, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM production_companies WHERE id = ?), ?), ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          contact_name = excluded.contact_name,
          email = excluded.email,
          phone = excluded.phone,
          pur = excluded.pur,
          notes = excluded.notes,
          is_active = excluded.is_active,
          updated_at = excluded.updated_at
      `,
    )
    .run(
      row.id,
      row.workspace_id,
      row.name ?? "",
      row.contact_name ?? null,
      row.email ?? null,
      row.phone ?? null,
      row.pur ?? null,
      row.notes ?? null,
      activeFlag(row),
      row.id,
      row.updated_at,
      row.updated_at,
    );
};

const upsertCrewMembers = (db: DatabaseSync, row: RemoteCatalogRow) => {
  // FK columns (primary_department_id, document_id, linked_user_id) are
  // intentionally left to the local row: hydrating them here risks an FK
  // failure if the referenced row hasn't synced yet, and they aren't needed to
  // resolve project crew assignments (those only need the crew row to exist).
  // Identity, contact and payroll-rate columns are safe plain values.
  db
    .prepare(
      `
        INSERT INTO crew_members (
          id, workspace_id, full_name, role_label, email, phone, notes, is_active,
          default_daily_rate, default_weekly_rate, default_overtime_rate, rate_currency,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM crew_members WHERE id = ?), ?), ?)
        ON CONFLICT(id) DO UPDATE SET
          full_name = excluded.full_name,
          role_label = excluded.role_label,
          email = excluded.email,
          phone = excluded.phone,
          notes = excluded.notes,
          is_active = excluded.is_active,
          default_daily_rate = excluded.default_daily_rate,
          default_weekly_rate = excluded.default_weekly_rate,
          default_overtime_rate = excluded.default_overtime_rate,
          rate_currency = excluded.rate_currency,
          updated_at = excluded.updated_at
      `,
    )
    .run(
      row.id,
      row.workspace_id,
      row.full_name ?? row.name ?? "",
      row.role_label ?? null,
      row.email ?? null,
      row.phone ?? null,
      row.notes ?? null,
      activeFlag(row),
      row.default_daily_rate ?? null,
      row.default_weekly_rate ?? null,
      row.default_overtime_rate ?? null,
      row.rate_currency ?? null,
      row.id,
      row.updated_at,
      row.updated_at,
    );
};

const upsertDepartments = (db: DatabaseSync, row: RemoteCatalogRow) => {
  // Local departments has no updated_at column — only created_at.
  db
    .prepare(
      `
        INSERT INTO departments (id, workspace_id, code, name, description, is_active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM departments WHERE id = ?), ?))
        ON CONFLICT(id) DO UPDATE SET
          code = excluded.code,
          name = excluded.name,
          description = excluded.description,
          is_active = excluded.is_active
      `,
    )
    .run(
      row.id,
      row.workspace_id,
      row.code ?? "",
      row.name ?? "",
      row.description ?? null,
      activeFlag(row),
      row.id,
      row.updated_at,
    );
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
  if (entityType === "manufacturers") {
    upsertManufacturers(db, row);
    return;
  }
  if (entityType === "production_companies") {
    upsertProductionCompanies(db, row);
    return;
  }
  if (entityType === "crew_members") {
    upsertCrewMembers(db, row);
    return;
  }
  if (entityType === "departments") {
    upsertDepartments(db, row);
    return;
  }
  upsertClients(db, row);
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

        db.exec("SAVEPOINT catalog_pull_row");
        try {
          reconcileNaturalKeyIdentity(db, entityType, row);

          if (hasOutboxPendingForEntity(db, workspaceId, entityType, row.id)) {
            db.exec("RELEASE SAVEPOINT catalog_pull_row");
            result.skippedDueToOutboxCount += 1;
            continue;
          }

          const localUpdatedAt = readLocalUpdatedAt(db, entityType, row.id);
          if (localUpdatedAt && isLocalTimestampAtLeastAsNew(localUpdatedAt, row.updated_at)) {
            db.exec("RELEASE SAVEPOINT catalog_pull_row");
            result.skippedDueToOlderCount += 1;
            continue;
          }

          applyOne(db, entityType, row);
          db.exec("RELEASE SAVEPOINT catalog_pull_row");
          result.appliedCount += 1;
          if (!result.cursorAfter || row.updated_at > result.cursorAfter) {
            result.cursorAfter = row.updated_at;
          }
        } catch (error) {
          db.exec("ROLLBACK TO SAVEPOINT catalog_pull_row");
          db.exec("RELEASE SAVEPOINT catalog_pull_row");
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
          if (hasOutboxPendingForEntity(db, workspaceId, "exchange_rate", row.id)) {
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
