import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, it } from "vitest";

import { foundationMigrationSql } from "@db";

import { createFoundationReadService } from "../../electron/main/services/data/foundationReadService";
import { seedFoundationData } from "../../electron/main/services/data/foundationSeed";
import { createProjectMutationService, ensureProjectShellDefaults } from "../../electron/main/services/data/projectMutationService";

const createTempDatabase = () => {
  const databasePath = path.join(os.tmpdir(), `bukowski-project-test-${Date.now()}-${Math.random()}.sqlite`);
  const database = new DatabaseSync(databasePath);

  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(foundationMigrationSql);
  seedFoundationData(database);
  ensureProjectShellDefaults(database);

  return { database, databasePath };
};

describe("project mutation service", () => {
  it("creates, updates and deletes standalone sidebar projects", () => {
    const { database, databasePath } = createTempDatabase();
    const reads = createFoundationReadService(database);
    const mutations = createProjectMutationService(database);

    mutations.createProject({
      code: "TEST",
      name: "Test Project",
      clientName: "Internal",
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

    database.close();
    fs.unlinkSync(databasePath);
  });
});
