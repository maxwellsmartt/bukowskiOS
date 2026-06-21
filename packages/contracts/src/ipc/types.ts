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
  databaseEncrypted: boolean;
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

export type AppSyncStatusSnapshot = {
  diagnostics: AppDiagnosticsSnapshot;
  pullCursors: AppSyncPullCursorRow[];
};

export type EnsureLocalWorkspaceInput = {
  id: string;
  name: string;
  slug: string;
  baseCurrency: string;
  iconColor?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  roleKey?: string | null;
  roleName?: string | null;
  permissions?: string[];
};

export type AppLocalWorkspaceRow = {
  id: string;
  name: string;
  slug: string;
  baseCurrency: string;
  roleKey?: string | null;
  roleName?: string | null;
  permissions?: string[];
};

export type AppActionResult = {
  summary: string;
  diagnostics: AppDiagnosticsSnapshot;
};

export type AppOperationalBackfillCommand = {
  workspaceId: string;
};

export type AppCreateRemoteWorkspaceCommand = {
  name: string;
  slug: string;
  baseCurrency: string;
  iconColor?: string | null;
};

export type AppCreateRemoteWorkspaceResult = {
  workspaceId: string;
};

export type AppSendWorkspaceInviteCommand = {
  workspaceId: string;
  email: string;
  roleId: string;
  message?: string | null;
};

export type AppSendWorkspaceInviteResult = {
  alreadyRegistered: boolean;
  magicLinkSent: boolean;
  membershipStatus: "active" | "invited";
  warning: string | null;
  userId: string;
};

export type AppUpsertUserProfileCommand = {
  avatarUrl?: string | null;
  fullName?: string | null;
};

export type AppTrustedImageUploadFile = {
  fileName: string;
  contentType: string;
  bytes: ArrayBuffer;
};

export type AppUploadUserAvatarCommand = AppTrustedImageUploadFile;

export type AppUploadWorkspaceImageAssetCommand = AppTrustedImageUploadFile & {
  workspaceId: string;
  assetKind: "avatar" | "logo" | "seal" | "signature";
};

export type AppStorageUploadResult = {
  publicUrl: string;
  objectPath: string;
};

export type AppUpdateRemoteWorkspaceIdentityCommand = {
  workspaceId: string;
  name?: string;
  baseCurrency?: string;
  iconColor?: string | null;
  avatarUrl?: string | null;
};

export type AppUpdateWorkspaceMemberRoleCommand = {
  workspaceId: string;
  userId: string;
  roleId: string;
};

export type AppSetWorkspaceMemberStatusCommand = {
  workspaceId: string;
  userId: string;
  status: "active" | "inactive";
};

export type AppRevokeWorkspaceInviteCommand = {
  workspaceId: string;
  membershipId: string;
};

export type AppCreateCustomRoleCommand = {
  workspaceId: string;
  key: string;
  name: string;
  description: string;
};

export type AppCreateCustomRoleResult = {
  roleId: string;
};

export type AppUpdateCustomRoleCommand = {
  workspaceId: string;
  roleId: string;
  name: string;
  description: string;
};

export type AppDeleteCustomRoleCommand = {
  workspaceId: string;
  roleId: string;
};

export type AppSetRolePermissionCommand = {
  workspaceId: string;
  roleId: string;
  permissionId: string;
  enabled: boolean;
};

export type AppOperationalBackfillResult = AppActionResult & {
  enqueuedCount: number;
  skippedCount: number;
  byEntityType: Array<{
    entityType: OperationalSnapshotEntityType;
    scannedCount: number;
    enqueuedCount: number;
    skippedCount: number;
  }>;
};

export type CatalogPullEntityType =
  | "asset_categories"
  | "locations"
  | "clients"
  | "manufacturers"
  | "production_companies"
  | "crew_members"
  | "departments";

