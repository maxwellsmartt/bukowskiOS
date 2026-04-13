import { describe, expect, it } from "vitest";
import { createFoundationReadService } from "../../electron/main/services/data/foundationReadService";
import { createProjectMutationService } from "../../electron/main/services/data/projectMutationService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("project mutation service", () => {
  it("creates, updates and deletes standalone sidebar projects", () => {
    const { cleanup, database } = createTestDatabase("bukowski-project-test");
    const reads = createFoundationReadService(database);
    const mutations = createProjectMutationService(database);
    const catalog = reads.getCatalogSnapshot();
    const internalClient = catalog.clients.find((client) => client.name === "Internal");

    mutations.createProject({
      code: "TEST",
      name: "Test Project",
      clientId: internalClient?.id,
    });

    let createdProject = reads.getProjects().find((project) => project.code === "TEST");
    expect(createdProject?.name).toBe("Test Project");

    mutations.updateProject({
      projectId: createdProject!.id,
      code: "TEST",
      name: "Renamed Project",
      clientName: "Partner",
      status: "Prep",
      description: "Sidebar edited project",
    });

    createdProject = reads.getProjects().find((project) => project.code === "TEST");
    expect(createdProject?.name).toBe("Renamed Project");
    expect(createdProject?.client).toBe("Partner");

    mutations.deleteProject({ projectId: createdProject!.id });

    expect(reads.getProjects().some((project) => project.code === "TEST")).toBe(false);

    cleanup();
  });

  it("blocks shrinking a project window when units would fall outside the new dates", () => {
    const { cleanup, database } = createTestDatabase("bukowski-project-test");
    const mutations = createProjectMutationService(database);

    expect(() =>
      mutations.updateProject({
        projectId: "project-aurora",
        code: "AURORA",
        name: "Aurora Campaign",
        status: "Active",
        description: "Window shrink test",
        startDate: "2026-04-01",
        endDate: "2026-04-09",
      }),
    ).toThrow("falls outside the new project date window");

    cleanup();
  });

  it("flags crew overlaps as warnings instead of blocking the assignment", () => {
    const { cleanup, database } = createTestDatabase("bukowski-project-conflict-test");
    const reads = createFoundationReadService(database);
    const mutations = createProjectMutationService(database);

    mutations.createProjectUnit({
      projectId: "project-studio",
      code: "OVR",
      name: "Overlap Unit",
      startDate: "2026-04-10",
      endDate: "2026-04-12",
    });

    const studioDetail = reads.getProjectDetail("project-studio");
    const overlapUnit = studioDetail.units.find((unit) => unit.code === "OVR");
    expect(overlapUnit).toBeTruthy();

    mutations.assignCrewToProjectUnit({
      projectId: "project-studio",
      unitId: overlapUnit!.id,
      crewMemberId: "crew-user-paola",
      roleLabel: "Camera overlap",
      startDate: "2026-04-10",
      endDate: "2026-04-12",
    });

    const refreshedStudioDetail = reads.getProjectDetail("project-studio");
    const refreshedAuroraDetail = reads.getProjectDetail("project-aurora");
    const conflictedStudioUnit = refreshedStudioDetail.units.find((unit) => unit.id === overlapUnit!.id);
    const conflictedAuroraUnit = refreshedAuroraDetail.units.find((unit) => unit.id === "unit-aurora-main");

    expect(conflictedStudioUnit?.conflictCount).toBeGreaterThan(0);
    expect(conflictedStudioUnit?.crewConflictCount).toBeGreaterThan(0);
    expect(conflictedStudioUnit?.conflictSummary).toContain("crew overlap");
    expect(conflictedAuroraUnit?.conflictCount).toBeGreaterThan(0);

    cleanup();
  });

  it("creates a project blueprint with a hidden main unit and visible additional units", () => {
    const { cleanup, database } = createTestDatabase("bukowski-project-blueprint-test");
    const reads = createFoundationReadService(database);
    const mutations = createProjectMutationService(database);
    const catalog = reads.getCatalogSnapshot();
    const client = catalog.clients.find((row) => row.name === "Internal");

    mutations.createProjectBlueprint({
      generalInfo: {
        code: "BLUE",
        name: "Blueprint Launch",
        clientId: client?.id,
        productionCompanyName: "Altitude Pictures",
        status: "Prep",
        startDate: "2026-05-01",
        endDate: "2026-05-10",
        hasPreproduction: true,
        preproductionStartDate: "2026-04-25",
        preproductionEndDate: "2026-04-30",
        colorKey: "teal",
        description: "Blueprint creation test",
      },
      mainUnit: {
        name: "Main Unit",
        assetIds: ["asset-aputure-600d"],
        crewAssignments: [{ crewMemberId: "crew-user-paola", roleLabel: "Lead" }],
      },
      additionalUnits: [
        {
          name: "Second Unit",
          code: "BLUE-2U",
          startDate: "2026-05-03",
          endDate: "2026-05-06",
          assetIds: ["asset-sachtler-flowtech"],
          crewAssignments: [{ crewMemberId: "crew-user-miguel", roleLabel: "AC" }],
        },
      ],
      packingSelection: {
        mode: "none",
      },
    });

    const project = reads.getProjects().find((row) => row.code === "BLUE");
    expect(project?.productionCompanyId).toBeTruthy();
    expect(project?.productionCompany).toBe("Altitude Pictures");
    expect(project?.hasPreproduction).toBe(true);
    expect(project?.activeUnitCount).toBe(0);

    const detail = reads.getProjectDetail(project!.id);
    expect(detail.units).toHaveLength(1);
    expect(detail.units[0]?.name).toBe("Second Unit");
    expect(detail.units[0]?.crewAssignments).toHaveLength(1);

    const timeline = reads.getScheduleTimeline("90d", "week");
    const timelineProject = timeline.projects.find((row) => row.id === project!.id);
    expect(timelineProject?.units).toHaveLength(1);
    expect(timelineProject?.units[0]?.name).toBe("Second Unit");

    cleanup();
  });
});
