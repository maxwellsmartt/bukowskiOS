import { app, safeStorage } from "electron";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

import type { AppDiagnosticsSnapshot } from "@contracts";
import { foundationMigrations } from "@db";

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
import { createFinanceMutationService } from "./financeMutationService";
import { createIncidentMutationService } from "./incidentMutationService";
import { createPackingMutationService } from "./packingMutationService";
import { seedFoundationData } from "./foundationSeed";
import { bootstrapLegacyRentmanDemo } from "./legacyRentmanDemo";
import { createProjectMutationService, ensureProjectShellDefaults } from "./projectMutationService";
import { createRmaMutationService } from "./rmaMutationService";
import { createRuntimeDiagnosticsService, type RuntimeDiagnosticsService } from "./runtimeDiagnosticsService";
import { applySchedulingFoundationMigration, bootstrapSchedulingFoundation } from "./schedulingFoundationBootstrap";
import {
  applyTrackedSqlMigrations,
  applyTrackedStep,
  createDatabaseBackup,
  runIntegrityChecks,
  shouldRefreshBackup,
} from "./localDatabaseSupport";

type ProjectMutationService = ReturnType<typeof createProjectMutationService>;
type CatalogMutationService = ReturnType<typeof createCatalogMutationService>;
type AssetMutationService = ReturnType<typeof createAssetMutationService>;
type IncidentMutationService = ReturnType<typeof createIncidentMutationService>;
type FinanceMutationService = ReturnType<typeof createFinanceMutationService>;
type PackingMutationService = ReturnType<typeof createPackingMutationService>;
type RmaMutationService = ReturnType<typeof createRmaMutationService>;
type AgentMutationService = ReturnType<typeof createAgentMutationService>;

type LocalDatabaseRuntime = {
  database: DatabaseSync;
  databasePath: string;
  backupPath: string;
  foundationReads: FoundationReadService;
  agentReads: AgentReadService;
  assistantChatService: AssistantChatService;
  projectMutations: ProjectMutationService;
  catalogMutations: CatalogMutationService;
  assetMutations: AssetMutationService;
  incidentMutations: IncidentMutationService;
  financeMutations: FinanceMutationService;
  packingMutations: PackingMutationService;
  rmaMutations: RmaMutationService;
  agentMutations: AgentMutationService;
  runtimeDiagnostics: RuntimeDiagnosticsService;
  getDiagnosticsSnapshot: () => AppDiagnosticsSnapshot;
  createBackupNow: () => AppDiagnosticsSnapshot;
  runIntegrityCheckNow: () => AppDiagnosticsSnapshot;
};

let runtime: LocalDatabaseRuntime | null = null;
let walCheckpointTimer: NodeJS.Timeout | null = null;
let lastIntegrityCheckAt: string | null = null;
let lastIntegrityCheckStatus: "healthy" | "failed" | "never" = "never";

const backupMaxAgeMs = 24 * 60 * 60 * 1000;

const withRecoveredDatabase = (databasePath: string, backupPath: string) => {
  const openDatabase = () => {
    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA journal_mode = WAL;");
    database.exec("PRAGMA foreign_keys = ON;");
    return database;
  };

  let database = openDatabase();

  try {
    runIntegrityChecks(database);
    lastIntegrityCheckAt = new Date().toISOString();
    lastIntegrityCheckStatus = "healthy";
    return database;
  } catch (error) {
    lastIntegrityCheckAt = new Date().toISOString();
    lastIntegrityCheckStatus = "failed";
    database.close();

    if (!fs.existsSync(backupPath)) {
      throw error;
    }

    fs.copyFileSync(backupPath, databasePath);
    database = openDatabase();
    runIntegrityChecks(database);
    lastIntegrityCheckAt = new Date().toISOString();
    lastIntegrityCheckStatus = "healthy";
    return database;
  }
};

