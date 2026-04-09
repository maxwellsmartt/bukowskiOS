import { app } from "electron";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import { foundationMigrationSql } from "@db";

import { createFoundationReadService, type FoundationReadService } from "./foundationReadService";
import { seedFoundationData } from "./foundationSeed";

type LocalDatabaseRuntime = {
  database: DatabaseSync;
  databasePath: string;
  foundationReads: FoundationReadService;
};

let runtime: LocalDatabaseRuntime | null = null;

const createRuntime = (): LocalDatabaseRuntime => {
  const databasePath = path.join(app.getPath("userData"), "bukowski-foundation.sqlite");
  const database = new DatabaseSync(databasePath);

  database.exec("PRAGMA journal_mode = WAL;");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(foundationMigrationSql);
  seedFoundationData(database);

  return {
    database,
    databasePath,
    foundationReads: createFoundationReadService(database),
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
