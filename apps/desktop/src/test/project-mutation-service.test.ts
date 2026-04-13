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
});
