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

  it("hydrates an epoch-dated placeholder crew with the real catalog row", () => {
    const { cleanup, database } = createTestDatabase("bukowski-catalog-pull-crew-hydrate");
    const workspaceId = "workspace-metadata";
    const service = createCatalogPullService(database);

    // Placeholder created by a project-snapshot import, backdated to the epoch
    // so the real (older-than-now) catalog row always wins last-write-wins.
    database
      .prepare(
        `INSERT INTO crew_members (id, workspace_id, full_name, role_label, email, phone, notes, is_active, created_at, updated_at)
           VALUES (?, ?, 'Remote crew abcdef', NULL, NULL, NULL, 'Created from a project snapshot; the crew catalog will hydrate the full record.', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')`,
      )
      .run("crew-001", workspaceId);

    const result = service.applyRemoteRows(workspaceId, "crew_members", [
      {
        id: "crew-001",
        workspace_id: workspaceId,
        full_name: "Ada Lovelace",
        role_label: "DIT",
        updated_at: "2026-04-01T10:00:00.000Z",
      },
    ]);

    expect(result.appliedCount).toBe(1);
    expect(result.skippedDueToOlderCount).toBe(0);

    const local = database
      .prepare(`SELECT full_name FROM crew_members WHERE id = ?`)
      .get("crew-001") as { full_name: string };
    expect(local.full_name).toBe("Ada Lovelace");

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

  it("adopts the remote department id and preserves dependent relationships", () => {
    const { cleanup, database } = createTestDatabase("bukowski-catalog-pull-department-rekey");
    const workspaceId = "workspace-metadata";
    const localDepartment = database.prepare(
      "SELECT id, code, name FROM departments WHERE workspace_id = ? ORDER BY id LIMIT 1",
    ).get(workspaceId) as { id: string; code: string; name: string };
    const asset = database.prepare(
      "SELECT asset_id FROM asset_current_state WHERE workspace_id = ? ORDER BY asset_id LIMIT 1",
    ).get(workspaceId) as { asset_id: string };
    database.prepare("UPDATE asset_current_state SET current_department_id = ? WHERE asset_id = ?")
      .run(localDepartment.id, asset.asset_id);

    const remoteDepartmentId = "department-remote-canonical";
    const result = createCatalogPullService(database).applyRemoteRows(workspaceId, "departments", [{
      id: remoteDepartmentId,
      workspace_id: workspaceId,
      code: localDepartment.code,
      name: localDepartment.name,
      updated_at: new Date().toISOString(),
    }]);

    expect(result.errors).toEqual([]);
    expect(database.prepare("SELECT 1 FROM departments WHERE id = ?").get(localDepartment.id)).toBeUndefined();
    expect(database.prepare("SELECT 1 FROM departments WHERE id = ?").get(remoteDepartmentId)).toBeTruthy();
    expect(
      (database.prepare("SELECT current_department_id FROM asset_current_state WHERE asset_id = ?").get(asset.asset_id) as { current_department_id: string }).current_department_id,
    ).toBe(remoteDepartmentId);
    cleanup();
  });

  it("adopts the remote client id and preserves project references", () => {
    const { cleanup, database } = createTestDatabase("bukowski-catalog-pull-client-rekey");
    const workspaceId = "workspace-metadata";
    const localClient = database.prepare(
      "SELECT id, name FROM clients WHERE workspace_id = ? ORDER BY id LIMIT 1",
    ).get(workspaceId) as { id: string; name: string };
    const project = database.prepare(
      "SELECT id FROM projects WHERE workspace_id = ? ORDER BY id LIMIT 1",
    ).get(workspaceId) as { id: string };
    database.prepare("UPDATE projects SET client_id = ? WHERE id = ?").run(localClient.id, project.id);

    const remoteClientId = "client-remote-canonical";
    const result = createCatalogPullService(database).applyRemoteRows(workspaceId, "clients", [{
      id: remoteClientId,
      workspace_id: workspaceId,
      name: localClient.name,
      updated_at: new Date().toISOString(),
    }]);

    expect(result.errors).toEqual([]);
    expect(database.prepare("SELECT 1 FROM clients WHERE id = ?").get(localClient.id)).toBeUndefined();
    expect(database.prepare("SELECT 1 FROM clients WHERE id = ?").get(remoteClientId)).toBeTruthy();
    expect(
      (database.prepare("SELECT client_id FROM projects WHERE id = ?").get(project.id) as { client_id: string }).client_id,
    ).toBe(remoteClientId);
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
         VALUES (?, ?, 'location', ?, 'update', '{}', 'pending', 0, ?, ?)`,
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
