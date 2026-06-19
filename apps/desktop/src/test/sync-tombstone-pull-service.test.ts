import { describe, expect, it } from "vitest";

import { createSyncTombstonePullService } from "../../electron/main/services/data/syncTombstonePullService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("sync tombstone pull service", () => {
  it("removes a local row deleted by another machine", () => {
    const { cleanup, database } = createTestDatabase("bukowski-sync-tombstone-delete");
    const workspaceId = "workspace-metadata";
    database.prepare(
      `INSERT INTO locations (id, workspace_id, code, name, type, is_active, created_at, updated_at)
       VALUES ('location-remote-delete', ?, 'DEL', 'Delete me', 'warehouse', 1, ?, ?)`,
    ).run(workspaceId, "2026-06-19T10:00:00.000Z", "2026-06-19T10:00:00.000Z");

    const result = createSyncTombstonePullService(database).apply(workspaceId, [{
      workspace_id: workspaceId,
      table_name: "locations",
      entity_id: "location-remote-delete",
      deleted_at: "2026-06-19T11:00:00.000Z",
    }]);

    expect(result.errors).toEqual([]);
    expect(result.appliedCount).toBe(1);
    expect(database.prepare("SELECT id FROM locations WHERE id = ?").get("location-remote-delete")).toBeUndefined();
    cleanup();
  });

  it("does not delete a row with an unsent local mutation", () => {
    const { cleanup, database } = createTestDatabase("bukowski-sync-tombstone-pending");
    const workspaceId = "workspace-metadata";
    database.prepare(
      `INSERT INTO locations (id, workspace_id, code, name, type, is_active, created_at, updated_at)
       VALUES ('location-local-pending', ?, 'KEEP', 'Keep me', 'warehouse', 1, ?, ?)`,
    ).run(workspaceId, "2026-06-19T10:00:00.000Z", "2026-06-19T10:00:00.000Z");
    database.prepare(
      `INSERT INTO sync_outbox (
        id, workspace_id, entity_type, entity_id, operation_type, payload_json,
        status, attempt_count, created_at, updated_at
      ) VALUES ('pending-location', ?, 'location', 'location-local-pending', 'upsert', '{}', 'pending', 0, ?, ?)`,
    ).run(workspaceId, "2026-06-19T10:30:00.000Z", "2026-06-19T10:30:00.000Z");

    const result = createSyncTombstonePullService(database).apply(workspaceId, [{
      workspace_id: workspaceId,
      table_name: "locations",
      entity_id: "location-local-pending",
      deleted_at: "2026-06-19T11:00:00.000Z",
    }]);

    expect(result.skippedDueToOutboxCount).toBe(1);
    expect(database.prepare("SELECT id FROM locations WHERE id = ?").get("location-local-pending")).toBeTruthy();
    cleanup();
  });
});
