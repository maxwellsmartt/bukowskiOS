import { describe, expect, it } from "vitest";

import { createCatalogPullService } from "../../electron/main/services/data/catalogPullService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("catalogPullService", () => {
  it("applies a fresh remote row when no local row exists", () => {
    const { cleanup, database } = createTestDatabase("bukowski-catalog-pull-fresh");
    const workspaceId = "workspace-metadata";

    const service = createCatalogPullService(database);
    const result = service.applyRemoteRows(workspaceId, "locations", [
      {
        id: "loc-remote-001",
        workspace_id: workspaceId,
        code: "TEST-PULL-A",
        name: "Warehouse A",
        type: "warehouse",
        description: "Pulled from cloud",
        updated_at: "2026-05-01T10:00:00.000Z",
      },
    ]);

    expect(result.appliedCount).toBe(1);
    expect(result.skippedDueToOlderCount).toBe(0);
    expect(result.skippedDueToOutboxCount).toBe(0);
    expect(result.cursorAfter).toBe("2026-05-01T10:00:00.000Z");

    const local = database
      .prepare(`SELECT name, updated_at FROM locations WHERE id = ?`)
      .get("loc-remote-001") as { name: string; updated_at: string };
    expect(local.name).toBe("Warehouse A");
    expect(local.updated_at).toBe("2026-05-01T10:00:00.000Z");

    cleanup();
  });

  it("skips a remote row that is older than the local copy (LWW)", () => {
    const { cleanup, database } = createTestDatabase("bukowski-catalog-pull-lww");
    const workspaceId = "workspace-metadata";
    const service = createCatalogPullService(database);

    // Insert a newer local copy first.
    database
      .prepare(
        `INSERT INTO locations (id, workspace_id, code, name, type, description, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        "loc-stale",
        workspaceId,
        "WH-X",
        "Local newer",
        "warehouse",
        null,
        "2026-05-10T00:00:00.000Z",
        "2026-05-10T00:00:00.000Z",
      );

    const result = service.applyRemoteRows(workspaceId, "locations", [
      {
        id: "loc-stale",
        workspace_id: workspaceId,
        code: "WH-X",
        name: "Remote stale",
        type: "warehouse",
        updated_at: "2026-05-01T00:00:00.000Z",
      },
    ]);

    expect(result.appliedCount).toBe(0);
    expect(result.skippedDueToOlderCount).toBe(1);

    const local = database
      .prepare(`SELECT name FROM locations WHERE id = ?`)
      .get("loc-stale") as { name: string };
    expect(local.name).toBe("Local newer");

    cleanup();
  });

  it("accepts server state when the local workstation timestamp is implausibly future", () => {
    const { cleanup, database } = createTestDatabase("bukowski-catalog-pull-clock-skew");
    const workspaceId = "workspace-metadata";
    const service = createCatalogPullService(database);
    const serverNow = new Date().toISOString();
    const futureLocal = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    database.prepare(
      `INSERT INTO locations (id, workspace_id, code, name, type, description, is_active, created_at, updated_at)
       VALUES ('loc-clock-skew', ?, 'CLOCK', 'Future local', 'warehouse', NULL, 1, ?, ?)`,
    ).run(workspaceId, futureLocal, futureLocal);

    const result = service.applyRemoteRows(workspaceId, "locations", [{
      id: "loc-clock-skew",
      workspace_id: workspaceId,
      code: "CLOCK",
      name: "Server canonical",
      type: "warehouse",
      updated_at: serverNow,
    }]);

    expect(result.appliedCount).toBe(1);
    expect(result.skippedDueToOlderCount).toBe(0);
    expect((database.prepare("SELECT name FROM locations WHERE id = 'loc-clock-skew'").get() as { name: string }).name)
      .toBe("Server canonical");
    cleanup();
  });

  it("skips remote updates while a local mutation is pending in the outbox", () => {
    const { cleanup, database } = createTestDatabase("bukowski-catalog-pull-outbox");
    const workspaceId = "workspace-metadata";
    const service = createCatalogPullService(database);

    // Local row.
    database
      .prepare(
        `INSERT INTO locations (id, workspace_id, code, name, type, description, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        "loc-pending",
        workspaceId,
        "WH-Y",
        "Local before edit",
        "warehouse",
        null,
        "2026-04-01T00:00:00.000Z",
        "2026-04-01T00:00:00.000Z",
      );

    // Pending outbox row for that entity.
    database
      .prepare(
        `INSERT INTO sync_outbox (id, workspace_id, entity_type, entity_id, operation_type, payload_json, status, attempt_count, created_at, updated_at)
         VALUES (?, ?, 'locations', ?, 'update', '{}', 'pending', 0, ?, ?)`,
      )
      .run(
        "outbox-1",
        workspaceId,
        "loc-pending",
        "2026-04-15T00:00:00.000Z",
        "2026-04-15T00:00:00.000Z",
      );

    const result = service.applyRemoteRows(workspaceId, "locations", [
      {
        id: "loc-pending",
        workspace_id: workspaceId,
        code: "WH-Y",
        name: "Remote attempt",
        type: "warehouse",
        updated_at: "2026-05-20T00:00:00.000Z",
      },
    ]);

    expect(result.skippedDueToOutboxCount).toBe(1);
    expect(result.appliedCount).toBe(0);

    const local = database
      .prepare(`SELECT name FROM locations WHERE id = ?`)
      .get("loc-pending") as { name: string };
    expect(local.name).toBe("Local before edit");

    cleanup();
  });

  it("persists the cursor after a successful apply pass", () => {
    const { cleanup, database } = createTestDatabase("bukowski-catalog-pull-cursor");
    const workspaceId = "workspace-metadata";
    const service = createCatalogPullService(database);

    expect(service.readCursor(workspaceId, "locations")).toBeNull();

    service.applyRemoteRows(workspaceId, "locations", [
      {
        id: "loc-cursor-1",
        workspace_id: workspaceId,
        code: "WH-Z",
        name: "Cursor row",
        type: "warehouse",
        updated_at: "2026-05-15T12:00:00.000Z",
      },
    ]);

    expect(service.readCursor(workspaceId, "locations")).toBe("2026-05-15T12:00:00.000Z");

    cleanup();
  });
});
