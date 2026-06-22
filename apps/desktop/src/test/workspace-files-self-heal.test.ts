import { describe, expect, it } from "vitest";

import { ensureWorkspaceFilesTable } from "../../electron/main/services/data/fileUploadService";
import { createSyncOutboxWorkerService } from "../../electron/main/services/data/syncOutboxWorkerService";
import { createTestDatabase } from "./helpers/createTestDatabase";

const tableExists = (db: Parameters<typeof ensureWorkspaceFilesTable>[0]) =>
  Boolean(
    db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'workspace_files' LIMIT 1").get(),
  );

describe("workspace_files self-heal", () => {
  it("reads the outbox queue even when workspace_files is missing, then heals it", () => {
    const { cleanup, database } = createTestDatabase("bukowski-workspace-files-heal");
    try {
      // Simulate a local database that recorded the tracked migration before
      // workspace_files was added, so it never got the table.
      database.exec("DROP TABLE IF EXISTS workspace_files");
      expect(tableExists(database)).toBe(false);

      // The outbox queue read must not throw "no such table: workspace_files".
      const worker = createSyncOutboxWorkerService(database);
      expect(() => worker.listRows()).not.toThrow();

      // The boot self-heal recreates the table idempotently.
      ensureWorkspaceFilesTable(database);
      expect(tableExists(database)).toBe(true);

      // Running it again is a no-op (idempotent), not an error.
      expect(() => ensureWorkspaceFilesTable(database)).not.toThrow();
    } finally {
      cleanup();
    }
  });
});
