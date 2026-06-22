import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

import type { AppSyncConflictResolution, AppSyncConflictRow } from "@contracts";

import { getDesktopLogger } from "../logger";

const logger = getDesktopLogger("sync-conflict-service");

/**
 * Sensitive entities where a divergent edit must NOT be resolved silently by
 * last-writer-wins. For these, an inbound remote change that collides with an
 * unpushed local change is captured into `sync_conflicts` for human review.
 * Derived from the roadmap's "casos sensibles": packing returns, incident
 * states, RMA cases and financial adjustments. Extend by adding here AND
 * registering an applier in `createSyncConflictService`.
 */
export const SENSITIVE_CONFLICT_ENTITY_TYPES = [
  "packing_slip",
  "incident",
  "rma_case",
  "financial_entry",
] as const;

export type SensitiveConflictEntityType = (typeof SENSITIVE_CONFLICT_ENTITY_TYPES)[number];

export const isSensitiveConflictEntity = (entityType: string): entityType is SensitiveConflictEntityType =>
  (SENSITIVE_CONFLICT_ENTITY_TYPES as readonly string[]).includes(entityType);

type SyncConflictDbRow = {
  id: string;
  workspace_id: string;
  entity_type: string;
  entity_id: string;
  operation_type: string;
  local_updated_at: string | null;
  remote_updated_at: string | null;
  local_snapshot_json: string | null;
  remote_snapshot_json: string | null;
  status: string;
  resolution: string | null;
  detected_at: string;
  resolved_at: string | null;
};

export type RecordSyncConflictInput = {
  workspaceId: string;
  entityType: string;
  entityId: string;
  operationType: string;
  localUpdatedAt: string | null;
  remoteUpdatedAt: string | null;
  localSnapshot: unknown;
  remoteSnapshot: unknown;
};

const toJson = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

