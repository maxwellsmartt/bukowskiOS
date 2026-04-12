import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { foundationMigrations } from "@db";

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
import { applyTrackedSqlMigrations, applyTrackedStep } from "../../../electron/main/services/data/localDatabaseSupport";

type TestDatabase = {
  cleanup: () => void;
  database: DatabaseSync;
  databasePath: string;
};

export const createTestDatabase = (prefix: string): TestDatabase => {
  const databasePath = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random()}.sqlite`);
  const database = new DatabaseSync(databasePath);

  database.exec("PRAGMA foreign_keys = ON;");
  applyTrackedSqlMigrations(database, foundationMigrations);
  applyTrackedStep(database, "runtime_admin_foundation_v1", () => applyAdminFoundationMigration(database));
  applyTrackedStep(database, "runtime_scheduling_foundation_v1", () => applySchedulingFoundationMigration(database));
  applyTrackedStep(database, "runtime_ai_gateway_foundation_v2", () => applyAIGatewayFoundationMigration(database));
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
