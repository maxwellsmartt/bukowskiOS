import { shell } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import type { FileDeleteMutationResult, FileUploadMutationResult } from "@contracts";

import { assertPathWithinRoot } from "../../security/pathSafety";
import { ensurePrivateDirectory, ensurePrivateFile } from "../../security/storagePrivacy";

type FileUploadServiceOptions = {
  userDataPath: string;
  /** Optional override for where new files are stored (configurable folder). */
  getStorageRoot?: () => string;
  fileSystem?: Pick<typeof fs, "copyFileSync" | "existsSync" | "mkdirSync" | "readFileSync" | "statSync" | "unlinkSync" | "writeFileSync">;
  shellApi?: Pick<typeof shell, "openPath">;
  storage?: {
    enabled: boolean;
    download: (objectKey: string) => Promise<Buffer | null>;
  };
  now?: () => string;
};

type AssetFileRow = {
  id: string;
  storage_path: string | null;
  status: string | null;
};

const hasColumn = (db: DatabaseSync, tableName: string, columnName: string) => {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
};

const ensureColumn = (db: DatabaseSync, tableName: string, columnName: string, sqlType: string) => {
  if (!hasColumn(db, tableName, columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlType};`);
  }
};

const inferMimeType = (filePath: string) => {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".pdf":
      return "application/pdf";
    case ".heic":
      return "image/heic";
    default:
      return "application/octet-stream";
  }
};

const inferFileType = (mimeType: string) => {
  if (mimeType.startsWith("image/")) {
    return "image";
  }

  if (mimeType === "application/pdf") {
    return "pdf";
  }

  return "file";
};

const isPreviewableMimeType = (mimeType: string) => mimeType.startsWith("image/") || mimeType === "application/pdf";

/**
 * Idempotently ensures the workspace_files table (+ indexes) exists. Kept
 * separate so it can run as an unconditional startup self-heal: the table was
 * added to applyOperationalFilesMigration after its tracked version key already
 * existed in some local databases, so those DBs skip the tracked step and would
 * otherwise never get the table ("no such table: workspace_files").
 */
export const ensureWorkspaceFilesTable = (db: DatabaseSync) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_files (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      domain TEXT NOT NULL CHECK (domain IN ('assets', 'incidents', 'finance', 'crew')),
      entity_id TEXT NOT NULL,
      storage_path TEXT,
      storage_object_key TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      byte_size INTEGER NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
      content_hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending_upload' CHECK (status IN ('pending_upload', 'available', 'missing', 'deleted')),
      created_by_user_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      UNIQUE (workspace_id, domain, entity_id, content_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_workspace_files_entity
      ON workspace_files(workspace_id, domain, entity_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_workspace_files_pull
      ON workspace_files(workspace_id, updated_at, id);
  `);
};

export const applyOperationalFilesMigration = (db: DatabaseSync) => {
  ensureColumn(db, "asset_files", "storage_path", "TEXT");
  ensureColumn(db, "asset_files", "original_name", "TEXT");
  ensureColumn(db, "asset_files", "byte_size", "INTEGER DEFAULT 0");
  ensureColumn(db, "asset_files", "mime_type", "TEXT DEFAULT 'application/octet-stream'");
  ensureColumn(db, "asset_files", "status", "TEXT DEFAULT 'available'");
  ensureColumn(db, "asset_files", "deleted_at", "TEXT");
  ensureColumn(db, "incident_files", "storage_path", "TEXT");
  ensureColumn(db, "incident_files", "original_name", "TEXT");
  ensureColumn(db, "incident_files", "byte_size", "INTEGER DEFAULT 0");
  ensureColumn(db, "incident_files", "mime_type", "TEXT DEFAULT 'application/octet-stream'");
  ensureColumn(db, "incident_files", "status", "TEXT DEFAULT 'available'");
  ensureColumn(db, "incident_files", "deleted_at", "TEXT");
  db.exec(`
    CREATE TABLE IF NOT EXISTS financial_documents (
      id TEXT PRIMARY KEY,
      financial_entry_id TEXT NOT NULL REFERENCES financial_entries(id),
      file_type TEXT NOT NULL,
      storage_path TEXT,
      original_name TEXT,
      byte_size INTEGER DEFAULT 0,
      mime_type TEXT DEFAULT 'application/octet-stream',
      status TEXT DEFAULT 'available',
      uploaded_at TEXT NOT NULL,
      deleted_at TEXT
    );
  `);
  // I3b: content hash for same-machine upload dedupe (skip re-attaching the
  // exact same file to the same entity).
  ensureColumn(db, "asset_files", "content_hash", "TEXT");
  ensureColumn(db, "asset_files", "storage_object_key", "TEXT");
  ensureColumn(db, "asset_files", "updated_at", "TEXT");
  ensureColumn(db, "incident_files", "content_hash", "TEXT");
  ensureColumn(db, "incident_files", "storage_object_key", "TEXT");
  ensureColumn(db, "incident_files", "updated_at", "TEXT");
  ensureColumn(db, "financial_documents", "content_hash", "TEXT");
  ensureColumn(db, "financial_documents", "storage_object_key", "TEXT");
  ensureColumn(db, "financial_documents", "updated_at", "TEXT");
  try {
    ensureColumn(db, "crew_documents", "content_hash", "TEXT");
    ensureColumn(db, "crew_documents", "storage_object_key", "TEXT");
    ensureColumn(db, "crew_documents", "updated_at", "TEXT");
  } catch {
    // crew_documents is created by another bootstrap; column added there/later.
  }

  ensureWorkspaceFilesTable(db);
};

