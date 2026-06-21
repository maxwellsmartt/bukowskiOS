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
});
