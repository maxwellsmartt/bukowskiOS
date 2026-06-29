import type { DatabaseSync } from "node:sqlite";

import { getDesktopLogger } from "../logger";
import { isLocalTimestampAtLeastAsNew } from "./syncTimestampPolicy";

const logger = getDesktopLogger("asset-snapshot-pull-service");

export type RemoteAssetSnapshotRow = {
  id: string;
  workspace_id: string;
  category_id: string;
  name: string;
  brand?: string | null;
  model?: string | null;
  serial_number?: string | null;
  internal_code: string;
  description?: string | null;
  purchase_date?: string | null;
  purchase_price?: number | null;
  additional_costs?: number | null;
  currency?: string | null;
  replacement_value?: number | null;
  current_book_value?: number | null;
  ownership_type?: string | null;
  default_location_id?: string | null;
  qr_code_value?: string | null;
  notes?: string | null;
  is_active?: boolean | null;
  created_at: string;
  updated_at: string;
};

export type RemoteAssetCurrentStateRow = {
  asset_id: string;
  workspace_id: string;
  current_location_id?: string | null;
  current_project_id?: string | null;
  current_department_id?: string | null;
  current_responsible_user_id?: string | null;
  active_assignment_id?: string | null;
  condition_status: string;
  operational_status: string;
  custody_status: string;
  last_event_id: string;
  version?: number | null;
  updated_at: string;
  project_unit_id?: string | null;
  total_quantity?: number | null;
  available_quantity?: number | null;
  assigned_quantity?: number | null;
  checked_out_quantity?: number | null;
};

export type AssetSnapshotPullResult = {
  workspaceId: string;
  appliedCount: number;
  skippedDueToOutboxCount: number;
  skippedDueToOlderCount: number;
  missingAssetCount: number;
  errors: string[];
  cursorAfter: string | null;
};

const isoOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const hasOutboxPendingForAsset = (db: DatabaseSync, workspaceId: string, assetId: string) => {
  const row = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM sync_outbox
        WHERE workspace_id = ?
          AND entity_type = 'asset_event'
          AND entity_id = ?
          AND status IN ('pending', 'processing', 'failed')
      `,
    )
    .get(workspaceId, assetId) as { count: number };
  return row.count > 0;
};

const readAssetUpdatedAt = (db: DatabaseSync, workspaceId: string, assetId: string) => {
  const row = db.prepare("SELECT updated_at FROM assets WHERE id = ? AND workspace_id = ? LIMIT 1").get(assetId, workspaceId) as
    | { updated_at?: string | null }
    | undefined;
  return isoOrNull(row?.updated_at);
};

const readStateUpdatedAt = (db: DatabaseSync, workspaceId: string, assetId: string) => {
  const row = db.prepare("SELECT updated_at FROM asset_current_state WHERE asset_id = ? AND workspace_id = ? LIMIT 1").get(assetId, workspaceId) as
    | { updated_at?: string | null }
    | undefined;
  return isoOrNull(row?.updated_at);
};

const existsById = (db: DatabaseSync, table: string, id: string | null | undefined) => {
  if (!id) return null;
  const row = db.prepare(`SELECT id FROM ${table} WHERE id = ? LIMIT 1`).get(id) as { id?: string } | undefined;
  return row?.id ? id : null;
};

const requireReference = (db: DatabaseSync, table: string, id: string | null | undefined, label: string) => {
  if (!id) return null;
  const existing = existsById(db, table, id);
  if (!existing) throw new Error(`${label} ${id} is not available locally yet; snapshot deferred.`);
  return existing;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// asset_categories, locations and departments are UUID-keyed in the cloud. A
// non-UUID id on those columns is a legacy (Rentman 2021 import) ghost the
// UUID-keyed cloud can never deliver — it must not wedge the asset pull forever.
// A UUID that's merely late still defers and retries.
const isLegacyGhostId = (id: string) => !UUID_RE.test(id);

// Materialize a recognizable placeholder for a ghost category so the asset still
// lands (the column is NOT NULL) and the pull cursor advances. The code is the
// id itself to satisfy UNIQUE(workspace_id, code); the name surfaces the legacy
// code so the team can see and reconcile it later.
const ensureCategoryPlaceholder = (db: DatabaseSync, workspaceId: string, categoryId: string) => {
  const code = /^category-([a-z0-9]+)-/i.exec(categoryId)?.[1]?.toUpperCase() ?? "RENTMAN";
  const now = new Date().toISOString();
  db
    .prepare(
      `INSERT OR IGNORE INTO asset_categories (id, workspace_id, parent_category_id, code, name, description, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
    )
    .run(categoryId, workspaceId, categoryId, `${code} (Rentman)`, "Categoría del import Rentman pendiente de reconciliar.", now, now);
  return categoryId;
};

