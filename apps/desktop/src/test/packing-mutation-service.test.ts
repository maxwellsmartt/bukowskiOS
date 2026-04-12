import { describe, expect, it } from "vitest";
import { createFoundationReadService } from "../../electron/main/services/data/foundationReadService";
import { createPackingMutationService } from "../../electron/main/services/data/packingMutationService";
import { createProjectMutationService } from "../../electron/main/services/data/projectMutationService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("packing mutation service", () => {
  it("issues and returns packing slips with event and current-state updates", () => {
    const { cleanup, database } = createTestDatabase("bukowski-packing-mutation-test");
    const reads = createFoundationReadService(database);
    const mutations = createPackingMutationService(database);

    const issueResult = mutations.createPackingSlip({
      commandId: "cmd-test-packing-issue",
      workspaceId: "workspace-metadata",
      assetIds: ["asset-legacy-rentman-1", "asset-legacy-rentman-2"],
      projectId: "project-archipielago",
      responsibleUserId: "user-paola",
      returnDueAt: "2030-04-12T18:00:00.000Z",
      notes: "Issued from packing test coverage.",
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(issueResult.repeated).toBe(false);
    expect(issueResult.processedAssetIds).toHaveLength(2);

    const issuedSlip = reads.getPackingSlipDetail(issueResult.packingSlipId);
    expect(issuedSlip.slip?.status).toBe("Issued");
    expect(issuedSlip.slip?.itemCount).toBe(2);
    expect(issuedSlip.items.every((item) => item.status === "Out")).toBe(true);

    const checkedOutAsset = reads.getAssetDetail("asset-legacy-rentman-1");
    expect(checkedOutAsset.asset?.status).toBe("Checked out");
    expect(checkedOutAsset.timeline[0]?.title).toBe("Checked out");

    const partialReturn = mutations.returnPackingSlipItems({
      commandId: "cmd-test-packing-return-1",
      workspaceId: "workspace-metadata",
      packingSlipId: issueResult.packingSlipId,
      assetIds: ["asset-legacy-rentman-1"],
      conditionIn: "Review",
      notes: "Returned from packing test coverage.",
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(partialReturn.slipStatus).toBe("Partial return");

    const partialSlip = reads.getPackingSlipDetail(issueResult.packingSlipId);
    expect(partialSlip.slip?.returnedCount).toBe(1);
    expect(partialSlip.slip?.pendingCount).toBe(1);

    const returnedAsset = reads.getAssetDetail("asset-legacy-rentman-1");
    expect(returnedAsset.asset?.status).toBe("Available");
    expect(returnedAsset.asset?.condition).toBe("Review");

    const finalReturn = mutations.returnPackingSlipItems({
      commandId: "cmd-test-packing-return-2",
      workspaceId: "workspace-metadata",
      packingSlipId: issueResult.packingSlipId,
      assetIds: ["asset-legacy-rentman-2"],
      conditionIn: "Good",
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(finalReturn.slipStatus).toBe("Closed");
    expect(reads.getPackingSlipDetail(issueResult.packingSlipId).slip?.status).toBe("Closed");

    const receipt = database
      .prepare("SELECT outcome_status FROM command_receipts WHERE command_id = ?")
      .get("cmd-test-packing-return-2") as { outcome_status: string } | undefined;
    expect(receipt?.outcome_status).toBe("success");

    const packingOutboxCount = database
      .prepare("SELECT COUNT(*) AS count FROM sync_outbox WHERE entity_type = 'packing_slip'")
      .get() as { count: number };
    expect(packingOutboxCount.count).toBeGreaterThanOrEqual(3);

    cleanup();
  });

  it("blocks packing issue against cancelled units and records the failed receipt", () => {
    const { cleanup, database } = createTestDatabase("bukowski-packing-mutation-test");
    const packingMutations = createPackingMutationService(database);
    const projectMutations = createProjectMutationService(database);

    projectMutations.updateProjectUnit({
      projectId: "project-aurora",
      unitId: "unit-aurora-second",
      code: "2ND",
      name: "Second Unit",
      sortOrder: 2,
      colorKey: "teal",
      startDate: "2026-04-10",
      endDate: "2026-04-14",
      notes: "Parallel pickup days.",
      statusAction: "cancel",
    });

    expect(() =>
      packingMutations.createPackingSlip({
        commandId: "cmd-test-packing-cancelled-unit",
        workspaceId: "workspace-metadata",
        assetIds: ["asset-smallhd-cine7"],
        projectId: "project-aurora",
        projectUnitId: "unit-aurora-second",
        responsibleUserId: "user-paola",
        actorType: "user",
        sourceChannel: "desktop",
      }),
    ).toThrow("cancelled");

    const failedReceipt = database
      .prepare("SELECT outcome_status, error_message FROM command_receipts WHERE command_id = ?")
      .get("cmd-test-packing-cancelled-unit") as { outcome_status: string; error_message: string | null } | undefined;

    expect(failedReceipt?.outcome_status).toBe("failed");
    expect(failedReceipt?.error_message).toContain("cancelled");

    cleanup();
  });
});
