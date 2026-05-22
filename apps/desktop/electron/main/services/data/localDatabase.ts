import { app, BrowserWindow, safeStorage } from "electron";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

import {
  DEFAULT_WORKSPACE_ID,
  ipcChannels,
  type AppDiagnosticsSnapshot,
  type AppExportResult,
  type AppInfo,
  type AppSyncPullCursorRow,
  type AppSupportSnapshot,
  type AppSyncOutboxRow,
  type EnsureLocalWorkspaceInput,
} from "@contracts";
import { foundationMigrations } from "@db";
import { createSupabaseOutboxTransport } from "@sync";

import { createAssistantGatewayService } from "../ai/assistantGatewayService";
import { createAssistantMemoryService } from "../ai/assistantMemoryService";
import { createAssistantAudioTranscriptionService } from "../ai/assistantAudioTranscriptionService";
import { createAssistantGatewaySessionStore } from "../ai/assistantGatewaySessionStore";
import { createAgentToolRegistry } from "../ai/agentToolRegistry";
import { createAISecretStore } from "../ai/aiSecretStore";
import { createAnthropicProviderService } from "../ai/anthropicProviderService";
import { createOpenAIProviderService } from "../ai/openaiProviderService";
import { createAssistantChatService, type AssistantChatService } from "./assistantChatService";
import { createAgentMutationService } from "./agentMutationService";
import { createAgentReadService, type AgentReadService } from "./agentReadService";
import {
  applyAIGatewayFoundationMigration,
  bootstrapAIGatewayFoundation,
  reconcileLiveProviderEnablement,
} from "./aiGatewayFoundationBootstrap";
import { createFoundationReadService, type FoundationReadService } from "./foundationReadService";
import { applyAssetQuantityFoundationMigration } from "./assetQuantityFoundationBootstrap";
import { applyAssetValuationFoundationMigration } from "./assetValuationFoundationBootstrap";
import { createAssetMutationService } from "./assetMutationService";
import { createAssetSnapshotPullService } from "./assetSnapshotPullService";
import { createOperationalSnapshotService } from "./operationalSnapshotService";
import { applyAdminFoundationMigration, bootstrapAdminFoundation } from "./adminFoundationBootstrap";
import { createCatalogMutationService } from "./catalogMutationService";
import { createCatalogPullService } from "./catalogPullService";
import { applyConnectorFoundationMigration, bootstrapConnectorFoundation } from "./connectorFoundationBootstrap";
import { applyCrewCatalogFoundationMigration } from "./crewCatalogFoundationBootstrap";
import { createDataRetentionService, summarizeDataRetention } from "./dataRetentionService";
import { createCurrencyMutationService } from "./currencyMutationService";
import { createCurrencyRateProviderService, type CurrencyRateProviderService } from "./currencyRateProviderService";
import { createCurrencyReadService } from "./currencyReadService";
import { applyQuoteAgentSourceMigration } from "./quoteAgentSourceBootstrap";
import { createInvoiceMutationService } from "./invoiceMutationService";
import { createInvoiceReadService } from "./invoiceReadService";
import { createTreasuryMutationService } from "./treasuryMutationService";
import { createTreasuryReadService } from "./treasuryReadService";
import { createQuoteMutationService } from "./quoteMutationService";
import { createQuoteReadService } from "./quoteReadService";
import { createFinanceMutationService } from "./financeMutationService";
import { applyOperationalFilesMigration, createFileUploadService, type FileUploadService } from "./fileUploadService";
import { createIncidentMutationService } from "./incidentMutationService";
import { createPackingMutationService } from "./packingMutationService";
import { cleanupPerformanceFoundationData, seedPerformanceFoundationData } from "./performanceFoundationSeed";
import { seedFoundationData } from "./foundationSeed";
import { bootstrapLegacyRentmanDemo } from "./legacyRentmanDemo";
import {
  applyProjectArchiveFoundationMigration,
  applyProjectCreationWizardFoundationMigration,
  applyProjectDepartmentsMatrixFoundationMigration,
  applyProjectUnitWindowsFoundationMigration,
} from "./projectCreationWizardFoundationBootstrap";
import { createProjectMutationService, ensureProjectShellDefaults } from "./projectMutationService";
import { createRmaMutationService } from "./rmaMutationService";
import { createRuntimeDiagnosticsService, type RuntimeDiagnosticsService } from "./runtimeDiagnosticsService";
import { applySchedulingFoundationMigration, bootstrapSchedulingFoundation } from "./schedulingFoundationBootstrap";
import { createSupportDiagnosticsService, type SupportDiagnosticsService } from "./supportDiagnosticsService";
import { createSyncOutboxWorkerService, summarizeSyncOutboxWorker } from "./syncOutboxWorkerService";
import { createUserAdminService, type UserAdminService } from "./userAdminService";
import { createSupabaseTokenStore } from "../auth/tokenStore";
import { createWorkspaceAccessGuard, type WorkspaceAccessGuard } from "../auth/workspaceAccessGuard";
import { createConnectorBridgeService } from "../connectors/connectorBridgeService";
import { createTelegramConnectorService } from "../connectors/telegramConnectorService";
import {
  applyTrackedSqlMigrations,
  applyTrackedStep,
  createDatabaseBackup,
  runIntegrityChecks,
  shouldRefreshBackup,
} from "./localDatabaseSupport";
import { getDesktopLogger, initializeDesktopLogger } from "../logger";

