import foundationCoreSql from "../migrations/0001_foundation.sql?raw";
import legacyRentmanSql from "../migrations/0002_legacy_rentman.sql?raw";
import adminFoundationSql from "../migrations/0003_admin_foundation.sql?raw";
import schedulingFoundationSql from "../migrations/0004_scheduling_foundation.sql?raw";
import rmaFoundationSql from "../migrations/0005_rma_foundation.sql?raw";
import agentsFoundationSql from "../migrations/0006_agents_foundation.sql?raw";
import aiProviderFoundationSql from "../migrations/0007_ai_provider_foundation.sql?raw";
import assistantChatMemoryFoundationSql from "../migrations/0008_assistant_chat_memory_foundation.sql?raw";

const foundationMigrationSql = [
  foundationCoreSql,
  legacyRentmanSql,
  adminFoundationSql,
  schedulingFoundationSql,
  rmaFoundationSql,
  agentsFoundationSql,
  aiProviderFoundationSql,
  assistantChatMemoryFoundationSql,
].join("\n\n");

export { foundationMigrationSql };
