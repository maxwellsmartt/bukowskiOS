import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { foundationMigrations } from "@db";

import { applyAdminFoundationMigration, bootstrapAdminFoundation } from "../../../electron/main/services/data/adminFoundationBootstrap";
import { applyAssetQuantityFoundationMigration } from "../../../electron/main/services/data/assetQuantityFoundationBootstrap";
import {
  applyAIGatewayFoundationMigration,
  bootstrapAIGatewayFoundation,
} from "../../../electron/main/services/data/aiGatewayFoundationBootstrap";
import { applyConnectorFoundationMigration } from "../../../electron/main/services/data/connectorFoundationBootstrap";
import { seedFoundationData } from "../../../electron/main/services/data/foundationSeed";
import { bootstrapLegacyRentmanDemo } from "../../../electron/main/services/data/legacyRentmanDemo";
import { applyCrewCatalogFoundationMigration } from "../../../electron/main/services/data/crewCatalogFoundationBootstrap";
import { applyProjectArchiveFoundationMigration } from "../../../electron/main/services/data/projectCreationWizardFoundationBootstrap";
import { ensureProjectShellDefaults } from "../../../electron/main/services/data/projectMutationService";
import {
  applySchedulingFoundationMigration,
  bootstrapSchedulingFoundation,
} from "../../../electron/main/services/data/schedulingFoundationBootstrap";
import { applyOperationalFilesMigration } from "../../../electron/main/services/data/fileUploadService";
import { applyTrackedSqlMigrations, applyTrackedStep } from "../../../electron/main/services/data/localDatabaseSupport";
import { applyTreasuryFoundationSelfHeal } from "../../../electron/main/services/data/treasuryFoundationBootstrap";

type TestDatabase = {
  cleanup: () => void;
  database: DatabaseSync;
  databasePath: string;
};

export const createTestDatabase = (
  prefix: string,
  options: { includeDemoData?: boolean } = {},
): TestDatabase => {
  const databasePath = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random()}.sqlite`);
  const database = new DatabaseSync(databasePath);

  database.exec("PRAGMA foreign_keys = ON;");
  applyTrackedSqlMigrations(database, foundationMigrations);
  applyTreasuryFoundationSelfHeal(database);
  applyTrackedStep(database, "runtime_admin_foundation_v1", () => applyAdminFoundationMigration(database));
  applyTrackedStep(database, "runtime_scheduling_foundation_v1", () => applySchedulingFoundationMigration(database));
  applyTrackedStep(database, "runtime_project_archive_v1", () => applyProjectArchiveFoundationMigration(database));
  applyTrackedStep(database, "runtime_crew_catalog_foundation_v1", () => applyCrewCatalogFoundationMigration(database));
  applyTrackedStep(database, "runtime_ai_gateway_foundation_v2", () => applyAIGatewayFoundationMigration(database));
  applyTrackedStep(database, "runtime_connector_foundation_v1", () => applyConnectorFoundationMigration(database));
  applyTrackedStep(database, "runtime_operational_files_v2", () => applyOperationalFilesMigration(database));
  const includeDemoData = options.includeDemoData !== false;
  seedFoundationData(database, { includeDemoData });
  bootstrapAIGatewayFoundation(database);
  if (includeDemoData) {
    ensureProjectShellDefaults(database);
    bootstrapLegacyRentmanDemo(database);
  }
  applyTrackedStep(database, "runtime_asset_quantity_foundation_v1", () => applyAssetQuantityFoundationMigration(database));
  bootstrapAdminFoundation(database);
  if (includeDemoData) bootstrapSchedulingFoundation(database);

  return {
    database,
    databasePath,
    cleanup: () => {
      database.close();
      fs.unlinkSync(databasePath);
    },
  };
};
