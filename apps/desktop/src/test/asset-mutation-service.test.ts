import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { foundationMigrationSql } from "@db";

import { createAssetMutationService } from "../../electron/main/services/data/assetMutationService";
import { createFoundationReadService } from "../../electron/main/services/data/foundationReadService";
import { seedFoundationData } from "../../electron/main/services/data/foundationSeed";
import { bootstrapLegacyRentmanDemo } from "../../electron/main/services/data/legacyRentmanDemo";
import { ensureProjectShellDefaults } from "../../electron/main/services/data/projectMutationService";

const createTempDatabase = () => {
  const databasePath = path.join(os.tmpdir(), `bukowski-asset-mutation-test-${Date.now()}-${Math.random()}.sqlite`);
  const database = new DatabaseSync(databasePath);

  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(foundationMigrationSql);
  seedFoundationData(database);
  ensureProjectShellDefaults(database);
  bootstrapLegacyRentmanDemo(database);

  return { database, databasePath };
};

describe("asset mutation service", () => {
  it("assigns imported assets and then moves them while preserving project context", () => {
    const { database, databasePath } = createTempDatabase();
    const reads = createFoundationReadService(database);
    const mutations = createAssetMutationService(database);

    const assignResult = mutations.assignMoveAssets({
      commandId: "cmd-test-assign-legacy-1",
      workspaceId: "workspace-metadata",
      assetIds: ["asset-legacy-rentman-1"],
      mode: "assign",
      projectId: "project-archipielago",
      assignedToUserId: "user-paola",
      targetLocationId: "loc-warehouse-a",
      expectedReturnAt: "2026-04-12T16:00:00.000Z",
      notes: "Assigned from test coverage.",
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(assignResult.eventType).toBe("assigned");
    expect(assignResult.processedAssetIds).toEqual(["asset-legacy-rentman-1"]);

    let detail = reads.getAssetDetail("asset-legacy-rentman-1");
    expect(detail.asset?.project).toBe("Archipiélado");
    expect(detail.asset?.responsible).toBe("Paola Rivas");
    expect(detail.asset?.location).toBe("Warehouse A");
    expect(detail.timeline[0]?.title).toBe("Assigned");

    const moveResult = mutations.assignMoveAssets({
      commandId: "cmd-test-move-legacy-1",
      workspaceId: "workspace-metadata",
      assetIds: ["asset-legacy-rentman-1"],
      mode: "move",
      targetLocationId: "loc-video-village",
      notes: "Moved from test coverage.",
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(moveResult.eventType).toBe("moved");

    detail = reads.getAssetDetail("asset-legacy-rentman-1");
    expect(detail.asset?.location).toBe("Set / Video Village");
    expect(detail.asset?.project).toBe("Archipiélado");
    expect(detail.timeline[0]?.title).toBe("Moved");

    const project = reads.getProjects().find((row) => row.code === "ARCH");
    expect(project?.assetCount).toBeGreaterThan(0);

    const receipt = database
      .prepare("SELECT outcome_status FROM command_receipts WHERE command_id = ?")
      .get("cmd-test-move-legacy-1") as { outcome_status: string } | undefined;
    expect(receipt?.outcome_status).toBe("success");

    const outboxCount = database
      .prepare("SELECT COUNT(*) AS count FROM sync_outbox WHERE entity_id = ?")
      .get("asset-legacy-rentman-1") as { count: number };
    expect(outboxCount.count).toBeGreaterThanOrEqual(2);

    database.close();
    fs.unlinkSync(databasePath);
  });
});
