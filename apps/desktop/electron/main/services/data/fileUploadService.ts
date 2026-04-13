import { shell } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import type { FileUploadMutationResult } from "@contracts";
import { DEFAULT_WORKSPACE_ID } from "@contracts";

const workspaceId = DEFAULT_WORKSPACE_ID;

type FileUploadServiceOptions = {
  userDataPath: string;
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
};

export const createFileUploadService = (db: DatabaseSync, options: FileUploadServiceOptions) => {
  const fileSystem = options.fileSystem ?? fs;
  const shellApi = options.shellApi ?? shell;

  const importFiles = (
    domain: "asset" | "incident",
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
    const rootDirectory = path.join(options.userDataPath, `${domain}-files`, workspaceId, entityId);
    fileSystem.mkdirSync(rootDirectory, { recursive: true });

    if (domain === "asset") {
      const assetRow = db.prepare("SELECT id FROM assets WHERE id = ? LIMIT 1").get(entityId) as { id: string } | undefined;
      if (!assetRow) {
        throw new Error("Asset was not found.");
      }
    } else {
      const incidentRow = db.prepare("SELECT id FROM incidents WHERE id = ? LIMIT 1").get(entityId) as { id: string } | undefined;
      if (!incidentRow) {
        throw new Error("Incident was not found.");
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
        : db.prepare(`
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
          `);

    let uploadedCount = 0;

    db.exec("BEGIN");

    try {
      sourceFilePaths.forEach((sourceFilePath) => {
        const originalName = path.basename(sourceFilePath);
        const mimeType = inferMimeType(sourceFilePath);
        const extension = path.extname(originalName);
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
        } else {
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
        }

        uploadedCount += 1;
      });

      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    return {
      uploadedCount,
      summary:
        uploadedCount === 1
          ? `Attached 1 ${domain} file.`
          : `Attached ${uploadedCount} ${domain} files.`,
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

    const result = await shellApi.openPath(row.storage_path);
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
  };
};

export type FileUploadService = ReturnType<typeof createFileUploadService>;
