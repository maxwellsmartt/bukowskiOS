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
] as const;

const foundationMigrationSql = foundationMigrations.map((migration) => migration.sql).join("\n\n");

export { foundationMigrations };
export { foundationMigrationSql };
