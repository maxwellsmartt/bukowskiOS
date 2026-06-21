import type { DatabaseSync } from "node:sqlite";
import fs from "node:fs";

import { assertPathWithinRoot } from "../../security/pathSafety";

export type RemoteWorkspaceFileRow = {
  id: string;
  workspace_id: string;
  domain: "assets" | "incidents" | "finance" | "crew";
  entity_id: string;
  storage_object_key: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  content_hash?: string | null;
  status: "pending_upload" | "available" | "missing" | "deleted";
  created_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

export type WorkspaceFilePullResult = {
  workspaceId: string;
  appliedCount: number;
  skippedDueToOutboxCount: number;
  errors: string[];
  cursorAfter: string | null;
};

const domainConfig = {
  assets: { parentTable: "assets", fileTable: "asset_files", entityColumn: "asset_id" },
  incidents: { parentTable: "incidents", fileTable: "incident_files", entityColumn: "incident_id" },
  finance: { parentTable: "financial_entries", fileTable: "financial_documents", entityColumn: "financial_entry_id" },
  crew: { parentTable: "crew_members", fileTable: "crew_documents", entityColumn: "crew_member_id" },
} as const;

const fileType = (mimeType: string) => mimeType.startsWith("image/") ? "image" : mimeType === "application/pdf" ? "pdf" : "file";

const hasPendingMutation = (db: DatabaseSync, row: RemoteWorkspaceFileRow) => Boolean(db.prepare(
  `SELECT 1 FROM sync_outbox
   WHERE workspace_id = ? AND entity_type = 'workspace_file' AND entity_id = ?
     AND status IN ('pending', 'processing', 'failed')
   LIMIT 1`,
).get(row.workspace_id, row.id));

const parentExists = (db: DatabaseSync, row: RemoteWorkspaceFileRow) => {
  const config = domainConfig[row.domain];
  return Boolean(db.prepare(
    `SELECT 1 FROM ${config.parentTable} WHERE id = ? AND workspace_id = ? LIMIT 1`,
  ).get(row.entity_id, row.workspace_id));
};

const updatePullCursor = (
  db: DatabaseSync,
  workspaceId: string,
  cursorAfter: string | null,
  appliedCount: number,
  errorMessage: string | null,
) => {
  db.prepare(
    `INSERT INTO sync_pull_cursors (
       workspace_id, entity_type, last_synced_at, last_pulled_count, last_error, updated_at
     ) VALUES (?, 'workspace_files', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(workspace_id, entity_type) DO UPDATE SET
       last_synced_at = COALESCE(excluded.last_synced_at, sync_pull_cursors.last_synced_at),
       last_pulled_count = excluded.last_pulled_count,
       last_error = excluded.last_error,
       updated_at = excluded.updated_at`,
  ).run(workspaceId, cursorAfter, appliedCount, errorMessage);
};

const mirrorDomainFile = (db: DatabaseSync, row: RemoteWorkspaceFileRow) => {
  const nextStatus = row.deleted_at || row.status === "deleted" ? "deleted" : "available";
  if (row.domain === "assets") {
    db.prepare(
      `INSERT INTO asset_files (
         id, asset_id, file_type, file_url, external_url, label, uploaded_by_user_id,
         created_at, storage_path, original_name, byte_size, mime_type, status,
         deleted_at, content_hash, storage_object_key, updated_at
       ) VALUES (?, ?, ?, NULL, NULL, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         original_name = excluded.original_name, byte_size = excluded.byte_size,
         mime_type = excluded.mime_type, status = excluded.status,
         deleted_at = excluded.deleted_at, content_hash = excluded.content_hash,
         storage_object_key = excluded.storage_object_key, updated_at = excluded.updated_at`,
    ).run(
      row.id, row.entity_id, fileType(row.mime_type), row.original_name, row.created_at,
      row.original_name, row.byte_size, row.mime_type, nextStatus, row.deleted_at ?? null,
      row.content_hash ?? null, row.storage_object_key, row.updated_at,
    );
    return;
  }
  if (row.domain === "incidents") {
    db.prepare(
      `INSERT INTO incident_files (
         id, incident_id, file_url, file_type, uploaded_by_user_id, created_at,
         storage_path, original_name, byte_size, mime_type, status, deleted_at,
         content_hash, storage_object_key, updated_at
       ) VALUES (?, ?, NULL, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         original_name = excluded.original_name, byte_size = excluded.byte_size,
         mime_type = excluded.mime_type, status = excluded.status,
         deleted_at = excluded.deleted_at, content_hash = excluded.content_hash,
         storage_object_key = excluded.storage_object_key, updated_at = excluded.updated_at`,
    ).run(
      row.id, row.entity_id, fileType(row.mime_type), row.created_at, row.original_name,
      row.byte_size, row.mime_type, nextStatus, row.deleted_at ?? null,
      row.content_hash ?? null, row.storage_object_key, row.updated_at,
    );
    return;
  }
  const config = domainConfig[row.domain];
  db.prepare(
    `INSERT INTO ${config.fileTable} (
       id, ${config.entityColumn}, file_type, storage_path, original_name, byte_size,
       mime_type, status, uploaded_at, deleted_at, content_hash, storage_object_key, updated_at
     ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       original_name = excluded.original_name, byte_size = excluded.byte_size,
       mime_type = excluded.mime_type, status = excluded.status,
       deleted_at = excluded.deleted_at, content_hash = excluded.content_hash,
       storage_object_key = excluded.storage_object_key, updated_at = excluded.updated_at`,
  ).run(
    row.id, row.entity_id, fileType(row.mime_type), row.original_name, row.byte_size,
    row.mime_type, nextStatus, row.created_at, row.deleted_at ?? null,
    row.content_hash ?? null, row.storage_object_key, row.updated_at,
  );
};

export const createWorkspaceFilePullService = (
  db: DatabaseSync,
  options?: { getStorageRoot?: () => string; fileSystem?: Pick<typeof fs, "existsSync" | "unlinkSync"> },
) => ({
  applyRemoteRows(
    workspaceId: string,
    rows: RemoteWorkspaceFileRow[],
    pullError: string | null = null,
  ): WorkspaceFilePullResult {
    const result: WorkspaceFilePullResult = {
      workspaceId,
      appliedCount: 0,
      skippedDueToOutboxCount: 0,
      errors: [],
      cursorAfter: null,
    };

    if (pullError) result.errors.push(pullError);

    db.exec("BEGIN");
    try {
      for (const row of rows) {
        if (row.workspace_id !== workspaceId) continue;
        const expectedPrefix = `${workspaceId}/${row.domain}/${row.entity_id}/${row.id}/`;
        if (!row.storage_object_key.startsWith(expectedPrefix)) {
          result.errors.push(`${row.id}: object key is outside its canonical scope`);
          continue;
        }
        if (hasPendingMutation(db, row)) {
          result.skippedDueToOutboxCount += 1;
          continue;
        }
        if (!parentExists(db, row)) {
          result.errors.push(`${row.id}: ${row.domain} parent ${row.entity_id} is unavailable`);
          continue;
        }

        if ((row.deleted_at || row.status === "deleted") && options?.getStorageRoot) {
          const local = db.prepare("SELECT storage_path FROM workspace_files WHERE id = ? LIMIT 1").get(row.id) as
            | { storage_path: string | null }
            | undefined;
          if (local?.storage_path) {
            const safePath = assertPathWithinRoot(local.storage_path, options.getStorageRoot());
            const fileSystem = options.fileSystem ?? fs;
            if (fileSystem.existsSync(safePath)) fileSystem.unlinkSync(safePath);
          }
        }

        db.prepare(
          `INSERT INTO workspace_files (
             id, workspace_id, domain, entity_id, storage_path, storage_object_key,
             original_name, mime_type, byte_size, content_hash, status,
             created_by_user_id, created_at, updated_at, deleted_at
           ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             storage_object_key = excluded.storage_object_key,
             original_name = excluded.original_name,
             mime_type = excluded.mime_type,
             byte_size = excluded.byte_size,
             content_hash = excluded.content_hash,
             status = excluded.status,
             updated_at = excluded.updated_at,
             deleted_at = excluded.deleted_at`,
        ).run(
          row.id, row.workspace_id, row.domain, row.entity_id, row.storage_object_key,
          row.original_name, row.mime_type, row.byte_size, row.content_hash ?? null,
          row.deleted_at ? "deleted" : row.status, row.created_by_user_id ?? null,
          row.created_at, row.updated_at, row.deleted_at ?? null,
        );
        mirrorDomainFile(db, row);
        result.appliedCount += 1;
        if (!result.cursorAfter || row.updated_at > result.cursorAfter) result.cursorAfter = row.updated_at;
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      result.errors.push(error instanceof Error ? error.message : "Workspace file pull failed");
    }
    updatePullCursor(
      db,
      workspaceId,
      result.cursorAfter,
      result.appliedCount,
      result.errors.length ? result.errors.join(" | ") : null,
    );
    return result;
  },
});

export type WorkspaceFilePullService = ReturnType<typeof createWorkspaceFilePullService>;