const resolveCategoryReference = (db: DatabaseSync, workspaceId: string, id: string) => {
  if (existsById(db, "asset_categories", id)) return id;
  if (!isLegacyGhostId(id)) throw new Error(`Category ${id} is not available locally yet; snapshot deferred.`);
  return ensureCategoryPlaceholder(db, workspaceId, id);
};

// For an optional UUID-keyed reference: keep it if present, defer if a real UUID
// hasn't synced yet, and drop a legacy ghost id rather than wedge the pull.
const resolveUuidKeyedReference = (db: DatabaseSync, table: string, id: string | null | undefined, label: string) => {
  if (!id) return null;
  if (existsById(db, table, id)) return id;
  if (!isLegacyGhostId(id)) throw new Error(`${label} ${id} is not available locally yet; snapshot deferred.`);
  return null;
};

const ensureHydrationEvent = (db: DatabaseSync, workspaceId: string, assetId: string, stateUpdatedAt: string) => {
  const eventId = `remote-hydration-${assetId}`;
  db
    .prepare(
      `
        INSERT OR IGNORE INTO asset_events (
          id,
          workspace_id,
          asset_id,
          assignment_id,
          project_id,
          department_id,
          performed_by_user_id,
          event_type,
          location_id,
          from_location_id,
          to_location_id,
          event_timestamp,
          command_id,
          actor_type,
          source_channel,
          notes,
          metadata_json,
          created_at
        )
        VALUES (?, ?, ?, NULL, NULL, NULL, 'user-ops', 'remote_hydration', NULL, NULL, NULL, ?, ?, 'system', 'supabase', NULL, NULL, ?)
      `,
    )
    .run(eventId, workspaceId, assetId, stateUpdatedAt, eventId, stateUpdatedAt);
  return eventId;
};

const upsertAsset = (db: DatabaseSync, asset: RemoteAssetSnapshotRow) => {
  const categoryId = resolveCategoryReference(db, asset.workspace_id, asset.category_id);
  const defaultLocationId = resolveUuidKeyedReference(db, "locations", asset.default_location_id, "Default location");

  db
    .prepare(
      `
        INSERT INTO assets (
          id, workspace_id, category_id, name, brand, model, serial_number, internal_code,
          description, purchase_date, purchase_price, additional_costs, currency, replacement_value,
          current_book_value, ownership_type, default_location_id, qr_code_value, notes, is_active,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          category_id = excluded.category_id,
          name = excluded.name,
          brand = excluded.brand,
          model = excluded.model,
          serial_number = excluded.serial_number,
          internal_code = excluded.internal_code,
          description = excluded.description,
          purchase_date = excluded.purchase_date,
          purchase_price = excluded.purchase_price,
          additional_costs = excluded.additional_costs,
          currency = excluded.currency,
          replacement_value = excluded.replacement_value,
          current_book_value = excluded.current_book_value,
          ownership_type = excluded.ownership_type,
          default_location_id = excluded.default_location_id,
          qr_code_value = excluded.qr_code_value,
          notes = excluded.notes,
          is_active = excluded.is_active,
          updated_at = excluded.updated_at
        WHERE assets.workspace_id = excluded.workspace_id
      `,
    )
    .run(
      asset.id,
      asset.workspace_id,
      categoryId,
      asset.name,
      asset.brand ?? null,
      asset.model ?? null,
      asset.serial_number ?? null,
      asset.internal_code,
      asset.description ?? null,
      asset.purchase_date ?? null,
      asset.purchase_price ?? null,
      asset.additional_costs ?? null,
      asset.currency ?? null,
      asset.replacement_value ?? null,
      asset.current_book_value ?? null,
      asset.ownership_type ?? null,
      defaultLocationId,
      asset.qr_code_value ?? null,
      asset.notes ?? null,
      asset.is_active === false ? 0 : 1,
      asset.created_at,
      asset.updated_at,
    );
};

