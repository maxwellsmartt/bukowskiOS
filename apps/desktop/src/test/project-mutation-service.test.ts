import { describe, expect, it, vi } from "vitest";
import { createFoundationReadService } from "../../electron/main/services/data/foundationReadService";
import { createProjectMutationService } from "../../electron/main/services/data/projectMutationService";
import { createTestDatabase } from "./helpers/createTestDatabase";

describe("project mutation service", () => {
  const buildBucket = (departmentId: string, overrides?: Partial<{ assetIds: string[]; crewAssignments: Array<{ crewMemberId: string; roleLabel?: string }> }>) => ({
    departmentId,
    assetIds: overrides?.assetIds ?? [],
    crewAssignments: overrides?.crewAssignments ?? [],
    packingSeed: { mode: "none" as const },
  });

  it("creates, updates, archives and deletes standalone sidebar projects", () => {
    const { cleanup, database } = createTestDatabase("bukowski-project-test");
    const reads = createFoundationReadService(database);
    const backupSpy = vi.fn();
    const mutations = createProjectMutationService(database, { createBackupBeforeDelete: backupSpy });
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

    mutations.archiveProject({ projectId: createdProject!.id });

    expect(reads.getProjects().some((project) => project.code === "TEST")).toBe(false);
    expect(reads.getProjects({ search: "", sortBy: "name", sortDirection: "asc", includeArchived: true }).some((project) => project.code === "TEST" && project.isArchived)).toBe(true);

    mutations.deleteProject({ projectId: createdProject!.id, confirmedWithBackup: true });
    expect(backupSpy).toHaveBeenCalledTimes(1);

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
        departmentIds: ["dept-video"],
      },
      mainUnit: {
        name: "Main Unit",
        windows: [{ startDate: "2026-05-01", endDate: "2026-05-10", sortOrder: 0 }],
        departmentIds: ["dept-video"],
        unitDepartments: [buildBucket("dept-video", { assetIds: ["asset-aputure-600d"], crewAssignments: [{ crewMemberId: "crew-user-paola", roleLabel: "Lead" }] })],
      },
      additionalUnits: [
        {
          name: "Second Unit",
          code: "BLUE-2U",
          windows: [{ startDate: "2026-05-03", endDate: "2026-05-06", sortOrder: 0 }],
          departmentIds: ["dept-video"],
          unitDepartments: [buildBucket("dept-video", { assetIds: ["asset-sachtler-flowtech"], crewAssignments: [{ crewMemberId: "crew-user-miguel", roleLabel: "AC" }] })],
        },
      ],
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

  it("deletes structural blueprint projects when they have no operational records yet", () => {
    const { cleanup, database } = createTestDatabase("bukowski-project-blueprint-delete-test");
    const reads = createFoundationReadService(database);
    const backupSpy = vi.fn();
    const mutations = createProjectMutationService(database, { createBackupBeforeDelete: backupSpy });

    mutations.createProjectBlueprint({
      generalInfo: {
        name: "Delete Me Blueprint",
        status: "Prep",
        startDate: "2026-05-01",
        endDate: "2026-05-10",
        colorKey: "amber",
        departmentIds: ["dept-camera"],
      },
      mainUnit: {
        name: "Main Unit",
        windows: [{ startDate: "2026-05-01", endDate: "2026-05-10" }],
        departmentIds: ["dept-camera"],
        unitDepartments: [
          {
            departmentId: "dept-camera",
            assetIds: [],
            crewAssignments: [],
            packingSeed: { mode: "none" },
          },
        ],
      },
      additionalUnits: [
        {
          name: "Second Unit",
          windows: [{ startDate: "2026-05-03", endDate: "2026-05-05" }],
          departmentIds: ["dept-camera"],
          unitDepartments: [
            {
              departmentId: "dept-camera",
              assetIds: [],
              crewAssignments: [],
              packingSeed: { mode: "none" },
            },
          ],
        },
      ],
    });

    const createdProject = reads.getProjects().find((project) => project.name === "Delete Me Blueprint");
    expect(createdProject).toBeTruthy();

    mutations.archiveProject({ projectId: createdProject!.id });
    mutations.deleteProject({ projectId: createdProject!.id, confirmedWithBackup: true });
    expect(backupSpy).toHaveBeenCalledTimes(1);

    expect(reads.getProjects().some((project) => project.id === createdProject!.id)).toBe(false);

    cleanup();
  });

  it("auto-generates a project code when the blueprint omits it", () => {
    const { cleanup, database } = createTestDatabase("bukowski-project-blueprint-code-test");
    const reads = createFoundationReadService(database);
    const mutations = createProjectMutationService(database);

    mutations.createProjectBlueprint({
      generalInfo: {
        name: "Silent River",
        status: "Prep",
        startDate: "2026-05-12",
        endDate: "2026-05-20",
        colorKey: "moss",
        departmentIds: [],
      },
      mainUnit: {
        name: "Main Unit",
        windows: [{ startDate: "2026-05-12", endDate: "2026-05-20", sortOrder: 0 }],
        departmentIds: [],
        unitDepartments: [],
      },
      additionalUnits: [],
    });

    const project = reads.getProjects().find((row) => row.name === "Silent River");
    expect(project?.code).toBeTruthy();
    expect(project?.code).toBe("SR");

    cleanup();
  });

  it("blocks overlapping crew assignments inside the same setup", () => {
    const { cleanup, database } = createTestDatabase("bukowski-project-blueprint-internal-crew-conflict-test");
    const mutations = createProjectMutationService(database);

    expect(() =>
      mutations.createProjectBlueprint({
        generalInfo: {
          name: "Crew Conflict Setup",
          status: "Prep",
          startDate: "2026-05-12",
          endDate: "2026-05-20",
          colorKey: "moss",
          departmentIds: ["dept-video"],
        },
        mainUnit: {
          name: "Main Unit",
          windows: [{ startDate: "2026-05-12", endDate: "2026-05-20", sortOrder: 0 }],
          departmentIds: ["dept-video"],
          unitDepartments: [buildBucket("dept-video", { crewAssignments: [{ crewMemberId: "crew-user-paola", roleLabel: "Lead" }] })],
        },
        additionalUnits: [
          {
            name: "Second Unit",
            code: "CCS-2U",
            windows: [{ startDate: "2026-05-14", endDate: "2026-05-16", sortOrder: 0 }],
            departmentIds: ["dept-video"],
            unitDepartments: [buildBucket("dept-video", { crewAssignments: [{ crewMemberId: "crew-user-paola", roleLabel: "Second Unit Lead" }] })],
          },
        ],
      }),
    ).toThrow("overlaps within this setup");

    cleanup();
  });

  it("blocks overlapping asset assignments inside the same setup", () => {
    const { cleanup, database } = createTestDatabase("bukowski-project-blueprint-internal-asset-conflict-test");
    const mutations = createProjectMutationService(database);

    expect(() =>
      mutations.createProjectBlueprint({
        generalInfo: {
          name: "Asset Conflict Setup",
          status: "Prep",
          startDate: "2026-05-12",
          endDate: "2026-05-20",
          colorKey: "moss",
          departmentIds: ["dept-video"],
        },
        mainUnit: {
          name: "Main Unit",
          windows: [{ startDate: "2026-05-12", endDate: "2026-05-20", sortOrder: 0 }],
          departmentIds: ["dept-video"],
          unitDepartments: [buildBucket("dept-video", { assetIds: ["asset-aputure-600d"] })],
        },
        additionalUnits: [
          {
            name: "Second Unit",
            code: "ACS-2U",
            windows: [{ startDate: "2026-05-14", endDate: "2026-05-16", sortOrder: 0 }],
            departmentIds: ["dept-video"],
            unitDepartments: [buildBucket("dept-video", { assetIds: ["asset-aputure-600d"] })],
          },
        ],
      }),
    ).toThrow("overlaps within this setup");

    cleanup();
  });

  it("persists multiple windows for an additional unit and exposes them in the timeline", () => {
    const { cleanup, database } = createTestDatabase("bukowski-project-blueprint-multi-window-test");
    const reads = createFoundationReadService(database);
    const mutations = createProjectMutationService(database);

    mutations.createProjectBlueprint({
      generalInfo: {
        name: "Segmented Unit Setup",
        status: "Prep",
        startDate: "2026-05-12",
        endDate: "2026-05-30",
        hasPreproduction: true,
        preproductionStartDate: "2026-05-08",
        preproductionEndDate: "2026-05-11",
        colorKey: "ice",
        departmentIds: [],
      },
      mainUnit: {
        name: "Main Unit",
        windows: [{ startDate: "2026-05-12", endDate: "2026-05-30", sortOrder: 0 }],
        departmentIds: [],
        unitDepartments: [],
      },
      additionalUnits: [
        {
          name: "Second Unit",
          code: "SEG-2U",
          windows: [
            { startDate: "2026-05-13", endDate: "2026-05-14", sortOrder: 0 },
            { startDate: "2026-05-18", endDate: "2026-05-20", sortOrder: 1 },
            { startDate: "2026-05-24", endDate: "2026-05-25", sortOrder: 2 },
          ],
          departmentIds: [],
          unitDepartments: [],
        },
      ],
    });

    const project = reads.getProjects().find((row) => row.name === "Segmented Unit Setup");
    const detail = reads.getProjectDetail(project!.id);
    expect(detail.units[0]?.windows).toHaveLength(3);

    const timeline = reads.getScheduleTimeline("90d", "week");
    const timelineProject = timeline.projects.find((row) => row.id === project!.id);
    expect(timelineProject?.segments.some((segment) => segment.kind === "preproduction")).toBe(true);
    expect(timelineProject?.units[0]?.segments).toHaveLength(3);

    cleanup();
  });

  it("blocks hard delete while a project is active", () => {
    const { cleanup, database } = createTestDatabase("bukowski-project-active-delete-test");
    const mutations = createProjectMutationService(database, { createBackupBeforeDelete: vi.fn() });

    expect(() => mutations.deleteProject({ projectId: "project-aurora", confirmedWithBackup: true })).toThrow(
      "Active projects cannot be hard-deleted. Archive the project instead.",
    );

    cleanup();
  });

  it("blocks hard delete until the project is archived", () => {
    const { cleanup, database } = createTestDatabase("bukowski-project-needs-archive-delete-test");
    const reads = createFoundationReadService(database);
    const mutations = createProjectMutationService(database, { createBackupBeforeDelete: vi.fn() });
    const catalog = reads.getCatalogSnapshot();

    mutations.createProject({
      code: "SHELL",
      name: "Shell Only",
      clientId: catalog.clients[0]?.id,
    });

    const project = reads.getProjects().find((row) => row.code === "SHELL");
    expect(() => mutations.deleteProject({ projectId: project!.id, confirmedWithBackup: true })).toThrow(
      "Archive the project before hard delete.",
    );

    cleanup();
  });

  it("blocks hard delete when operational history exists", () => {
    const { cleanup, database } = createTestDatabase("bukowski-project-operational-delete-test");
    const mutations = createProjectMutationService(database, { createBackupBeforeDelete: vi.fn() });

    mutations.updateProject({
      projectId: "project-aurora",
      code: "AURORA",
      name: "Aurora Campaign",
      status: "Wrapped",
      description: "Archive eligibility test",
    });
    mutations.archiveProject({ projectId: "project-aurora" });

    expect(() => mutations.deleteProject({ projectId: "project-aurora", confirmedWithBackup: true })).toThrow(
      "This project has linked operational history and can only be archived.",
    );

    cleanup();
  });
});
