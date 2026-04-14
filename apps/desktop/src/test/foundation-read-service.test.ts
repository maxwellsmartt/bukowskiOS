import { describe, expect, it } from "vitest";
import { createAssetMutationService } from "../../electron/main/services/data/assetMutationService";
import { createFoundationReadService } from "../../electron/main/services/data/foundationReadService";
import { createProjectMutationService } from "../../electron/main/services/data/projectMutationService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("foundation read service", () => {
  it("hydrates shell, imported assets and finance snapshots from the local foundation database", () => {
    const { cleanup, database } = createTestDatabase("bukowski-foundation-test");
    const reads = createFoundationReadService(database);
    const overviewSnapshot = reads.getOverviewSnapshot();

    expect(reads.getShellBootstrap().workspaceName).toBe("Metadata Cine");
    expect(overviewSnapshot.cards.overdueReturns.label).toBe("Overdue returns");
    expect(overviewSnapshot.cards.openPackingSlips.label).toBe("Open packing slips");
    expect(overviewSnapshot.cards.activeIncidents.label).toBe("Active incidents");
    expect(overviewSnapshot.cards.maintenanceWatch.label).toBe("Maintenance watch");
    expect(reads.getAssetSummary().totalAssets).toBeTruthy();
    expect(reads.getAssetSummary().assignedAssets).toBeTruthy();
    expect(reads.getAssets().length).toBeGreaterThan(780);
    expect(reads.getAssetDetail("asset-legacy-rentman-1").asset?.code).toBe("485");
    expect(reads.getAssetDetail("asset-legacy-rentman-1").asset?.quantity).toBe(2);
    expect(reads.getAssetDetail("asset-legacy-rentman-1").legacy?.folderPath).toBe("Gripería/Tripodes");
    expect(reads.getAssetDetail("asset-legacy-rentman-1").editor?.primaryCodeValue).toBeTruthy();
    expect(reads.getAssetDetail("asset-legacy-rentman-1").scannableCodes.length).toBeGreaterThan(0);
    expect(reads.getAssetDetail("asset-legacy-rentman-1").timeline.length).toBeGreaterThan(0);
    expect(reads.getPackingSlips().length).toBeGreaterThan(0);
    expect(reads.getPackingSlipDetail("packing-1042").slip?.number).toBe("PS-1042");
    expect(reads.getPackingSlipDetail("packing-1042").slip?.primaryCodeValue).toBeTruthy();
    expect(reads.getPackingSlipDetail("packing-1042").items.length).toBeGreaterThan(0);
    expect(reads.getProjectDetail("project-aurora").project?.name).toBe("Aurora Campaign");
    expect(reads.getProjectDetail("project-aurora").project?.client).toBe("Altura");
    expect(reads.getProjectDetail("project-aurora").assets.length).toBeGreaterThan(0);
    expect(reads.getProjectDetail("project-aurora").incidents.length).toBeGreaterThan(0);
    expect(reads.getProjectDetail("project-aurora").metrics).toHaveLength(4);
    expect(reads.getCatalogSnapshot().clients.length).toBeGreaterThan(0);
    expect(reads.getCatalogSnapshot().crewMembers.length).toBeGreaterThan(0);
    expect(reads.getCatalogSnapshot().categories.length).toBeGreaterThan(0);
    expect(reads.getFinanceOverview().metrics).toHaveLength(5);
    expect(reads.getFinanceOverview().activePeriodLabel).toBeTruthy();
    expect(reads.getFinanceOverview().monthlyBurn).toHaveLength(6);
    expect(Array.isArray(reads.getFinanceOverview().categoryBreakdown)).toBe(true);
    expect(reads.getFinanceEntries()).toHaveLength(2);

    cleanup();
  });

  it("builds timeline windows from range, scale and anchor date without changing project data", () => {
    const { cleanup, database } = createTestDatabase("bukowski-foundation-timeline");
    const reads = createFoundationReadService(database);

    const weeklyTimeline = reads.getScheduleTimeline("90d", "week", "2026-04-10");
    const dailyTimeline = reads.getScheduleTimeline("30d", "day", "2026-04-10");
    const monthlyTimeline = reads.getScheduleTimeline("6m", "month", "2026-06-15");
    const shiftedTimeline = reads.getScheduleTimeline("90d", "week", "2026-07-10");
    const pagedTimeline = reads.getScheduleTimeline("90d", "week", "2026-04-10", { limit: 1, offset: 1 });

    expect(weeklyTimeline.anchorDate).toBe("2026-04-10");
    expect(weeklyTimeline.scale).toBe("week");
    expect(dailyTimeline.scale).toBe("day");
    expect(monthlyTimeline.scale).toBe("month");
    expect(dailyTimeline.rangeStart).toBe("2026-04-04");
    expect(weeklyTimeline.rangeStart).toBe("2026-03-23");
    expect(dailyTimeline.markers.length).toBeGreaterThan(weeklyTimeline.markers.length);
    expect(monthlyTimeline.markers.length).toBeLessThan(weeklyTimeline.markers.length);
    expect(shiftedTimeline.rangeStart).not.toBe(weeklyTimeline.rangeStart);
    expect(shiftedTimeline.projects).toHaveLength(weeklyTimeline.projects.length);
    expect(shiftedTimeline.unscheduled).toHaveLength(weeklyTimeline.unscheduled.length);
    expect(weeklyTimeline.limit).toBe(24);
    expect(weeklyTimeline.offset).toBe(0);
    expect(weeklyTimeline.totalProjects).toBe(weeklyTimeline.projects.length);
    expect(weeklyTimeline.visibleProjects).toBe(weeklyTimeline.projects.length);
    expect(weeklyTimeline.hasMoreProjects).toBe(false);
    expect(weeklyTimeline.projects[0]?.assignedAssetCount).toBeTypeOf("number");
    expect(weeklyTimeline.projects[0]?.crewAssignmentCount).toBeTypeOf("number");
    expect(weeklyTimeline.projects[0]?.activeIncidentCount).toBeTypeOf("number");
    expect(weeklyTimeline.projects[0]?.conflictCount).toBeTypeOf("number");
    expect(weeklyTimeline.projects[0]?.units[0]?.conflictCount).toBeTypeOf("number");
    expect(Array.isArray(weeklyTimeline.projects[0]?.incidentMarkers ?? [])).toBe(true);
    expect(pagedTimeline.limit).toBe(1);
    expect(pagedTimeline.offset).toBe(1);
    expect(pagedTimeline.visibleProjects).toBe(1);
    expect(pagedTimeline.totalProjects).toBeGreaterThanOrEqual(pagedTimeline.visibleProjects);
    expect(pagedTimeline.hasMoreProjects).toBe(pagedTimeline.totalProjects > pagedTimeline.offset + pagedTimeline.visibleProjects);

    cleanup();
  });

  it("hides archived projects from default lists and timeline until explicitly included", () => {
    const { cleanup, database } = createTestDatabase("bukowski-foundation-archived-projects");
    const reads = createFoundationReadService(database);
    const mutations = createProjectMutationService(database, { createBackupBeforeDelete: () => undefined });

    expect(reads.getProjects().some((project) => project.id === "project-aurora")).toBe(true);
    expect(reads.getScheduleTimeline("90d", "week").projects.some((project) => project.id === "project-aurora")).toBe(true);

    mutations.archiveProject({ projectId: "project-aurora" });

    expect(reads.getProjects().some((project) => project.id === "project-aurora")).toBe(false);
    expect(
      reads.getProjects({ search: "", sortBy: "name", sortDirection: "asc", includeArchived: true }).some((project) => project.id === "project-aurora" && project.isArchived),
    ).toBe(true);
    expect(reads.getScheduleTimeline("90d", "week").projects.some((project) => project.id === "project-aurora")).toBe(false);

    mutations.unarchiveProject({ projectId: "project-aurora" });

    expect(reads.getProjects().some((project) => project.id === "project-aurora")).toBe(true);
    expect(reads.getScheduleTimeline("90d", "week").projects.some((project) => project.id === "project-aurora")).toBe(true);

    cleanup();
  });

  it("exposes quantity buckets and reservation quantities across asset and project reads", () => {
    const { cleanup, database } = createTestDatabase("bukowski-foundation-quantity-reads");
    const reads = createFoundationReadService(database);
    const assetMutations = createAssetMutationService(database);

    assetMutations.assignMoveAssets({
      commandId: "cmd-foundation-quantity-read-1",
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

    const assetRow = reads.getAssets().find((row) => row.id === "asset-legacy-rentman-1");
    const assetDetail = reads.getAssetDetail("asset-legacy-rentman-1");
    const projectDetail = reads.getProjectDetail("project-aurora");
    const projectAsset = projectDetail.assets.find((row) => row.id === "asset-legacy-rentman-1");
    const availability = reads.getAssetAvailability({ assetId: "asset-legacy-rentman-1" })[0];
    const reservations = reads.getAssetReservations({ assetId: "asset-legacy-rentman-1" });

    expect(assetRow?.totalQuantity).toBe(2);
    expect(assetRow?.quantity).toBe(1);
    expect(assetRow?.assignedQuantity).toBe(1);
    expect(assetRow?.checkedOutQuantity).toBe(0);

    expect(assetDetail.asset?.totalQuantity).toBe(2);
    expect(assetDetail.asset?.quantity).toBe(1);
    expect(assetDetail.asset?.assignedQuantity).toBe(1);
    expect(assetDetail.asset?.checkedOutQuantity).toBe(0);

    expect(projectAsset?.totalQuantity).toBe(2);
    expect(projectAsset?.availableQuantity).toBe(1);
    expect(projectAsset?.assignedQuantity).toBe(1);
    expect(projectAsset?.checkedOutQuantity).toBe(0);

    expect(availability?.reservationsInWindow).toBe(1);
    expect(availability?.availableQuantity).toBe(1);
    expect(availability?.availableNow).toBe(true);

    expect(reservations[0]?.quantity).toBe(1);
    expect(reservations[0]?.project).toBe("Aurora Campaign");

    cleanup();
  });
});
