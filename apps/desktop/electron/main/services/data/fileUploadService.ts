import { shell } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import type { FileDeleteMutationResult, FileUploadMutationResult } from "@contracts";
import { DEFAULT_WORKSPACE_ID } from "@contracts";

import { assertPathWithinRoot } from "../../security/pathSafety";

const workspaceId = DEFAULT_WORKSPACE_ID;

type FileUploadServiceOptions = {
  userDataPath: string;
  /** Optional override for where new files are stored (configurable folder). */
  getStorageRoot?: () => string;
  fileSystem?: Pick<typeof fs, "copyFileSync" | "existsSync" | "mkdirSync" | "readFileSync" | "statSync" | "unlinkSync">;
  shellApi?: Pick<typeof shell, "openPath">;
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
  ensureColumn(db, "incident_files", "content_hash", "TEXT");
  ensureColumn(db, "financial_documents", "content_hash", "TEXT");
  try {
    ensureColumn(db, "crew_documents", "content_hash", "TEXT");
  } catch {
    // crew_documents is created by another bootstrap; column added there/later.
  }
};

export const createFileUploadService = (db: DatabaseSync, options: FileUploadServiceOptions) => {
  const fileSystem = options.fileSystem ?? fs;
  const shellApi = options.shellApi ?? shell;
  const getAllowedRoot = () => options.getStorageRoot?.() || options.userDataPath;
  // Guard any filesystem op that targets a path coming from SQLite: refuse if
  // it resolves outside the workspace storage root (symlink/`..` traversal).
  const ensureSafePath = (target: string) => assertPathWithinRoot(target, getAllowedRoot());

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
    const storageRoot = options.getStorageRoot?.() || options.userDataPath;
    const rootDirectory = path.join(storageRoot, `${domain}-files`, workspaceId, entityId);
    fileSystem.mkdirSync(rootDirectory, { recursive: true });

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
        const byteSize = fileSystem.statSync(sourceFilePath).size;
        fileSystem.copyFileSync(sourceFilePath, storagePath);

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

  const openStoredRow = async (row: AssetFileRow | undefined, tableName: string, fileId: string) => {
    if (!row?.storage_path) {
      throw new Error("This file is no longer available.");
    }

    if (!fileSystem.existsSync(row.storage_path)) {
      db.prepare(`UPDATE ${tableName} SET status = 'missing' WHERE id = ?`).run(fileId);
      throw new Error("The stored file is missing from local storage.");
    }

    const safePath = ensureSafePath(row.storage_path);
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

      if (row.storage_path && fileSystem.existsSync(row.storage_path)) {
        fileSystem.unlinkSync(ensureSafePath(row.storage_path));
      }

      db.prepare(
        `
          UPDATE asset_files
          SET status = 'deleted',
              deleted_at = ?
          WHERE id = ?
        `,
      ).run(options.now?.() ?? new Date().toISOString(), fileId);

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

      if (row.storage_path && fileSystem.existsSync(row.storage_path)) {
        fileSystem.unlinkSync(ensureSafePath(row.storage_path));
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