const upsertState = (db: DatabaseSync, state: RemoteAssetCurrentStateRow) => {
  // Validate every relationship before writing anything. Missing parents are a
  // retryable ordering condition, never a reason to erase a business link.
  // Locations and departments are UUID-keyed in the cloud — drop a legacy ghost
  // id instead of wedging. Projects, units and users keep deferring (their ids
  // are text-keyed and do still sync, so a missing one is a real ordering wait).
  const currentLocationId = resolveUuidKeyedReference(db, "locations", state.current_location_id, "Current location");
  const currentProjectId = requireReference(db, "projects", state.current_project_id, "Current project");
  const currentDepartmentId = resolveUuidKeyedReference(db, "departments", state.current_department_id, "Current department");
  const currentResponsibleUserId = requireReference(db, "users", state.current_responsible_user_id, "Responsible user");
  const projectUnitId = requireReference(db, "project_units", state.project_unit_id, "Project unit");
  const hydrationEventId = ensureHydrationEvent(db, state.workspace_id, state.asset_id, state.updated_at);

  db
    .prepare(
      `
        INSERT INTO asset_current_state (
          asset_id, workspace_id, current_location_id, current_project_id, current_department_id,
          current_responsible_user_id, active_assignment_id, condition_status, operational_status,
          custody_status, last_event_id, version, updated_at, project_unit_id, total_quantity,
          available_quantity, assigned_quantity, checked_out_quantity
        )
        VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(asset_id) DO UPDATE SET
          current_location_id = excluded.current_location_id,
          current_project_id = excluded.current_project_id,
          current_department_id = excluded.current_department_id,
          current_responsible_user_id = excluded.current_responsible_user_id,
          active_assignment_id = excluded.active_assignment_id,
          condition_status = excluded.condition_status,
          operational_status = excluded.operational_status,
          custody_status = excluded.custody_status,
          last_event_id = excluded.last_event_id,
          version = excluded.version,
          updated_at = excluded.updated_at,
          project_unit_id = excluded.project_unit_id,
          total_quantity = excluded.total_quantity,
          available_quantity = excluded.available_quantity,
          assigned_quantity = excluded.assigned_quantity,
          checked_out_quantity = excluded.checked_out_quantity
        WHERE asset_current_state.workspace_id = excluded.workspace_id
      `,
    )
    .run(
      state.asset_id,
      state.workspace_id,
      currentLocationId,
      currentProjectId,
      currentDepartmentId,
      currentResponsibleUserId,
      state.condition_status,
      state.operational_status,
      state.custody_status,
      hydrationEventId,
      state.version ?? 1,
      state.updated_at,
      projectUnitId,
      state.total_quantity ?? 1,
      state.available_quantity ?? 1,
      state.assigned_quantity ?? 0,
      state.checked_out_quantity ?? 0,
    );
};

const updateCursor = (
  db: DatabaseSync,
  workspaceId: string,
  cursorAfter: string | null,
  appliedCount: number,
  errorMessage: string | null,
) => {
  db
    .prepare(
      `
        INSERT INTO sync_pull_cursors (workspace_id, entity_type, last_synced_at, last_pulled_count, last_error, updated_at)
        VALUES (?, 'asset_snapshots', ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(workspace_id, entity_type) DO UPDATE SET
          last_synced_at = excluded.last_synced_at,
          last_pulled_count = excluded.last_pulled_count,
          last_error = excluded.last_error,
          updated_at = CURRENT_TIMESTAMP
      `,
    )
    .run(workspaceId, cursorAfter, appliedCount, errorMessage);
};