type ProjectMutationService = ReturnType<typeof createProjectMutationService>;
type CatalogMutationService = ReturnType<typeof createCatalogMutationService>;
type AssetMutationService = ReturnType<typeof createAssetMutationService>;
type IncidentMutationService = ReturnType<typeof createIncidentMutationService>;
type FinanceMutationService = ReturnType<typeof createFinanceMutationService>;
type CurrencyMutationService = ReturnType<typeof createCurrencyMutationService>;
type CurrencyReadService = ReturnType<typeof createCurrencyReadService>;
type QuoteMutationServiceType = ReturnType<typeof createQuoteMutationService>;
type QuoteReadServiceType = ReturnType<typeof createQuoteReadService>;
type InvoiceMutationServiceType = ReturnType<typeof createInvoiceMutationService>;
type InvoiceReadServiceType = ReturnType<typeof createInvoiceReadService>;
type TreasuryMutationServiceType = ReturnType<typeof createTreasuryMutationService>;
type TreasuryReadServiceType = ReturnType<typeof createTreasuryReadService>;
type PackingMutationService = ReturnType<typeof createPackingMutationService>;
type RmaMutationService = ReturnType<typeof createRmaMutationService>;
type AgentMutationService = ReturnType<typeof createAgentMutationService>;
type AssistantAudioTranscriptionService = ReturnType<typeof createAssistantAudioTranscriptionService>;

const resolveTelegramPollingMode = (): "host" | "disabled" => {
  const rawMode = (process.env.BUKOWSKI_TELEGRAM_POLLING_MODE ?? "").trim().toLowerCase();
  if (rawMode === "host" || rawMode === "polling") {
    return "host";
  }
  if (rawMode === "disabled" || rawMode === "off" || rawMode === "webhook") {
    return "disabled";
  }

  // Packaged installs should not compete for Telegram getUpdates. Run one
  // explicit host/webhook process and keep regular desktop clients passive.
  return app.isPackaged ? "disabled" : "host";
};

