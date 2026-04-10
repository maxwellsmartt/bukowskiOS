import { app } from "electron";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import { foundationMigrationSql } from "@db";

import { createFoundationReadService, type FoundationReadService } from "./foundationReadService";
import { createAssetMutationService } from "./assetMutationService";
import { createIncidentMutationService } from "./incidentMutationService";
import { seedFoundationData } from "./foundationSeed";
import { bootstrapLegacyRentmanDemo } from "./legacyRentmanDemo";
import { createProjectMutationService, ensureProjectShellDefaults } from "./projectMutationService";

type ProjectMutationService = ReturnType<typeof createProjectMutationService>;
type AssetMutationService = ReturnType<typeof createAssetMutationService>;
type IncidentMutationService = ReturnType<typeof createIncidentMutationService>;

type LocalDatabaseRuntime = {
  database: DatabaseSync;
  databasePath: string;
  foundationReads: FoundationReadService;
  projectMutations: ProjectMutationService;
  assetMutations: AssetMutationService;
  incidentMutations: IncidentMutationService;
};

let runtime: LocalDatabaseRuntime | null = null;

const createRuntime = (): LocalDatabaseRuntime => {
  const databasePath = path.join(app.getPath("userData"), "bukowski-foundation.sqlite");
  const database = new DatabaseSync(databasePath);

  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(foundationMigrationSql);
  seedFoundationData(database);
  ensureProjectShellDefaults(database);
  bootstrapLegacyRentmanDemo(database);

  return {
    database,
    databasePath,
    foundationReads: createFoundationReadService(database),
    projectMutations: createProjectMutationService(database),
    assetMutations: createAssetMutationService(database),
    incidentMutations: createIncidentMutationService(database),
  };
};

export const initializeLocalDatabase = () => {
  if (!runtime) {
    runtime = createRuntime();
  }

  return runtime;
};

export const getLocalDatabase = () => {
  if (!runtime) {
    throw new Error("Local database has not been initialized");
  }

  return runtime;
};
