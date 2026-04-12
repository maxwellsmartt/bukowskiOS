import { app, safeStorage } from "electron";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

import type { AppDiagnosticsSnapshot, AppSyncOutboxRow } from "@contracts";
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
import { createDataRetentionService, summarizeDataRetention } from "./dataRetentionService";
import { createFinanceMutationService } from "./financeMutationService";
import { createIncidentMutationService } from "./incidentMutationService";
import { createPackingMutationService } from "./packingMutationService";
import { seedFoundationData } from "./foundationSeed";
import { bootstrapLegacyRentmanDemo } from "./legacyRentmanDemo";
import { createProjectMutationService, ensureProjectShellDefaults } from "./projectMutationService";
import { createRmaMutationService } from "./rmaMutationService";
import { createRuntimeDiagnosticsService, type RuntimeDiagnosticsService } from "./runtimeDiagnosticsService";
import { applySchedulingFoundationMigration, bootstrapSchedulingFoundation } from "./schedulingFoundationBootstrap";
import { createSyncOutboxWorkerService, summarizeSyncOutboxWorker } from "./syncOutboxWorkerService";
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
  runLocalSyncNow: () => AppDiagnosticsSnapshot;
  getSyncOutboxRows: () => AppSyncOutboxRow[];
  retrySyncOutboxRow: (id: string) => AppDiagnosticsSnapshot;
};

let runtime: LocalDatabaseRuntime | null = null;
let walCheckpointTimer: NodeJS.Timeout | null = null;
let retentionTimer: NodeJS.Timeout | null = null;
let syncOutboxTimer: NodeJS.Timeout | null = null;
let lastIntegrityCheckAt: string | null = null;
let lastIntegrityCheckStatus: "healthy" | "failed" | "never" = "never";
let lastRetentionRunAt: string | null = null;
let lastRetentionSummary: string | null = null;
let lastSyncRunAt: string | null = null;
let lastSyncSummary: string | null = null;
let lastSyncStatus: "healthy" | "failed" | "idle" = "idle";

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

    const syncOutboxCounts = {
      pending: (database.prepare("SELECT COUNT(*) AS count FROM sync_outbox WHERE status = 'pending'").get() as { count: number })
        .count,
      processing: (
        database.prepare("SELECT COUNT(*) AS count FROM sync_outbox WHERE status = 'processing'").get() as { count: number }
      ).count,
      failed: (database.prepare("SELECT COUNT(*) AS count FROM sync_outbox WHERE status = 'failed'").get() as { count: number })
        .count,
    };

    return {
      databaseSizeBytes: databaseStats?.size ?? 0,
      backupSizeBytes: backupStats?.size ?? 0,
      databaseExists: Boolean(databaseStats),
      backupExists: Boolean(backupStats),
      lastBackupAt: backupStats ? new Date(backupStats.mtimeMs).toISOString() : null,
      lastIntegrityCheckAt,
      lastIntegrityCheckStatus,
      lastRetentionRunAt,
      lastRetentionSummary,
      lastSyncRunAt,
      lastSyncSummary,
      lastSyncStatus,
      syncOutboxPendingCount: syncOutboxCounts.pending,
      syncOutboxProcessingCount: syncOutboxCounts.processing,
      syncOutboxFailedCount: syncOutboxCounts.failed,
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

  const syncOutboxWorker = createSyncOutboxWorkerService(database);

  const runLocalSyncNow = () => {
    const syncSummary = syncOutboxWorker.runDueEntries();
    lastSyncRunAt = new Date().toISOString();
    lastSyncSummary = summarizeSyncOutboxWorker(syncSummary);
    lastSyncStatus = syncSummary.failedRows > 0 ? "failed" : "healthy";

    return getDiagnosticsSnapshot();
  };

  const getSyncOutboxRows = () => syncOutboxWorker.listRows();

  const retrySyncOutboxRow = (id: string) => {
    const retried = syncOutboxWorker.retryRow(id);

    if (!retried) {
      throw new Error("That outbox row is not retryable anymore.");
    }

    return runLocalSyncNow();
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
  const dataRetention = createDataRetentionService(database);
  assistantChatService.reconcileInterruptedThreads();
  try {
    const retentionSummary = dataRetention.run();
    lastRetentionRunAt = new Date().toISOString();
    lastRetentionSummary = summarizeDataRetention(retentionSummary);
  } catch {
    // Retention must not block startup for an internal alpha build.
  }
  try {
    runLocalSyncNow();
  } catch {
    lastSyncRunAt = new Date().toISOString();
    lastSyncStatus = "failed";
    lastSyncSummary = "The local sync worker failed during startup.";
  }
  walCheckpointTimer?.unref();
  walCheckpointTimer = setInterval(() => {
    database.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  }, 5 * 60 * 1000);
  walCheckpointTimer.unref();
  retentionTimer?.unref();
  retentionTimer = setInterval(() => {
    try {
      const retentionSummary = dataRetention.run();
      lastRetentionRunAt = new Date().toISOString();
      lastRetentionSummary = summarizeDataRetention(retentionSummary);
    } catch {
      // Best effort maintenance only.
    }
  }, 12 * 60 * 60 * 1000);
  retentionTimer.unref();
  syncOutboxTimer?.unref();
  syncOutboxTimer = setInterval(() => {
    try {
      runLocalSyncNow();
    } catch {
      lastSyncRunAt = new Date().toISOString();
      lastSyncStatus = "failed";
      lastSyncSummary = "The scheduled local sync pass failed.";
    }
  }, 60 * 1000);
  syncOutboxTimer.unref();

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
    runLocalSyncNow,
    getSyncOutboxRows,
    retrySyncOutboxRow,
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