type LocalDatabaseRuntime = {
  database: DatabaseSync;
  databasePath: string;
  backupPath: string;
  foundationReads: FoundationReadService;
  agentReads: AgentReadService;
  assistantChatService: AssistantChatService;
  assistantAudioTranscription: AssistantAudioTranscriptionService;
  projectMutations: ProjectMutationService;
  catalogMutations: CatalogMutationService;
  assetMutations: AssetMutationService;
  incidentMutations: IncidentMutationService;
  financeMutations: FinanceMutationService;
  currencyMutations: CurrencyMutationService;
  currencyReads: CurrencyReadService;
  currencyRateProviders: CurrencyRateProviderService;
  quoteMutations: QuoteMutationServiceType;
  quoteReads: QuoteReadServiceType;
  invoiceMutations: InvoiceMutationServiceType;
  invoiceReads: InvoiceReadServiceType;
  treasuryMutations: TreasuryMutationServiceType;
  treasuryReads: TreasuryReadServiceType;
  packingMutations: PackingMutationService;
  rmaMutations: RmaMutationService;
  agentMutations: AgentMutationService;
  workspaceAccess: WorkspaceAccessGuard;
  runtimeDiagnostics: RuntimeDiagnosticsService;
  supportDiagnostics: SupportDiagnosticsService;
  userAdmin: UserAdminService;
  fileUploads: FileUploadService;
  getDiagnosticsSnapshot: () => AppDiagnosticsSnapshot;
  getSupportSnapshot: () => AppSupportSnapshot;
  createBackupNow: () => AppDiagnosticsSnapshot;
  runIntegrityCheckNow: () => AppDiagnosticsSnapshot;
  ensureLocalWorkspaces: (workspaces: EnsureLocalWorkspaceInput[]) => AppDiagnosticsSnapshot;
  getLocalWorkspaces: () => import("@contracts").AppLocalWorkspaceRow[];
  runLocalSyncNow: () => Promise<AppDiagnosticsSnapshot>;
  getSyncOutboxRows: () => AppSyncOutboxRow[];
  getSyncPullCursors: () => AppSyncPullCursorRow[];
  retrySyncOutboxRow: (id: string) => Promise<AppDiagnosticsSnapshot>;
  retryAllFailedSyncOutboxRows: () => Promise<AppDiagnosticsSnapshot>;
  backfillOperationalSnapshots: (
    input: import("@contracts").AppOperationalBackfillCommand,
  ) => Promise<import("@contracts").AppOperationalBackfillResult>;
  exportRecentLogs: (filePath: string) => AppExportResult;
  exportSupportBundle: (directoryPath: string) => AppExportResult;
  applyRemoteCatalogRows: (
    input: import("@contracts").AppApplyRemoteCatalogRowsCommand,
  ) => import("@contracts").AppApplyRemoteCatalogRowsResult;
  applyRemoteExchangeRates: (
    input: import("@contracts").AppApplyRemoteExchangeRatesCommand,
  ) => import("@contracts").AppApplyRemoteExchangeRatesResult;
  applyRemoteAssetSnapshots: (
    input: import("@contracts").AppApplyRemoteAssetSnapshotsCommand,
  ) => import("@contracts").AppApplyRemoteAssetSnapshotsResult;
  applyRemoteOperationalSnapshots: (
    input: import("@contracts").AppApplyRemoteOperationalSnapshotsCommand,
  ) => import("@contracts").AppApplyRemoteOperationalSnapshotsResult;
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
const logger = getDesktopLogger("local-database");

const backupMaxAgeMs = 24 * 60 * 60 * 1000;

const runStartupStep = <T>(label: string, step: () => T): T => {
  const startedAt = Date.now();
  logger.info(`Startup step started: ${label}.`);
  try {
    const result = step();
    logger.info(`Startup step completed: ${label}.`, { durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    logger.error(`Startup step failed: ${label}.`, error);
    throw error;
  }
};

const isSupabaseSyncEnabled = () => {
  const value = process.env.VITE_SUPABASE_SYNC_ENABLED?.trim().toLowerCase();
  return value === "1" || value === "true";
};

const parseJsonObject = (value: string | null) => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

type ProjectShellSeedRow = {
  id: string;
  code: string;
  name: string;
  client_name: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  description: string | null;
  color_key: string | null;
  production_company_name: string | null;
  has_preproduction: number;
  preproduction_start_date: string | null;
  preproduction_end_date: string | null;
};

type ProjectUnitShellSeedRow = {
  id: string;
  project_id: string;
  code: string;
  name: string;
  sort_order: number;
  status: string;
  status_source: string;
  color_key: string | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  is_primary: number;
};

type ProjectUnitWindowShellSeedRow = {
  id: string;
  project_unit_id: string;
  start_date: string | null;
  end_date: string | null;
  sort_order: number;
  label: string | null;
};

const seedProjectShellForWorkspace = (database: DatabaseSync, workspaceId: string, timestamp: string) => {
  if (workspaceId === DEFAULT_WORKSPACE_ID) {
    return 0;
  }

  const existingProjects = database
    .prepare("SELECT COUNT(*) AS count FROM projects WHERE workspace_id = ?")
    .get(workspaceId) as { count: number };
  if (existingProjects.count > 0) {
    return 0;
  }

  const assetCount = database
    .prepare("SELECT COUNT(*) AS count FROM assets WHERE workspace_id = ?")
    .get(workspaceId) as { count: number };
  if (assetCount.count === 0) {
    return 0;
  }

  const sourceProjects = database
    .prepare(
      `
        SELECT
          id,
          code,
          name,
          client_name,
          status,
          start_date,
          end_date,
          description,
          color_key,
          production_company_name,
          has_preproduction,
          preproduction_start_date,
          preproduction_end_date
        FROM projects
        WHERE workspace_id = ?
          AND archived_at IS NULL
        ORDER BY created_at, name
      `,
    )
    .all(DEFAULT_WORKSPACE_ID) as ProjectShellSeedRow[];
  if (sourceProjects.length === 0) {
    return 0;
  }

  const workspaceSuffix = workspaceId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "workspace";
  const projectIdBySourceId = new Map<string, string>();
  const insertProject = database.prepare(
    `
      INSERT OR IGNORE INTO projects (
        id,
        workspace_id,
        code,
        name,
        client_id,
        client_name,
        production_company_id,
        production_company_name,
        status,
        start_date,
        end_date,
        has_preproduction,
        preproduction_start_date,
        preproduction_end_date,
        color_key,
        description,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );
  const insertUnit = database.prepare(
    `
      INSERT OR IGNORE INTO project_units (
        id,
        workspace_id,
        project_id,
        code,
        name,
        sort_order,
        status,
        status_source,
        color_key,
        start_date,
        end_date,
        notes,
        is_primary,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );
  const insertWindow = database.prepare(
    `
      INSERT OR IGNORE INTO project_unit_windows (
        id,
        project_unit_id,
        start_date,
        end_date,
        sort_order,
        label,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
  );
  const sourceUnitStatement = database.prepare(
    `
      SELECT
        id,
        project_id,
        code,
        name,
        sort_order,
        status,
        status_source,
        color_key,
        start_date,
        end_date,
        notes,
        is_primary
      FROM project_units
      WHERE project_id = ?
      ORDER BY sort_order, name
    `,
  );
  const sourceWindowStatement = database.prepare(
    `
      SELECT
        id,
        project_unit_id,
        start_date,
        end_date,
        sort_order,
        label
      FROM project_unit_windows
      WHERE project_unit_id = ?
      ORDER BY sort_order, start_date, end_date
    `,
  );

  sourceProjects.forEach((project) => {
    const targetProjectId = `${project.id}-${workspaceSuffix}`;
    projectIdBySourceId.set(project.id, targetProjectId);
    insertProject.run(
      targetProjectId,
      workspaceId,
      project.code,
      project.name,
      project.client_name,
      project.production_company_name,
      project.status,
      project.start_date,
      project.end_date,
      project.has_preproduction,
      project.preproduction_start_date,
      project.preproduction_end_date,
      project.color_key,
      project.description,
      timestamp,
      timestamp,
    );

    const sourceUnits = sourceUnitStatement.all(project.id) as ProjectUnitShellSeedRow[];
    sourceUnits.forEach((unit) => {
      const targetUnitId = `${unit.id}-${workspaceSuffix}`;
      insertUnit.run(
        targetUnitId,
        workspaceId,
        targetProjectId,
        unit.code,
        unit.name,
        unit.sort_order,
        unit.status,
        unit.status_source,
        unit.color_key,
        unit.start_date,
        unit.end_date,
        unit.notes,
        unit.is_primary,
        timestamp,
        timestamp,
      );

      const sourceWindows = sourceWindowStatement.all(unit.id) as ProjectUnitWindowShellSeedRow[];
      sourceWindows.forEach((window) => {
        insertWindow.run(
          `${window.id}-${workspaceSuffix}`,
          targetUnitId,
          window.start_date,
          window.end_date,
          window.sort_order,
          window.label,
          timestamp,
          timestamp,
        );
      });
    });
  });

  return projectIdBySourceId.size;
};

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
  initializeDesktopLogger(path.join(app.getPath("userData"), "logs"));
  logger.info("Initializing local database runtime.", {
    profileDatasetEnabled: process.env.BUKOWSKI_PROFILE_DATASET === "1",
  });
  const databaseAlreadyExisted = fs.existsSync(databasePath);
  const database = runStartupStep("open and verify local database", () => withRecoveredDatabase(databasePath, backupPath));

  if (databaseAlreadyExisted && shouldRefreshBackup(backupPath, backupMaxAgeMs)) {
    runStartupStep("refresh startup database backup", () => createDatabaseBackup(database, backupPath));
    logger.info("Refreshed local database backup before migrations.");
  }

  runStartupStep("apply tracked SQL migrations", () => applyTrackedSqlMigrations(database, foundationMigrations));
  runStartupStep("apply admin foundation migration", () =>
    applyTrackedStep(database, "runtime_admin_foundation_v1", () => applyAdminFoundationMigration(database)),
  );
  runStartupStep("apply scheduling foundation migration", () =>
    applyTrackedStep(database, "runtime_scheduling_foundation_v1", () => applySchedulingFoundationMigration(database)),
  );
  runStartupStep("apply project creation wizard migration", () =>
    applyTrackedStep(database, "runtime_project_creation_wizard_v1", () =>
      applyProjectCreationWizardFoundationMigration(database),
    ),
  );
  runStartupStep("apply project archive migration", () =>
    applyTrackedStep(database, "runtime_project_archive_v1", () => applyProjectArchiveFoundationMigration(database)),
  );
  runStartupStep("apply project unit windows migration", () =>
    applyTrackedStep(database, "runtime_project_unit_windows_v1", () => applyProjectUnitWindowsFoundationMigration(database)),
  );
  runStartupStep("apply project departments matrix migration", () =>
    applyTrackedStep(database, "runtime_project_departments_matrix_v1", () =>
      applyProjectDepartmentsMatrixFoundationMigration(database),
    ),
  );
  runStartupStep("apply crew catalog foundation migration", () =>
    applyTrackedStep(database, "runtime_crew_catalog_foundation_v2", () => applyCrewCatalogFoundationMigration(database)),
  );
  runStartupStep("apply AI gateway foundation migration", () =>
    applyTrackedStep(database, "runtime_ai_gateway_foundation_v2", () => applyAIGatewayFoundationMigration(database)),
  );
  runStartupStep("apply connector foundation migration", () =>
    applyTrackedStep(database, "runtime_connector_foundation_v2", () => applyConnectorFoundationMigration(database)),
  );
  runStartupStep("apply operational files migration", () =>
    applyTrackedStep(database, "runtime_operational_files_v2", () => applyOperationalFilesMigration(database)),
  );
  runStartupStep("seed foundation data", () => seedFoundationData(database));
  runStartupStep("bootstrap AI gateway foundation", () => bootstrapAIGatewayFoundation(database));
  runStartupStep("bootstrap connector foundation", () => bootstrapConnectorFoundation(database));
  runStartupStep("ensure project shell defaults", () => ensureProjectShellDefaults(database));
  runStartupStep("bootstrap legacy Rentman demo", () => bootstrapLegacyRentmanDemo(database));
  runStartupStep("apply asset quantity foundation migration", () =>
    applyTrackedStep(database, "runtime_asset_quantity_foundation_v1", () => applyAssetQuantityFoundationMigration(database)),
  );
  runStartupStep("apply asset valuation foundation migration", () =>
    applyTrackedStep(database, "runtime_asset_valuation_foundation_v1", () => applyAssetValuationFoundationMigration(database)),
  );
  runStartupStep("apply quote agent source migration", () =>
    applyTrackedStep(database, "runtime_quote_agent_source_v1", () => applyQuoteAgentSourceMigration(database)),
  );
  runStartupStep("bootstrap admin foundation", () => bootstrapAdminFoundation(database, { cleanupDemoPlaceholders: true }));
  runStartupStep("bootstrap scheduling foundation", () => bootstrapSchedulingFoundation(database));
  if (process.env.BUKOWSKI_PROFILE_DATASET === "1") {
    runStartupStep("seed performance dataset", () => seedPerformanceFoundationData(database));
    logger.info("Seeded heavy performance dataset.");
  } else {
    const cleanedRows = runStartupStep("cleanup performance dataset", () => cleanupPerformanceFoundationData(database));

    if (cleanedRows > 0) {
      logger.info("Removed synthetic performance dataset from the local workspace.", { cleanedRows });
    }
  }
  runStartupStep("run post-migration integrity checks", () => runIntegrityChecks(database));
  lastIntegrityCheckAt = new Date().toISOString();
  lastIntegrityCheckStatus = "healthy";

  if (!databaseAlreadyExisted || shouldRefreshBackup(backupPath, backupMaxAgeMs)) {
    runStartupStep("create startup database backup", () => createDatabaseBackup(database, backupPath));
    logger.info("Created startup backup for local database.");
  }

  const getAppInfo = (): AppInfo => ({
    appName: "bukowskiOS",
    platform: process.platform,
    isPackaged: app.isPackaged,
    version: app.getVersion(),
    shellVersion: "foundation-v1",
  });

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
    logger.info("Created backup on demand from Settings.");
    return getDiagnosticsSnapshot();
  };

  const runIntegrityCheckNow = () => {
    try {
      runIntegrityChecks(database);
      lastIntegrityCheckAt = new Date().toISOString();
      lastIntegrityCheckStatus = "healthy";
      logger.info("Completed manual integrity check successfully.");
    } catch (error) {
      lastIntegrityCheckAt = new Date().toISOString();
      lastIntegrityCheckStatus = "failed";
      logger.error("Manual integrity check failed.", error);
      throw error;
    }

    return getDiagnosticsSnapshot();
  };

  const ensureLocalWorkspaces = (workspaces: EnsureLocalWorkspaceInput[]) => {
    const timestamp = new Date().toISOString();
    const statement = database.prepare(
      `
        INSERT INTO workspaces (id, name, slug, base_currency, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          slug = excluded.slug,
          base_currency = excluded.base_currency,
          updated_at = excluded.updated_at
      `,
    );
    const ensureCommandActorUser = database.prepare(
      `
        INSERT INTO users (id, full_name, email, phone, is_active, created_at, updated_at)
        VALUES ('user-ops', 'AI Agent', 'ai-agent@bukowskios.local', '', 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          full_name = 'AI Agent',
          email = 'ai-agent@bukowskios.local',
          is_active = 1,
          updated_at = excluded.updated_at
      `,
    );
    const ensureCommandActorMembership = database.prepare(
      `
        INSERT INTO workspace_memberships (id, workspace_id, user_id, role_id, status, joined_at, created_at)
        VALUES (?, ?, 'user-ops', 'role-admin', 'active', ?, ?)
        ON CONFLICT(workspace_id, user_id) DO UPDATE SET
          role_id = 'role-admin',
          status = 'active'
      `,
    );

    try {
      database.exec("BEGIN");
      let seededProjectCount = 0;
      ensureCommandActorUser.run(timestamp, timestamp);
      workspaces.forEach((workspace) => {
        statement.run(
          workspace.id,
          workspace.name.trim() || "Workspace",
          workspace.slug.trim() || workspace.id,
          workspace.baseCurrency.trim().toUpperCase() || "USD",
          timestamp,
          timestamp,
        );
        ensureCommandActorMembership.run(`membership-${workspace.id}-ops`, workspace.id, timestamp, timestamp);
        seededProjectCount += seedProjectShellForWorkspace(database, workspace.id, timestamp);
      });
      database.exec("COMMIT");
      bootstrapAdminFoundation(database);
      if (seededProjectCount > 0) {
        logger.info("Seeded project shell rows for remote workspaces.", { count: seededProjectCount });
      }
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    logger.info("Ensured remote workspaces in local SQLite cache.", { count: workspaces.length });

    return getDiagnosticsSnapshot();
  };

  const getLocalWorkspaces = () =>
    (
      database
        .prepare(
          `
            SELECT
              id,
              name,
              slug,
              base_currency AS baseCurrency
            FROM workspaces
            WHERE is_active = 1
            ORDER BY created_at ASC, name ASC
          `,
        )
        .all() as Array<{
        id: string;
        name: string;
        slug: string;
        baseCurrency: string;
      }>
    ).map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      baseCurrency: workspace.baseCurrency,
    }));

  const resolveSupabaseAssetSnapshot = (row: { entity_type: string; entity_id: string; event_id: string | null }) => {
    if (row.entity_type !== "asset_event") {
      return null;
    }

    const asset = database
      .prepare(
        `
          SELECT
            id,
            workspace_id,
            category_id,
            name,
            brand,
            model,
            serial_number,
            internal_code,
            description,
            purchase_date,
            purchase_price,
            additional_costs,
            currency,
            replacement_value,
            current_book_value,
            ownership_type,
            default_location_id,
            qr_code_value,
            notes,
            is_active,
            created_at,
            updated_at
          FROM assets
          WHERE id = ?
          LIMIT 1
        `,
      )
      .get(row.entity_id) as
      | {
          id: string;
          workspace_id: string;
          category_id: string;
          name: string;
          brand: string | null;
          model: string | null;
          serial_number: string | null;
          internal_code: string;
          description: string | null;
          purchase_date: string | null;
          purchase_price: number | null;
          additional_costs: number | null;
          currency: string | null;
          replacement_value: number | null;
          current_book_value: number | null;
          ownership_type: string | null;
          default_location_id: string | null;
          qr_code_value: string | null;
          notes: string | null;
          is_active: number;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    const currentState = database
      .prepare(
        `
          SELECT
            asset_id,
            workspace_id,
            current_location_id,
            current_project_id,
            current_department_id,
            current_responsible_user_id,
            active_assignment_id,
            condition_status,
            operational_status,
            custody_status,
            last_event_id,
            version,
            updated_at,
            project_unit_id,
            total_quantity,
            available_quantity,
            assigned_quantity,
            checked_out_quantity
          FROM asset_current_state
          WHERE asset_id = ?
          LIMIT 1
        `,
      )
      .get(row.entity_id) as
      | {
          asset_id: string;
          workspace_id: string;
          current_location_id: string | null;
          current_project_id: string | null;
          current_department_id: string | null;
          current_responsible_user_id: string | null;
          active_assignment_id: string | null;
          condition_status: string;
          operational_status: string;
          custody_status: string;
          last_event_id: string;
          version: number;
          updated_at: string;
          project_unit_id: string | null;
          total_quantity: number;
          available_quantity: number;
          assigned_quantity: number;
          checked_out_quantity: number;
        }
      | undefined;

    if (!asset || !currentState) {
      throw new Error(`Asset snapshot missing locally for ${row.entity_id}.`);
    }

    const event = row.event_id
      ? ((database
          .prepare(
            `
              SELECT
                id,
                workspace_id,
                asset_id,
                assignment_id,
                project_id,
                department_id,
                performed_by_user_id,
                event_type,
                location_id,
                from_location_id,
                to_location_id,
                event_timestamp,
                command_id,
                actor_type,
                source_channel,
                notes,
                metadata_json,
                created_at
              FROM asset_events
              WHERE id = ?
              LIMIT 1
            `,
          )
          .get(row.event_id) as
          | {
              id: string;
              workspace_id: string;
              asset_id: string;
              assignment_id: string | null;
              project_id: string | null;
              department_id: string | null;
              performed_by_user_id: string;
              event_type: string;
              location_id: string | null;
              from_location_id: string | null;
              to_location_id: string | null;
              event_timestamp: string;
              command_id: string;
              actor_type: string;
              source_channel: string;
              notes: string | null;
              metadata_json: string | null;
              created_at: string;
            }
          | undefined) ?? null)
      : null;

    return {
      asset: {
        ...asset,
        is_active: asset.is_active === 1,
      },
      currentState,
      event: event
        ? {
            ...event,
            metadata_json: parseJsonObject(event.metadata_json),
          }
        : null,
    };
  };

  const supabaseTokenStore = createSupabaseTokenStore();
  const operationalSnapshots = createOperationalSnapshotService(database);
  const workspaceAccess = createWorkspaceAccessGuard({
    database,
    supabaseUrl: process.env.VITE_SUPABASE_URL,
    anonKey: process.env.VITE_SUPABASE_ANON_KEY,
    getTokens: () => supabaseTokenStore.getTokens(),
  });
  const syncOutboxWorker = createSyncOutboxWorkerService(database, {
    transport: isSupabaseSyncEnabled()
      ? createSupabaseOutboxTransport({
          supabaseUrl: process.env.VITE_SUPABASE_URL ?? "",
          anonKey: process.env.VITE_SUPABASE_ANON_KEY ?? "",
          getAccessToken: async () => (await supabaseTokenStore.getTokens()).accessToken,
          resolveAssetSnapshot: resolveSupabaseAssetSnapshot,
          resolveOperationalSnapshot: (row) => operationalSnapshots.resolveSnapshot(row),
        })
      : undefined,
  });

  const runLocalSyncNow = async () => {
    const syncSummary = await syncOutboxWorker.runDueEntries();
    lastSyncRunAt = new Date().toISOString();
    lastSyncSummary = summarizeSyncOutboxWorker(syncSummary);
    lastSyncStatus = syncSummary.failedRows > 0 ? "failed" : "healthy";
    logger.info("Completed local sync pass.", syncSummary);

    return getDiagnosticsSnapshot();
  };

  const getSyncOutboxRows = () => syncOutboxWorker.listRows();

  const getSyncPullCursors = (): AppSyncPullCursorRow[] =>
    (
      database
        .prepare(
          `
            SELECT
              workspace_id,
              entity_type,
              last_synced_at,
              last_pulled_count,
              last_error,
              updated_at
            FROM sync_pull_cursors
            ORDER BY updated_at DESC, entity_type ASC
          `,
        )
        .all() as Array<{
        workspace_id: string;
        entity_type: string;
        last_synced_at: string | null;
        last_pulled_count: number;
        last_error: string | null;
        updated_at: string;
      }>
    ).map((row) => ({
      workspaceId: row.workspace_id,
      entityType: row.entity_type,
      lastSyncedAt: row.last_synced_at,
      lastPulledCount: row.last_pulled_count,
      lastError: row.last_error,
      updatedAt: row.updated_at,
    }));

  const retrySyncOutboxRow = async (id: string) => {
    const retried = syncOutboxWorker.retryRow(id);

    if (!retried) {
      throw new Error("That outbox row is not retryable anymore.");
    }

    logger.info("Queued one sync outbox row for retry.", { id });
    return await runLocalSyncNow();
  };

  const retryAllFailedSyncOutboxRows = async () => {
    const retriedCount = syncOutboxWorker.retryAllFailedRows();
    logger.info("Queued failed sync outbox rows for retry.", { retriedCount });
    return await runLocalSyncNow();
  };

  const backfillOperationalSnapshots = async (input: import("@contracts").AppOperationalBackfillCommand) => {
    const backfill = operationalSnapshots.enqueueBackfill(input.workspaceId);
    const diagnostics = await runLocalSyncNow();
    const entitySummary = backfill.byEntityType
      .map((row) => `${row.entityType}: ${row.enqueuedCount}/${row.scannedCount}`)
      .join(", ");

    return {
      summary:
        backfill.enqueuedCount > 0
          ? `Queued ${backfill.enqueuedCount} operational snapshot${backfill.enqueuedCount === 1 ? "" : "s"} for cloud sync (${entitySummary}).`
          : `Operational snapshots were already queued or synced (${entitySummary}).`,
      diagnostics,
      enqueuedCount: backfill.enqueuedCount,
      skippedCount: backfill.skippedCount,
      byEntityType: backfill.byEntityType,
    };
  };

  const secretStore = createAISecretStore();
  reconcileLiveProviderEnablement(database, secretStore);
  const openaiProviderService = createOpenAIProviderService();
  const anthropicProviderService = createAnthropicProviderService();
  const foundationReads = createFoundationReadService(database);
  const userAdmin = createUserAdminService(database);
  const agentReads = createAgentReadService(database, secretStore);
  const sessionStore = createAssistantGatewaySessionStore(database);
  const projectMutations = createProjectMutationService(database, {
    createBackupBeforeDelete: () => {
      createDatabaseBackup(database, backupPath);
    },
  });
  const catalogMutations = createCatalogMutationService(database);
  const assetMutations = createAssetMutationService(database);
  const incidentMutations = createIncidentMutationService(database);
  const financeMutations = createFinanceMutationService(database);
  const currencyMutations = createCurrencyMutationService(database);
  const currencyReads = createCurrencyReadService(database);
  const currencyRateProviders = createCurrencyRateProviderService({
    currencyMutations,
    currencyReads,
    secretStore,
  });
  const quoteMutations = createQuoteMutationService(database);
  const quoteReads = createQuoteReadService(database);
  const invoiceMutations = createInvoiceMutationService(database);
  const invoiceReads = createInvoiceReadService(database);
  const treasuryMutations = createTreasuryMutationService(database);
  const treasuryReads = createTreasuryReadService(database);
  const packingMutations = createPackingMutationService(database);
  const rmaMutations = createRmaMutationService(database);
  const toolRegistry = createAgentToolRegistry(foundationReads, {
    getRunsList: () => agentReads.getRunsList(),
    currencyReads,
    quoteReads,
    writeServices: {
      packing: packingMutations,
      projects: projectMutations,
      incidents: incidentMutations,
      rma: rmaMutations,
      assets: assetMutations,
      finance: financeMutations,
      quotes: quoteMutations,
      projectLookup: {
        findByCode(workspaceId, code) {
          const row = database
            .prepare(
              `
                SELECT id, code, name, status
                FROM projects
                WHERE workspace_id = ?
                  AND code = ?
                LIMIT 1
              `,
            )
            .get(workspaceId, code.toUpperCase()) as
            | {
                id: string;
                code: string;
                name: string;
                status: string;
              }
            | undefined;

          return row ?? null;
        },
        findByIdentifier(workspaceId, identifier) {
          const normalizedIdentifier = identifier.trim();
          if (!normalizedIdentifier) {
            return null;
          }

          const row = database
            .prepare(
              `
                SELECT id, code, name, status
                FROM projects
                WHERE workspace_id = ?
                  AND (
                    id = ?
                    OR code = ?
                    OR lower(name) = lower(?)
                    OR lower(code) LIKE lower(?)
                    OR lower(name) LIKE lower(?)
                  )
                ORDER BY
                  CASE
                    WHEN id = ? THEN 0
                    WHEN code = ? THEN 1
                    WHEN lower(name) = lower(?) THEN 2
                    WHEN lower(code) LIKE lower(?) THEN 3
                    WHEN lower(name) LIKE lower(?) THEN 4
                    ELSE 5
                  END
                LIMIT 1
              `,
            )
            .get(
              workspaceId,
              normalizedIdentifier,
              normalizedIdentifier.toUpperCase(),
              normalizedIdentifier,
              `${normalizedIdentifier.toUpperCase()}%`,
              `%${normalizedIdentifier}%`,
              normalizedIdentifier,
              normalizedIdentifier.toUpperCase(),
              normalizedIdentifier,
              `${normalizedIdentifier.toUpperCase()}%`,
              `%${normalizedIdentifier}%`,
            ) as
            | {
                id: string;
                code: string;
                name: string;
                status: string;
              }
            | undefined;

          return row ?? null;
        },
      },
    },
  });
  const memoryService = createAssistantMemoryService(database);
  memoryService.pruneStaleEntries();
  const assistantGatewayService = createAssistantGatewayService(database, {
    secretStore,
    openaiProviderService,
    anthropicProviderService,
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
    onWorkspaceDataChanged: (detail) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(ipcChannels.shell.appAction, {
          type: "workspace-data-changed",
          source: detail.source,
          entities: detail.entities,
        });
      }
    },
  });
  const assistantAudioTranscription = createAssistantAudioTranscriptionService(database, {
    secretStore,
    openaiProviderService,
  });
  const connectorBridgeService = createConnectorBridgeService(database, {
    assistantChatService,
  });
  const telegramConnectorService = createTelegramConnectorService(database, {
    secretStore,
    bridgeService: connectorBridgeService,
    audioTranscriptionService: assistantAudioTranscription,
    pollingMode: resolveTelegramPollingMode(),
  });
  const runtimeDiagnostics = createRuntimeDiagnosticsService(database);
  const supportDiagnostics = createSupportDiagnosticsService({
    database,
    getDiagnosticsSnapshot,
    getAppInfo,
    runtimeDiagnostics,
  });
  const fileUploads = createFileUploadService(database, {
    userDataPath: app.getPath("userData"),
  });
  const dataRetention = createDataRetentionService(database);
  assistantChatService.reconcileInterruptedThreads();
  void telegramConnectorService.start();
  try {
    const retentionSummary = dataRetention.run();
    lastRetentionRunAt = new Date().toISOString();
    lastRetentionSummary = summarizeDataRetention(retentionSummary);
    logger.info("Completed startup retention pass.", retentionSummary);
  } catch {
    // Retention must not block startup for an internal alpha build.
    logger.warn("Startup retention pass failed.");
  }
  try {
    void runLocalSyncNow().catch(() => {
      lastSyncRunAt = new Date().toISOString();
      lastSyncStatus = "failed";
      lastSyncSummary = "The local sync worker failed during startup.";
      logger.warn("Startup local sync pass failed.");
    });
  } catch {
    lastSyncRunAt = new Date().toISOString();
    lastSyncStatus = "failed";
    lastSyncSummary = "The local sync worker failed during startup.";
    logger.warn("Startup local sync pass failed.");
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
      logger.info("Completed scheduled retention pass.", retentionSummary);
    } catch {
      // Best effort maintenance only.
      logger.warn("Scheduled retention pass failed.");
    }

    // Quote expiration sweep (Plan L FQ7). Marks any draft/sent quote whose
    // valid_until has passed as `expired` for every workspace this device
    // knows about. Same 12h cadence as the retention worker.
    try {
      const workspaces = database
        .prepare("SELECT id FROM workspaces WHERE is_active = 1")
        .all() as Array<{ id: string }>;
      let expired = 0;
      for (const ws of workspaces) {
        const out = quoteMutations.expireOverdueQuotes(ws.id);
        expired += out.expiredCount;
      }
      if (expired > 0) {
        logger.info("Expired overdue quotes in scheduled pass.", { expiredCount: expired });
      }
    } catch (error) {
      logger.warn("Scheduled quote expiration pass failed.", {
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }, 12 * 60 * 60 * 1000);
  retentionTimer.unref();

  // Run the expiration sweep once at startup so quotes that became overdue
  // while the app was closed get marked immediately.
  try {
    const workspaces = database
      .prepare("SELECT id FROM workspaces WHERE is_active = 1")
      .all() as Array<{ id: string }>;
    for (const ws of workspaces) {
      quoteMutations.expireOverdueQuotes(ws.id);
    }
  } catch {
    /* startup is best-effort */
  }
  syncOutboxTimer?.unref();
  syncOutboxTimer = setInterval(() => {
    void runLocalSyncNow().catch(() => {
      lastSyncRunAt = new Date().toISOString();
      lastSyncStatus = "failed";
      lastSyncSummary = "The scheduled local sync pass failed.";
      logger.warn("Scheduled local sync pass failed.");
    });
  }, 60 * 1000);
  syncOutboxTimer.unref();

  return {
    database,
    databasePath,
    backupPath,
    foundationReads,
    agentReads,
    assistantChatService,
    assistantAudioTranscription,
    projectMutations,
    catalogMutations,
    assetMutations,
    workspaceAccess,
    incidentMutations,
    financeMutations,
    currencyMutations,
    currencyReads,
    currencyRateProviders,
    quoteMutations,
    quoteReads,
    invoiceMutations,
    invoiceReads,
    treasuryMutations,
    treasuryReads,
    packingMutations,
    rmaMutations,
    applyRemoteCatalogRows: (input: {
      workspaceId: string;
      entityType: "asset_categories" | "locations" | "clients" | "manufacturers" | "production_companies";
      rows: Array<{
        id: string;
        workspace_id: string;
        code: string;
        name: string;
        description?: string | null;
        parent_category_id?: string | null;
        type?: string | null;
        is_active?: boolean | null;
        updated_at: string;
      }>;
    }) => createCatalogPullService(database).applyRemoteRows(input.workspaceId, input.entityType, input.rows),
    applyRemoteExchangeRates: (input: import("@contracts").AppApplyRemoteExchangeRatesCommand) => {
      const result = createCatalogPullService(database).applyRemoteExchangeRates(input.workspaceId, input.rows);
      return { workspaceId: input.workspaceId, ...result };
    },
    applyRemoteAssetSnapshots: (input: import("@contracts").AppApplyRemoteAssetSnapshotsCommand) =>
      createAssetSnapshotPullService(database).applyRemoteSnapshots(input.workspaceId, input.assets, input.states),
    applyRemoteOperationalSnapshots: (input: import("@contracts").AppApplyRemoteOperationalSnapshotsCommand) =>
      operationalSnapshots.applyRemoteSnapshots(input.workspaceId, input.entityType, input.rows),
    runtimeDiagnostics,
    supportDiagnostics,
    userAdmin,
    fileUploads,
    getDiagnosticsSnapshot,
    getSupportSnapshot: () => supportDiagnostics.getSupportSnapshot(),
    createBackupNow,
    runIntegrityCheckNow,
    ensureLocalWorkspaces,
    getLocalWorkspaces,
    runLocalSyncNow,
    getSyncOutboxRows,
    getSyncPullCursors,
    retrySyncOutboxRow,
    retryAllFailedSyncOutboxRows,
    backfillOperationalSnapshots,
    exportRecentLogs: (filePath: string) => supportDiagnostics.exportRecentLogs(filePath),
    exportSupportBundle: (directoryPath: string) => supportDiagnostics.exportSupportBundle(directoryPath),
    agentMutations: createAgentMutationService(database, {
      secretStore,
      openaiProviderService,
      anthropicProviderService,
      assistantGatewayService,
      assistantChatService,
      connectorBridgeService,
      telegramConnectorService,
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
