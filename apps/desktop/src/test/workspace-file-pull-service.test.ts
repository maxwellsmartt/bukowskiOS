import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createFileUploadService } from "../../electron/main/services/data/fileUploadService";
import { createWorkspaceFilePullService } from "../../electron/main/services/data/workspaceFilePullService";
import { createTestDatabase } from "./helpers/createTestDatabase";

const remoteAssetFile = {
  id: "asset-file-remote",
  workspace_id: "workspace-metadata",
  domain: "assets" as const,
  entity_id: "asset-legacy-rentman-1",
  storage_object_key: "workspace-metadata/assets/asset-legacy-rentman-1/asset-file-remote/manual.pdf",
  original_name: "manual.pdf",
  mime_type: "application/pdf",
  byte_size: 12,
  content_hash: "remote-hash",
  status: "available" as const,
  created_by_user_id: null,
  created_at: "2026-06-21T20:50:00.000Z",
  updated_at: "2026-06-21T20:50:00.000Z",
  deleted_at: null,
};

describe("workspace file pull service", () => {
  it("hydrates metadata and downloads bytes only when the file is opened", async () => {
    const { cleanup, database } = createTestDatabase("bukowski-workspace-file-pull");
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bukowski-workspace-file-pull-"));
    try {
      const result = createWorkspaceFilePullService(database).applyRemoteRows("workspace-metadata", [remoteAssetFile]);
      expect(result).toMatchObject({ appliedCount: 1, errors: [] });

      const before = database.prepare(
        "SELECT storage_path, storage_object_key FROM workspace_files WHERE id = ?",
      ).get(remoteAssetFile.id) as { storage_path: string | null; storage_object_key: string };
      expect(before.storage_path).toBeNull();
      expect(before.storage_object_key).toBe(remoteAssetFile.storage_object_key);

      const openPath = vi.fn().mockResolvedValue("");
      const service = createFileUploadService(database, {
        userDataPath: storageRoot,
        getStorageRoot: () => storageRoot,
        shellApi: { openPath },
        storage: {
          enabled: true,
          download: vi.fn().mockResolvedValue(Buffer.from("remote-bytes")),
        },
      });
      await service.openAssetFile(remoteAssetFile.id);

      const after = database.prepare(
        "SELECT storage_path, status FROM workspace_files WHERE id = ?",
      ).get(remoteAssetFile.id) as { storage_path: string; status: string };
      expect(after.status).toBe("available");
      expect(fs.readFileSync(after.storage_path, "utf8")).toBe("remote-bytes");
      expect(openPath).toHaveBeenCalledWith(fs.realpathSync(after.storage_path));
    } finally {
      cleanup();
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it("does not overwrite a local file while its outbox mutation is pending", () => {
    const { cleanup, database } = createTestDatabase("bukowski-workspace-file-pull-outbox");
    try {
      database.prepare(
        `INSERT INTO sync_outbox (
           id, workspace_id, entity_type, entity_id, operation_type, payload_json,
           status, attempt_count, created_at, updated_at
         ) VALUES ('outbox-file-local', 'workspace-metadata', 'workspace_file', ?, 'upsert', '{}', 'pending', 0, ?, ?)`,
      ).run(remoteAssetFile.id, remoteAssetFile.created_at, remoteAssetFile.created_at);

      const result = createWorkspaceFilePullService(database).applyRemoteRows("workspace-metadata", [remoteAssetFile]);
      expect(result.skippedDueToOutboxCount).toBe(1);
      expect(result.appliedCount).toBe(0);
      expect(database.prepare("SELECT 1 FROM workspace_files WHERE id = ?").get(remoteAssetFile.id)).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("removes cached bytes when a remote tombstone arrives", () => {
    const { cleanup, database } = createTestDatabase("bukowski-workspace-file-pull-delete");
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bukowski-workspace-file-delete-"));
    const cachedPath = path.join(storageRoot, "cached.pdf");
    fs.writeFileSync(cachedPath, "cached-bytes");
    try {
      createWorkspaceFilePullService(database).applyRemoteRows("workspace-metadata", [remoteAssetFile]);
      database.prepare("UPDATE workspace_files SET storage_path = ? WHERE id = ?").run(cachedPath, remoteAssetFile.id);

      const deleted = {
        ...remoteAssetFile,
        status: "deleted" as const,
        updated_at: "2026-06-21T20:55:00.000Z",
        deleted_at: "2026-06-21T20:55:00.000Z",
      };
      const result = createWorkspaceFilePullService(database, {
        getStorageRoot: () => storageRoot,
      }).applyRemoteRows("workspace-metadata", [deleted]);

      expect(result.errors).toEqual([]);
      expect(fs.existsSync(cachedPath)).toBe(false);
      expect(
        (database.prepare("SELECT status FROM workspace_files WHERE id = ?").get(remoteAssetFile.id) as { status: string }).status,
      ).toBe("deleted");
    } finally {
      cleanup();
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });
});