const createRuntime = (): LocalDatabaseRuntime => {
  const databasePath = path.join(app.getPath("userData"), "bukowski-foundation.sqlite");
  const backupPath = path.join(app.getPath("userData"), "bukowski-foundation.backup.sqlite");
  const databaseAlreadyExisted = fs.existsSync(databasePath);
  const database = withRecoveredDatabase(databasePath, backupPath);

  if (databaseAlreadyExisted && shouldRefreshBackup(backupPath, backupMaxAgeMs)) {
    createDatabaseBackup(database, backupPath);
  }

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
  runIntegrityChecks(database);
  lastIntegrityCheckAt = new Date().toISOString();
  lastIntegrityCheckStatus = "healthy";

  if (!databaseAlreadyExisted || shouldRefreshBackup(backupPath, backupMaxAgeMs)) {
    createDatabaseBackup(database, backupPath);
  }

  const getDiagnosticsSnapshot = (): AppDiagnosticsSnapshot => {
    const databaseStats = fs.existsSync(databasePath) ? fs.statSync(databasePath) : null;
    const backupStats = fs.existsSync(backupPath) ? fs.statSync(backupPath) : null;
    const distPackagedPath = path.join(process.cwd(), "apps/desktop/dist-packaged");
    const internalBuildArtifacts = fs.existsSync(distPackagedPath)
      ? fs
          .readdirSync(distPackagedPath)
          .filter((entry) => entry.endsWith(".dmg") || entry.endsWith(".zip"))
          .sort()
      : [];

    return {
      databaseSizeBytes: databaseStats?.size ?? 0,
      backupSizeBytes: backupStats?.size ?? 0,
      databaseExists: Boolean(databaseStats),
      backupExists: Boolean(backupStats),
      lastBackupAt: backupStats ? new Date(backupStats.mtimeMs).toISOString() : null,
      lastIntegrityCheckAt,
      lastIntegrityCheckStatus,
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
      internalBuildArtifacts,
    };
  };

  const createBackupNow = () => {
    createDatabaseBackup(database, backupPath);
    return getDiagnosticsSnapshot();
  };

  const runIntegrityCheckNow = () => {
    try {
      runIntegrityChecks(database);
      lastIntegrityCheckAt = new Date().toISOString();
      lastIntegrityCheckStatus = "healthy";
    } catch (error) {
      lastIntegrityCheckAt = new Date().toISOString();
      lastIntegrityCheckStatus = "failed";
      throw error;
    }

    return getDiagnosticsSnapshot();
  };

  const secretStore = createAISecretStore();
  const openaiProviderService = createOpenAIProviderService();
  const foundationReads = createFoundationReadService(database);
  const agentReads = createAgentReadService(database, secretStore);
  const sessionStore = createAssistantGatewaySessionStore(database);
  const toolRegistry = createAgentToolRegistry(foundationReads, {
    getRunsList: () => agentReads.getRunsList(),
  });
  const memoryService = createAssistantMemoryService(database);
  memoryService.pruneStaleEntries();
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
  const runtimeDiagnostics = createRuntimeDiagnosticsService(database);
  assistantChatService.reconcileInterruptedThreads();
  walCheckpointTimer?.unref();
  walCheckpointTimer = setInterval(() => {
    database.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  }, 5 * 60 * 1000);
  walCheckpointTimer.unref();

  return {
    database,
    databasePath,
    backupPath,
    foundationReads,
    agentReads,
    assistantChatService,
    projectMutations: createProjectMutationService(database),
    catalogMutations: createCatalogMutationService(database),
    assetMutations: createAssetMutationService(database),
    incidentMutations: createIncidentMutationService(database),
    financeMutations: createFinanceMutationService(database),
    packingMutations: createPackingMutationService(database),
    rmaMutations: createRmaMutationService(database),
    runtimeDiagnostics,
    getDiagnosticsSnapshot,
    createBackupNow,
    runIntegrityCheckNow,
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