export const createAssetSnapshotPullService = (db: DatabaseSync) => ({
  applyRemoteSnapshots(
    workspaceId: string,
    assets: RemoteAssetSnapshotRow[],
    states: RemoteAssetCurrentStateRow[],
  ): AssetSnapshotPullResult {
    const result: AssetSnapshotPullResult = {
      workspaceId,
      appliedCount: 0,
      skippedDueToOutboxCount: 0,
      skippedDueToOlderCount: 0,
      missingAssetCount: 0,
      errors: [],
      cursorAfter: null,
    };

    const workspaceAssets = assets.filter((asset) => asset.workspace_id === workspaceId);
    const assetsById = new Map(workspaceAssets.map((asset) => [asset.id, asset]));
    const processedAssetIds = new Set<string>();

    const advanceDiagnosticCursor = (timestamp: string) => {
      if (!result.cursorAfter || timestamp > result.cursorAfter) result.cursorAfter = timestamp;
    };

    const applyAtomically = (assetId: string, apply: () => boolean) => {
      db.exec("SAVEPOINT asset_snapshot_row");
      try {
        const applied = apply();
        db.exec("RELEASE SAVEPOINT asset_snapshot_row");
        if (applied) result.appliedCount += 1;
      } catch (error) {
        db.exec("ROLLBACK TO SAVEPOINT asset_snapshot_row");
        db.exec("RELEASE SAVEPOINT asset_snapshot_row");
        const message = error instanceof Error ? error.message : "Unknown error applying remote asset snapshot.";
        result.errors.push(`${assetId}: ${message}`);
        logger.warn("Asset snapshot pull row failed.", { id: assetId, error: message });
      }
    };

    db.exec("BEGIN");
    try {
      for (const state of states) {
        if (state.workspace_id !== workspaceId) {
          continue;
        }

        const asset = assetsById.get(state.asset_id);
        const remoteUpdatedAt = asset?.updated_at && asset.updated_at > state.updated_at ? asset.updated_at : state.updated_at;
        advanceDiagnosticCursor(remoteUpdatedAt);
        processedAssetIds.add(state.asset_id);

        const localAssetUpdatedAt = readAssetUpdatedAt(db, workspaceId, state.asset_id);
        if (!asset && !localAssetUpdatedAt) {
          result.missingAssetCount += 1;
          continue;
        }

        if (hasOutboxPendingForAsset(db, workspaceId, state.asset_id)) {
          result.skippedDueToOutboxCount += 1;
          continue;
        }

        const localStateUpdatedAt = readStateUpdatedAt(db, workspaceId, state.asset_id);
        const shouldApplyAsset = Boolean(
          asset && (!localAssetUpdatedAt || !isLocalTimestampAtLeastAsNew(localAssetUpdatedAt, asset.updated_at)),
        );
        const shouldApplyState = !localStateUpdatedAt
          || !isLocalTimestampAtLeastAsNew(localStateUpdatedAt, state.updated_at);
        if (!shouldApplyAsset && !shouldApplyState) {
          result.skippedDueToOlderCount += 1;
          continue;
        }

        applyAtomically(state.asset_id, () => {
          if (shouldApplyAsset && asset) upsertAsset(db, asset);
          if (shouldApplyState) upsertState(db, state);
          return true;
        });
      }

      // Assets and current state are independent remote streams. Process rows
      // that arrived without a state row so profile-only edits can converge.
      for (const asset of workspaceAssets) {
        if (processedAssetIds.has(asset.id)) continue;
        advanceDiagnosticCursor(asset.updated_at);

        if (hasOutboxPendingForAsset(db, workspaceId, asset.id)) {
          result.skippedDueToOutboxCount += 1;
          continue;
        }

        const localAssetUpdatedAt = readAssetUpdatedAt(db, workspaceId, asset.id);
        if (!localAssetUpdatedAt) {
          // A brand-new asset must be hydrated together with its state. The
          // remote transport writes asset first, so retry this boundary until
          // asset_current_state becomes visible instead of creating half rows.
          result.missingAssetCount += 1;
          continue;
        }
        if (isLocalTimestampAtLeastAsNew(localAssetUpdatedAt, asset.updated_at)) {
          result.skippedDueToOlderCount += 1;
          continue;
        }

        applyAtomically(asset.id, () => {
          upsertAsset(db, asset);
          return true;
        });
      }

      updateCursor(db, workspaceId, result.cursorAfter, result.appliedCount, result.errors[0] ?? null);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      const message = error instanceof Error ? error.message : "Unknown error during asset snapshot pull.";
      result.errors.push(message);
      logger.error("Asset snapshot pull transaction rolled back.", { error: message });
    }

    return result;
  },
});
