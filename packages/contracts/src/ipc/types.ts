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

export type AppUsersSnapshotQuery = {
  workspaceId?: string;
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

export type AppSyncPullCursorRow = {
  workspaceId: string;
  entityType: string;
  lastSyncedAt: string | null;
  lastPulledCount: number;
  lastError: string | null;
  updatedAt: string;
};

export type EnsureLocalWorkspaceInput = {
  id: string;
  name: string;
  slug: string;
  baseCurrency: string;
  iconColor?: string | null;
};

export type AppLocalWorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  baseCurrency: string;
};

export type AppActionResult = {
  summary: string;
  diagnostics: AppDiagnosticsSnapshot;
};

export type CatalogPullEntityType = "asset_categories" | "locations" | "clients" | "manufacturers" | "production_companies";

export type AppRemoteCatalogRow = {
  id: string;
  workspace_id: string;
  code: string;
  name: string;
  description?: string | null;
  parent_category_id?: string | null;
  type?: string | null;
  is_active?: boolean | null;
  updated_at: string;
};

export type AppApplyRemoteCatalogRowsCommand = {
  workspaceId: string;
  entityType: CatalogPullEntityType;
  rows: AppRemoteCatalogRow[];
};

export type AppApplyRemoteCatalogRowsResult = {
  entityType: CatalogPullEntityType;
  workspaceId: string;
  appliedCount: number;
  skippedDueToOutboxCount: number;
  skippedDueToOlderCount: number;
  errors: string[];
  cursorAfter: string | null;
};

export type AppRemoteAssetSnapshotRow = {
  id: string;
  workspace_id: string;
  category_id: string;
  name: string;
  brand?: string | null;
  model?: string | null;
  serial_number?: string | null;
  internal_code: string;
  description?: string | null;
  purchase_date?: string | null;
  purchase_price?: number | null;
  additional_costs?: number | null;
  currency?: string | null;
  replacement_value?: number | null;
  current_book_value?: number | null;
  ownership_type?: string | null;
  default_location_id?: string | null;
  qr_code_value?: string | null;
  notes?: string | null;
  is_active?: boolean | null;
  created_at: string;
  updated_at: string;
};

export type AppRemoteAssetCurrentStateRow = {
  asset_id: string;
  workspace_id: string;
  current_location_id?: string | null;
  current_project_id?: string | null;
  current_department_id?: string | null;
  current_responsible_user_id?: string | null;
  active_assignment_id?: string | null;
  condition_status: string;
  operational_status: string;
  custody_status: string;
  last_event_id: string;
  version?: number | null;
  updated_at: string;
  project_unit_id?: string | null;
  total_quantity?: number | null;
  available_quantity?: number | null;
  assigned_quantity?: number | null;
  checked_out_quantity?: number | null;
};

export type AppApplyRemoteAssetSnapshotsCommand = {
  workspaceId: string;
  assets: AppRemoteAssetSnapshotRow[];
  states: AppRemoteAssetCurrentStateRow[];
};

export type AppApplyRemoteAssetSnapshotsResult = {
  workspaceId: string;
  appliedCount: number;
  skippedDueToOutboxCount: number;
  skippedDueToOlderCount: number;
  missingAssetCount: number;
  errors: string[];
  cursorAfter: string | null;
};

export type AppRemoteExchangeRateRow = {
  id: string;
  workspace_id: string;
  base_currency: string;
  quote_currency: string;
  rate: number;
  rate_type: string;
  source: string;
  source_label: string | null;
  effective_date: string;
  fetched_at: string | null;
  created_by_user_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at?: string;
};

export type AppApplyRemoteExchangeRatesCommand = {
  workspaceId: string;
  rows: AppRemoteExchangeRateRow[];
};

export type AppApplyRemoteExchangeRatesResult = {
  workspaceId: string;
  appliedCount: number;
  skippedDueToOutboxCount: number;
  errors: string[];
  cursorAfter: string | null;
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
