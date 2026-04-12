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
  encryptionAvailable: boolean;
  internalBuildArtifacts: string[];
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
