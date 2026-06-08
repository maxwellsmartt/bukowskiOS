import { describe, expect, it } from "vitest";
import { createAssetMutationService } from "../../electron/main/services/data/assetMutationService";
import { createCatalogMutationService } from "../../electron/main/services/data/catalogMutationService";
import { createFoundationReadService } from "../../electron/main/services/data/foundationReadService";
import { createPackingMutationService } from "../../electron/main/services/data/packingMutationService";
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

  it("blocks reassigning assets that are currently checked out and records the failed receipt", () => {
    const { cleanup, database } = createTestDatabase("bukowski-asset-mutation-test");
    const assetMutations = createAssetMutationService(database);
    const packingMutations = createPackingMutationService(database);

    const createdAsset = assetMutations.createAsset({
      commandId: "cmd-test-asset-create-hardening",
      workspaceId: "workspace-metadata",
      name: "Hardening cart battery",
      internalCode: "HARD-001",
      categoryId: "cat-lighting",
      defaultLocationId: "loc-warehouse-a",
      conditionStatus: "Good",
      actorType: "user",
      sourceChannel: "desktop",
    });

    packingMutations.createPackingSlip({
      commandId: "cmd-test-asset-packing-first",
      workspaceId: "workspace-metadata",
      assetIds: [createdAsset.assetId],
      projectId: "project-aurora",
      responsibleUserId: "user-paola",
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(() =>
      assetMutations.assignMoveAssets({
        commandId: "cmd-test-assign-checked-out",
        workspaceId: "workspace-metadata",
        assetIds: [createdAsset.assetId],
        mode: "assign",
        projectId: "project-archipielago",
        assignedToUserId: "user-paola",
        actorType: "user",
        sourceChannel: "desktop",
      }),
    ).toThrow("currently checked out");

    const failedReceipt = database
      .prepare("SELECT outcome_status, error_message FROM command_receipts WHERE command_id = ?")
      .get("cmd-test-assign-checked-out") as { outcome_status: string; error_message: string | null } | undefined;

    expect(failedReceipt?.outcome_status).toBe("failed");
    expect(failedReceipt?.error_message).toContain("currently checked out");

    cleanup();
  });

  it("rejects assign references that belong to another workspace", () => {
    const { cleanup, database } = createTestDatabase("bukowski-asset-cross-workspace-reference-test");
    const mutations = createAssetMutationService(database);
    const now = "2026-04-10T00:00:00.000Z";

    database
      .prepare(
        `
          INSERT INTO workspaces (id, name, slug, base_currency, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
      )
      .run("workspace-asset-other", "Other Asset Workspace", "other-asset-workspace", "USD", now, now);
    database
      .prepare(
        `
          INSERT INTO projects (
            id,
            workspace_id,
            code,
            name,
            client_name,
            status,
            start_date,
            end_date,
            description,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        "project-asset-other",
        "workspace-asset-other",
        "OTHERASSET",
        "Other Asset Workspace Project",
        "Other Client",
        "Prep",
        "2026-04-14",
        "2026-04-28",
        null,
        now,
        now,
      );

    expect(() =>
      mutations.assignMoveAssets({
        commandId: "cmd-test-asset-cross-workspace-project",
        workspaceId: "workspace-metadata",
        assetIds: ["asset-legacy-rentman-1"],
        mode: "assign",
        projectId: "project-asset-other",
        actorType: "user",
        sourceChannel: "desktop",
      }),
    ).toThrow("Project not found.");

    const failedReceipt = database
      .prepare("SELECT outcome_status, error_message FROM command_receipts WHERE command_id = ?")
      .get("cmd-test-asset-cross-workspace-project") as { outcome_status: string; error_message: string | null } | undefined;

    expect(failedReceipt?.outcome_status).toBe("failed");
    expect(failedReceipt?.error_message).toBe("Project not found.");

    cleanup();
  });

  it("updates multiple assets in a single assignment transaction", () => {
    const { cleanup, database } = createTestDatabase("bukowski-asset-bulk-test");
    const reads = createFoundationReadService(database);
    const mutations = createAssetMutationService(database);
    const createdAsset = mutations.createAsset({
      commandId: "cmd-test-asset-bulk-create",
      workspaceId: "workspace-metadata",
      name: "Bulk test battery plate",
      internalCode: "BULK-001",
      categoryId: "cat-monitors",
      defaultLocationId: "loc-warehouse-a",
      conditionStatus: "Good",
      actorType: "user",
      sourceChannel: "desktop",
    });

    const result = mutations.assignMoveAssets({
      commandId: "cmd-test-asset-bulk-assign",
      workspaceId: "workspace-metadata",
      assetIds: ["asset-aputure-600d", createdAsset.assetId],
      mode: "assign",
      projectId: "project-aurora",
      assignedToUserId: "user-paola",
      targetLocationId: "loc-video-village",
      notes: "Bulk assignment from test coverage.",
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(result.processedAssetIds).toHaveLength(2);
    expect(result.summary).toContain("2 assets");

    const firstDetail = reads.getAssetDetail("asset-aputure-600d");
    const secondDetail = reads.getAssetDetail(createdAsset.assetId);
    expect(firstDetail.asset?.responsible).toBe("Paola Rivas");
    expect(secondDetail.asset?.responsible).toBe("Paola Rivas");
    expect(firstDetail.asset?.location).toBe("Set / Video Village");
    expect(secondDetail.asset?.location).toBe("Set / Video Village");

    const receipt = database
      .prepare("SELECT outcome_status FROM command_receipts WHERE command_id = ?")
      .get("cmd-test-asset-bulk-assign") as { outcome_status: string } | undefined;
    expect(receipt?.outcome_status).toBe("success");

    cleanup();
  });

  it("returns conflict warnings when assigning assets across overlapping project windows", () => {
    const { cleanup, database } = createTestDatabase("bukowski-asset-conflict-test");
    const mutations = createAssetMutationService(database);
    const createdAsset = mutations.createAsset({
      commandId: "cmd-test-asset-conflict-create",
      workspaceId: "workspace-metadata",
      name: "Conflict test monitor",
      internalCode: "CONFLICT-001",
      categoryId: "cat-monitors",
      defaultLocationId: "loc-warehouse-a",
      conditionStatus: "Good",
      actorType: "user",
      sourceChannel: "desktop",
    });

    mutations.assignMoveAssets({
      commandId: "cmd-test-asset-conflict-seed",
      workspaceId: "workspace-metadata",
      assetIds: [createdAsset.assetId],
      mode: "assign",
      projectId: "project-aurora",
      assignedToUserId: "user-paola",
      targetLocationId: "loc-video-village",
      actorType: "user",
      sourceChannel: "desktop",
    });

    const result = mutations.assignMoveAssets({
      commandId: "cmd-test-asset-conflict-warning",
      workspaceId: "workspace-metadata",
      assetIds: [createdAsset.assetId],
      mode: "assign",
      projectId: "project-studio",
      assignedToUserId: "user-paola",
      targetLocationId: "loc-video-village",
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(result.conflictCount).toBeGreaterThan(0);
    expect(result.warningSummary).toContain("still linked");
    expect(result.summary).toContain("1 asset");

    cleanup();
  });

  it("supports partial project assignment on bulk rows and tops up the same active context", () => {
    const { cleanup, database } = createTestDatabase("bukowski-asset-partial-assign-test");
    const reads = createFoundationReadService(database);
    const mutations = createAssetMutationService(database);

    const firstResult = mutations.assignMoveAssets({
      commandId: "cmd-test-asset-partial-assign-1",
      workspaceId: "workspace-metadata",
      assetIds: ["asset-legacy-rentman-1"],
      assetSelections: [{ assetId: "asset-legacy-rentman-1", quantity: 1 }],
      mode: "assign",
      projectId: "project-aurora",
      assignedToUserId: "user-paola",
      targetLocationId: "loc-video-village",
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(firstResult.processedAssetIds).toEqual(["asset-legacy-rentman-1"]);

    let state = database
      .prepare(
        "SELECT available_quantity, assigned_quantity, checked_out_quantity, custody_status, active_assignment_id FROM asset_current_state WHERE asset_id = ?",
      )
      .get("asset-legacy-rentman-1") as
      | {
          available_quantity: number;
          assigned_quantity: number;
          checked_out_quantity: number;
          custody_status: string;
          active_assignment_id: string | null;
        }
      | undefined;

    expect(state?.available_quantity).toBe(1);
    expect(state?.assigned_quantity).toBe(1);
    expect(state?.checked_out_quantity).toBe(0);
    expect(state?.custody_status).toBe("partial_assigned");

    const firstAssignment = database
      .prepare("SELECT quantity, assignment_status FROM asset_assignments WHERE id = ?")
      .get(state!.active_assignment_id!) as { quantity: number; assignment_status: string } | undefined;

    expect(firstAssignment?.quantity).toBe(1);
    expect(firstAssignment?.assignment_status).toBe("assigned");
    expect(reads.getAssetDetail("asset-legacy-rentman-1").asset?.quantity).toBe(1);

    mutations.assignMoveAssets({
      commandId: "cmd-test-asset-partial-assign-2",
      workspaceId: "workspace-metadata",
      assetIds: ["asset-legacy-rentman-1"],
      assetSelections: [{ assetId: "asset-legacy-rentman-1", quantity: 1 }],
      mode: "assign",
      projectId: "project-aurora",
      assignedToUserId: "user-paola",
      targetLocationId: "loc-video-village",
      actorType: "user",
      sourceChannel: "desktop",
    });

    state = database
      .prepare(
        "SELECT available_quantity, assigned_quantity, checked_out_quantity, custody_status, active_assignment_id FROM asset_current_state WHERE asset_id = ?",
      )
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

    const assignments = database
      .prepare("SELECT id, quantity FROM asset_assignments WHERE asset_id = ? AND returned_at IS NULL")
      .all("asset-legacy-rentman-1") as Array<{ id: string; quantity: number }>;

    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.quantity).toBe(2);
    expect(reads.getAssetDetail("asset-legacy-rentman-1").asset?.quantity).toBe(0);

    cleanup();
  });

  it("blocks assigning kit members individually unless the action comes from that kit", () => {
    const { cleanup, database } = createTestDatabase("bukowski-asset-kit-guard-test");
    const assetMutations = createAssetMutationService(database);
    const catalogMutations = createCatalogMutationService(database);
    const reads = createFoundationReadService(database);
    const createdAsset = assetMutations.createAsset({
      commandId: "cmd-test-asset-kit-member-create",
      workspaceId: "workspace-metadata",
      name: "Kit locked monitor",
      internalCode: "KITLOCK-001",
      categoryId: "cat-monitors",
      defaultLocationId: "loc-warehouse-a",
      conditionStatus: "Good",
      actorType: "user",
      sourceChannel: "desktop",
    });

    catalogMutations.createEntity({
      workspaceId: "workspace-metadata",
      entityType: "kit",
      code: "FIELDKIT",
      name: "Field Monitor Kit",
      assetSelections: [{ assetId: createdAsset.assetId, quantity: 1 }],
    });
    const createdKit = reads.getCatalogSnapshot().kits.find((kit) => kit.code === "FIELDKIT");

    expect(createdKit?.id).toBeTruthy();

    expect(() =>
      assetMutations.assignMoveAssets({
        commandId: "cmd-test-asset-kit-block",
        workspaceId: "workspace-metadata",
        assetIds: [createdAsset.assetId],
        assetSelections: [{ assetId: createdAsset.assetId, quantity: 1 }],
        mode: "assign",
        projectId: "project-aurora",
        assignedToUserId: "user-paola",
        targetLocationId: "loc-video-village",
        actorType: "user",
        sourceChannel: "desktop",
      }),
    ).toThrow("Remove it from the kit");

    const allowedResult = assetMutations.assignMoveAssets({
      commandId: "cmd-test-asset-kit-allow",
      workspaceId: "workspace-metadata",
      assetIds: [createdAsset.assetId],
      assetSelections: [{ assetId: createdAsset.assetId, quantity: 1 }],
      sourceKitId: createdKit!.id,
      mode: "assign",
      projectId: "project-aurora",
      assignedToUserId: "user-paola",
      targetLocationId: "loc-video-village",
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(allowedResult.processedAssetIds).toEqual([createdAsset.assetId]);

    cleanup();
  });

  it("still blocks kit assignment when a kit member is in maintenance", () => {
    const { cleanup, database } = createTestDatabase("bukowski-asset-kit-maintenance-guard-test");
    const assetMutations = createAssetMutationService(database);
    const catalogMutations = createCatalogMutationService(database);
    const reads = createFoundationReadService(database);
    const createdAsset = assetMutations.createAsset({
      commandId: "cmd-test-asset-kit-maintenance-create",
      workspaceId: "workspace-metadata",
      name: "Maintenance blocked monitor",
      internalCode: "KITMAIN-001",
      categoryId: "cat-monitors",
      defaultLocationId: "loc-warehouse-a",
      conditionStatus: "Review",
      actorType: "user",
      sourceChannel: "desktop",
    });

    catalogMutations.createEntity({
      workspaceId: "workspace-metadata",
      entityType: "kit",
      code: "MAINTKIT",
      name: "Maintenance Sensitive Kit",
      assetSelections: [{ assetId: createdAsset.assetId, quantity: 1 }],
    });
    const createdKit = reads.getCatalogSnapshot().kits.find((kit) => kit.code === "MAINTKIT");

    database
      .prepare(
        `
          UPDATE asset_current_state
          SET operational_status = 'maintenance',
              custody_status = 'maintenance'
          WHERE asset_id = ?
        `,
      )
      .run(createdAsset.assetId);

    expect(() =>
      assetMutations.assignMoveAssets({
        commandId: "cmd-test-asset-kit-maintenance-assign",
        workspaceId: "workspace-metadata",
        assetIds: [createdAsset.assetId],
        assetSelections: [{ assetId: createdAsset.assetId, quantity: 1 }],
        sourceKitId: createdKit!.id,
        mode: "assign",
        projectId: "project-aurora",
        assignedToUserId: "user-paola",
        targetLocationId: "loc-video-village",
        actorType: "user",
        sourceChannel: "desktop",
      }),
    ).toThrow("in maintenance and cannot be assigned right now");

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
      purchasePrice: 520,
      additionalCosts: 80,
      replacementValue: 640,
      currentBookValue: 575,
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
    expect(detail.editor?.purchasePrice).toBe(520);
    expect(detail.editor?.additionalCosts).toBe(80);
    expect(detail.editor?.currentBookValue).toBe(575);
    expect(detail.asset?.insuredValue).toBe("$575");
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
      purchasePrice: 140,
      additionalCosts: 25,
      replacementValue: 180,
      currentBookValue: 160,
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
    expect(detail.editor?.purchasePrice).toBe(140);
    expect(detail.editor?.additionalCosts).toBe(25);
    expect(detail.editor?.currentBookValue).toBe(160);
    expect(detail.asset?.insuredValue).toBe("$160");

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

  it("tolerates a default location missing from the catalog when updating an asset", () => {
    const { cleanup, database } = createTestDatabase("bukowski-asset-orphan-location-test");
    const reads = createFoundationReadService(database);
    const mutations = createAssetMutationService(database);

    const before = reads.getAssetDetail("asset-legacy-rentman-1");

    // Legacy assets (e.g. from the Rentman 2021 import) can carry an orphaned
    // default-location reference that no longer exists in the catalog. Editing
    // them — including just flipping the condition — must not be blocked by it.
    const result = mutations.updateAsset({
      commandId: "cmd-test-asset-orphan-location",
      workspaceId: "workspace-metadata",
      assetId: "asset-legacy-rentman-1",
      name: before.asset!.name,
      internalCode: before.editor!.internalCode,
      categoryId: before.editor!.categoryId,
      defaultLocationId: "loc-deleted-from-catalog",
      conditionStatus: "Damaged",
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(result.repeated).toBe(false);

    const after = reads.getAssetDetail("asset-legacy-rentman-1");
    expect(after.asset?.condition).toBe("Damaged");
    // The missing location is dropped rather than persisted.
    expect(after.editor?.defaultLocationId ?? null).toBeNull();

    cleanup();
  });

  it("still rejects an asset update whose category does not exist", () => {
    const { cleanup, database } = createTestDatabase("bukowski-asset-bad-category-test");
    const reads = createFoundationReadService(database);
    const mutations = createAssetMutationService(database);

    const before = reads.getAssetDetail("asset-legacy-rentman-1");

    expect(() =>
      mutations.updateAsset({
        commandId: "cmd-test-asset-bad-category",
        workspaceId: "workspace-metadata",
        assetId: "asset-legacy-rentman-1",
        name: before.asset!.name,
        internalCode: before.editor!.internalCode,
        categoryId: "cat-does-not-exist",
        conditionStatus: "Good",
        actorType: "user",
        sourceChannel: "desktop",
      }),
    ).toThrow("Category not found.");

    cleanup();
  });

  it("filters asset lists by workspace id", () => {
    const { cleanup, database } = createTestDatabase("bukowski-asset-workspace-filter");
    const reads = createFoundationReadService(database);
    const mutations = createAssetMutationService(database);

    database
      .prepare(
        `
          INSERT INTO workspaces (id, name, slug, base_currency, created_at, updated_at)
          VALUES (?, ?, ?, 'USD', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `,
      )
      .run("workspace-assets-alt", "Assets Alt", "assets-alt");

    database
      .prepare(
        `
          INSERT INTO locations (id, workspace_id, code, name, type, description, is_active, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
        `,
      )
      .run("loc-alt-warehouse", "workspace-assets-alt", "ALT-WH", "Alt Warehouse", "storage", "Workspace-specific warehouse");

    database
      .prepare(
        `
          INSERT INTO asset_categories (id, workspace_id, parent_category_id, code, name, description, created_at)
          VALUES (?, ?, NULL, ?, ?, ?, CURRENT_TIMESTAMP)
        `,
      )
      .run("cat-alt-monitors", "workspace-assets-alt", "ALT-MON", "Alt Monitors", "Workspace-specific monitor category");

    const createResult = mutations.createAsset({
      commandId: "cmd-test-asset-create-alt-workspace",
      workspaceId: "workspace-assets-alt",
      name: "Workspace isolated monitor",
      internalCode: "ALT-001",
      categoryId: "cat-alt-monitors",
      defaultLocationId: "loc-alt-warehouse",
      conditionStatus: "Good",
      actorType: "user",
      sourceChannel: "desktop",
    });

    expect(
      reads
        .getAssets({ workspaceId: "workspace-metadata", sortBy: "name", sortDirection: "asc" })
        .some((asset) => asset.id === createResult.assetId),
    ).toBe(false);
    expect(
      reads
        .getAssets({ workspaceId: "workspace-assets-alt", sortBy: "name", sortDirection: "asc" })
        .some((asset) => asset.id === createResult.assetId),
    ).toBe(true);
    expect(reads.getAssetSummary({ workspaceId: "workspace-assets-alt" }).totalAssets).toBe("1");
    expect(reads.getAssetSummary({ workspaceId: "workspace-metadata" }).totalAssets).not.toBe("1");

    cleanup();
  });
});
