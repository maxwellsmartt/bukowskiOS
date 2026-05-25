import foundationCoreSql from "../migrations/0001_foundation.sql?raw";
import legacyRentmanSql from "../migrations/0002_legacy_rentman.sql?raw";
import adminFoundationSql from "../migrations/0003_admin_foundation.sql?raw";
import schedulingFoundationSql from "../migrations/0004_scheduling_foundation.sql?raw";
import rmaFoundationSql from "../migrations/0005_rma_foundation.sql?raw";
import agentsFoundationSql from "../migrations/0006_agents_foundation.sql?raw";
import aiProviderFoundationSql from "../migrations/0007_ai_provider_foundation.sql?raw";
import assistantChatMemoryFoundationSql from "../migrations/0008_assistant_chat_memory_foundation.sql?raw";
import migrationTrackingSql from "../migrations/0009_migration_tracking.sql?raw";
import projectCreationWizardSql from "../migrations/0010_project_creation_wizard.sql?raw";
import projectUnitWindowsSql from "../migrations/0011_project_unit_windows.sql?raw";
import projectDepartmentsMatrixSql from "../migrations/0012_project_departments_matrix.sql?raw";
import kitAssetQuantitiesSql from "../migrations/0013_kit_asset_quantities.sql?raw";
import assetQuantityStateSql from "../migrations/0014_asset_quantity_state.sql?raw";
import assetAssignmentQuantitiesSql from "../migrations/0015_asset_assignment_quantities.sql?raw";
import connectorRuntimeSql from "../migrations/0016_connector_runtime.sql?raw";
import catalogPullCursorsSql from "../migrations/0017_catalog_pull_cursors.sql?raw";
import currencyAndQuotesFoundationSql from "../migrations/0018_currency_and_quotes_foundation.sql?raw";
import quotesSchemaSql from "../migrations/0019_quotes_schema.sql?raw";
import invoicesSchemaSql from "../migrations/0021_invoices_schema.sql?raw";
import treasurySchemaSql from "../migrations/0022_treasury_schema.sql?raw";
import collaboratorPaymentsSql from "../migrations/0022_collaborator_payments.sql?raw";
import treasuryUndoJournalSql from "../migrations/0023_treasury_undo_journal.sql?raw";
import treasuryFiscalFieldsSql from "../migrations/0024_treasury_fiscal_fields.sql?raw";

const foundationMigrations = [
  { version: "0001_foundation", sql: foundationCoreSql },
  { version: "0002_legacy_rentman", sql: legacyRentmanSql },
  { version: "0003_admin_foundation", sql: adminFoundationSql },
  { version: "0004_scheduling_foundation", sql: schedulingFoundationSql },
  { version: "0005_rma_foundation", sql: rmaFoundationSql },
  { version: "0006_agents_foundation", sql: agentsFoundationSql },
  { version: "0007_ai_provider_foundation", sql: aiProviderFoundationSql },
  { version: "0008_assistant_chat_memory_foundation", sql: assistantChatMemoryFoundationSql },
  { version: "0009_migration_tracking", sql: migrationTrackingSql },
  { version: "0010_project_creation_wizard", sql: projectCreationWizardSql },
  { version: "0011_project_unit_windows", sql: projectUnitWindowsSql },
  { version: "0012_project_departments_matrix", sql: projectDepartmentsMatrixSql },
  { version: "0013_kit_asset_quantities", sql: kitAssetQuantitiesSql },
  { version: "0014_asset_quantity_state", sql: assetQuantityStateSql },
  { version: "0015_asset_assignment_quantities", sql: assetAssignmentQuantitiesSql },
  { version: "0016_connector_runtime", sql: connectorRuntimeSql },
  { version: "0017_catalog_pull_cursors", sql: catalogPullCursorsSql },
  { version: "0018_currency_and_quotes_foundation", sql: currencyAndQuotesFoundationSql },
  { version: "0019_quotes_schema", sql: quotesSchemaSql },
  { version: "0021_invoices_schema", sql: invoicesSchemaSql },
  { version: "0022_treasury_schema", sql: treasurySchemaSql },
  { version: "0022_collaborator_payments", sql: collaboratorPaymentsSql },
  { version: "0023_treasury_undo_journal", sql: treasuryUndoJournalSql },
  { version: "0024_treasury_fiscal_fields", sql: treasuryFiscalFieldsSql },
] as const;

const foundationMigrationSql = foundationMigrations.map((migration) => migration.sql).join("\n\n");

export { foundationMigrations };
export { foundationMigrationSql };
