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
});
