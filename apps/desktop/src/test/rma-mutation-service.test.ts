import { describe, expect, it } from "vitest";
import { createAssetMutationService } from "../../electron/main/services/data/assetMutationService";
import { createFoundationReadService } from "../../electron/main/services/data/foundationReadService";
import { createRmaMutationService } from "../../electron/main/services/data/rmaMutationService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("rma mutation service", () => {
  it("creates repair cases from active assets and moves them into maintenance", () => {
    const { cleanup, database } = createTestDatabase("bukowski-rma-create-from-incident-test");
    const reads = createFoundationReadService(database);
    const rmaMutations = createRmaMutationService(database);
    const assetMutations = createAssetMutationService(database);

    const result = rmaMutations.createRmaCase({
      commandId: "cmd-test-rma-create-from-incident",
      workspaceId: "workspace-metadata",
      manufacturerId: "manufacturer-smallhd",
      supportEmail: "support@smallhd.test",
      title: "Repair · Monitor input failure",
      problemSummary: "SDI input drops signal during prep.",
      notes: "Created from incident incident-cine7-scratch.",
      assetItems: [
        {
          assetId: "asset-aputure-600d",
          issueSummary: "Fixture needs bench review after electrical fault report.",
        },
      ],
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(result.summary).toContain("prepared");

    const assetDetail = reads.getAssetDetail("asset-aputure-600d");
    expect(assetDetail.asset?.status).toBe("Maintenance");
    expect(assetDetail.asset?.condition).toBe("Needs review");
    expect(assetDetail.asset?.quantity).toBe(0);
    expect(assetDetail.timeline[0]?.title).toBe("Maintenance started");

    expect(() =>
      assetMutations.assignMoveAssets({
        commandId: "cmd-test-rma-create-from-incident-assign",
        workspaceId: "workspace-metadata",
        assetIds: ["asset-aputure-600d"],
        mode: "assign",
        projectId: "project-archipielago",
        actorType: "user",
        sourceChannel: "desktop",
      }),
    ).toThrow("in maintenance");

    cleanup();
  });

  it("returns repaired assets to available inventory", () => {
    const { cleanup, database } = createTestDatabase("bukowski-rma-repaired-test");
    const reads = createFoundationReadService(database);
    const rmaMutations = createRmaMutationService(database);
    const assetMutations = createAssetMutationService(database);

    const snapshot = reads.getRmaSnapshot({ workspaceId: "workspace-metadata" });
    expect(snapshot.cases.find((row) => row.id === "rma-flowtech-latch")?.status).toBe("Needs review");

    const detail = reads.getRmaCaseDetail("rma-flowtech-latch");
    const result = rmaMutations.updateRmaCase({
      commandId: "cmd-test-rma-returned",
      workspaceId: "workspace-metadata",
      rmaCaseId: "rma-flowtech-latch",
      manufacturerId: detail.caseRecord!.manufacturerId,
      supportEmail: detail.caseRecord!.supportEmail,
      title: detail.caseRecord!.title,
      problemSummary: detail.caseRecord!.problemSummary,
      notes: detail.caseRecord!.notes,
      status: "Returned to inventory",
      assetItems: detail.assets.map((asset) => ({
        assetId: asset.assetId,
        equipmentYear: asset.equipmentYear,
        issueSummary: asset.issueSummary,
      })),
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(result.summary).toContain("returned to inventory");

    const assetDetail = reads.getAssetDetail("asset-sachtler-flowtech");
    expect(assetDetail.asset?.status).toBe("Available");
    expect(assetDetail.asset?.quantity).toBe(1);
    expect(assetDetail.timeline[0]?.title).toBe("Maintenance completed");

    expect(() =>
      assetMutations.assignMoveAssets({
        commandId: "cmd-test-rma-returned-assign",
        workspaceId: "workspace-metadata",
        assetIds: ["asset-sachtler-flowtech"],
        mode: "assign",
        projectId: "project-archipielago",
        actorType: "user",
        sourceChannel: "desktop",
      }),
    ).not.toThrow();

    cleanup();
  });

  it("retires assets that cannot be repaired", () => {
    const { cleanup, database } = createTestDatabase("bukowski-rma-retired-test");
    const reads = createFoundationReadService(database);
    const rmaMutations = createRmaMutationService(database);
    const assetMutations = createAssetMutationService(database);

    const detail = reads.getRmaCaseDetail("rma-flowtech-latch");
    rmaMutations.updateRmaCase({
      commandId: "cmd-test-rma-retired",
      workspaceId: "workspace-metadata",
      rmaCaseId: "rma-flowtech-latch",
      manufacturerId: detail.caseRecord!.manufacturerId,
      supportEmail: detail.caseRecord!.supportEmail,
      title: detail.caseRecord!.title,
      problemSummary: detail.caseRecord!.problemSummary,
      notes: detail.caseRecord!.notes,
      status: "No repair / retired",
      assetItems: detail.assets.map((asset) => ({
        assetId: asset.assetId,
        equipmentYear: asset.equipmentYear,
        issueSummary: asset.issueSummary,
      })),
      actorType: "user",
      sourceChannel: "desktop",
    });

    const assetDetail = reads.getAssetDetail("asset-sachtler-flowtech");
    expect(assetDetail.asset?.status).toBe("Retired");
    expect(assetDetail.asset?.condition).toBe("No repair");
    expect(assetDetail.asset?.quantity).toBe(0);

    expect(() =>
      assetMutations.assignMoveAssets({
        commandId: "cmd-test-rma-retired-assign",
        workspaceId: "workspace-metadata",
        assetIds: ["asset-sachtler-flowtech"],
        mode: "assign",
        projectId: "project-archipielago",
        actorType: "user",
        sourceChannel: "desktop",
      }),
    ).toThrow("retired");

    cleanup();
  });
});