export type AppRemoteCatalogRow = {
  id: string;
  workspace_id: string;
  code?: string | null;
  name?: string | null;
  description?: string | null;
  parent_category_id?: string | null;
  type?: string | null;
  is_active?: boolean | number | null;
  updated_at: string;
  // Business-catalog fields (clients / manufacturers / production_companies).
  contact_name?: string | null;
  email?: string | null;
  support_email?: string | null;
  phone?: string | null;
  rnc?: string | null;
  pur?: string | null;
  notes?: string | null;
  // crew_members
  full_name?: string | null;
  role_label?: string | null;
  default_daily_rate?: number | null;
  default_weekly_rate?: number | null;
  default_overtime_rate?: number | null;
  rate_currency?: string | null;
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

export type AppRemoteSyncTombstone = {
  workspace_id: string;
  table_name: string;
  entity_id: string;
  deleted_at: string;
};

export type AppApplyRemoteSyncTombstonesCommand = {
  workspaceId: string;
  rows: AppRemoteSyncTombstone[];
};

export type AppApplyRemoteSyncTombstonesResult = {
  workspaceId: string;
  appliedCount: number;
  skippedDueToOutboxCount: number;
  errors: string[];
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

export type OperationalSnapshotEntityType = "project" | "packing_slip" | "incident" | "rma_case";

export type AppRemoteOperationalSnapshotRow = {
  workspace_id: string;
  entity_type: OperationalSnapshotEntityType;
  entity_id: string;
  snapshot_json: Record<string, unknown>;
  updated_at: string;
  deleted_at?: string | null;
};

export type AppApplyRemoteOperationalSnapshotsCommand = {
  workspaceId: string;
  entityType: OperationalSnapshotEntityType;
  rows: AppRemoteOperationalSnapshotRow[];
};

export type AppApplyRemoteOperationalSnapshotsResult = {
  workspaceId: string;
  entityType: OperationalSnapshotEntityType;
  appliedCount: number;
  skippedDueToOutboxCount: number;
  skippedDueToOlderCount: number;
  errors: string[];
  cursorAfter: string | null;
};

export type WorkspaceFileDomain = "assets" | "incidents" | "finance" | "crew";

export type AppRemoteWorkspaceFileRow = {
  id: string;
  workspace_id: string;
  domain: WorkspaceFileDomain;
  entity_id: string;
  storage_object_key: string;
  original_name: string;
  mime_type: string;
  byte_size: number;
  content_hash?: string | null;
  status: "pending_upload" | "available" | "missing" | "deleted";
  created_by_user_id?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
};

export type AppApplyRemoteWorkspaceFilesCommand = {
  workspaceId: string;
  rows: AppRemoteWorkspaceFileRow[];
  pullError?: string | null;
};

export type AppApplyRemoteWorkspaceFilesResult = {
  workspaceId: string;
  appliedCount: number;
  skippedDueToOutboxCount: number;
  errors: string[];
  cursorAfter: string | null;
};

export type TreasuryPullTable =
  | "bank_accounts"
  | "bank_statement_imports"
  | "bank_transactions"
  | "transaction_annotations"
  | "transaction_project_allocations"
  | "transaction_links"
  | "counterparty_rules";

export type CollaboratorPaymentPullTable =
  | "collaborator_fees"
  | "collaborator_payment_batches"
  | "collaborator_fee_payments";

export type FinanceBusinessPullTable =
  | "currency_settings"
  | "quotes"
  | "quote_items"
  | "quote_versions"
  | "invoices"
  | "invoice_items"
  | "invoice_payments"
  | "invoice_extractions"
  | "financial_entries"
  | "software_licenses";

export type AppApplyRemoteFinancialRowsResult<TTable extends string = string> = {
  workspaceId: string;
  table: TTable;
  appliedCount: number;
  skippedDueToOutboxCount: number;
  skippedDueToOlderCount: number;
  skippedDueToDependencyCount: number;
  errors: string[];
  cursorAfter: string | null;
};

export type AppApplyRemoteTreasuryRowsCommand = {
  workspaceId: string;
  table: TreasuryPullTable;
  rows: Array<Record<string, unknown>>;
};

export type AppApplyRemoteTreasuryRowsResult = AppApplyRemoteFinancialRowsResult<TreasuryPullTable>;

export type AppApplyRemoteCollaboratorPaymentRowsCommand = {
  workspaceId: string;
  table: CollaboratorPaymentPullTable;
  rows: Array<Record<string, unknown>>;
};

export type AppApplyRemoteCollaboratorPaymentRowsResult =
  AppApplyRemoteFinancialRowsResult<CollaboratorPaymentPullTable>;

export type AppApplyRemoteFinanceBusinessRowsCommand = {
  workspaceId: string;
  table: FinanceBusinessPullTable;
  rows: Array<Record<string, unknown>>;
  /**
   * Child rows for tables that own a join (currently invoice_extractions →
   * invoice_extraction_projects). The pull replaces each applied parent's full
   * child set from this, so project-tag adds/removes propagate across machines.
   */
  childRows?: Array<Record<string, unknown>>;
};

export type AppApplyRemoteFinanceBusinessRowsResult =
  AppApplyRemoteFinancialRowsResult<FinanceBusinessPullTable>;

export type AutomationControlPlanePullEntityType = "agents" | "ai_provider_configs" | "agent_connector_configs";

export type AppRemoteAutomationControlPlaneRow = Record<string, unknown> & {
  id: string;
  workspace_id: string;
  updated_at: string;
};

export type AppApplyRemoteAutomationControlPlaneRowsCommand = {
  workspaceId: string;
  entityType: AutomationControlPlanePullEntityType;
  rows: AppRemoteAutomationControlPlaneRow[];
};

export type AppApplyRemoteAutomationControlPlaneRowsResult = {
  workspaceId: string;
  entityType: AutomationControlPlanePullEntityType;
  appliedCount: number;
  skippedDueToOutboxCount: number;
  skippedDueToOlderCount: number;
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

export type AppPrintResult = {
  printed: boolean;
  fileName: string | null;
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
