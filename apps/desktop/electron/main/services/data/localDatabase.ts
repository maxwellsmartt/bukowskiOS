import { app, BrowserWindow, safeStorage } from "electron";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

import {
  LOCAL_FALLBACK_WORKSPACE_ID,
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
import {
  createSupabaseOutboxTransport,
  type SupabaseDomainDelete,
  type SupabaseDomainUpsert,
  type SupabaseWorkspaceFileUpload,
} from "@sync";

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
import { applyOperationalSnapshotLocally, createOperationalSnapshotService } from "./operationalSnapshotService";
import { applyAdminFoundationMigration, bootstrapAdminFoundation } from "./adminFoundationBootstrap";
import { createCatalogMutationService } from "./catalogMutationService";
import { createAutomationControlPlanePullService } from "./automationControlPlanePullService";
import { createCatalogPullService } from "./catalogPullService";
import { applyFinancialEntryLocally, createFinancialDomainPullService } from "./financialDomainPullService";
import { createSyncConflictService } from "./syncConflictService";
import { applyConnectorFoundationMigration, bootstrapConnectorFoundation } from "./connectorFoundationBootstrap";
import { applyCrewCatalogFoundationMigration } from "./crewCatalogFoundationBootstrap";
import { deduplicateCrewCatalog } from "./crewCatalogDeduplicationBackfill";
import { backfillCrewDepartmentSyncOutbox, cleanupSeedCrewDepartmentOutbox } from "./crewDepartmentSyncBackfill";
import { createDataRetentionService, summarizeDataRetention } from "./dataRetentionService";
import { createCurrencyMutationService } from "./currencyMutationService";
import { createCurrencyRateProviderService, type CurrencyRateProviderService } from "./currencyRateProviderService";
import { createCurrencyReadService } from "./currencyReadService";
import { applyQuoteAgentSourceMigration } from "./quoteAgentSourceBootstrap";
import { createInvoiceMutationService } from "./invoiceMutationService";
import { createInvoiceReadService } from "./invoiceReadService";
import { materializeTreasuryCounterpartyRules } from "./treasuryCounterpartyRuleMaterializer";
import { applyTreasuryFoundationSelfHeal } from "./treasuryFoundationBootstrap";
import { createTreasuryMutationService } from "./treasuryMutationService";
import { createTreasuryReadService } from "./treasuryReadService";
import { createInvoiceInboxService } from "./invoiceInboxService";
import { createInvoiceExtractionService } from "../ai/invoiceExtractionService";
import { createSupabaseDocumentStorage } from "./supabaseDocumentStorageService";
import { createWorkspaceBrandingAssetService, type WorkspaceBrandingAssetService } from "./workspaceBrandingAssetService";
import { createAppSettingsStore } from "./appSettingsStore";
import { createSoftwareLicenseService } from "./softwareLicenseService";
import { applyNotificationLocalMigration, createNotificationLocalService } from "./notificationLocalService";
import { createQuoteMutationService } from "./quoteMutationService";
import { createQuoteReadService } from "./quoteReadService";
import { createFinanceMutationService } from "./financeMutationService";
import { createCollaboratorFeeMutationService } from "./collaboratorFeeMutationService";
import { createCollaboratorFeeReadService, type CollaboratorFeeReadService } from "./collaboratorFeeReadService";
import { applyOperationalFilesMigration, ensureWorkspaceFilesTable, createFileUploadService, type FileUploadService } from "./fileUploadService";
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
import { createSyncTombstonePullService } from "./syncTombstonePullService";
import { createUserAdminService, type UserAdminService } from "./userAdminService";
import { createLocalDatabaseKeyStore, DatabaseKeyIntegrityError } from "../auth/databaseKeyStore";
import { getFreshStoredAccessToken } from "../auth/supabaseAuthBridge";
import { createWorkspaceAccessGuard, type WorkspaceAccessGuard } from "../auth/workspaceAccessGuard";
import { assertPathWithinRoot } from "../../security/pathSafety";
import { createWorkspaceFilePullService } from "./workspaceFilePullService";
import { createConnectorBridgeService } from "../connectors/connectorBridgeService";
import { createTelegramConnectorService } from "../connectors/telegramConnectorService";
import {
  createEncryptedDatabaseBackup,
  isPlaintextSqliteDatabase,
  openOrMigrateEncryptedDatabase,
} from "./databaseEncryption";
import {
  applyTrackedSqlMigrations,
  applyTrackedStep,
  runIntegrityChecks,
  shouldRefreshBackup,
} from "./localDatabaseSupport";
import { getDesktopLogger, initializeDesktopLogger } from "../logger";
import { ensurePrivateDirectory, ensurePrivateFile } from "../../security/storagePrivacy";

type ProjectMutationService = ReturnType<typeof createProjectMutationService>;
type CatalogMutationService = ReturnType<typeof createCatalogMutationService>;
type AssetMutationService = ReturnType<typeof createAssetMutationService>;
type IncidentMutationService = ReturnType<typeof createIncidentMutationService>;
type FinanceMutationService = ReturnType<typeof createFinanceMutationService>;
type CollaboratorFeeMutationService = ReturnType<typeof createCollaboratorFeeMutationService>;
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
type NotificationLocalService = ReturnType<typeof createNotificationLocalService>;

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
  databaseEncrypted: boolean;
  foundationReads: FoundationReadService;
  agentReads: AgentReadService;
  assistantChatService: AssistantChatService;
  assistantAudioTranscription: AssistantAudioTranscriptionService;
  projectMutations: ProjectMutationService;
  catalogMutations: CatalogMutationService;
  assetMutations: AssetMutationService;
  incidentMutations: IncidentMutationService;
  financeMutations: FinanceMutationService;
  collaboratorFeeMutations: CollaboratorFeeMutationService;
  collaboratorFeeReads: CollaboratorFeeReadService;
  currencyMutations: CurrencyMutationService;
  currencyReads: CurrencyReadService;
  workspaceBrandingAssets: WorkspaceBrandingAssetService;
  currencyRateProviders: CurrencyRateProviderService;
  quoteMutations: QuoteMutationServiceType;
  quoteReads: QuoteReadServiceType;
  invoiceMutations: InvoiceMutationServiceType;
  invoiceReads: InvoiceReadServiceType;
  treasuryMutations: TreasuryMutationServiceType;
  treasuryReads: TreasuryReadServiceType;
  invoiceInbox: {
    enqueue: (
      input: import("@contracts").EnqueueInvoiceBatchCommand,
    ) => Promise<import("@contracts").EnqueueInvoiceBatchResult>;
    list: (query: import("@contracts").InvoiceInboxListQuery) => import("@contracts").InvoiceExtraction[];
    update: (
      input: import("@contracts").UpdateInvoiceExtractionCommand,
    ) => import("@contracts").InvoiceExtractionMutationResult;
    bulkLink: (
      input: import("@contracts").BulkLinkInvoiceExtractionsCommand,
    ) => import("@contracts").BulkLinkInvoiceExtractionsResult;
    retry: (
      input: import("@contracts").RetryInvoiceExtractionsCommand,
    ) => import("@contracts").RetryInvoiceExtractionsResult;
    apply: (
      input: import("@contracts").ApplyInvoiceExtractionCommand,
    ) => import("@contracts").InvoiceExtractionMutationResult;
    dismiss: (
      input: import("@contracts").DismissInvoiceExtractionCommand,
    ) => import("@contracts").InvoiceExtractionMutationResult;
    getFileBuffer: (
      id: string,
    ) => Promise<{ buffer: Buffer; mimeType: string; fileName: string } | null>;
    getDownload: (
      workspaceId: string,
      extractionId: string,
    ) => Promise<{ buffer: Buffer; fileName: string; mimeType: string } | null>;
    buildBatchZip: (
      workspaceId: string,
      extractionIds: string[],
    ) => Promise<{ buffer: Buffer; fileName: string; includedCount: number; missingCount: number } | null>;
    findDuplicateGroups: (workspaceId: string) => import("@contracts").InvoiceDuplicateGroup[];
    backfillContentHashes: (workspaceId: string, limit?: number) => Promise<number>;
  };
  packingMutations: PackingMutationService;
  rmaMutations: RmaMutationService;
  agentMutations: AgentMutationService;
  workspaceAccess: WorkspaceAccessGuard;
  runtimeDiagnostics: RuntimeDiagnosticsService;
  supportDiagnostics: SupportDiagnosticsService;
  userAdmin: UserAdminService;
  fileUploads: FileUploadService;
  softwareLicenses: ReturnType<typeof createSoftwareLicenseService>;
  notifications: NotificationLocalService;
  appSettings: {
    getDocumentsRoot: () => string;
    getDocumentsRootSetting: () => string | null;
    setDocumentsRoot: (next: string | null) => void;
    defaultDocumentsRoot: () => string;
  };
  getDiagnosticsSnapshot: () => AppDiagnosticsSnapshot;
  getSupportSnapshot: () => AppSupportSnapshot;
  createBackupNow: () => AppDiagnosticsSnapshot;
  restoreFromBackupNow: () => AppDiagnosticsSnapshot;
  runIntegrityCheckNow: () => AppDiagnosticsSnapshot;
  ensureLocalWorkspaces: (workspaces: EnsureLocalWorkspaceInput[]) => AppDiagnosticsSnapshot;
  getLocalWorkspaces: (query?: { userId?: string | null }) => import("@contracts").AppLocalWorkspaceRow[];
  runLocalSyncNow: () => Promise<AppDiagnosticsSnapshot>;
  getSyncOutboxRows: () => AppSyncOutboxRow[];
  getSyncPullCursors: () => AppSyncPullCursorRow[];
  retrySyncOutboxRow: (id: string) => Promise<AppDiagnosticsSnapshot>;
  retryAllFailedSyncOutboxRows: () => Promise<AppDiagnosticsSnapshot>;
  getSyncConflicts: (workspaceId: string) => import("@contracts").AppSyncConflictRow[];
  resolveSyncConflict: (
    command: import("@contracts").AppSyncConflictResolveCommand,
  ) => import("@contracts").AppSyncConflictResolveResult;
  backfillOperationalSnapshots: (
    input: import("@contracts").AppOperationalBackfillCommand,
  ) => Promise<import("@contracts").AppOperationalBackfillResult>;
  exportRecentLogs: (filePath: string) => AppExportResult;
  exportSupportBundle: (directoryPath: string) => AppExportResult;
  applyRemoteCatalogRows: (
    input: import("@contracts").AppApplyRemoteCatalogRowsCommand,
  ) => import("@contracts").AppApplyRemoteCatalogRowsResult;
  applyRemoteSyncTombstones: (
    input: import("@contracts").AppApplyRemoteSyncTombstonesCommand,
  ) => import("@contracts").AppApplyRemoteSyncTombstonesResult;
  applyRemoteExchangeRates: (
    input: import("@contracts").AppApplyRemoteExchangeRatesCommand,
  ) => import("@contracts").AppApplyRemoteExchangeRatesResult;
  applyRemoteAssetSnapshots: (
    input: import("@contracts").AppApplyRemoteAssetSnapshotsCommand,
  ) => import("@contracts").AppApplyRemoteAssetSnapshotsResult;
  applyRemoteOperationalSnapshots: (
    input: import("@contracts").AppApplyRemoteOperationalSnapshotsCommand,
  ) => import("@contracts").AppApplyRemoteOperationalSnapshotsResult;
  applyRemoteWorkspaceFiles: (
    input: import("@contracts").AppApplyRemoteWorkspaceFilesCommand,
  ) => import("@contracts").AppApplyRemoteWorkspaceFilesResult;
  applyRemoteTreasuryRows: (
    input: import("@contracts").AppApplyRemoteTreasuryRowsCommand,
  ) => import("@contracts").AppApplyRemoteTreasuryRowsResult;
  applyRemoteCollaboratorPaymentRows: (
    input: import("@contracts").AppApplyRemoteCollaboratorPaymentRowsCommand,
  ) => import("@contracts").AppApplyRemoteCollaboratorPaymentRowsResult;
  applyRemoteFinanceBusinessRows: (
    input: import("@contracts").AppApplyRemoteFinanceBusinessRowsCommand,
  ) => import("@contracts").AppApplyRemoteFinanceBusinessRowsResult;
  applyRemoteAutomationControlPlaneRows: (
    input: import("@contracts").AppApplyRemoteAutomationControlPlaneRowsCommand,
  ) => import("@contracts").AppApplyRemoteAutomationControlPlaneRowsResult;
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

const runAsyncStartupStep = async <T>(label: string, step: () => Promise<T>): Promise<T> => {
  const startedAt = Date.now();
  logger.info(`Startup step started: ${label}.`);
  try {
    const result = await step();
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

const isDemoDataEnabled = () => {
  const value = process.env.BUKOWSKI_ENABLE_DEMO_DATA?.trim().toLowerCase();
  return value === "1" || value === "true" || (!app.isPackaged && value !== "0" && value !== "false");
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

const withRecoveredDatabase = async (databasePath: string, backupPath: string) => {
  const keyStore = createLocalDatabaseKeyStore();

  const openAndVerifyDatabase = async () => {
    const result = await openOrMigrateEncryptedDatabase({
      databasePath,
      keyStore,
    });
    const database = result.database as unknown as DatabaseSync;

    try {
      runIntegrityChecks(database);
      return result;
    } catch (error) {
      result.database.close();
      throw error;
    }
  };

  try {
    const result = await openAndVerifyDatabase();
    lastIntegrityCheckAt = new Date().toISOString();
    lastIntegrityCheckStatus = "healthy";
    return {
      database: result.database,
      databaseEncrypted: result.databaseEncrypted,
      migrationPerformed: result.migrationPerformed,
    };
  } catch (error) {
    // A key problem is NOT database corruption: the file on disk is fine and
    // the backup is encrypted with the same key, so restoring it would only
    // destroy data newer than the backup and fail the same way. Abort instead.
    if (error instanceof DatabaseKeyIntegrityError) {
      throw error;
    }

    lastIntegrityCheckAt = new Date().toISOString();
    lastIntegrityCheckStatus = "failed";

    if (!fs.existsSync(backupPath)) {
      throw error;
    }

    fs.copyFileSync(backupPath, databasePath);
    ensurePrivateFile(databasePath);
    const result = await openAndVerifyDatabase();
    lastIntegrityCheckAt = new Date().toISOString();
    lastIntegrityCheckStatus = "healthy";
    return {
      database: result.database,
      databaseEncrypted: result.databaseEncrypted,
      migrationPerformed: result.migrationPerformed,
    };
  }
};

const createRuntime = async (): Promise<LocalDatabaseRuntime> => {
  const userDataPath = app.getPath("userData");
  ensurePrivateDirectory(userDataPath);
  const databasePath = path.join(userDataPath, "bukowski-foundation.sqlite");
  const backupPath = path.join(userDataPath, "bukowski-foundation.backup.sqlite");
  initializeDesktopLogger(path.join(userDataPath, "logs"));
  logger.info("Initializing local database runtime.", {
    profileDatasetEnabled: process.env.BUKOWSKI_PROFILE_DATASET === "1",
  });
  const databaseAlreadyExisted = fs.existsSync(databasePath);
  const backupRequiresEncryption = fs.existsSync(backupPath) && isPlaintextSqliteDatabase(backupPath);
  const {
    database: rawDatabase,
    databaseEncrypted,
    migrationPerformed,
  } = await runAsyncStartupStep("open and verify local database", () => withRecoveredDatabase(databasePath, backupPath));
  const database = rawDatabase as unknown as DatabaseSync;
  ensurePrivateFile(databasePath);
  if (fs.existsSync(backupPath)) {
    ensurePrivateFile(backupPath);
  }

  if (migrationPerformed) {
    logger.info("Migrated local SQLite database to SQLCipher-compatible encryption.");
  }

  if (databaseAlreadyExisted && (migrationPerformed || backupRequiresEncryption || shouldRefreshBackup(backupPath, backupMaxAgeMs))) {
    runStartupStep("refresh startup database backup", () => createEncryptedDatabaseBackup(rawDatabase, backupPath));
    logger.info("Refreshed local database backup before migrations.");
  }

  runStartupStep("apply tracked SQL migrations", () => applyTrackedSqlMigrations(database, foundationMigrations));
  runStartupStep("self-heal treasury foundation schema", () => applyTreasuryFoundationSelfHeal(database));
  runStartupStep("materialize treasury counterparty rules", () => materializeTreasuryCounterpartyRules(database));
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
  runStartupStep("backfill crew + department sync outbox", () =>
    applyTrackedStep(database, "runtime_crew_department_sync_backfill_v1", () => backfillCrewDepartmentSyncOutbox(database)),
  );
  runStartupStep("clean up seed-workspace crew/department outbox", () =>
    applyTrackedStep(database, "runtime_crew_department_seed_outbox_cleanup_v1", () => cleanupSeedCrewDepartmentOutbox(database)),
  );
  runStartupStep("deduplicate crew catalog", () =>
    applyTrackedStep(database, "runtime_crew_catalog_deduplication_v1", () => deduplicateCrewCatalog(database)),
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
  // Self-heal (unconditional, idempotent): workspace_files was added to the
  // tracked migration above after its version key already existed in some local
  // databases, so those skip it and lack the table. Ensure it every boot.
  runStartupStep("ensure workspace files schema", () => ensureWorkspaceFilesTable(database));
  const demoDataEnabled = isDemoDataEnabled();
  runStartupStep("seed foundation permissions", () => seedFoundationData(database, { includeDemoData: demoDataEnabled }));
  runStartupStep("bootstrap AI gateway foundation", () => bootstrapAIGatewayFoundation(database));
  runStartupStep("bootstrap connector foundation", () => bootstrapConnectorFoundation(database));
  if (demoDataEnabled) {
    runStartupStep("ensure local project shell defaults", () => ensureProjectShellDefaults(database));
    runStartupStep("bootstrap legacy Rentman demo", () => bootstrapLegacyRentmanDemo(database));
  }
  runStartupStep("apply asset quantity foundation migration", () =>
    applyTrackedStep(database, "runtime_asset_quantity_foundation_v1", () => applyAssetQuantityFoundationMigration(database)),
  );
  runStartupStep("apply asset valuation foundation migration", () =>
    applyTrackedStep(database, "runtime_asset_valuation_foundation_v1", () => applyAssetValuationFoundationMigration(database)),
  );
  runStartupStep("apply quote agent source migration", () =>
    applyTrackedStep(database, "runtime_quote_agent_source_v1", () => applyQuoteAgentSourceMigration(database)),
  );
  runStartupStep("apply local notifications migration", () =>
    applyTrackedStep(database, "runtime_notifications_local_first_v1", () => applyNotificationLocalMigration(database)),
  );
  runStartupStep("bootstrap admin foundation", () => bootstrapAdminFoundation(database, { cleanupDemoPlaceholders: true }));
  if (demoDataEnabled) {
    runStartupStep("bootstrap local scheduling demo", () => bootstrapSchedulingFoundation(database));
  }
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

  if (
    !databaseAlreadyExisted ||
    migrationPerformed ||
    backupRequiresEncryption ||
    shouldRefreshBackup(backupPath, backupMaxAgeMs)
  ) {
    runStartupStep("create startup database backup", () => createEncryptedDatabaseBackup(rawDatabase, backupPath));
    logger.info("Created startup backup for local database.");
  }

  const getAppInfo = (): AppInfo => ({
    appName: "bukowskiOS",
    platform: process.platform,
    isPackaged: app.isPackaged,
    version: app.getVersion(),
    shellVersion: "Beta 2",
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
      databaseEncrypted,
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
      internalBuildArtifacts,
    };
  };

  const createBackupNow = () => {
    createEncryptedDatabaseBackup(rawDatabase, backupPath);
    logger.info("Created backup on demand from Settings.");
    return getDiagnosticsSnapshot();
  };

  // Replaces the live database with the on-disk backup. The caller must
  // relaunch the app immediately afterwards — every open handle still points
  // at the old file contents. The current database is preserved next to it
  // (pre-restore copy) so a restore is itself reversible with support help.
  const restoreFromBackupNow = () => {
    if (!fs.existsSync(backupPath)) {
      throw new Error("There is no backup to restore yet.");
    }

    const snapshot = getDiagnosticsSnapshot();
    const preRestorePath = path.join(userDataPath, "bukowski-foundation.pre-restore.sqlite");

    try {
      rawDatabase.close();
    } catch (error) {
      logger.warn("Database handle was already closed before restore.", error);
    }

    if (fs.existsSync(databasePath)) {
      fs.copyFileSync(databasePath, preRestorePath);
      ensurePrivateFile(preRestorePath);
    }

    fs.copyFileSync(backupPath, databasePath);
    ensurePrivateFile(databasePath);
    logger.info("Restored local database from backup; the app must relaunch now.");
    return snapshot;
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
    bootstrapAdminFoundation(database);
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
    const findUserByEmail = database.prepare(
      `
        SELECT id
        FROM users
        WHERE LOWER(email) = LOWER(?)
        LIMIT 1
      `,
    );
    const upsertCachedUser = database.prepare(
      `
        INSERT INTO users (id, full_name, email, phone, is_active, created_at, updated_at)
        VALUES (?, ?, ?, '', 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          full_name = excluded.full_name,
          email = excluded.email,
          is_active = 1,
          updated_at = excluded.updated_at
      `,
    );
    const upsertCachedRole = database.prepare(
      `
        INSERT INTO roles (id, workspace_id, key, name, description, is_system_role, created_at)
        VALUES (?, ?, ?, ?, 'Cached remote role for offline permission checks.', 0, ?)
        ON CONFLICT(id) DO UPDATE SET
          workspace_id = excluded.workspace_id,
          key = excluded.key,
          name = excluded.name,
          description = excluded.description
      `,
    );
    const findRoleByWorkspaceAndKey = database.prepare(
      `
        SELECT id, is_system_role AS isSystemRole
        FROM roles
        WHERE workspace_id = ?
          AND key = ?
        LIMIT 1
      `,
    );
    const deleteCachedRolePermissions = database.prepare("DELETE FROM role_permissions WHERE role_id = ?");
    const insertCachedRolePermission = database.prepare(
      `
        INSERT INTO role_permissions (role_id, permission_id, created_at)
        SELECT ?, permissions.id, ?
        FROM permissions
        WHERE permissions.key = ?
        ON CONFLICT(role_id, permission_id) DO NOTHING
      `,
    );
    const upsertCachedMembership = database.prepare(
      `
        INSERT INTO workspace_memberships (id, workspace_id, user_id, role_id, status, joined_at, created_at)
        VALUES (?, ?, ?, ?, 'active', ?, ?)
        ON CONFLICT(workspace_id, user_id) DO UPDATE SET
          role_id = excluded.role_id,
          status = 'active'
      `,
    );

    try {
      database.exec("BEGIN");
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
        if (workspace.userId && workspace.permissions?.length) {
          const roleKey = workspace.roleKey?.trim() || "cached";
          const roleName = workspace.roleName?.trim() || "Cached access";
          const existingRole = findRoleByWorkspaceAndKey.get(workspace.id, roleKey) as
            | { id: string; isSystemRole: number }
            | undefined;
          const cachedRoleId = existingRole?.id ?? `cached-role-${workspace.id}-${workspace.userId}`;
          const normalizedEmail = workspace.userEmail?.trim() || "";
          const emailOwner = normalizedEmail
            ? (findUserByEmail.get(normalizedEmail) as { id: string } | undefined)
            : undefined;
          const cachedEmail =
            !normalizedEmail || (emailOwner && emailOwner.id !== workspace.userId)
              ? `${workspace.userId}@cached.bukowskios.local`
              : normalizedEmail;
          upsertCachedUser.run(
            workspace.userId,
            normalizedEmail || "Cached user",
            cachedEmail,
            timestamp,
            timestamp,
          );
          if (!existingRole) {
            upsertCachedRole.run(cachedRoleId, workspace.id, roleKey, roleName, timestamp);
          }
          if (!existingRole?.isSystemRole) {
            deleteCachedRolePermissions.run(cachedRoleId);
            Array.from(new Set(workspace.permissions)).forEach((permissionKey) => {
              insertCachedRolePermission.run(cachedRoleId, timestamp, permissionKey);
            });
          }
          upsertCachedMembership.run(
            `membership-${workspace.id}-${workspace.userId}`,
            workspace.id,
            workspace.userId,
            cachedRoleId,
            timestamp,
            timestamp,
          );
        }
      });
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    logger.info("Ensured remote workspaces in local SQLite cache.", { count: workspaces.length });

    return getDiagnosticsSnapshot();
  };

  const getLocalWorkspaces = (query?: { userId?: string | null }) => {
    const userId = query?.userId?.trim() || null;

    if (userId) {
      return (
        database
          .prepare(
            `
              SELECT
                workspaces.id,
                workspaces.name,
                workspaces.slug,
                workspaces.base_currency AS baseCurrency,
                roles.key AS roleKey,
                roles.name AS roleName,
                GROUP_CONCAT(DISTINCT permissions.key) AS permissionKeys
              FROM workspaces
              JOIN workspace_memberships
                ON workspace_memberships.workspace_id = workspaces.id
                AND workspace_memberships.user_id = ?
                AND workspace_memberships.status = 'active'
              LEFT JOIN roles ON roles.id = workspace_memberships.role_id
              LEFT JOIN role_permissions ON role_permissions.role_id = roles.id
              LEFT JOIN permissions ON permissions.id = role_permissions.permission_id
              WHERE workspaces.is_active = 1
              GROUP BY workspaces.id, workspaces.name, workspaces.slug, workspaces.base_currency, roles.key, roles.name
              ORDER BY workspaces.created_at ASC, workspaces.name ASC
            `,
          )
          .all(userId) as Array<{
          id: string;
          name: string;
          slug: string;
          baseCurrency: string;
          roleKey: string | null;
          roleName: string | null;
          permissionKeys: string | null;
        }>
      ).map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        baseCurrency: workspace.baseCurrency,
        roleKey: workspace.roleKey,
        roleName: workspace.roleName,
        permissions: (workspace.permissionKeys ?? "")
          .split(",")
          .map((permissionKey) => permissionKey.trim())
          .filter(Boolean),
      }));
    }

    return (
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
  };

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

  // Materialize a financial-domain outbox row into its real Supabase table(s).
  // The local SQLite schema mirrors the Supabase tables 1:1 (including INTEGER
  // 0/1 flags — Supabase stores these as integer, NOT boolean, so we send the
  // raw value). The only fix-ups: user-id columns are uuid on Supabase but can
  // hold non-uuid seed values locally (e.g. "user-ops"), so we null those when
  // they are not valid uuids. Returns null for entity types this resolver does
  // not own (assets / operational handled elsewhere).
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const nullNonUuid = <T extends Record<string, unknown>>(row: T, columns: string[]): T => {
    const next: Record<string, unknown> = { ...row };
    for (const column of columns) {
      const value = next[column];
      if (typeof value === "string" && !UUID_RE.test(value)) next[column] = null;
    }
    return next as T;
  };
  const parseJsonColumn = <T extends Record<string, unknown>>(row: T, columns: string[]): T => {
    const next: Record<string, unknown> = { ...row };
    for (const column of columns) {
      const value = next[column];
      if (typeof value !== "string") continue;
      try {
        next[column] = JSON.parse(value) as unknown;
      } catch {
        next[column] = value;
      }
    }
    return next as T;
  };
  const selectAll = (sql: string, ...params: Array<string | number>) =>
    database.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  const pickColumns = <T extends Record<string, unknown>>(source: T, columns: readonly string[]) =>
    columns.reduce<Record<string, unknown>>((accumulator, column) => {
      accumulator[column] = source[column] ?? null;
      return accumulator;
    }, {});

  const resolveSupabaseDomainUpserts = (
    row: { entity_type: string; entity_id: string },
  ): SupabaseDomainUpsert[] | null => {
    switch (row.entity_type) {
      case "bank_account": {
        const rows = selectAll("SELECT * FROM bank_accounts WHERE id = ?", row.entity_id).map((r) =>
          nullNonUuid(r, ["owner_user_id", "reminder_user_id"]),
        );
        return rows.length ? [{ table: "bank_accounts", onConflict: "id", rows }] : [];
      }
      case "bank_statement_import": {
        // The import path enqueues ONE outbox row per batch (not per txn), so
        // pushing an import also pushes every transaction it inserted.
        const imports = selectAll("SELECT * FROM bank_statement_imports WHERE id = ?", row.entity_id).map(
          (r) => nullNonUuid(r, ["imported_by_user_id"]),
        );
        if (!imports.length) return []; // deleted locally — nothing to materialize
        const txns = selectAll("SELECT * FROM bank_transactions WHERE import_id = ?", row.entity_id);
        const upserts: SupabaseDomainUpsert[] = [
          { table: "bank_statement_imports", onConflict: "id", rows: imports },
        ];
        if (txns.length) upserts.push({ table: "bank_transactions", onConflict: "id", rows: txns });
        return upserts;
      }
      case "bank_transaction": {
        const rows = selectAll("SELECT * FROM bank_transactions WHERE id = ?", row.entity_id);
        return rows.length ? [{ table: "bank_transactions", onConflict: "id", rows }] : [];
      }
      case "transaction_annotation": {
        const rows = selectAll(
          "SELECT * FROM transaction_annotations WHERE transaction_id = ?",
          row.entity_id,
        ).map((r) => nullNonUuid(r, ["reviewed_by_user_id", "classified_by_user_id"]));
        return rows.length
          ? [{ table: "transaction_annotations", onConflict: "transaction_id", rows }]
          : [];
      }
      case "transaction_allocations": {
        const rows = selectAll(
          "SELECT * FROM transaction_project_allocations WHERE transaction_id = ?",
          row.entity_id,
        );
        return [
          {
            table: "transaction_project_allocations",
            onConflict: "id",
            rows,
            deleteBeforeInsert: { column: "transaction_id", value: row.entity_id },
          },
        ];
      }
      case "transaction_link": {
        let rows = selectAll("SELECT * FROM transaction_links WHERE id = ?", row.entity_id);
        if (!rows.length) {
          // Transitional compatibility: older outbox rows used transaction_id as
          // entity_id. Keep draining those instead of forcing a manual outbox reset.
          rows = selectAll("SELECT * FROM transaction_links WHERE transaction_id = ?", row.entity_id);
        }
        return [{ table: "transaction_links", onConflict: "id", rows }];
      }
      case "counterparty_rule": {
        const rows = selectAll("SELECT * FROM counterparty_rules WHERE id = ?", row.entity_id);
        return rows.length ? [{ table: "counterparty_rules", onConflict: "id", rows }] : [];
      }
      case "collaborator_fee": {
        const rows = selectAll("SELECT * FROM collaborator_fees WHERE id = ?", row.entity_id).map((r) =>
          nullNonUuid(r, ["created_by_user_id", "updated_by_user_id"]),
        );
        return rows.length ? [{ table: "collaborator_fees", onConflict: "id", rows }] : [];
      }
      case "collaborator_payment": {
        const batches = selectAll("SELECT * FROM collaborator_payment_batches WHERE id = ?", row.entity_id).map((r) =>
          nullNonUuid(r, ["recorded_by_user_id"]),
        );
        if (!batches.length) return [];
        const allocations = selectAll(
          "SELECT * FROM collaborator_fee_payments WHERE payment_batch_id = ?",
          row.entity_id,
        );
        const feeRows = allocations.length
          ? selectAll(
              `SELECT collaborator_fees.*
               FROM collaborator_fees
               JOIN collaborator_fee_payments ON collaborator_fee_payments.fee_id = collaborator_fees.id
               WHERE collaborator_fee_payments.payment_batch_id = ?`,
              row.entity_id,
            ).map((r) => nullNonUuid(r, ["created_by_user_id", "updated_by_user_id"]))
          : [];
        const upserts: SupabaseDomainUpsert[] = [
          { table: "collaborator_payment_batches", onConflict: "id", rows: batches },
        ];
        if (feeRows.length) upserts.unshift({ table: "collaborator_fees", onConflict: "id", rows: feeRows });
        if (allocations.length) {
          upserts.push({ table: "collaborator_fee_payments", onConflict: "id", rows: allocations });
        }
        return upserts;
      }
      case "currency_settings": {
        const rows = selectAll("SELECT * FROM currency_settings WHERE id = ?", row.entity_id).map((r) =>
          parseJsonColumn(r, ["enabled_currencies_json"]),
        );
        return rows.length ? [{ table: "currency_settings", onConflict: "workspace_id", rows }] : [];
      }
      case "exchange_rate": {
        const rows = selectAll("SELECT * FROM exchange_rates WHERE id = ?", row.entity_id).map((r) =>
          nullNonUuid(r, ["created_by_user_id"]),
        );
        return rows.length ? [{ table: "exchange_rates", onConflict: "id", rows }] : [];
      }
      case "location": {
        const rows = selectAll("SELECT * FROM locations WHERE id = ?", row.entity_id);
        return rows.length ? [{ table: "locations", onConflict: "id", rows }] : [];
      }
      case "category": {
        const rows = selectAll("SELECT * FROM asset_categories WHERE id = ?", row.entity_id);
        return rows.length ? [{ table: "asset_categories", onConflict: "id", rows }] : [];
      }
      case "client": {
        const rows = selectAll("SELECT * FROM clients WHERE id = ?", row.entity_id);
        return rows.length ? [{ table: "clients", onConflict: "id", rows }] : [];
      }
      case "manufacturer": {
        const rows = selectAll("SELECT * FROM manufacturers WHERE id = ?", row.entity_id);
        return rows.length ? [{ table: "manufacturers", onConflict: "id", rows }] : [];
      }
      case "production_company": {
        const rows = selectAll("SELECT * FROM production_companies WHERE id = ?", row.entity_id);
        return rows.length ? [{ table: "production_companies", onConflict: "id", rows }] : [];
      }
      case "crew": {
        const rows = selectAll("SELECT * FROM crew_members WHERE id = ?", row.entity_id);
        return rows.length ? [{ table: "crew_members", onConflict: "id", rows }] : [];
      }
      case "department": {
        const rows = selectAll("SELECT * FROM departments WHERE id = ?", row.entity_id);
        return rows.length ? [{ table: "departments", onConflict: "id", rows }] : [];
      }
      case "quote": {
        const quotes = selectAll("SELECT * FROM quotes WHERE id = ?", row.entity_id).map((r) =>
          parseJsonColumn(nullNonUuid(r, ["created_by_user_id", "updated_by_user_id"]), ["exchange_rate_snapshot_json"]),
        );
        if (!quotes.length) return [];
        const items = selectAll("SELECT * FROM quote_items WHERE quote_id = ?", row.entity_id).map((r) =>
          parseJsonColumn(r, ["metadata_json"]),
        );
        const versions = selectAll("SELECT * FROM quote_versions WHERE quote_id = ?", row.entity_id).map((r) =>
          parseJsonColumn(nullNonUuid(r, ["created_by_user_id"]), ["snapshot_json"]),
        );
        const upserts: SupabaseDomainUpsert[] = [{ table: "quotes", onConflict: "id", rows: quotes }];
        upserts.push({
          table: "quote_items",
          onConflict: "id",
          rows: items,
          deleteBeforeInsert: { column: "quote_id", value: row.entity_id },
        });
        if (versions.length) upserts.push({ table: "quote_versions", onConflict: "id", rows: versions });
        return upserts;
      }
      case "invoice": {
        const invoices = selectAll("SELECT * FROM invoices WHERE id = ?", row.entity_id).map((r) =>
          parseJsonColumn(nullNonUuid(r, ["created_by_user_id", "updated_by_user_id"]), ["exchange_rate_snapshot_json"]),
        );
        if (!invoices.length) return [];
        const items = selectAll("SELECT * FROM invoice_items WHERE invoice_id = ?", row.entity_id).map((r) =>
          parseJsonColumn(r, ["metadata_json"]),
        );
        const upserts: SupabaseDomainUpsert[] = [{ table: "invoices", onConflict: "id", rows: invoices }];
        upserts.push({
          table: "invoice_items",
          onConflict: "id",
          rows: items,
          deleteBeforeInsert: { column: "invoice_id", value: row.entity_id },
        });
        return upserts;
      }
      case "invoice_payment": {
        const payments = selectAll("SELECT * FROM invoice_payments WHERE id = ?", row.entity_id).map((r) =>
          nullNonUuid(r, ["recorded_by_user_id"]),
        );
        if (!payments.length) return [];
        const invoiceId = payments[0]?.invoice_id;
        const invoices =
          typeof invoiceId === "string"
            ? selectAll("SELECT * FROM invoices WHERE id = ?", invoiceId).map((r) =>
                parseJsonColumn(nullNonUuid(r, ["created_by_user_id", "updated_by_user_id"]), [
                  "exchange_rate_snapshot_json",
                ]),
              )
            : [];
        const upserts: SupabaseDomainUpsert[] = [];
        if (invoices.length) upserts.push({ table: "invoices", onConflict: "id", rows: invoices });
        upserts.push({ table: "invoice_payments", onConflict: "id", rows: payments });
        return upserts;
      }
      case "financial_entry": {
        const rows = selectAll("SELECT * FROM financial_entries WHERE id = ?", row.entity_id).map((r) =>
          nullNonUuid(r, ["created_by_user_id"]),
        );
        return rows.length ? [{ table: "financial_entries", onConflict: "id", rows }] : [];
      }
      case "software_license": {
        const rows = selectAll("SELECT * FROM software_licenses WHERE id = ?", row.entity_id).map((r) =>
          parseJsonColumn(r, ["seat_assignments"]),
        );
        return rows.length ? [{ table: "software_licenses", onConflict: "id", rows }] : [];
      }
      case "invoice_extraction": {
        const rows = selectAll("SELECT * FROM invoice_extractions WHERE id = ?", row.entity_id).map((r) =>
          nullNonUuid(r, ["uploaded_by_user_id", "linked_user_id"]),
        );
        if (!rows.length) return [];
        const upserts: SupabaseDomainUpsert[] = [
          { table: "invoice_extractions", onConflict: "id", rows },
        ];
        const projects = selectAll(
          "SELECT * FROM invoice_extraction_projects WHERE invoice_extraction_id = ?",
          row.entity_id,
        );
        upserts.push({
          table: "invoice_extraction_projects",
          onConflict: "id",
          rows: projects,
          deleteBeforeInsert: { column: "invoice_extraction_id", value: row.entity_id },
        });
        return upserts;
      }
      case "notification": {
        const rows = selectAll("SELECT * FROM notifications WHERE id = ?", row.entity_id).map((r) =>
          parseJsonColumn(r, ["source_ref"]),
        );
        return rows.length ? [{ table: "notifications", onConflict: "id", rows }] : [];
      }
      case "todo": {
        const rows = selectAll("SELECT * FROM todos WHERE id = ?", row.entity_id).map((r) =>
          parseJsonColumn(r, ["agent_action_ref"]),
        );
        return rows.length ? [{ table: "todos", onConflict: "id", rows }] : [];
      }
      case "reminder": {
        if (row.entity_id.startsWith("treasury-card-payment-")) {
          return [];
        }
        const rows = selectAll("SELECT * FROM reminders WHERE id = ?", row.entity_id);
        return rows.length ? [{ table: "reminders", onConflict: "id", rows }] : [];
      }
      case "agent": {
        const rows = selectAll("SELECT * FROM agents WHERE id = ?", row.entity_id).map((record) =>
          pickColumns(record, [
            "workspace_id",
            "id",
            "agent_key",
            "display_name",
            "emoji",
            "role_summary",
            "domain_key",
            "model_key",
            "model_label",
            "status",
            "approval_mode",
            "allowed_tools_json",
            "allowed_domains_json",
            "notes",
            "is_supervisor",
            "sort_order",
            "created_at",
            "updated_at",
          ]),
        );
        return rows.length ? [{ table: "agents", onConflict: "workspace_id,id", rows }] : [];
      }
      case "ai_provider_config": {
        const rows = selectAll("SELECT * FROM ai_provider_configs WHERE id = ?", row.entity_id).map((record) =>
          pickColumns(record, [
            "workspace_id",
            "id",
            "provider_key",
            "display_name",
            "supports_live_requests",
            "enabled",
            "default_model_key",
            "fallback_model_key",
            "base_url",
            "timeout_ms",
            "retry_count",
            "status",
            "last_tested_at",
            "last_success_at",
            "last_error_summary",
            "notes",
            "created_at",
            "updated_at",
          ]),
        );
        return rows.length ? [{ table: "ai_provider_configs", onConflict: "workspace_id,id", rows }] : [];
      }
      case "agent_connector_config": {
        const rows = selectAll("SELECT * FROM agent_connector_configs WHERE id = ?", row.entity_id).map((record) =>
          pickColumns(record, [
            "workspace_id",
            "id",
            "connector_key",
            "display_name",
            "status",
            "capability_summary",
            "notes",
            "bot_username",
            "last_tested_at",
            "last_error_summary",
            "created_at",
            "updated_at",
          ]),
        );
        return rows.length ? [{ table: "agent_connector_configs", onConflict: "workspace_id,id", rows }] : [];
      }
      default:
        return null;
    }
  };

  // Maps a delete-operation outbox row to the Supabase rows to remove. Children
  // are listed before parents because bank_transactions.import_id is ON DELETE
  // SET NULL (not cascade), so deleting only the import would orphan its rows.
  const resolveSupabaseDomainDeletes = (row: {
    workspace_id: string;
    entity_type: string;
    entity_id: string;
  }): SupabaseDomainDelete[] | null => {
    switch (row.entity_type) {
      case "bank_statement_import":
        return [
          { table: "bank_transactions", filters: [{ column: "import_id", value: row.entity_id }] },
          { table: "bank_statement_imports", filters: [{ column: "id", value: row.entity_id }] },
        ];
      case "bank_account":
        return [{ table: "bank_accounts", filters: [{ column: "id", value: row.entity_id }] }];
      case "bank_transaction":
        return [{ table: "bank_transactions", filters: [{ column: "id", value: row.entity_id }] }];
      case "transaction_annotation":
        return [{ table: "transaction_annotations", filters: [{ column: "transaction_id", value: row.entity_id }] }];
      case "transaction_link":
        return [{ table: "transaction_links", filters: [{ column: "id", value: row.entity_id }] }];
      case "counterparty_rule":
        return [{ table: "counterparty_rules", filters: [{ column: "id", value: row.entity_id }] }];
      case "exchange_rate":
        return [{ table: "exchange_rates", filters: [{ column: "id", value: row.entity_id }] }];
      case "invoice":
        return [{ table: "invoices", filters: [{ column: "id", value: row.entity_id }] }];
      case "quote":
        return [{ table: "quotes", filters: [{ column: "id", value: row.entity_id }] }];
      case "collaborator_fee":
        return [{ table: "collaborator_fees", filters: [{ column: "id", value: row.entity_id }] }];
      case "financial_entry":
        return [{ table: "financial_entries", filters: [{ column: "id", value: row.entity_id }] }];
      case "invoice_extraction":
        return [
          { table: "invoice_extraction_projects", filters: [{ column: "invoice_extraction_id", value: row.entity_id }] },
          { table: "invoice_extractions", filters: [{ column: "id", value: row.entity_id }] },
        ];
      case "software_license":
        return [{ table: "software_licenses", filters: [{ column: "id", value: row.entity_id }] }];
      case "notification":
        return [{ table: "notifications", filters: [{ column: "id", value: row.entity_id }] }];
      case "todo":
        return [{ table: "todos", filters: [{ column: "id", value: row.entity_id }] }];
      case "reminder":
        return [{ table: "reminders", filters: [{ column: "id", value: row.entity_id }] }];
      case "client":
        return [{ table: "clients", filters: [{ column: "id", value: row.entity_id }] }];
      case "manufacturer":
        return [{ table: "manufacturers", filters: [{ column: "id", value: row.entity_id }] }];
      case "production_company":
        return [{ table: "production_companies", filters: [{ column: "id", value: row.entity_id }] }];
      case "location":
        return [{ table: "locations", filters: [{ column: "id", value: row.entity_id }] }];
      case "category":
        return [{ table: "asset_categories", filters: [{ column: "id", value: row.entity_id }] }];
      case "crew":
        return [{ table: "crew_members", filters: [{ column: "id", value: row.entity_id }] }];
      case "department":
        return [{ table: "departments", filters: [{ column: "id", value: row.entity_id }] }];
      default:
        return null;
    }
  };

  const operationalSnapshots = createOperationalSnapshotService(database);
  const syncConflicts = createSyncConflictService(database, {
    appliers: {
      packing_slip: (db, conflict) =>
        applyOperationalSnapshotLocally(db, {
          workspaceId: conflict.workspaceId,
          entityType: "packing_slip",
          entityId: conflict.entityId,
          remoteSnapshot: conflict.remoteSnapshot,
        }),
      incident: (db, conflict) =>
        applyOperationalSnapshotLocally(db, {
          workspaceId: conflict.workspaceId,
          entityType: "incident",
          entityId: conflict.entityId,
          remoteSnapshot: conflict.remoteSnapshot,
        }),
      rma_case: (db, conflict) =>
        applyOperationalSnapshotLocally(db, {
          workspaceId: conflict.workspaceId,
          entityType: "rma_case",
          entityId: conflict.entityId,
          remoteSnapshot: conflict.remoteSnapshot,
        }),
      financial_entry: (db, conflict) => applyFinancialEntryLocally(db, conflict.remoteSnapshot),
    },
  });
  const appSettings = createAppSettingsStore(app.getPath("userData"));
  const resolveWorkspaceFileUpload = (
    row: { workspace_id: string; entity_type: string; entity_id: string; operation_type: string },
  ): SupabaseWorkspaceFileUpload | null => {
    if (row.entity_type !== "workspace_file") return null;
    const file = database.prepare(
      `SELECT id, workspace_id, domain, entity_id, storage_path, storage_object_key,
              original_name, mime_type, byte_size, content_hash, created_by_user_id,
              created_at, updated_at, deleted_at
       FROM workspace_files
       WHERE id = ? AND workspace_id = ?
       LIMIT 1`,
    ).get(row.entity_id, row.workspace_id) as {
      id: string;
      workspace_id: string;
      domain: string;
      entity_id: string;
      storage_path: string | null;
      storage_object_key: string;
      original_name: string;
      mime_type: string;
      byte_size: number;
      content_hash: string | null;
      created_by_user_id: string | null;
      created_at: string;
      updated_at: string;
      deleted_at: string | null;
    } | undefined;
    if (!file) return null;
    const expectedPrefix = `${file.workspace_id}/${file.domain}/${file.entity_id}/${file.id}/`;
    if (!file.storage_object_key.startsWith(expectedPrefix)) {
      throw new Error(`Workspace file object key is outside its canonical scope: ${file.id}.`);
    }

    const isDelete = row.operation_type === "delete";
    const bytes = !isDelete && file.storage_path
      ? fs.readFileSync(assertPathWithinRoot(file.storage_path, appSettings.getDocumentsRoot()))
      : null;
    return {
      objectKey: file.storage_object_key,
      contentType: file.mime_type,
      bytes: bytes ? new Uint8Array(bytes) : null,
      metadata: {
        id: file.id,
        workspace_id: file.workspace_id,
        domain: file.domain,
        entity_id: file.entity_id,
        storage_object_key: file.storage_object_key,
        original_name: file.original_name,
        mime_type: file.mime_type,
        byte_size: file.byte_size,
        content_hash: file.content_hash,
        status: isDelete ? "deleted" : "available",
        created_by_user_id: file.created_by_user_id,
        created_at: file.created_at,
        updated_at: file.updated_at,
        deleted_at: isDelete ? (file.deleted_at ?? file.updated_at) : null,
      },
    };
  };
  const workspaceAccess = createWorkspaceAccessGuard({
    database,
    supabaseUrl: process.env.VITE_SUPABASE_URL,
    anonKey: process.env.VITE_SUPABASE_ANON_KEY,
    getTokens: async () => ({ accessToken: await getFreshStoredAccessToken() }),
  });
  const syncOutboxWorker = createSyncOutboxWorkerService(database, {
    // Keep cross-machine latency low and drain normal bulk operations in one
    // pass. The worker has its own single-flight guard, so overlapping ticks are
    // harmless and the 20s-era queue backlog no longer accumulates.
    batchSize: 100,
    transport: isSupabaseSyncEnabled()
      ? createSupabaseOutboxTransport({
          supabaseUrl: process.env.VITE_SUPABASE_URL ?? "",
          anonKey: process.env.VITE_SUPABASE_ANON_KEY ?? "",
          getAccessToken: getFreshStoredAccessToken,
          resolveAssetSnapshot: resolveSupabaseAssetSnapshot,
          resolveOperationalSnapshot: (row) => operationalSnapshots.resolveSnapshot(row),
          resolveWorkspaceFileUpload,
          resolveDomainUpserts: resolveSupabaseDomainUpserts,
          resolveDomainDeletes: resolveSupabaseDomainDeletes,
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

  const clearResolvedPullCursorErrors = () => {
    database
      .prepare(
        `
          UPDATE sync_pull_cursors
          SET last_error = NULL,
              updated_at = CURRENT_TIMESTAMP
          WHERE entity_type = 'transaction_links'
            AND lower(COALESCE(last_error, '')) LIKE '%idx_txn_links_dedupe_v4%'
        `,
      )
      .run();
  };

  const getSyncPullCursors = (): AppSyncPullCursorRow[] => {
    clearResolvedPullCursorErrors();
    return (
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
  };

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

  const getSyncConflicts = (workspaceId: string) => syncConflicts.listConflicts(workspaceId);

  const resolveSyncConflict = (
    command: import("@contracts").AppSyncConflictResolveCommand,
  ): import("@contracts").AppSyncConflictResolveResult => {
    const conflict = syncConflicts.resolveConflict(command.conflictId, command.resolution);
    return {
      summary:
        command.resolution === "take_remote"
          ? "Conflict resolved with the cloud version."
          : "Conflict resolved keeping your version.",
      conflict,
      diagnostics: getDiagnosticsSnapshot(),
    };
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
  const foundationReads = createFoundationReadService(database, {
    getStorageRoot: () => appSettings.getDocumentsRoot(),
  });
  const userAdmin = createUserAdminService(database);
  const agentReads = createAgentReadService(database, secretStore);
  const sessionStore = createAssistantGatewaySessionStore(database);
  const projectMutations = createProjectMutationService(database, {
    createBackupBeforeDelete: () => {
      createEncryptedDatabaseBackup(rawDatabase, backupPath);
    },
  });
  const catalogMutations = createCatalogMutationService(database);
  const assetMutations = createAssetMutationService(database);
  const incidentMutations = createIncidentMutationService(database);
  const financeMutations = createFinanceMutationService(database);
  const collaboratorFeeMutations = createCollaboratorFeeMutationService(database);
  const collaboratorFeeReads = createCollaboratorFeeReadService(database);
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
    treasuryReads,
    writeServices: {
      packing: packingMutations,
      projects: projectMutations,
      incidents: incidentMutations,
      rma: rmaMutations,
      assets: assetMutations,
      finance: financeMutations,
      quotes: quoteMutations,
      treasury: treasuryMutations,
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
  const attachmentsRootPath = path.join(userDataPath, "assistant-attachments");
  ensurePrivateDirectory(attachmentsRootPath);
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
  const softwareLicenses = createSoftwareLicenseService(database);
  const notifications = createNotificationLocalService(database);
  const documentStorage = createSupabaseDocumentStorage({
    supabaseUrl: isSupabaseSyncEnabled() ? process.env.VITE_SUPABASE_URL : undefined,
    bucket: "workspace-documents",
    getAccessToken: getFreshStoredAccessToken,
  });
  const fileUploads = createFileUploadService(database, {
    userDataPath: app.getPath("userData"),
    getStorageRoot: () => appSettings.getDocumentsRoot(),
    storage: documentStorage,
  });
  const brandingAssetStorage = createSupabaseDocumentStorage({
    supabaseUrl: isSupabaseSyncEnabled() ? process.env.VITE_SUPABASE_URL : undefined,
    bucket: "workspace-assets",
    getAccessToken: getFreshStoredAccessToken,
  });
  const workspaceBrandingAssets = createWorkspaceBrandingAssetService(database, {
    userDataPath: app.getPath("userData"),
    getStorageRoot: () => appSettings.getDocumentsRoot(),
    storage: brandingAssetStorage,
  });
  const invoiceInboxService = createInvoiceInboxService(database, {
    userDataPath: app.getPath("userData"),
    getStorageRoot: () => appSettings.getDocumentsRoot(),
    treasuryMutations,
    storage: documentStorage,
  });
  const invoiceExtractionService = createInvoiceExtractionService(database, {
    secretStore,
    openaiProviderService,
    anthropicProviderService,
  });
  // Sequentially extract pending invoice documents in the background (one
  // vision/text call per file) and refresh the renderer so the inbox shows
  // progress. Fire-and-forget — failures are recorded per-row, never thrown.
  const processInvoiceQueue = async (ids: string[], workspaceId: string) => {
    for (const id of ids) {
      try {
        invoiceInboxService.setProcessing(id);
        const file = await invoiceInboxService.getFileBuffer(id);
        if (!file) {
          invoiceInboxService.recordFailure(id, "Archivo no encontrado en disco.");
          continue;
        }
        // Push the bytes to cloud storage so teammates/other machines can
        // open the document. Best-effort: never blocks extraction.
        void invoiceInboxService.uploadDocument(id);
        const fields = await invoiceExtractionService.extract(
          file.buffer,
          file.mimeType,
          file.fileName,
          workspaceId,
        );
        const match = invoiceInboxService.autoMatch(workspaceId, fields);
        invoiceInboxService.recordExtraction(id, fields, match);
      } catch (error) {
        const raw = error instanceof Error ? error.message : "";
        // Map common low-level failures to a clear, human message (the inbox
        // shows this verbatim). Keep the raw cause for anything unrecognized.
        const friendly = /abort|tim-?out|timed out/i.test(raw)
          ? "La IA tardó demasiado en responder. Reintenta la factura."
          : /network|ECONN|ETIMEDOUT|socket|unavailable|overloaded|50\d/i.test(raw)
            ? "No se pudo conectar con la IA. Revisa tu conexión y reintenta."
            : /rate.?limit|throttl|429/i.test(raw)
              ? "El proveedor de IA está saturado. Reintenta en un momento."
              : /API key|no hay un proveedor/i.test(raw)
                ? "Configura un proveedor de IA habilitado en Modelos."
                : /PDF sin texto/i.test(raw)
                  ? raw
                  : raw || "No se pudo extraer la factura.";
        invoiceInboxService.recordFailure(id, friendly);
      }
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(ipcChannels.shell.appAction, {
          type: "workspace-data-changed",
          source: "invoice-inbox",
          entities: ["invoice_extraction"],
        });
      }
    }
  };
  const invoiceInbox = {
    enqueue: async (input: import("@contracts").EnqueueInvoiceBatchCommand) => {
      const { result, ids } = invoiceInboxService.enqueueBatch(input);
      if (ids.length) {
        void processInvoiceQueue(ids, input.workspaceId);
      }
      return result;
    },
    list: invoiceInboxService.list,
    update: invoiceInboxService.update,
    bulkLink: invoiceInboxService.bulkLink,
    retry: (input: import("@contracts").RetryInvoiceExtractionsCommand) => {
      const result = invoiceInboxService.retry(input);
      if (result.extractionIds.length) {
        void processInvoiceQueue(result.extractionIds, input.workspaceId);
      }
      return result;
    },
    apply: invoiceInboxService.applyExtraction,
    dismiss: invoiceInboxService.dismiss,
    getFileBuffer: invoiceInboxService.getFileBuffer,
    getDownload: invoiceInboxService.getDownload,
    buildBatchZip: invoiceInboxService.buildBatchZip,
    findDuplicateGroups: invoiceInboxService.findDuplicateGroups,
    backfillContentHashes: invoiceInboxService.backfillContentHashes,
  };
  const dataRetention = createDataRetentionService(database, {
    attachmentsRootPath,
  });
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
  }, 2 * 1000);
  syncOutboxTimer.unref();

  return {
    database,
    databasePath,
    backupPath,
    databaseEncrypted,
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
    collaboratorFeeMutations,
    collaboratorFeeReads,
    currencyMutations,
    currencyReads,
    workspaceBrandingAssets,
    currencyRateProviders,
    quoteMutations,
    quoteReads,
    invoiceMutations,
    invoiceReads,
    treasuryMutations,
    treasuryReads,
    invoiceInbox,
    packingMutations,
    rmaMutations,
    applyRemoteCatalogRows: (input: import("@contracts").AppApplyRemoteCatalogRowsCommand) =>
      createCatalogPullService(database).applyRemoteRows(input.workspaceId, input.entityType, input.rows),
    applyRemoteSyncTombstones: (input: import("@contracts").AppApplyRemoteSyncTombstonesCommand) =>
      createSyncTombstonePullService(database).apply(input.workspaceId, input.rows),
    applyRemoteExchangeRates: (input: import("@contracts").AppApplyRemoteExchangeRatesCommand) => {
      const result = createCatalogPullService(database).applyRemoteExchangeRates(input.workspaceId, input.rows);
      return { workspaceId: input.workspaceId, ...result };
    },
    applyRemoteAssetSnapshots: (input: import("@contracts").AppApplyRemoteAssetSnapshotsCommand) =>
      createAssetSnapshotPullService(database).applyRemoteSnapshots(input.workspaceId, input.assets, input.states),
    applyRemoteOperationalSnapshots: (input: import("@contracts").AppApplyRemoteOperationalSnapshotsCommand) =>
      operationalSnapshots.applyRemoteSnapshots(input.workspaceId, input.entityType, input.rows),
    applyRemoteWorkspaceFiles: (input: import("@contracts").AppApplyRemoteWorkspaceFilesCommand) =>
      createWorkspaceFilePullService(database, {
        getStorageRoot: () => appSettings.getDocumentsRoot(),
      }).applyRemoteRows(input.workspaceId, input.rows, input.pullError ?? null),
    applyRemoteTreasuryRows: (input: import("@contracts").AppApplyRemoteTreasuryRowsCommand) =>
      createFinancialDomainPullService(database).applyRemoteTreasuryRows(input.workspaceId, input.table, input.rows),
    applyRemoteCollaboratorPaymentRows: (input: import("@contracts").AppApplyRemoteCollaboratorPaymentRowsCommand) =>
      createFinancialDomainPullService(database).applyRemoteCollaboratorPaymentRows(input.workspaceId, input.table, input.rows),
    applyRemoteFinanceBusinessRows: (input: import("@contracts").AppApplyRemoteFinanceBusinessRowsCommand) =>
      createFinancialDomainPullService(database).applyRemoteFinanceBusinessRows(
        input.workspaceId,
        input.table,
        input.rows,
        input.childRows,
      ),
    applyRemoteAutomationControlPlaneRows: (input: import("@contracts").AppApplyRemoteAutomationControlPlaneRowsCommand) =>
      createAutomationControlPlanePullService(database).applyRemoteRows(input.workspaceId, input.entityType, input.rows),
    runtimeDiagnostics,
    supportDiagnostics,
    userAdmin,
    fileUploads,
    appSettings,
    softwareLicenses,
    notifications,
    getDiagnosticsSnapshot,
    getSupportSnapshot: () => supportDiagnostics.getSupportSnapshot(),
    createBackupNow,
    restoreFromBackupNow,
    runIntegrityCheckNow,
    ensureLocalWorkspaces,
    getLocalWorkspaces,
    runLocalSyncNow,
    getSyncOutboxRows,
    getSyncPullCursors,
    retrySyncOutboxRow,
    retryAllFailedSyncOutboxRows,
    getSyncConflicts,
    resolveSyncConflict,
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

export const initializeLocalDatabaseAsync = async () => {
  if (!runtime) {
    runtime = await createRuntime();
  }

  return runtime;
};

export const getLocalDatabase = () => {
  if (!runtime) {
    throw new Error("Local database has not been initialized");
  }

  return runtime;
};
