import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { foundationMigrationSql } from "@db";

import { applyAdminFoundationMigration, bootstrapAdminFoundation } from "../../../electron/main/services/data/adminFoundationBootstrap";
import {
  applyAIGatewayFoundationMigration,
  bootstrapAIGatewayFoundation,
} from "../../../electron/main/services/data/aiGatewayFoundationBootstrap";
import { seedFoundationData } from "../../../electron/main/services/data/foundationSeed";
import { bootstrapLegacyRentmanDemo } from "../../../electron/main/services/data/legacyRentmanDemo";
import { ensureProjectShellDefaults } from "../../../electron/main/services/data/projectMutationService";
import {
  applySchedulingFoundationMigration,
  bootstrapSchedulingFoundation,
} from "../../../electron/main/services/data/schedulingFoundationBootstrap";

type TestDatabase = {
  cleanup: () => void;
  database: DatabaseSync;
  databasePath: string;
};

export const createTestDatabase = (prefix: string): TestDatabase => {
  const databasePath = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random()}.sqlite`);
  const database = new DatabaseSync(databasePath);

  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(foundationMigrationSql);
  applyAdminFoundationMigration(database);
  applySchedulingFoundationMigration(database);
  applyAIGatewayFoundationMigration(database);
  seedFoundationData(database);
  bootstrapAIGatewayFoundation(database);
  ensureProjectShellDefaults(database);
  bootstrapLegacyRentmanDemo(database);
  bootstrapAdminFoundation(database);
  bootstrapSchedulingFoundation(database);

  return {
    database,
    databasePath,
    cleanup: () => {
      database.close();
      fs.unlinkSync(databasePath);
    },
  };
};