export const createFileUploadService = (db: DatabaseSync, options: FileUploadServiceOptions) => {
  const fileSystem = options.fileSystem ?? fs;
  const shellApi = options.shellApi ?? shell;
  const getAllowedRoot = () => options.getStorageRoot?.() || options.userDataPath;
  // Guard any filesystem op that targets a path coming from SQLite: refuse if
  // it resolves outside the workspace storage root (symlink/`..` traversal).
  const ensureSafePath = (target: string) => assertPathWithinRoot(target, getAllowedRoot());

  const domainConfig = {
    asset: { remoteDomain: "assets", parentTable: "assets" },
    incident: { remoteDomain: "incidents", parentTable: "incidents" },
    finance: { remoteDomain: "finance", parentTable: "financial_entries" },
    crew: { remoteDomain: "crew", parentTable: "crew_members" },
  } as const;

  const resolveWorkspaceId = (domain: keyof typeof domainConfig, entityId: string) => {
    const row = db.prepare(
      `SELECT workspace_id FROM ${domainConfig[domain].parentTable} WHERE id = ? LIMIT 1`,
    ).get(entityId) as { workspace_id: string } | undefined;
    if (!row?.workspace_id) throw new Error(`${domain} parent was not found.`);
    return row.workspace_id;
  };

  const safeObjectName = (value: string) =>
    value.replace(/[\\/\u0000-\u001f\u007f]/g, "_").slice(0, 180) || "attachment";

  const enqueueWorkspaceFile = (
    operationType: "upsert" | "delete",
    fileId: string,
    workspaceId: string,
    now: string,
  ) => {
    db.prepare(
      `INSERT INTO sync_outbox (
         id, workspace_id, entity_type, entity_id, event_id, operation_type,
         payload_json, status, attempt_count, last_error, next_retry_at, created_at, updated_at
       ) VALUES (?, ?, 'workspace_file', ?, NULL, ?, '{}', 'pending', 0, NULL, NULL, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         operation_type = excluded.operation_type,
         status = 'pending',
         attempt_count = 0,
         last_error = NULL,
         next_retry_at = NULL,
         updated_at = excluded.updated_at`,
    ).run(`outbox-workspace-file-${operationType}-${fileId}`, workspaceId, fileId, operationType, now, now);
  };

  const importFiles = (
    domain: "asset" | "incident" | "finance" | "crew",
    entityId: string,
    sourceFilePaths: string[],
  ): FileUploadMutationResult => {
    if (!sourceFilePaths.length) {
      return {
        uploadedCount: 0,
        summary: `No ${domain} files were selected.`,
      };
    }

    const now = options.now?.() ?? new Date().toISOString();
    const workspaceId = resolveWorkspaceId(domain, entityId);
    const storageRoot = options.getStorageRoot?.() || options.userDataPath;
    const rootDirectory = path.join(storageRoot, `${domain}-files`, workspaceId, entityId);
    fileSystem.mkdirSync(rootDirectory, { recursive: true });
    ensurePrivateDirectory(rootDirectory);

    if (domain === "asset") {
      const assetRow = db.prepare("SELECT id FROM assets WHERE id = ? LIMIT 1").get(entityId) as { id: string } | undefined;
      if (!assetRow) {
        throw new Error("Asset was not found.");
      }
    } else if (domain === "incident") {
      const incidentRow = db.prepare("SELECT id FROM incidents WHERE id = ? LIMIT 1").get(entityId) as { id: string } | undefined;
      if (!incidentRow) {
        throw new Error("Incident was not found.");
      }
    } else if (domain === "finance") {
      const financeRow = db.prepare("SELECT id FROM financial_entries WHERE id = ? LIMIT 1").get(entityId) as { id: string } | undefined;
      if (!financeRow) {
        throw new Error("Finance entry was not found.");
      }
    } else {
      const crewRow = db.prepare("SELECT id FROM crew_members WHERE id = ? LIMIT 1").get(entityId) as { id: string } | undefined;
      if (!crewRow) {
        throw new Error("Crew member was not found.");
      }
    }

    const insertStatement =
      domain === "asset"
        ? db.prepare(`
            INSERT INTO asset_files (
              id,
              asset_id,
              file_type,
              file_url,
              external_url,
              label,
              uploaded_by_user_id,
              created_at,
              storage_path,
              original_name,
              byte_size,
              mime_type,
              status,
              deleted_at
            ) VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, 'available', NULL)
          `)
        : domain === "incident"
          ? db.prepare(`
            INSERT INTO incident_files (
              id,
              incident_id,
              file_url,
              file_type,
              uploaded_by_user_id,
              created_at,
              storage_path,
              original_name,
              byte_size,
              mime_type,
              status,
              deleted_at
            ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'available', NULL)
          `)
          : domain === "finance"
            ? db.prepare(`
            INSERT INTO financial_documents (
              id,
              financial_entry_id,
              file_type,
              storage_path,
              original_name,
              byte_size,
              mime_type,
              status,
              uploaded_at,
              deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?, NULL)
          `)
            : db.prepare(`
            INSERT INTO crew_documents (
              id,
              crew_member_id,
              file_type,
              storage_path,
              original_name,
              byte_size,
              mime_type,
              status,
              uploaded_at,
              deleted_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?, NULL)
          `);

    const tableName =
      domain === "asset"
        ? "asset_files"
        : domain === "incident"
          ? "incident_files"
          : domain === "finance"
            ? "financial_documents"
            : "crew_documents";
    const entityColumn =
      domain === "asset"
        ? "asset_id"
        : domain === "incident"
          ? "incident_id"
          : domain === "finance"
            ? "financial_entry_id"
            : "crew_member_id";
    const existsByHash = db.prepare(
      `SELECT 1 AS x FROM ${tableName} WHERE ${entityColumn} = ? AND content_hash = ? AND status <> 'deleted' LIMIT 1`,
    );
    const setHash = db.prepare(`UPDATE ${tableName} SET content_hash = ? WHERE id = ?`);

    let uploadedCount = 0;
    let duplicateCount = 0;

    db.exec("BEGIN");

    try {
      sourceFilePaths.forEach((sourceFilePath) => {
        const originalName = path.basename(sourceFilePath);
        const mimeType = inferMimeType(sourceFilePath);
        const extension = path.extname(originalName);
        // Skip re-attaching the exact same bytes to the same entity.
        const contentHash = crypto.createHash("sha256").update(fileSystem.readFileSync(sourceFilePath)).digest("hex");
        if (existsByHash.get(entityId, contentHash)) {
          duplicateCount += 1;
          return;
        }
        const fileId = `${domain}-file-${crypto.randomUUID()}`;
        const storagePath = path.join(rootDirectory, `${fileId}${extension}`);
        const objectKey = `${workspaceId}/${domainConfig[domain].remoteDomain}/${entityId}/${fileId}/${safeObjectName(originalName)}`;
        const byteSize = fileSystem.statSync(sourceFilePath).size;
        fileSystem.copyFileSync(sourceFilePath, storagePath);
        ensurePrivateFile(storagePath);

        if (domain === "asset") {
          insertStatement.run(
            fileId,
            entityId,
            inferFileType(mimeType),
            storagePath,
            originalName,
            now,
            storagePath,
            originalName,
            byteSize,
            mimeType,
          );
        } else if (domain === "incident") {
          insertStatement.run(
            fileId,
            entityId,
            storagePath,
            inferFileType(mimeType),
            now,
            storagePath,
            originalName,
            byteSize,
            mimeType,
          );
        } else if (domain === "finance") {
          insertStatement.run(
            fileId,
            entityId,
            inferFileType(mimeType),
            storagePath,
            originalName,
            byteSize,
            mimeType,
            now,
          );
        } else {
          insertStatement.run(
            fileId,
            entityId,
            inferFileType(mimeType),
            storagePath,
            originalName,
            byteSize,
            mimeType,
            now,
          );
        }

        setHash.run(contentHash, fileId);
        db.prepare(
          `UPDATE ${tableName}
           SET storage_object_key = ?, updated_at = ?
           WHERE id = ?`,
        ).run(objectKey, now, fileId);
        db.prepare(
          `INSERT INTO workspace_files (
             id, workspace_id, domain, entity_id, storage_path, storage_object_key,
             original_name, mime_type, byte_size, content_hash, status,
             created_by_user_id, created_at, updated_at, deleted_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_upload', NULL, ?, ?, NULL)`,
        ).run(
          fileId,
          workspaceId,
          domainConfig[domain].remoteDomain,
          entityId,
          storagePath,
          objectKey,
          originalName,
          mimeType,
          byteSize,
          contentHash,
          now,
          now,
        );
        enqueueWorkspaceFile("upsert", fileId, workspaceId, now);
        uploadedCount += 1;
      });

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const dupNote = duplicateCount > 0 ? ` (${duplicateCount} duplicate(s) skipped)` : "";
    return {
      uploadedCount,
      summary:
        uploadedCount === 1
          ? `Attached 1 ${domain} file${dupNote}.`
          : uploadedCount === 0 && duplicateCount > 0
            ? `No new files — ${duplicateCount} duplicate(s) skipped.`
            : `Attached ${uploadedCount} ${domain} files${dupNote}.`,
    };
  };

  const cacheRemoteFile = async (fileId: string, tableName: string): Promise<string | null> => {
    if (!options.storage?.enabled) return null;
    const remote = db.prepare(
      `SELECT workspace_id, domain, entity_id, storage_object_key, original_name
       FROM workspace_files
       WHERE id = ? AND status <> 'deleted'
       LIMIT 1`,
    ).get(fileId) as {
      workspace_id: string;
      domain: "assets" | "incidents" | "finance" | "crew";
      entity_id: string;
      storage_object_key: string;
      original_name: string;
    } | undefined;
    if (!remote) return null;
    const bytes = await options.storage.download(remote.storage_object_key);
    if (!bytes) return null;

    const localDomain = remote.domain === "assets" ? "asset" : remote.domain === "incidents" ? "incident" : remote.domain;
    const rootDirectory = path.join(getAllowedRoot(), `${localDomain}-files`, remote.workspace_id, remote.entity_id);
    fileSystem.mkdirSync(rootDirectory, { recursive: true });
    ensurePrivateDirectory(rootDirectory);
    const storagePath = path.join(rootDirectory, `${fileId}${path.extname(remote.original_name)}`);
    fileSystem.writeFileSync(storagePath, bytes);
    ensurePrivateFile(storagePath);
    db.prepare("UPDATE workspace_files SET storage_path = ?, status = 'available' WHERE id = ?").run(storagePath, fileId);
    db.prepare(`UPDATE ${tableName} SET storage_path = ?, status = 'available' WHERE id = ?`).run(storagePath, fileId);
    return storagePath;
  };

  const openStoredRow = async (row: AssetFileRow | undefined, tableName: string, fileId: string) => {
    if (!row) throw new Error("This file is no longer available.");

    const recoveredPath = !row.storage_path || !fileSystem.existsSync(ensureSafePath(row.storage_path))
      ? await cacheRemoteFile(fileId, tableName)
      : null;
    const candidatePath = recoveredPath ?? row.storage_path;
    if (!candidatePath) {
      db.prepare(`UPDATE ${tableName} SET status = 'missing' WHERE id = ?`).run(fileId);
      throw new Error("The file is not available offline and could not be downloaded.");
    }

    const safePath = ensureSafePath(candidatePath);
    if (!fileSystem.existsSync(safePath)) {
      db.prepare(`UPDATE ${tableName} SET status = 'missing' WHERE id = ?`).run(fileId);
      throw new Error("The stored file is missing from local storage.");
    }

    const result = await shellApi.openPath(safePath);
    if (result) {
      throw new Error("The desktop app could not open that file.");
    }
  };

  return {
    inferMimeType,
    isPreviewableMimeType,

    importAssetFiles(assetId: string, sourceFilePaths: string[]) {
      return importFiles("asset", assetId, sourceFilePaths);
    },

    importIncidentFiles(incidentId: string, sourceFilePaths: string[]) {
      return importFiles("incident", incidentId, sourceFilePaths);
    },

    importFinanceDocuments(entryId: string, sourceFilePaths: string[]) {
      return importFiles("finance", entryId, sourceFilePaths);
    },

    importCrewDocuments(crewMemberId: string, sourceFilePaths: string[]) {
      return importFiles("crew", crewMemberId, sourceFilePaths);
    },

    async openAssetFile(fileId: string) {
      const row = db
        .prepare(
          `
            SELECT id, storage_path, status
            FROM asset_files
            WHERE id = ?
            LIMIT 1
          `,
        )
        .get(fileId) as AssetFileRow | undefined;

      await openStoredRow(row, "asset_files", fileId);
    },

    deleteAssetFile(fileId: string): FileDeleteMutationResult {
      const row = db
        .prepare(
          `
            SELECT id, storage_path, status
            FROM asset_files
            WHERE id = ?
            LIMIT 1
          `,
        )
        .get(fileId) as AssetFileRow | undefined;

      if (!row) {
        throw new Error("Asset file was not found.");
      }

      if (row.storage_path) {
        const safePath = ensureSafePath(row.storage_path);
        if (fileSystem.existsSync(safePath)) {
          fileSystem.unlinkSync(safePath);
        }
      }

      db.prepare(
        `
          UPDATE asset_files
          SET status = 'deleted',
              deleted_at = ?
          WHERE id = ?
        `,
      ).run(options.now?.() ?? new Date().toISOString(), fileId);

      const deletedAt = options.now?.() ?? new Date().toISOString();
      const workspaceFile = db.prepare(
        "SELECT workspace_id FROM workspace_files WHERE id = ? LIMIT 1",
      ).get(fileId) as { workspace_id: string } | undefined;
      if (workspaceFile) {
        db.prepare(
          "UPDATE workspace_files SET status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?",
        ).run(deletedAt, deletedAt, fileId);
        db.prepare(
          `UPDATE sync_outbox
           SET status = 'sent', last_error = NULL, next_retry_at = NULL, updated_at = ?
           WHERE workspace_id = ? AND entity_type = 'workspace_file' AND entity_id = ?
             AND operation_type = 'upsert' AND status IN ('pending', 'processing', 'failed')`,
        ).run(deletedAt, workspaceFile.workspace_id, fileId);
        enqueueWorkspaceFile("delete", fileId, workspaceFile.workspace_id, deletedAt);
      }

      return {
        deletedCount: 1,
        summary: "Asset file removed.",
      };
    },

    async openIncidentFile(fileId: string) {
      const row = db
        .prepare(
          `
            SELECT id, storage_path, status
            FROM incident_files
            WHERE id = ?
            LIMIT 1
          `,
        )
        .get(fileId) as AssetFileRow | undefined;

      await openStoredRow(row, "incident_files", fileId);
    },

    async openFinanceDocument(fileId: string) {
      const row = db
        .prepare(
          `
            SELECT id, storage_path, status
            FROM financial_documents
            WHERE id = ?
            LIMIT 1
          `,
        )
        .get(fileId) as AssetFileRow | undefined;

      await openStoredRow(row, "financial_documents", fileId);
    },

    async openCrewDocument(fileId: string) {
      const row = db
        .prepare(
          `
            SELECT id, storage_path, status
            FROM crew_documents
            WHERE id = ?
            LIMIT 1
          `,
        )
        .get(fileId) as AssetFileRow | undefined;

      await openStoredRow(row, "crew_documents", fileId);
    },

    deleteCrewDocument(fileId: string): FileDeleteMutationResult {
      const row = db
        .prepare(
          `
            SELECT id, storage_path, status
            FROM crew_documents
            WHERE id = ?
            LIMIT 1
          `,
        )
        .get(fileId) as AssetFileRow | undefined;

      if (!row) {
        throw new Error("Crew document was not found.");
      }

      if (row.storage_path) {
        const safePath = ensureSafePath(row.storage_path);
        if (fileSystem.existsSync(safePath)) {
          fileSystem.unlinkSync(safePath);
        }
      }

      db.prepare(
        `
          UPDATE crew_documents
          SET status = 'deleted',
              deleted_at = ?
          WHERE id = ?
        `,
      ).run(options.now?.() ?? new Date().toISOString(), fileId);

      return {
        deletedCount: 1,
        summary: "Crew document removed.",
      };
    },
  };
};

export type FileUploadService = ReturnType<typeof createFileUploadService>;