const parseSnapshot = (json: string | null): Record<string, unknown> | null => {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const mapRow = (row: SyncConflictDbRow): AppSyncConflictRow => ({
  id: row.id,
  workspaceId: row.workspace_id,
  entityType: row.entity_type,
  entityId: row.entity_id,
  operationType: row.operation_type,
  localUpdatedAt: row.local_updated_at,
  remoteUpdatedAt: row.remote_updated_at,
  localSnapshotJson: row.local_snapshot_json,
  remoteSnapshotJson: row.remote_snapshot_json,
  status: row.status === "resolved" ? "resolved" : "open",
  resolution:
    row.resolution === "keep_local" || row.resolution === "take_remote" ? (row.resolution as AppSyncConflictResolution) : null,
  detectedAt: row.detected_at,
  resolvedAt: row.resolved_at,
});

/**
 * Captures (or refreshes) an open conflict for an entity. Runs plain statements
 * so it is safe to call inside an already-open pull transaction. Keeps at most
 * one open conflict per (workspace, entity); a fresh remote arrival refreshes
 * the stored snapshots rather than stacking duplicates.
 */
export const recordSyncConflict = (db: DatabaseSync, input: RecordSyncConflictInput): void => {
  const localJson = toJson(input.localSnapshot);
  const remoteJson = toJson(input.remoteSnapshot);

  const existing = db
    .prepare(
      `
        SELECT id
        FROM sync_conflicts
        WHERE workspace_id = ? AND entity_type = ? AND entity_id = ? AND status = 'open'
        LIMIT 1
      `,
    )
    .get(input.workspaceId, input.entityType, input.entityId) as { id: string } | undefined;

  if (existing) {
    db
      .prepare(
        `
          UPDATE sync_conflicts
          SET operation_type = ?, local_updated_at = ?, remote_updated_at = ?,
              local_snapshot_json = ?, remote_snapshot_json = ?, detected_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
      )
      .run(input.operationType, input.localUpdatedAt, input.remoteUpdatedAt, localJson, remoteJson, existing.id);
    return;
  }

  db
    .prepare(
      `
        INSERT INTO sync_conflicts (
          id, workspace_id, entity_type, entity_id, operation_type,
          local_updated_at, remote_updated_at, local_snapshot_json, remote_snapshot_json,
          status, resolution, detected_at, resolved_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, CURRENT_TIMESTAMP, NULL)
      `,
    )
    .run(
      randomUUID(),
      input.workspaceId,
      input.entityType,
      input.entityId,
      input.operationType,
      input.localUpdatedAt,
      input.remoteUpdatedAt,
      localJson,
      remoteJson,
    );

  logger.info("Sync conflict captured for review.", {
    workspaceId: input.workspaceId,
    entityType: input.entityType,
    entityId: input.entityId,
  });
};

/**
 * Domain-provided force-apply: writes the remote snapshot locally, bypassing the
 * outbox/LWW guards (the user has explicitly chosen the cloud version). Injected
 * at construction so this service stays free of domain imports (no cycles).
 */
export type SyncConflictApplier = (
  db: DatabaseSync,
  conflict: {
    workspaceId: string;
    entityType: string;
    entityId: string;
    remoteSnapshot: Record<string, unknown> | null;
  },
) => void;

export type SyncConflictServiceDeps = {
  appliers: Partial<Record<string, SyncConflictApplier>>;
};

export const createSyncConflictService = (db: DatabaseSync, deps: SyncConflictServiceDeps) => {
  const getConflict = (conflictId: string): SyncConflictDbRow | null =>
    (db.prepare("SELECT * FROM sync_conflicts WHERE id = ? LIMIT 1").get(conflictId) as SyncConflictDbRow | undefined) ?? null;

  const listConflicts = (workspaceId: string): AppSyncConflictRow[] => {
    const rows = db
      .prepare(
        `
          SELECT *
          FROM sync_conflicts
          WHERE workspace_id = ? AND status = 'open'
          ORDER BY detected_at DESC
        `,
      )
      .all(workspaceId) as SyncConflictDbRow[];
    return rows.map(mapRow);
  };

  const deletePendingOutbox = (workspaceId: string, entityType: string, entityId: string) => {
    db
      .prepare(
        `
          DELETE FROM sync_outbox
          WHERE workspace_id = ? AND entity_type = ? AND entity_id = ?
            AND status IN ('pending', 'processing', 'failed')
        `,
      )
      .run(workspaceId, entityType, entityId);
  };

  const resolveConflict = (conflictId: string, resolution: AppSyncConflictResolution): AppSyncConflictRow | null => {
    const conflict = getConflict(conflictId);
    if (!conflict) return null;
    if (conflict.status !== "open") return mapRow(conflict);

    db.exec("BEGIN");
    try {
      if (resolution === "take_remote") {
        const applier = deps.appliers[conflict.entity_type];
        if (!applier) {
          throw new Error(`No conflict applier registered for entity type ${conflict.entity_type}.`);
        }
        applier(db, {
          workspaceId: conflict.workspace_id,
          entityType: conflict.entity_type,
          entityId: conflict.entity_id,
          remoteSnapshot: parseSnapshot(conflict.remote_snapshot_json),
        });
        // Drop the local change so it can no longer overwrite the cloud version.
        deletePendingOutbox(conflict.workspace_id, conflict.entity_type, conflict.entity_id);
      }

      db
        .prepare(
          `
            UPDATE sync_conflicts
            SET status = 'resolved', resolution = ?, resolved_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
        )
        .run(resolution, conflictId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      const message = error instanceof Error ? error.message : "Unknown sync conflict resolution error.";
      logger.error("Sync conflict resolution failed.", { conflictId, resolution, error: message });
      throw error;
    }

    const resolved = getConflict(conflictId);
    return resolved ? mapRow(resolved) : null;
  };

  return { listConflicts, resolveConflict };
};

export type SyncConflictService = ReturnType<typeof createSyncConflictService>;
