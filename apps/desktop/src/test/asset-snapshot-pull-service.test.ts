import { describe, expect, it } from "vitest";

import {
  createAssetSnapshotPullService,
  type RemoteAssetCurrentStateRow,
  type RemoteAssetSnapshotRow,
} from "../../electron/main/services/data/assetSnapshotPullService";
import { createTestDatabase } from "./helpers/createTestDatabase";

const readSeedSnapshot = (database: ReturnType<typeof createTestDatabase>["database"]) => {
  const asset = database.prepare(
    "SELECT * FROM assets WHERE workspace_id = 'workspace-metadata' ORDER BY id LIMIT 1",
  ).get() as RemoteAssetSnapshotRow;
  const state = database.prepare(
    "SELECT * FROM asset_current_state WHERE asset_id = ?",
  ).get(asset.id) as RemoteAssetCurrentStateRow;
  return { asset, state };
};

describe("asset snapshot pull service", () => {
  it("applies metadata-only changes independently from a newer local state", () => {
    const { cleanup, database } = createTestDatabase("bukowski-asset-metadata-pull");
    const { asset, state } = readSeedSnapshot(database);
    database.prepare("UPDATE assets SET updated_at = ? WHERE id = ?").run("2026-06-21T10:00:00.000Z", asset.id);
    database.prepare("UPDATE asset_current_state SET updated_at = ? WHERE asset_id = ?").run(
      "2026-06-21T12:00:00.000Z",
      asset.id,
    );

    const result = createAssetSnapshotPullService(database).applyRemoteSnapshots(
      asset.workspace_id,
      [{ ...asset, name: "Remote metadata name", updated_at: "2026-06-21T11:00:00.000Z" }],
      [],
    );

    expect(result.errors).toEqual([]);
    expect(result.appliedCount).toBe(1);
    expect((database.prepare("SELECT name FROM assets WHERE id = ?").get(asset.id) as { name: string }).name)
      .toBe("Remote metadata name");
    expect(
      (database.prepare("SELECT updated_at FROM asset_current_state WHERE asset_id = ?").get(asset.id) as { updated_at: string }).updated_at,
    ).toBe("2026-06-21T12:00:00.000Z");
    cleanup();
  });

  it("rolls back metadata when the paired state cannot be applied", () => {
    const { cleanup, database } = createTestDatabase("bukowski-asset-pair-rollback");
    const { asset, state } = readSeedSnapshot(database);
    const originalName = asset.name;
    database.prepare("UPDATE assets SET updated_at = ? WHERE id = ?").run("2026-06-21T10:00:00.000Z", asset.id);
    database.prepare("UPDATE asset_current_state SET updated_at = ? WHERE asset_id = ?").run(
      "2026-06-21T10:00:00.000Z",
      asset.id,
    );

    const result = createAssetSnapshotPullService(database).applyRemoteSnapshots(
      asset.workspace_id,
      [{ ...asset, name: "Must roll back", updated_at: "2026-06-21T11:00:00.000Z" }],
      [{ ...state, current_project_id: "project-not-local", updated_at: "2026-06-21T11:00:00.000Z" }],
    );

    expect(result.errors).toHaveLength(1);
    expect((database.prepare("SELECT name FROM assets WHERE id = ?").get(asset.id) as { name: string }).name)
      .toBe(originalName);
    cleanup();
  });

  it("does not treat an asset id from another workspace as a local match", () => {
    const { cleanup, database } = createTestDatabase("bukowski-asset-metadata-tenant-collision");
    const { asset } = readSeedSnapshot(database);
    const originalName = asset.name;
    database.prepare(
      `INSERT INTO workspaces (id, name, slug, base_currency, created_at, updated_at)
       VALUES ('workspace-other', 'Other', 'other', 'USD', ?, ?)`,
    ).run("2026-06-21T10:00:00.000Z", "2026-06-21T10:00:00.000Z");

    const result = createAssetSnapshotPullService(database).applyRemoteSnapshots(
      "workspace-other",
      [{ ...asset, workspace_id: "workspace-other", name: "Cross-tenant overwrite", updated_at: "2026-06-21T11:00:00.000Z" }],
      [],
    );

    expect(result.missingAssetCount).toBe(1);
    expect(result.appliedCount).toBe(0);
    expect((database.prepare("SELECT name FROM assets WHERE id = ?").get(asset.id) as { name: string }).name)
      .toBe(originalName);
    cleanup();
  });

  it("materializes a placeholder for a legacy ghost category instead of wedging the pull", () => {
    // A Rentman-import asset references a category by a legacy text id the
    // UUID-keyed cloud can never deliver. It must still land (under a recognizable
    // pending-category placeholder) so the asset cursor advances and the whole
    // inventory keeps flowing, rather than deferring forever.
    const { cleanup, database } = createTestDatabase("bukowski-asset-ghost-category");
    const { asset, state } = readSeedSnapshot(database);
    const ghostCategoryId = "category-hd-mqv6ghost";

    const result = createAssetSnapshotPullService(database).applyRemoteSnapshots(
      asset.workspace_id,
      [{ ...asset, id: "asset-r-ghost-1", internal_code: "R-GHOST-1", category_id: ghostCategoryId, updated_at: "2026-06-26T12:00:00.000Z" }],
      [{ ...state, asset_id: "asset-r-ghost-1", updated_at: "2026-06-26T12:00:00.000Z" }],
    );

    expect(result.errors).toEqual([]);
    expect(result.appliedCount).toBe(1);
    const placeholder = database
      .prepare("SELECT code, name FROM asset_categories WHERE id = ?")
      .get(ghostCategoryId) as { code: string; name: string } | undefined;
    expect(placeholder).toBeTruthy();
    expect(placeholder?.name).toBe("Categoría pendiente");
    expect((database.prepare("SELECT category_id FROM assets WHERE id = ?").get("asset-r-ghost-1") as { category_id: string }).category_id)
      .toBe(ghostCategoryId);
    cleanup();
  });

  it("hydrates active project assignments from remote current-state snapshots", () => {
    const { cleanup, database } = createTestDatabase("bukowski-asset-remote-assignment");
    const { asset, state } = readSeedSnapshot(database);
    const assetId = "asset-remote-assigned-1";
    const assignmentId = "assign-remote-active-1";

    const result = createAssetSnapshotPullService(database).applyRemoteSnapshots(
      asset.workspace_id,
      [
        {
          ...asset,
          id: assetId,
          internal_code: "REMOTE-ASG-1",
          name: "Remote assigned asset",
          updated_at: "2026-06-27T12:00:00.000Z",
        },
      ],
      [
        {
          ...state,
          asset_id: assetId,
          current_project_id: "project-aurora",
          current_department_id: "dept-camera",
          current_responsible_user_id: "user-paola",
          active_assignment_id: assignmentId,
          custody_status: "assigned",
          available_quantity: 0,
          assigned_quantity: 1,
          checked_out_quantity: 0,
          updated_at: "2026-06-27T12:00:00.000Z",
        },
      ],
    );

    expect(result.errors).toEqual([]);
    expect(result.appliedCount).toBe(1);
    const currentState = database
      .prepare("SELECT current_project_id, active_assignment_id, assigned_quantity FROM asset_current_state WHERE asset_id = ?")
      .get(assetId) as { current_project_id: string | null; active_assignment_id: string | null; assigned_quantity: number } | undefined;
    expect(currentState).toEqual({
      current_project_id: "project-aurora",
      active_assignment_id: assignmentId,
      assigned_quantity: 1,
    });
    const assignment = database
      .prepare("SELECT project_id, asset_id, quantity, assignment_status, returned_at FROM asset_assignments WHERE id = ?")
      .get(assignmentId) as
      | { project_id: string | null; asset_id: string; quantity: number; assignment_status: string; returned_at: string | null }
      | undefined;
    expect(assignment).toEqual({
      project_id: "project-aurora",
      asset_id: assetId,
      quantity: 1,
      assignment_status: "assigned",
      returned_at: null,
    });
    cleanup();
  });

  it("still defers an asset whose UUID category simply has not synced yet", () => {
    const { cleanup, database } = createTestDatabase("bukowski-asset-uuid-category-defer");
    const { asset, state } = readSeedSnapshot(database);
    const missingUuid = "11111111-2222-3333-4444-555555555555";

    const result = createAssetSnapshotPullService(database).applyRemoteSnapshots(
      asset.workspace_id,
      [{ ...asset, id: "asset-uuid-defer-1", internal_code: "UUID-DEFER-1", category_id: missingUuid, updated_at: "2026-06-26T12:00:00.000Z" }],
      [{ ...state, asset_id: "asset-uuid-defer-1", updated_at: "2026-06-26T12:00:00.000Z" }],
    );

    expect(result.appliedCount).toBe(0);
    expect(result.errors.join(" ")).toContain("snapshot deferred");
    expect(database.prepare("SELECT id FROM assets WHERE id = ?").get("asset-uuid-defer-1")).toBeUndefined();
    cleanup();
  });
});
