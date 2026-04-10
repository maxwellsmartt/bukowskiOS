import { describe, expect, it } from "vitest";
import { createAssetMutationService } from "../../electron/main/services/data/assetMutationService";
import { createFoundationReadService } from "../../electron/main/services/data/foundationReadService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("asset mutation service", () => {
  it("assigns imported assets and then moves them while preserving project context", () => {
    const { cleanup, database } = createTestDatabase("bukowski-asset-mutation-test");
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

    cleanup();
  });

  it("creates, updates and archives editable assets with scan-ready codes", () => {
    const { cleanup, database } = createTestDatabase("bukowski-asset-mutation-test");
    const reads = createFoundationReadService(database);
    const mutations = createAssetMutationService(database);

    const createResult = mutations.createAsset({
      commandId: "cmd-test-asset-create",
      workspaceId: "workspace-metadata",
      name: "Cart battery charger",
      internalCode: "POWER-001",
      categoryId: "cat-lighting",
      brand: "Anton Bauer",
      model: "Quad",
      serialNumber: "AB-QUAD-01",
      description: "Charging station for cart batteries.",
      defaultLocationId: "loc-warehouse-a",
      conditionStatus: "Good",
      notes: "Created from admin foundation coverage.",
      replacementValue: 640,
      ownershipType: "owned",
      qrCodeValue: "POWER-001-QR",
      isActive: true,
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(createResult.repeated).toBe(false);

    let detail = reads.getAssetDetail(createResult.assetId);
    expect(detail.asset?.code).toBe("POWER-001");
    expect(detail.editor?.primaryCodeValue).toBe("POWER-001-QR");
    expect(detail.scannableCodes[0]?.codeValue).toBe("POWER-001-QR");

    const legacyBefore = reads.getAssetDetail("asset-legacy-rentman-1");

    const updateResult = mutations.updateAsset({
      commandId: "cmd-test-asset-update",
      workspaceId: "workspace-metadata",
      assetId: "asset-legacy-rentman-1",
      name: `${legacyBefore.asset!.name} Updated`,
      internalCode: legacyBefore.editor!.internalCode,
      categoryId: legacyBefore.editor!.categoryId,
      brand: "Legacy Updated",
      model: legacyBefore.editor!.model,
      serialNumber: legacyBefore.editor!.serialNumber,
      description: "Legacy item updated from admin test.",
      defaultLocationId: legacyBefore.editor!.defaultLocationId ?? undefined,
      conditionStatus: "Review",
      notes: "Updated from test coverage.",
      replacementValue: 180,
      ownershipType: "owned",
      qrCodeValue: "LEGACY-UPDATED-QR",
      isActive: true,
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(updateResult.repeated).toBe(false);

    detail = reads.getAssetDetail("asset-legacy-rentman-1");
    expect(detail.asset?.condition).toBe("Review");
    expect(detail.editor?.brand).toBe("Legacy Updated");
    expect(detail.editor?.primaryCodeValue).toBe("LEGACY-UPDATED-QR");

    const archiveResult = mutations.archiveAsset({
      commandId: "cmd-test-asset-archive",
      workspaceId: "workspace-metadata",
      assetId: createResult.assetId,
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(archiveResult.repeated).toBe(false);
    expect(reads.getAssets().some((asset) => asset.id === createResult.assetId)).toBe(false);

    cleanup();
  });
});
