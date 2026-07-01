import type { DatabaseSync } from "node:sqlite";

import { getDesktopLogger } from "../logger";
import { isLocalTimestampAtLeastAsNew } from "./syncTimestampPolicy";

const logger = getDesktopLogger("kit-pull-service");

export type RemoteKitRow = {
  id: string;
  workspace_id: string;
  code?: string | null;
  name?: string | null;
  description?: string | null;
  notes?: string | null;
  is_active?: boolean | number | null;
  created_at?: string | null;
  updated_at: string;
};

export type RemoteKitAssetRow = {
  kit_id: string;
  asset_id: string;
  quantity?: number | null;
  added_at?: string | null;
};

export type KitPullResult = {
  workspaceId: string;
  appliedCount: number;
  skippedDueToOutboxCount: number;
  skippedDueToOlderCount: number;
  errors: string[];
  cursorAfter: string | null;
};

const isoOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const activeFlag = (row: RemoteKitRow) => (row.is_active === false || row.is_active === 0 ? 0 : 1);

// A pending/processing/failed outbox row means a local edit hasn't reached the
// cloud yet — the local copy wins until it pushes, so we skip the remote echo.
const hasOutboxPendingForKit = (db: DatabaseSync, workspaceId: string, kitId: string): boolean => {
  const row = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM sync_outbox
        WHERE workspace_id = ?
          AND entity_type = 'kit'
          AND entity_id = ?
          AND status IN ('pending', 'processing', 'failed')
      `,
    )
    .get(workspaceId, kitId) as { count: number };
  return row.count > 0;
};

const readLocalKitUpdatedAt = (db: DatabaseSync, kitId: string): string | null => {
  const row = db.prepare("SELECT updated_at AS ts FROM kits WHERE id = ?").get(kitId) as
    | { ts?: string | null }
    | undefined;
  return isoOrNull(row?.ts);
};

const localAssetExists = (db: DatabaseSync, workspaceId: string, assetId: string): boolean => {
  const row = db
    .prepare("SELECT 1 AS hit FROM assets WHERE id = ? AND workspace_id = ? LIMIT 1")
    .get(assetId, workspaceId) as { hit?: number } | undefined;
  return Boolean(row?.hit);
};

const upsertKitRow = (db: DatabaseSync, row: RemoteKitRow) => {
  db
    .prepare(
      `
        INSERT INTO kits (id, workspace_id, code, name, description, notes, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM kits WHERE id = ?), ?), ?)
        ON CONFLICT(id) DO UPDATE SET
          code = excluded.code,
          name = excluded.name,
          description = excluded.description,
          notes = excluded.notes,
          is_active = excluded.is_active,
          updated_at = excluded.updated_at
      `,
    )
    .run(
      row.id,
      row.workspace_id,
      row.code ?? "",
      row.name ?? "",
      row.description ?? null,
      row.notes ?? null,
      activeFlag(row),
      row.id,
      row.created_at ?? row.updated_at,
      row.updated_at,
    );
};

// Wholesale member reconcile, mirroring replaceKitAssets on the mutation side:
// drop every local member then re-insert the remote set. Members whose asset
// has not synced locally yet are skipped (and logged) rather than crashing the
// FK — they re-materialize the next time the kit is edited and re-pulled.
const reconcileKitMembers = (
  db: DatabaseSync,
  workspaceId: string,
  kitId: string,
  members: RemoteKitAssetRow[],
): number => {
  db.prepare("DELETE FROM kit_assets WHERE kit_id = ?").run(kitId);
  const insert = db.prepare(
    "INSERT INTO kit_assets (kit_id, asset_id, quantity, added_at) VALUES (?, ?, ?, ?)",
  );
  let skipped = 0;
  for (const member of members) {
    if (!localAssetExists(db, workspaceId, member.asset_id)) {
      skipped += 1;
      continue;
    }
    insert.run(
      kitId,
      member.asset_id,
      typeof member.quantity === "number" && member.quantity > 0 ? Math.floor(member.quantity) : 1,
      member.added_at ?? new Date().toISOString(),
    );
  }
  return skipped;
};

export type KitPullService = ReturnType<typeof createKitPullService>;

export const createKitPullService = (db: DatabaseSync) => {
  const readCursor = (workspaceId: string): string | null => {
    const row = db
      .prepare("SELECT last_synced_at FROM sync_pull_cursors WHERE workspace_id = ? AND entity_type = 'kits'")
      .get(workspaceId) as { last_synced_at?: string | null } | undefined;
    return isoOrNull(row?.last_synced_at);
  };

  const updateCursor = (
    workspaceId: string,
    cursorAfter: string | null,
    appliedCount: number,
    errorMessage: string | null,
  ) => {
    db
      .prepare(
        `
          INSERT INTO sync_pull_cursors (workspace_id, entity_type, last_synced_at, last_pulled_count, last_error, updated_at)
          VALUES (?, 'kits', ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(workspace_id, entity_type) DO UPDATE SET
            last_synced_at = excluded.last_synced_at,
            last_pulled_count = excluded.last_pulled_count,
            last_error = excluded.last_error,
            updated_at = CURRENT_TIMESTAMP
        `,
      )
      .run(workspaceId, cursorAfter, appliedCount, errorMessage);
  };

  /**
   * Apply remote `kits` rows (plus their `kit_assets`) into local SQLite. Same
   * LWW + outbox guard as the catalog pull, with a wholesale member reconcile.
   * `members` is the flat kit_assets set for the kits in this batch.
   */
  const applyRemoteKits = (
    workspaceId: string,
    kits: RemoteKitRow[],
    members: RemoteKitAssetRow[],
  ): KitPullResult => {
    const result: KitPullResult = {
      workspaceId,
      appliedCount: 0,
      skippedDueToOutboxCount: 0,
      skippedDueToOlderCount: 0,
      errors: [],
      cursorAfter: readCursor(workspaceId),
    };

    if (!kits.length) {
      return result;
    }

    const membersByKitId = new Map<string, RemoteKitAssetRow[]>();
    for (const member of members) {
      const bucket = membersByKitId.get(member.kit_id);
      if (bucket) bucket.push(member);
      else membersByKitId.set(member.kit_id, [member]);
    }

    db.exec("BEGIN");
    try {
      for (const row of kits) {
        if (row.workspace_id !== workspaceId) {
          continue; // defensive: ignore cross-workspace rows
        }

        db.exec("SAVEPOINT kit_pull_row");
        try {
          if (hasOutboxPendingForKit(db, workspaceId, row.id)) {
            db.exec("RELEASE SAVEPOINT kit_pull_row");
            result.skippedDueToOutboxCount += 1;
            continue;
          }

          const localUpdatedAt = readLocalKitUpdatedAt(db, row.id);
          if (localUpdatedAt && isLocalTimestampAtLeastAsNew(localUpdatedAt, row.updated_at)) {
            db.exec("RELEASE SAVEPOINT kit_pull_row");
            result.skippedDueToOlderCount += 1;
            continue;
          }

          upsertKitRow(db, row);
          const skippedMembers = reconcileKitMembers(
            db,
            workspaceId,
            row.id,
            membersByKitId.get(row.id) ?? [],
          );
          if (skippedMembers > 0) {
            logger.warn("Kit pulled with members whose assets are not local yet.", {
              kitId: row.id,
              skippedMembers,
            });
          }

          db.exec("RELEASE SAVEPOINT kit_pull_row");
          result.appliedCount += 1;
          if (!result.cursorAfter || row.updated_at > result.cursorAfter) {
            result.cursorAfter = row.updated_at;
          }
        } catch (error) {
          db.exec("ROLLBACK TO SAVEPOINT kit_pull_row");
          db.exec("RELEASE SAVEPOINT kit_pull_row");
          // A UNIQUE(workspace_id, code) clash means this code already exists
          // locally under a different id (independent double-creation). Skip
          // rather than corrupt — the codes will be reconciled on a later edit.
          const message = error instanceof Error ? error.message : "Unknown error applying remote kit.";
          result.errors.push(`${row.id}: ${message}`);
          logger.warn("Kit pull row failed.", { id: row.id, error: message });
        }
      }

      updateCursor(workspaceId, result.cursorAfter, result.appliedCount, result.errors[0] ?? null);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      const message = error instanceof Error ? error.message : "Unknown error during kit pull.";
      result.errors.push(message);
      logger.error("Kit pull transaction rolled back.", { error: message });
    }

    return result;
  };

  return { applyRemoteKits };
};
