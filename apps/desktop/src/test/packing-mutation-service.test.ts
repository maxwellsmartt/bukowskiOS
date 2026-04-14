import { describe, expect, it } from "vitest";
import { createAssetMutationService } from "../../electron/main/services/data/assetMutationService";
import { createCatalogMutationService } from "../../electron/main/services/data/catalogMutationService";
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
    expect(issuedSlip.slip?.itemCount).toBe(3);
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
    expect(partialSlip.slip?.returnedCount).toBe(2);
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

  it("stores requested partial quantities on packing slips and reads them back as quantity totals", () => {
    const { cleanup, database } = createTestDatabase("bukowski-packing-quantity-test");
    const reads = createFoundationReadService(database);
    const mutations = createPackingMutationService(database);

    const issueResult = mutations.createPackingSlip({
      commandId: "cmd-test-packing-quantity-issue",
      workspaceId: "workspace-metadata",
      assetIds: ["asset-legacy-rentman-1"],
      assetSelections: [{ assetId: "asset-legacy-rentman-1", quantity: 1 }],
      projectId: "project-archipielago",
      responsibleUserId: "user-paola",
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(issueResult.summary).toContain("1 item");

    const issuedSlip = reads.getPackingSlipDetail(issueResult.packingSlipId);
    expect(issuedSlip.slip?.itemCount).toBe(1);
    expect(issuedSlip.slip?.returnedCount).toBe(0);
    expect(issuedSlip.items[0]?.quantity).toBe(1);

    const storedItem = database
      .prepare("SELECT quantity FROM packing_slip_items WHERE packing_slip_id = ? LIMIT 1")
      .get(issueResult.packingSlipId) as { quantity: number } | undefined;

    expect(storedItem?.quantity).toBe(1);

    const returnResult = mutations.returnPackingSlipItems({
      commandId: "cmd-test-packing-quantity-return",
      workspaceId: "workspace-metadata",
      packingSlipId: issueResult.packingSlipId,
      assetIds: ["asset-legacy-rentman-1"],
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(returnResult.summary).toContain("1 item returned");
    expect(reads.getPackingSlipDetail(issueResult.packingSlipId).slip?.returnedCount).toBe(1);

    cleanup();
  });

  it("blocks packing issue when the requested quantity exceeds available stock", () => {
    const { cleanup, database } = createTestDatabase("bukowski-packing-quantity-test");
    const mutations = createPackingMutationService(database);

    expect(() =>
      mutations.createPackingSlip({
        commandId: "cmd-test-packing-quantity-invalid",
        workspaceId: "workspace-metadata",
        assetIds: ["asset-legacy-rentman-1"],
        assetSelections: [{ assetId: "asset-legacy-rentman-1", quantity: 99 }],
        projectId: "project-archipielago",
        responsibleUserId: "user-paola",
        actorType: "user",
        sourceChannel: "desktop",
      }),
    ).toThrow("exceeds");

    cleanup();
  });

  it("returns assigned-source packing quantities back to the project reservation instead of releasing them to stock", () => {
    const { cleanup, database } = createTestDatabase("bukowski-packing-assigned-source-test");
    const assetMutations = createAssetMutationService(database);
    const reads = createFoundationReadService(database);
    const packingMutations = createPackingMutationService(database);

    assetMutations.assignMoveAssets({
      commandId: "cmd-test-packing-assigned-seed",
      workspaceId: "workspace-metadata",
      assetIds: ["asset-legacy-rentman-1"],
      assetSelections: [{ assetId: "asset-legacy-rentman-1", quantity: 2 }],
      mode: "assign",
      projectId: "project-aurora",
      projectUnitId: "unit-aurora-main",
      departmentId: "dept-camera",
      assignedToUserId: "user-paola",
      targetLocationId: "loc-video-village",
      actorType: "user",
      sourceChannel: "desktop",
    });

    const issueResult = packingMutations.createPackingSlip({
      commandId: "cmd-test-packing-assigned-issue",
      workspaceId: "workspace-metadata",
      assetIds: ["asset-legacy-rentman-1"],
      assetSelections: [{ assetId: "asset-legacy-rentman-1", quantity: 1 }],
      projectId: "project-aurora",
      projectUnitId: "unit-aurora-main",
      departmentId: "dept-camera",
      responsibleUserId: "user-paola",
      actorType: "user",
      sourceChannel: "desktop",
    });

    let state: {
      available_quantity: number;
      assigned_quantity: number;
      checked_out_quantity: number;
      custody_status?: string;
      active_assignment_id: string | null;
    } | undefined = database
      .prepare("SELECT available_quantity, assigned_quantity, checked_out_quantity, active_assignment_id FROM asset_current_state WHERE asset_id = ?")
      .get("asset-legacy-rentman-1") as {
      available_quantity: number;
      assigned_quantity: number;
      checked_out_quantity: number;
      active_assignment_id: string | null;
    } | undefined;

    expect(state?.available_quantity).toBe(0);
    expect(state?.assigned_quantity).toBe(1);
    expect(state?.checked_out_quantity).toBe(1);

    let assignment:
      | { quantity: number; assignment_status: string; returned_at?: string | null }
      | undefined = database
      .prepare("SELECT quantity, assignment_status FROM asset_assignments WHERE id = ?")
      .get(state!.active_assignment_id!) as { quantity: number; assignment_status: string } | undefined;

    expect(assignment?.quantity).toBe(2);
    expect(assignment?.assignment_status).toBe("checked_out");

    packingMutations.returnPackingSlipItems({
      commandId: "cmd-test-packing-assigned-return",
      workspaceId: "workspace-metadata",
      packingSlipId: issueResult.packingSlipId,
      actorType: "user",
      sourceChannel: "desktop",
    });

    state = database
      .prepare("SELECT available_quantity, assigned_quantity, checked_out_quantity, custody_status, active_assignment_id FROM asset_current_state WHERE asset_id = ?")
      .get("asset-legacy-rentman-1") as
      | {
          available_quantity: number;
          assigned_quantity: number;
          checked_out_quantity: number;
          custody_status: string;
          active_assignment_id: string | null;
        }
      | undefined;

    expect(state?.available_quantity).toBe(0);
    expect(state?.assigned_quantity).toBe(2);
    expect(state?.checked_out_quantity).toBe(0);
    expect(state?.custody_status).toBe("assigned");

    assignment = database
      .prepare("SELECT quantity, assignment_status, returned_at FROM asset_assignments WHERE id = ?")
      .get(state!.active_assignment_id!) as
      | { quantity: number; assignment_status: string; returned_at: string | null }
      | undefined;

    expect(assignment?.quantity).toBe(2);
    expect(assignment?.assignment_status).toBe("assigned");
    expect(assignment?.returned_at).toBeNull();
    expect(reads.getAssetDetail("asset-legacy-rentman-1").asset?.quantity).toBe(0);

    cleanup();
  });

  it("blocks issuing kit members individually on packing slips", () => {
    const { cleanup, database } = createTestDatabase("bukowski-packing-kit-guard-test");
    const assetMutations = createAssetMutationService(database);
    const catalogMutations = createCatalogMutationService(database);
    const packingMutations = createPackingMutationService(database);

    const createdAsset = assetMutations.createAsset({
      commandId: "cmd-test-packing-kit-member-create",
      workspaceId: "workspace-metadata",
      name: "Packing locked monitor",
      internalCode: "PACKKIT-001",
      categoryId: "cat-monitors",
      defaultLocationId: "loc-warehouse-a",
      conditionStatus: "Good",
      actorType: "user",
      sourceChannel: "desktop",
    });

    catalogMutations.createEntity({
      entityType: "kit",
      code: "PACKKIT",
      name: "Packing Guard Kit",
      assetSelections: [{ assetId: createdAsset.assetId, quantity: 1 }],
    });

    expect(() =>
      packingMutations.createPackingSlip({
        commandId: "cmd-test-packing-kit-block",
        workspaceId: "workspace-metadata",
        assetIds: [createdAsset.assetId],
        assetSelections: [{ assetId: createdAsset.assetId, quantity: 1 }],
        projectId: "project-aurora",
        responsibleUserId: "user-paola",
        actorType: "user",
        sourceChannel: "desktop",
      }),
    ).toThrow("Remove it from the kit");

    cleanup();
  });
});
