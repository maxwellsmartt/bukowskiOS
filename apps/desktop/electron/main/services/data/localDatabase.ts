import { app } from "electron";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

import { foundationMigrationSql } from "@db";

import { createAssistantGatewayService } from "../ai/assistantGatewayService";
import { createAssistantMemoryService } from "../ai/assistantMemoryService";
import { createAssistantGatewaySessionStore } from "../ai/assistantGatewaySessionStore";
import { createAgentToolRegistry } from "../ai/agentToolRegistry";
import { createAISecretStore } from "../ai/aiSecretStore";
import { createOpenAIProviderService } from "../ai/openaiProviderService";
import { createAssistantChatService, type AssistantChatService } from "./assistantChatService";
import { createAgentMutationService } from "./agentMutationService";
import { createAgentReadService, type AgentReadService } from "./agentReadService";
import { applyAIGatewayFoundationMigration, bootstrapAIGatewayFoundation } from "./aiGatewayFoundationBootstrap";
import { createFoundationReadService, type FoundationReadService } from "./foundationReadService";
import { createAssetMutationService } from "./assetMutationService";
import { applyAdminFoundationMigration, bootstrapAdminFoundation } from "./adminFoundationBootstrap";
import { createCatalogMutationService } from "./catalogMutationService";
import { createIncidentMutationService } from "./incidentMutationService";
import { createPackingMutationService } from "./packingMutationService";
import { seedFoundationData } from "./foundationSeed";
import { bootstrapLegacyRentmanDemo } from "./legacyRentmanDemo";
import { createProjectMutationService, ensureProjectShellDefaults } from "./projectMutationService";
import { createRmaMutationService } from "./rmaMutationService";
import { applySchedulingFoundationMigration, bootstrapSchedulingFoundation } from "./schedulingFoundationBootstrap";

type ProjectMutationService = ReturnType<typeof createProjectMutationService>;
type CatalogMutationService = ReturnType<typeof createCatalogMutationService>;
type AssetMutationService = ReturnType<typeof createAssetMutationService>;
type IncidentMutationService = ReturnType<typeof createIncidentMutationService>;
type PackingMutationService = ReturnType<typeof createPackingMutationService>;
type RmaMutationService = ReturnType<typeof createRmaMutationService>;
type AgentMutationService = ReturnType<typeof createAgentMutationService>;

type LocalDatabaseRuntime = {
  database: DatabaseSync;
  databasePath: string;
  foundationReads: FoundationReadService;
  agentReads: AgentReadService;
  assistantChatService: AssistantChatService;
  projectMutations: ProjectMutationService;
  catalogMutations: CatalogMutationService;
  assetMutations: AssetMutationService;
  incidentMutations: IncidentMutationService;
  packingMutations: PackingMutationService;
  rmaMutations: RmaMutationService;
  agentMutations: AgentMutationService;
};

let runtime: LocalDatabaseRuntime | null = null;

const createRuntime = (): LocalDatabaseRuntime => {
  const databasePath = path.join(app.getPath("userData"), "bukowski-foundation.sqlite");
  const database = new DatabaseSync(databasePath);

  database.exec("PRAGMA journal_mode = WAL;");
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

  const secretStore = createAISecretStore();
  const openaiProviderService = createOpenAIProviderService();
  const foundationReads = createFoundationReadService(database);
  const agentReads = createAgentReadService(database, secretStore);
  const sessionStore = createAssistantGatewaySessionStore(database);
  const toolRegistry = createAgentToolRegistry(foundationReads, {
    getRunsList: () => agentReads.getRunsList(),
  });
  const memoryService = createAssistantMemoryService(database);
  const assistantGatewayService = createAssistantGatewayService(database, {
    secretStore,
    openaiProviderService,
    sessionStore,
    toolRegistry,
    memoryService,
  });
  const attachmentsRootPath = path.join(app.getPath("userData"), "assistant-attachments");
  fs.mkdirSync(attachmentsRootPath, { recursive: true });
  const assistantChatService = createAssistantChatService(database, {
    assistantGatewayService,
    memoryService,
    attachmentsRootPath,
  });
  assistantChatService.reconcileInterruptedThreads();

  return {
    database,
    databasePath,
    foundationReads,
    agentReads,
    assistantChatService,
    projectMutations: createProjectMutationService(database),
    catalogMutations: createCatalogMutationService(database),
    assetMutations: createAssetMutationService(database),
    incidentMutations: createIncidentMutationService(database),
    packingMutations: createPackingMutationService(database),
    rmaMutations: createRmaMutationService(database),
    agentMutations: createAgentMutationService(database, {
      secretStore,
      openaiProviderService,
      assistantGatewayService,
      assistantChatService,
    }),
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
