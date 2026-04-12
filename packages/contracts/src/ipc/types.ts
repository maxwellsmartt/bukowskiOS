export type AppInfo = {
  appName: string;
  platform: string;
  isPackaged: boolean;
  version: string;
  shellVersion: string;
};

export type AppDiagnosticsSnapshot = {
  databaseSizeBytes: number;
  backupSizeBytes: number;
  databaseExists: boolean;
  backupExists: boolean;
  lastBackupAt: string | null;
  lastIntegrityCheckAt: string | null;
  lastIntegrityCheckStatus: "healthy" | "failed" | "never";
  lastRetentionRunAt: string | null;
  lastRetentionSummary: string | null;
  lastSyncRunAt: string | null;
  lastSyncSummary: string | null;
  lastSyncStatus: "healthy" | "failed" | "idle";
  syncOutboxPendingCount: number;
  syncOutboxProcessingCount: number;
  syncOutboxFailedCount: number;
  encryptionAvailable: boolean;
  internalBuildArtifacts: string[];
};

export type AppSyncOutboxRow = {
  id: string;
  entityType: string;
  entityId: string;
  operationType: string;
  status: "pending" | "processing" | "failed" | "sent";
  attemptCount: number;
  lastError: string | null;
  nextRetryAt: string | null;
  updatedAt: string;
  payloadJson: string;
};

export type AppActionResult = {
  summary: string;
  diagnostics: AppDiagnosticsSnapshot;
};

export type AppExportResult = {
  saved: boolean;
  fileName: string | null;
  summary: string;
};
