export type AppInfo = {
  appName: string;
  platform: string;
  isPackaged: boolean;
  version: string;
  shellVersion: string;
};

export type AppUserRoleRow = {
  id: string;
  key: string;
  name: string;
  description: string;
  isSystemRole: boolean;
  permissionKeys: string[];
  assignedUserCount: number;
};

export type AppUserAdminRow = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  isActive: boolean;
  membershipStatus: "active" | "inactive" | "missing";
  roleId: string | null;
  roleKey: string | null;
  roleName: string | null;
  permissionKeys: string[];
  linkedCrewId: string | null;
  linkedCrewLabel: string | null;
  telegramAccountId: string | null;
  telegramLinkStatus: "linked" | "pending" | "revoked" | "none";
  telegramDisplayName: string | null;
  telegramUsername: string | null;
  telegramExternalUserId: string | null;
  telegramLinkedAt: string | null;
  telegramLastSeenAt: string | null;
  readyForTelegram: boolean;
};

export type AppUsersSnapshot = {
  users: AppUserAdminRow[];
  roles: AppUserRoleRow[];
};

export type AppUserMutationResult = {
  summary: string;
  snapshot: AppUsersSnapshot;
  userId: string | null;
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

export type EnsureLocalWorkspaceInput = {
  id: string;
  name: string;
  slug: string;
  baseCurrency: string;
  iconColor?: string | null;
};

export type AppActionResult = {
  summary: string;
  diagnostics: AppDiagnosticsSnapshot;
};

export type AppExportResult = {
  saved: boolean;
  fileName: string | null;
  savedPath: string | null;
  summary: string;
};

export type AppLogFileSummary = {
  name: string;
  sizeBytes: number;
  updatedAt: string;
};

export type AppSupportEventSummary = {
  id: string;
  occurredAt: string;
  sourceKind: "main" | "renderer" | "webcontents";
  processLabel: string;
  errorName: string;
  message: string;
  severity: "low" | "medium" | "critical";
  fingerprint: string;
};

export type AppSupportSnapshot = {
  diagnostics: AppDiagnosticsSnapshot;
  appInfo: AppInfo;
  recentLogFiles: AppLogFileSummary[];
  logStorageLabel: string;
  lastCrash: AppSupportEventSummary | null;
  lastError: AppSupportEventSummary | null;
  lastLoadFailure: AppSupportEventSummary | null;
  recentCriticalEvents: AppSupportEventSummary[];
};
