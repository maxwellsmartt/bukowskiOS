/// <reference types="vite/client" />

import type {
  AIProviderMutationResult,
  AssistantAudioTranscriptionResult,
  AssistantChatSnapshot,
  AssistantGatewayRequest,
  AssistantGatewayResponse,
  AgentConnectorRow,
  AgentDetailSnapshot,
  AgentModelRow,
  AgentModelsSnapshot,
  AgentMutationResult,
  ConnectorMutationResult,
  AgentRosterRow,
  AgentRunRow,
  AddDepartmentToProjectUnitInput,
  ArchiveAssetCommand,
  ArchiveProjectInput,
  AssetListQuery,
  AssetWorkspaceQuery,
  AssignAgentModelCommand,
  AssignCrewToProjectUnitInput,
  AssignMoveAssetsInput,
  AssignMoveAssetsResult,
  AppActionResult,
  AppApplyRemoteCollaboratorPaymentRowsCommand,
  AppApplyRemoteCollaboratorPaymentRowsResult,
  AppApplyRemoteAutomationControlPlaneRowsCommand,
  AppApplyRemoteAutomationControlPlaneRowsResult,
  AppApplyRemoteFinanceBusinessRowsCommand,
  AppApplyRemoteFinanceBusinessRowsResult,
  AppApplyRemoteAssetSnapshotsCommand,
  AppApplyRemoteAssetSnapshotsResult,
  AppApplyRemoteWorkspaceFilesCommand,
  AppApplyRemoteWorkspaceFilesResult,
  AppApplyRemoteCatalogRowsCommand,
  AppApplyRemoteCatalogRowsResult,
  AppApplyRemoteTreasuryRowsCommand,
  AppApplyRemoteTreasuryRowsResult,
  AppDiagnosticsSnapshot,
  AppExportResult,
  AppPrintResult,
  AppInfo,
  AppLocalWorkspaceRow,
  AppOperationalBackfillCommand,
  AppOperationalBackfillResult,
  AppSupportSnapshot,
  AppSyncPullCursorRow,
  AppSyncOutboxRow,
  EnsureLocalWorkspaceInput,
  AppUserMutationResult,
  AppUsersSnapshot,
  AppUsersSnapshotQuery,
  AssetsOverviewSnapshot,
  CreateAgentCommand,
  CreateAppUserCommand,
  DeleteAppUserCommand,
  CreateAssistantThreadCommand,
  CreateConnectorLinkTokenCommand,
  AssetDetailSnapshot,
  AssetEditorMutationResult,
  FileDeleteMutationResult,
  FileUploadMutationResult,
  AssetListRow,
  AssetSummarySnapshot,
  CatalogCsvImportPreview,
  CatalogCsvImportResult,
  DeleteCatalogEntitiesInput,
  ExportCatalogCsvInput,
  ExportPackingSlipInsurancePdfInput,
  ImportCatalogCsvInput,
  CatalogListQuery,
  CatalogSnapshot,
  CreateAssetCommand,
  CreateCatalogEntityInput,
  CreateFinancialEntryCommand,
  CreateDraftRunFromChatCommand,
  CreatePackingSlipCommand,
  CreatePackingSlipResult,
  CreateProjectBlueprintInput,
  CreateProjectBlueprintResult,
  CreateProjectInput,
  CreateProjectUnitInput,
  CreateRmaCaseCommand,
  DeleteAssistantThreadCommand,
  DeleteCatalogEntityInput,
  PreviewCatalogCsvImportInput,
  DeleteProjectInput,
  DeleteProjectUnitInput,
  RemoveDepartmentFromProjectUnitInput,
  DraftRunFromChatResult,
  FinanceCostLinkRow,
  FinanceEntryListQuery,
  FinanceEntryMutationResult,
  FinanceEntryRow,
  FinancialDocumentRow,
  FinanceOverviewQuery,
  FinanceOverviewSnapshot,
  GlobalSearchGroup,
  GlobalSearchQuery,
  IncidentDetailSnapshot,
  IncidentMutationResult,
  IncidentListQuery,
  IncidentListRow,
  MissionControlSnapshot,
  OverviewSnapshot,
  PackingSlipDetailSnapshot,
  PackingSlipListQuery,
  PackingSlipRow,
  ProjectCardRow,
  ProjectCreationConflictsSnapshot,
  ProjectDeletePreview,
  ProjectDetailSnapshot,
  ProjectListQuery,
  RevokeTelegramLinkCommand,
  ReportIncidentCommand,
  ReportIncidentResult,
  ResolveIncidentCommand,
  ReviewAgentRunCommand,
  RequestAgentPermissionCommand,
  RequestAgentPermissionResult,
  RefreshAIProviderModelsCommand,
  AgentRunReviewResult,
  ReturnPackingSlipItemsCommand,
  ReturnPackingSlipItemsResult,
  RmaCaseDetailSnapshot,
  RmaCaseMutationResult,
  RmaSnapshotQuery,
  RmaSnapshot,
  SaveAIProviderConfigCommand,
  SaveConnectorConfigCommand,
  ScheduleTimelinePagination,
  ScheduleTimelineQuery,
  ScheduleTimelineRange,
  ScheduleTimelineScale,
  ScheduleTimelineSnapshot,
  SetAgentApprovalModeCommand,
  SetActiveAssistantThreadCommand,
  SetAgentStatusCommand,
  SetAppUserActiveCommand,
  ShellAppAction,
  ShellBootstrap,
  SendAssistantChatTurnCommand,
  TranscribeAssistantAudioCommand,
  TestAIProviderConnectionCommand,
  TestConnectorConnectionCommand,
  UnassignCrewFromProjectUnitInput,
  UpdateAgentCommand,
  UpdateAssetCommand,
  RenameAssistantThreadCommand,
  UpdateAssistantThreadPreferencesCommand,
  UpdateCatalogEntityInput,
  UpdateFinancialEntryCommand,
  UpdateIncidentCommand,
  UpdateAppUserCommand,
  UpdateProjectInput,
  UpdateProjectUnitInput,
  UpdateRmaCaseCommand,
  StagingPackingSlipRow,
  UnarchiveProjectInput,
} from "@contracts";

declare global {
  interface Window {
    bukowskiApp?: {
      getAppInfo: () => Promise<AppInfo>;
      getDiagnostics: () => Promise<AppDiagnosticsSnapshot>;
      getSupportSnapshot: () => Promise<AppSupportSnapshot>;
      getUsersSnapshot: (query?: AppUsersSnapshotQuery) => Promise<AppUsersSnapshot>;
      createBackup: () => Promise<AppActionResult>;
      restoreBackup: () => Promise<AppActionResult>;
      createUser: (input: CreateAppUserCommand) => Promise<AppUserMutationResult>;
      updateUser: (input: UpdateAppUserCommand) => Promise<AppUserMutationResult>;
      setUserActive: (input: SetAppUserActiveCommand) => Promise<AppUserMutationResult>;
      revokeTelegramLink: (input: RevokeTelegramLinkCommand) => Promise<AppUserMutationResult>;
      deleteUser: (input: DeleteAppUserCommand) => Promise<AppUserMutationResult>;
      ensureLocalWorkspaces: (workspaces: EnsureLocalWorkspaceInput[]) => Promise<AppActionResult>;
      getLocalWorkspaces: (query?: { userId?: string | null }) => Promise<AppLocalWorkspaceRow[]>;
      createRemoteWorkspace: (
        input: import("@contracts").AppCreateRemoteWorkspaceCommand,
      ) => Promise<import("@contracts").AppCreateRemoteWorkspaceResult>;
      sendWorkspaceInvite: (
        input: import("@contracts").AppSendWorkspaceInviteCommand,
      ) => Promise<import("@contracts").AppSendWorkspaceInviteResult>;
      upsertUserProfile: (input: import("@contracts").AppUpsertUserProfileCommand) => Promise<void>;
      uploadUserAvatar: (
        input: import("@contracts").AppUploadUserAvatarCommand,
      ) => Promise<import("@contracts").AppStorageUploadResult>;
      uploadWorkspaceImageAsset: (
        input: import("@contracts").AppUploadWorkspaceImageAssetCommand,
      ) => Promise<import("@contracts").AppStorageUploadResult>;
      updateRemoteWorkspaceIdentity: (
        input: import("@contracts").AppUpdateRemoteWorkspaceIdentityCommand,
      ) => Promise<void>;
      updateWorkspaceMemberRole: (
        input: import("@contracts").AppUpdateWorkspaceMemberRoleCommand,
      ) => Promise<void>;
      setWorkspaceMemberStatus: (
        input: import("@contracts").AppSetWorkspaceMemberStatusCommand,
      ) => Promise<void>;
      revokeWorkspaceInvite: (input: import("@contracts").AppRevokeWorkspaceInviteCommand) => Promise<void>;
      createCustomRole: (
        input: import("@contracts").AppCreateCustomRoleCommand,
      ) => Promise<import("@contracts").AppCreateCustomRoleResult>;
      updateCustomRole: (input: import("@contracts").AppUpdateCustomRoleCommand) => Promise<void>;
      deleteCustomRole: (input: import("@contracts").AppDeleteCustomRoleCommand) => Promise<void>;
      setRolePermission: (input: import("@contracts").AppSetRolePermissionCommand) => Promise<void>;
      runIntegrityCheck: () => Promise<AppActionResult>;
      runLocalSync: () => Promise<AppActionResult>;
      getSyncOutboxRows: () => Promise<AppSyncOutboxRow[]>;
      getSyncPullCursors: () => Promise<AppSyncPullCursorRow[]>;
      getSyncStatusSnapshot: () => Promise<import("@contracts").AppSyncStatusSnapshot>;
      retrySyncOutboxRow: (id: string) => Promise<AppActionResult>;
      retryAllFailedSyncOutboxRows: () => Promise<AppActionResult>;
      getSyncConflicts: (workspaceId: string) => Promise<import("@contracts").AppSyncConflictRow[]>;
      resolveSyncConflict: (
        command: import("@contracts").AppSyncConflictResolveCommand,
      ) => Promise<import("@contracts").AppSyncConflictResolveResult>;
      backfillOperationalSnapshots: (
        input: AppOperationalBackfillCommand,
      ) => Promise<AppOperationalBackfillResult>;
      exportWorkspaceData: () => Promise<AppExportResult>;
      exportSupportBundle: () => Promise<AppExportResult>;
      exportRecentLogs: () => Promise<AppExportResult>;
      openExternal: (url: string) => Promise<void>;
      revealLogFile: (name: string) => Promise<void>;
      writeClipboard: (text: string) => Promise<void>;
      getDocumentsRoot: () => Promise<{ root: string; isCustom: boolean; defaultRoot: string }>;
      chooseDocumentsRoot: () => Promise<{ root: string; isCustom: boolean; defaultRoot: string }>;
      resetDocumentsRoot: () => Promise<{ root: string; isCustom: boolean; defaultRoot: string }>;
      applyRemoteCatalogRows: (
        input: AppApplyRemoteCatalogRowsCommand,
      ) => Promise<AppApplyRemoteCatalogRowsResult>;
      applyRemoteSyncTombstones: (
        input: import("@contracts").AppApplyRemoteSyncTombstonesCommand,
      ) => Promise<import("@contracts").AppApplyRemoteSyncTombstonesResult>;
      applyRemoteExchangeRates: (
        input: import("@contracts").AppApplyRemoteExchangeRatesCommand,
      ) => Promise<import("@contracts").AppApplyRemoteExchangeRatesResult>;
      applyRemoteAssetSnapshots: (
        input: AppApplyRemoteAssetSnapshotsCommand,
      ) => Promise<AppApplyRemoteAssetSnapshotsResult>;
      applyRemoteOperationalSnapshots: (
        input: import("@contracts").AppApplyRemoteOperationalSnapshotsCommand,
      ) => Promise<import("@contracts").AppApplyRemoteOperationalSnapshotsResult>;
      applyRemoteWorkspaceFiles: (
        input: AppApplyRemoteWorkspaceFilesCommand,
      ) => Promise<AppApplyRemoteWorkspaceFilesResult>;
      applyRemoteTreasuryRows: (
        input: AppApplyRemoteTreasuryRowsCommand,
      ) => Promise<AppApplyRemoteTreasuryRowsResult>;
      applyRemoteCollaboratorPaymentRows: (
        input: AppApplyRemoteCollaboratorPaymentRowsCommand,
      ) => Promise<AppApplyRemoteCollaboratorPaymentRowsResult>;
      applyRemoteFinanceBusinessRows: (
        input: AppApplyRemoteFinanceBusinessRowsCommand,
      ) => Promise<AppApplyRemoteFinanceBusinessRowsResult>;
      applyRemoteAutomationControlPlaneRows: (
        input: AppApplyRemoteAutomationControlPlaneRowsCommand,
      ) => Promise<AppApplyRemoteAutomationControlPlaneRowsResult>;
    };
    bukowskiAuth?: {
      getAccessToken: () => Promise<string | null>;
      getOAuthRedirectUrl: () => Promise<string>;
      getAvatarDataUrl: (url: string) => Promise<string | null>;
      getStoredAvatar: (userId: string) => Promise<string | null>;
      cacheAvatar: (input: { userId: string; dataUrl: string }) => Promise<boolean>;
      clearStoredAvatar: (userId: string) => Promise<boolean>;
      updateUser: (input: { password?: string; data?: Record<string, unknown> }) => Promise<unknown>;
      setStoredTokens: (tokens: {
        accessToken: string | null;
        refreshToken: string | null;
        remember?: boolean;
      }) => Promise<void>;
      clearStoredTokens: () => Promise<void>;
    };
    bukowskiNotifications?: {
      list: (query: import("@contracts").NotificationListQuery) => Promise<import("@contracts").NotificationRow[]>;
      create: (input: import("@contracts").NotificationCreateCommand) => Promise<import("@contracts").NotificationRow>;
      markRead: (input: import("@contracts").NotificationMarkReadCommand) => Promise<void>;
      markAllRead: (input: import("@contracts").NotificationMarkAllReadCommand) => Promise<void>;
      listTodos: (query: import("@contracts").NotificationListQuery) => Promise<import("@contracts").TodoRow[]>;
      createTodo: (input: import("@contracts").TodoCreateCommand) => Promise<import("@contracts").TodoRow>;
      updateTodo: (input: import("@contracts").TodoUpdateCommand) => Promise<void>;
      deleteTodo: (input: { userId: string; workspaceId: string; id: string }) => Promise<void>;
      listReminders: (query: import("@contracts").NotificationListQuery) => Promise<import("@contracts").ReminderRow[]>;
      createReminder: (input: import("@contracts").ReminderCreateCommand) => Promise<import("@contracts").ReminderRow>;
      updateReminder: (input: import("@contracts").ReminderUpdateCommand) => Promise<void>;
      deleteReminder: (input: { userId: string; workspaceId: string; id: string }) => Promise<void>;
      applyRemoteRows: (input: { table: "notifications" | "todos" | "reminders"; rows: Record<string, unknown>[] }) => Promise<void>;
      reconcileRemoteRows: (input: { table: "todos" | "reminders"; userId: string; workspaceId: string; remoteIds: string[] }) => Promise<number>;
      showNative: (input: import("@contracts").ShowNativeNotificationCommand) => Promise<void>;
      setDockBadge: (count: number) => Promise<void>;
      getForegroundState: () => Promise<{
        isForeground: boolean;
        isSupported: boolean;
        permissionStatus: "unknown" | "unsupported";
      }>;
    };
    bukowskiShell?: {
      getBootstrap: () => Promise<ShellBootstrap>;
      searchGlobal: (query: GlobalSearchQuery) => Promise<GlobalSearchGroup[]>;
      onAppAction: (listener: (action: ShellAppAction) => void) => () => void;
    };
    bukowskiAgents?: {
      getMissionControlSnapshot: (query?: { workspaceId?: string }) => Promise<MissionControlSnapshot>;
      getAgentsList: (query?: { workspaceId?: string }) => Promise<AgentRosterRow[]>;
      getAgentDetail: (agentId: string, query?: { workspaceId?: string }) => Promise<AgentDetailSnapshot>;
      getRunsList: (query?: { workspaceId?: string }) => Promise<AgentRunRow[]>;
      getModelsSnapshot: (query?: { workspaceId?: string }) => Promise<AgentModelsSnapshot>;
      getAIProviderConfigs: (query?: { workspaceId?: string }) => Promise<AgentModelRow[]>;
      getConnectorsSnapshot: (query?: { workspaceId?: string }) => Promise<AgentConnectorRow[]>;
      getAssistantChatSnapshot: (workspaceId?: string | null) => Promise<AssistantChatSnapshot>;
      create: (input: CreateAgentCommand) => Promise<AgentMutationResult>;
      update: (input: UpdateAgentCommand) => Promise<AgentMutationResult>;
      setStatus: (input: SetAgentStatusCommand) => Promise<AgentMutationResult>;
      setApprovalMode: (input: SetAgentApprovalModeCommand) => Promise<AgentMutationResult>;
      saveAIProviderConfig: (input: SaveAIProviderConfigCommand) => Promise<AIProviderMutationResult>;
      refreshAIProviderModels: (input: RefreshAIProviderModelsCommand) => Promise<AIProviderMutationResult>;
      saveConnectorConfig: (input: SaveConnectorConfigCommand) => Promise<ConnectorMutationResult>;
      testAIProviderConnection: (input: TestAIProviderConnectionCommand) => Promise<AIProviderMutationResult>;
      testConnectorConnection: (input: TestConnectorConnectionCommand) => Promise<ConnectorMutationResult>;
      createConnectorLinkToken: (input: CreateConnectorLinkTokenCommand) => Promise<ConnectorMutationResult>;
      assignAgentModel: (input: AssignAgentModelCommand) => Promise<AgentMutationResult>;
      createAssistantThread: (input: CreateAssistantThreadCommand) => Promise<AssistantChatSnapshot>;
      deleteAssistantThread: (input: DeleteAssistantThreadCommand) => Promise<AssistantChatSnapshot>;
      setActiveAssistantThread: (input: SetActiveAssistantThreadCommand) => Promise<AssistantChatSnapshot>;
      updateAssistantThreadPreferences: (input: UpdateAssistantThreadPreferencesCommand) => Promise<AssistantChatSnapshot>;
      renameAssistantThread: (input: RenameAssistantThreadCommand) => Promise<AssistantChatSnapshot>;
      sendAssistantChatTurn: (input: SendAssistantChatTurnCommand) => Promise<AssistantChatSnapshot>;
      transcribeAudio: (input: TranscribeAssistantAudioCommand) => Promise<AssistantAudioTranscriptionResult>;
      reviewRun: (input: ReviewAgentRunCommand) => Promise<AgentRunReviewResult>;
      requestAgentPermission: (input: RequestAgentPermissionCommand) => Promise<RequestAgentPermissionResult>;
      sendAssistantMessage: (input: AssistantGatewayRequest) => Promise<AssistantGatewayResponse>;
      createDraftRunFromChat: (input: CreateDraftRunFromChatCommand) => Promise<DraftRunFromChatResult>;
    };
    bukowskiOverview?: {
      getSnapshot: () => Promise<OverviewSnapshot>;
      getTimeline: (
        range: ScheduleTimelineRange,
        scale: ScheduleTimelineScale,
        anchorDate?: string,
        query?: ScheduleTimelineQuery,
      ) => Promise<ScheduleTimelineSnapshot>;
    };
    bukowskiAssets?: {
      getList: (query?: AssetListQuery) => Promise<AssetListRow[]>;
      getSummary: (query?: AssetWorkspaceQuery) => Promise<AssetSummarySnapshot>;
      getOverview: (query?: AssetWorkspaceQuery) => Promise<AssetsOverviewSnapshot>;
      getDetail: (assetId: string) => Promise<AssetDetailSnapshot>;
      uploadFiles: (assetId: string) => Promise<FileUploadMutationResult>;
      uploadImages: (assetId: string) => Promise<FileUploadMutationResult>;
      openFile: (fileId: string) => Promise<void>;
      deleteFile: (fileId: string) => Promise<FileDeleteMutationResult>;
      assignMove: (input: AssignMoveAssetsInput) => Promise<AssignMoveAssetsResult>;
      create: (input: CreateAssetCommand) => Promise<AssetEditorMutationResult>;
      update: (input: UpdateAssetCommand) => Promise<AssetEditorMutationResult>;
      archive: (input: ArchiveAssetCommand) => Promise<AssetEditorMutationResult>;
    };
    bukowskiPacking?: {
      getList: (query?: PackingSlipListQuery) => Promise<PackingSlipRow[]>;
      getDetail: (packingSlipId: string) => Promise<PackingSlipDetailSnapshot>;
      exportPdf: (packingSlipId: string) => Promise<AppExportResult>;
      exportInsurancePdf: (input: ExportPackingSlipInsurancePdfInput) => Promise<AppExportResult>;
      printPdf: (packingSlipId: string) => Promise<AppPrintResult>;
      printInsurancePdf: (input: ExportPackingSlipInsurancePdfInput) => Promise<AppPrintResult>;
      create: (input: CreatePackingSlipCommand) => Promise<CreatePackingSlipResult>;
      returnItems: (input: ReturnPackingSlipItemsCommand) => Promise<ReturnPackingSlipItemsResult>;
    };
    bukowskiIncidents?: {
      getList: (query?: IncidentListQuery) => Promise<IncidentListRow[]>;
      getDetail: (incidentId: string) => Promise<IncidentDetailSnapshot>;
      uploadFiles: (incidentId: string) => Promise<FileUploadMutationResult>;
      openFile: (fileId: string) => Promise<void>;
      report: (input: ReportIncidentCommand) => Promise<ReportIncidentResult>;
      update: (input: UpdateIncidentCommand) => Promise<IncidentMutationResult>;
      resolve: (input: ResolveIncidentCommand) => Promise<IncidentMutationResult>;
    };
    bukowskiProjects?: {
      getList: (query?: ProjectListQuery) => Promise<ProjectCardRow[]>;
      getDetail: (projectId: string) => Promise<ProjectDetailSnapshot>;
      getDeletePreview: (projectId: string) => Promise<ProjectDeletePreview>;
      getCatalog: (query?: AssetWorkspaceQuery) => Promise<CatalogSnapshot>;
      getStagingPackingSlips: () => Promise<StagingPackingSlipRow[]>;
      getCreationConflicts: (input: CreateProjectBlueprintInput) => Promise<ProjectCreationConflictsSnapshot>;
      create: (input: CreateProjectInput) => Promise<ProjectCardRow[]>;
      createBlueprint: (input: CreateProjectBlueprintInput) => Promise<CreateProjectBlueprintResult>;
      exportBlueprintPdf: (input: CreateProjectBlueprintInput) => Promise<AppExportResult>;
      update: (input: UpdateProjectInput) => Promise<ProjectCardRow[]>;
      archive: (input: ArchiveProjectInput) => Promise<ProjectCardRow[]>;
      unarchive: (input: UnarchiveProjectInput) => Promise<ProjectCardRow[]>;
      remove: (input: DeleteProjectInput) => Promise<ProjectCardRow[]>;
      createUnit: (input: CreateProjectUnitInput) => Promise<ProjectDetailSnapshot>;
      updateUnit: (input: UpdateProjectUnitInput) => Promise<ProjectDetailSnapshot>;
      removeUnit: (input: DeleteProjectUnitInput) => Promise<ProjectDetailSnapshot>;
      addDepartmentToUnit: (input: AddDepartmentToProjectUnitInput) => Promise<ProjectDetailSnapshot>;
      removeDepartmentFromUnit: (input: RemoveDepartmentFromProjectUnitInput) => Promise<ProjectDetailSnapshot>;
      assignCrewToUnit: (input: AssignCrewToProjectUnitInput) => Promise<ProjectDetailSnapshot>;
      unassignCrewFromUnit: (input: UnassignCrewFromProjectUnitInput) => Promise<ProjectDetailSnapshot>;
    };
    bukowskiFinance?: {
      getOverview: (query?: FinanceOverviewQuery) => Promise<FinanceOverviewSnapshot>;
      exportReportPdf: (query?: FinanceOverviewQuery) => Promise<AppExportResult>;
      printReportPdf: (query?: FinanceOverviewQuery) => Promise<AppPrintResult>;
      getCostLinks: (workspaceId: string) => Promise<FinanceCostLinkRow[]>;
      getEntries: (query?: FinanceEntryListQuery) => Promise<FinanceEntryRow[]>;
      getDocuments: (entryId: string) => Promise<FinancialDocumentRow[]>;
      uploadDocuments: (entryId: string) => Promise<FileUploadMutationResult>;
      openDocument: (fileId: string) => Promise<void>;
      create: (input: CreateFinancialEntryCommand) => Promise<FinanceEntryMutationResult>;
      update: (input: UpdateFinancialEntryCommand) => Promise<FinanceEntryMutationResult>;
      listCollaboratorFees: (
        query?: import("@contracts").CollaboratorFeeListQuery,
      ) => Promise<import("@contracts").CollaboratorFeeRow[]>;
      getCollaboratorFeeDetail: (
        workspaceId: string,
        feeId: string,
      ) => Promise<import("@contracts").CollaboratorFeeDetail | null>;
      getCollaboratorFeeSummary: (
        workspaceId: string,
        projectId?: string | null,
      ) => Promise<import("@contracts").CollaboratorFeeSummary>;
      suggestCollaboratorFees: (input: {
        workspaceId: string;
        projectId?: string | null;
        crewMemberId?: string | null;
      }) => Promise<import("@contracts").CollaboratorFeeSuggestion[]>;
      createCollaboratorFee: (
        input: import("@contracts").CreateCollaboratorFeeCommand,
      ) => Promise<import("@contracts").CollaboratorFeeMutationResult>;
      updateCollaboratorFee: (
        input: import("@contracts").UpdateCollaboratorFeeCommand,
      ) => Promise<import("@contracts").CollaboratorFeeMutationResult>;
      approveCollaboratorFee: (
        input: import("@contracts").ApproveCollaboratorFeeCommand,
      ) => Promise<import("@contracts").CollaboratorFeeMutationResult>;
      cancelCollaboratorFee: (
        input: import("@contracts").CancelCollaboratorFeeCommand,
      ) => Promise<import("@contracts").CollaboratorFeeMutationResult>;
      recordCollaboratorPayment: (
        input: import("@contracts").RecordCollaboratorPaymentCommand,
      ) => Promise<import("@contracts").CollaboratorFeeMutationResult>;
    };
    bukowskiCurrency?: {
      getSettings: (workspaceId: string) => Promise<import("@contracts").CurrencySettingsRow>;
      listRates: (input: {
        workspaceId: string;
        baseCurrency?: string;
        quoteCurrency?: string;
        limit?: number;
      }) => Promise<import("@contracts").ExchangeRateRow[]>;
      getLatestRate: (input: {
        workspaceId: string;
        baseCurrency: string;
        quoteCurrency: string;
        rateType?: import("@contracts").CurrencyRateType;
      }) => Promise<import("@contracts").ExchangeRateRow | null>;
      upsertSettings: (
        input: import("@contracts").UpsertCurrencySettingsCommand,
      ) => Promise<import("@contracts").CurrencySettingsMutationResult>;
      createRate: (
        input: import("@contracts").CreateExchangeRateCommand,
      ) => Promise<import("@contracts").ExchangeRateMutationResult>;
      deleteRate: (
        input: import("@contracts").DeleteExchangeRateCommand,
      ) => Promise<import("@contracts").ExchangeRateMutationResult>;
      getProviderStatus: (input: {
        workspaceId: string;
        provider: import("@contracts").CurrencyRateProviderKey;
      }) => Promise<import("@contracts").CurrencyRateProviderStatus>;
      saveProviderConfig: (
        input: import("@contracts").SaveCurrencyRateProviderConfigCommand,
      ) => Promise<import("@contracts").CurrencyRateProviderStatus>;
      refreshRates: (
        input: import("@contracts").RefreshCurrencyRatesCommand,
      ) => Promise<import("@contracts").RefreshCurrencyRatesResult>;
    };
    bukowskiQuotes?: {
      list: (filter: import("@contracts").QuoteListFilter) => Promise<import("@contracts").QuoteRow[]>;
      detail: (
        workspaceId: string,
        quoteId: string,
      ) => Promise<import("@contracts").QuoteDetail | null>;
      create: (
        input: import("@contracts").CreateQuoteCommand,
      ) => Promise<import("@contracts").QuoteMutationResult>;
      update: (
        input: import("@contracts").UpdateQuoteCommand,
      ) => Promise<import("@contracts").QuoteMutationResult>;
      setStatus: (
        input: import("@contracts").SetQuoteStatusCommand,
      ) => Promise<import("@contracts").QuoteMutationResult>;
      duplicate: (
        input: import("@contracts").DuplicateQuoteCommand,
      ) => Promise<import("@contracts").QuoteMutationResult>;
      delete: (
        input: import("@contracts").DuplicateQuoteCommand,
      ) => Promise<import("@contracts").QuoteMutationResult>;
      renumber: (
        input: import("@contracts").RenumberQuoteCommand,
      ) => Promise<import("@contracts").QuoteMutationResult>;
      exportPdf: (workspaceId: string, quoteId: string) => Promise<AppExportResult>;
      printPdf: (workspaceId: string, quoteId: string) => Promise<AppPrintResult>;
      listVersions: (
        workspaceId: string,
        quoteId: string,
      ) => Promise<
        Array<{
          id: string;
          versionNumber: number;
          changeSummary: string | null;
          createdAt: string;
          createdByUserId: string | null;
          snapshot: Record<string, unknown>;
        }>
      >;
      restoreVersion: (
        input: import("@contracts").RestoreQuoteFromVersionCommand,
      ) => Promise<import("@contracts").QuoteMutationResult>;
    };
    bukowskiInvoices?: {
      list: (filter: import("@contracts").InvoiceListFilter) => Promise<import("@contracts").InvoiceRow[]>;
      detail: (
        workspaceId: string,
        invoiceId: string,
      ) => Promise<import("@contracts").InvoiceDetail | null>;
      exportPdf: (workspaceId: string, invoiceId: string) => Promise<AppExportResult>;
      printPdf: (workspaceId: string, invoiceId: string) => Promise<AppPrintResult>;
      create: (
        input: import("@contracts").CreateInvoiceCommand,
      ) => Promise<import("@contracts").InvoiceMutationResult>;
      update: (
        input: import("@contracts").UpdateInvoiceCommand,
      ) => Promise<import("@contracts").InvoiceMutationResult>;
      issue: (
        input: import("@contracts").IssueInvoiceCommand,
      ) => Promise<import("@contracts").InvoiceMutationResult>;
      cancel: (
        input: import("@contracts").CancelInvoiceCommand,
      ) => Promise<import("@contracts").InvoiceMutationResult>;
      recordPayment: (
        input: import("@contracts").RecordInvoicePaymentCommand,
      ) => Promise<import("@contracts").InvoiceMutationResult>;
      renumber: (
        input: import("@contracts").RenumberInvoiceCommand,
      ) => Promise<import("@contracts").InvoiceMutationResult>;
      createFromQuote: (input: {
        workspaceId: string;
        quoteId: string;
        commandId: string;
      }) => Promise<import("@contracts").InvoiceMutationResult>;
    };
    bukowskiLicenses?: {
      list: (workspaceId: string) => Promise<import("@contracts").SoftwareLicenseRow[]>;
      upsert: (
        input: import("@contracts").UpsertSoftwareLicenseCommand,
      ) => Promise<import("@contracts").SoftwareLicenseMutationResult>;
      archive: (
        input: import("@contracts").ArchiveSoftwareLicenseCommand,
      ) => Promise<import("@contracts").SoftwareLicenseMutationResult>;
      setSeats: (
        input: import("@contracts").SetLicenseSeatsCommand,
      ) => Promise<import("@contracts").SoftwareLicenseMutationResult>;
    };
    bukowskiTreasury?: {
      listAccounts: (workspaceId: string) => Promise<import("@contracts").BankAccountRow[]>;
      upsertAccount: (
        input: import("@contracts").UpsertBankAccountCommand,
      ) => Promise<import("@contracts").BankAccountMutationResult>;
      paymentInstrumentUpsert: (
        input: import("@contracts").UpsertPaymentInstrumentCommand,
      ) => Promise<import("@contracts").BankAccountMutationResult>;
      paymentInstrumentDeactivate: (
        input: import("@contracts").DeactivatePaymentInstrumentCommand,
      ) => Promise<import("@contracts").BankAccountMutationResult>;
      listTransactions: (
        query: import("@contracts").TreasuryTransactionListQuery,
      ) => Promise<import("@contracts").BankTransactionRow[]>;
      previewClassificationRule: (
        query: import("@contracts").CounterpartyRulePreviewQuery,
      ) => Promise<import("@contracts").CounterpartyRulePreview>;
      listImports: (
        workspaceId: string,
        bankAccountId?: string,
      ) => Promise<import("@contracts").BankStatementImportRow[]>;
      listExpenseCategories: (workspaceId: string) => Promise<string[]>;
      overview: (
        query: import("@contracts").TreasuryOverviewQuery,
      ) => Promise<import("@contracts").TreasuryOverviewSnapshot>;
      exportOverviewPdf: (
        query: import("@contracts").TreasuryOverviewQuery,
      ) => Promise<import("@contracts").AppExportResult>;
      reviewQueue: (workspaceId: string) => Promise<import("@contracts").ReviewQueueRow[]>;
      projectPnl: (
        workspaceId: string,
        dateFrom?: string,
        dateTo?: string,
      ) => Promise<import("@contracts").ProjectPnlRow[]>;
      undoPreview: (workspaceId: string) => Promise<import("@contracts").TreasuryUndoPreview>;
      deductibleLedger: (
        query: import("@contracts").TreasuryDeductibleLedgerQuery,
      ) => Promise<import("@contracts").TreasuryDeductibleLedger>;
      reimbursements: (
        query: import("@contracts").TreasuryReimbursementsQuery,
      ) => Promise<import("@contracts").TreasuryReimbursementsSnapshot>;
      exportDeductibleLedger: (
        input: import("@contracts").TreasuryDeductibleLedgerExportInput,
      ) => Promise<import("@contracts").AppExportResult>;
      dgiiReport: (query: import("@contracts").DgiiReportQuery) => Promise<import("@contracts").DgiiReport>;
      exportDgiiReport: (
        input: import("@contracts").DgiiReportExportInput,
      ) => Promise<import("@contracts").AppExportResult>;
      previewStatementImport: (
        input: import("@contracts").PreviewStatementImportCommand,
      ) => Promise<import("@contracts").StatementImportPreview>;
      importStatement: (
        input: import("@contracts").ImportStatementCommand,
      ) => Promise<import("@contracts").ImportStatementResult>;
      addManualTransactions: (
        input: import("@contracts").AddManualTransactionsCommand,
      ) => Promise<import("@contracts").ImportStatementResult>;
      deleteImport: (
        input: import("@contracts").DeleteImportCommand,
      ) => Promise<import("@contracts").TransactionMutationResult>;
      correctTransaction: (
        input: import("@contracts").CorrectTransactionCommand,
      ) => Promise<import("@contracts").TransactionMutationResult>;
      annotateTransaction: (
        input: import("@contracts").AnnotateTransactionCommand,
      ) => Promise<import("@contracts").TransactionMutationResult>;
      applyClassificationRule: (
        input: import("@contracts").ApplyCounterpartyRuleCommand,
      ) => Promise<import("@contracts").ApplyCounterpartyRuleResult>;
      setAllocations: (
        input: import("@contracts").SetAllocationsCommand,
      ) => Promise<import("@contracts").TransactionMutationResult>;
      reviewReimbursement: (
        input: import("@contracts").ReviewReimbursementCommand,
      ) => Promise<import("@contracts").TransactionMutationResult>;
      linkTransaction: (
        input: import("@contracts").LinkTransactionCommand,
      ) => Promise<import("@contracts").TransactionMutationResult>;
      invoiceAllocationAssign: (
        input: import("@contracts").AssignInvoiceAllocationCommand,
      ) => Promise<import("@contracts").InvoiceAllocationMutationResult>;
      invoiceAllocationLinkToTransaction: (
        input: import("@contracts").LinkInvoiceAllocationToTransactionCommand,
      ) => Promise<import("@contracts").InvoiceAllocationMutationResult>;
      invoiceAllocationUnlink: (
        input: import("@contracts").UnlinkInvoiceAllocationCommand,
      ) => Promise<import("@contracts").InvoiceAllocationMutationResult>;
      invoiceAllocationReject: (
        input: import("@contracts").RejectInvoiceAllocationCommand,
      ) => Promise<import("@contracts").InvoiceAllocationMutationResult>;
      invoiceAllocationMarkReimbursed: (
        input: import("@contracts").MarkInvoiceAllocationReimbursedCommand,
      ) => Promise<import("@contracts").InvoiceAllocationMutationResult>;
      cardSettlementCreate: (
        input: import("@contracts").CreateCardSettlementCommand,
      ) => Promise<import("@contracts").InvoiceAllocationMutationResult>;
      undoLastAction: (
        input: import("@contracts").UndoTreasuryActionCommand,
      ) => Promise<import("@contracts").TransactionMutationResult>;
      invoiceInboxEnqueue: (
        input: import("@contracts").EnqueueInvoiceBatchCommand,
      ) => Promise<import("@contracts").EnqueueInvoiceBatchResult>;
      invoiceInboxList: (
        query: import("@contracts").InvoiceInboxListQuery,
      ) => Promise<import("@contracts").InvoiceExtraction[]>;
      invoiceInboxUpdate: (
        input: import("@contracts").UpdateInvoiceExtractionCommand,
      ) => Promise<import("@contracts").InvoiceExtractionMutationResult>;
      invoiceInboxBulkLink: (
        input: import("@contracts").BulkLinkInvoiceExtractionsCommand,
      ) => Promise<import("@contracts").BulkLinkInvoiceExtractionsResult>;
      invoiceInboxRetry: (
        input: import("@contracts").RetryInvoiceExtractionsCommand,
      ) => Promise<import("@contracts").RetryInvoiceExtractionsResult>;
      invoiceInboxPreview: (
        workspaceId: string,
        extractionId: string,
      ) => Promise<{ fileName: string; mimeType: string; dataUrl: string } | null>;
      invoiceInboxDownload: (
        workspaceId: string,
        extractionId: string,
      ) => Promise<import("@contracts").AppExportResult>;
      invoiceInboxDownloadBatch: (
        workspaceId: string,
        extractionIds: string[],
      ) => Promise<import("@contracts").AppExportResult>;
      invoiceInboxDuplicates: (
        workspaceId: string,
      ) => Promise<import("@contracts").InvoiceDuplicateGroup[]>;
      invoiceInboxBackfillHashes: (workspaceId: string) => Promise<number>;
      invoiceInboxApply: (
        input: import("@contracts").ApplyInvoiceExtractionCommand,
      ) => Promise<import("@contracts").InvoiceExtractionMutationResult>;
      invoiceInboxDismiss: (
        input: import("@contracts").DismissInvoiceExtractionCommand,
      ) => Promise<import("@contracts").InvoiceExtractionMutationResult>;
    };
    bukowskiCatalog?: {
      getSnapshot: (query?: CatalogListQuery) => Promise<CatalogSnapshot>;
      create: (input: CreateCatalogEntityInput) => Promise<CatalogSnapshot>;
      update: (input: UpdateCatalogEntityInput) => Promise<CatalogSnapshot>;
      remove: (input: DeleteCatalogEntityInput) => Promise<CatalogSnapshot>;
      removeMany: (input: DeleteCatalogEntitiesInput) => Promise<CatalogSnapshot>;
      exportCsv: (input: ExportCatalogCsvInput) => Promise<AppExportResult>;
      previewImportCsv: (input: PreviewCatalogCsvImportInput) => Promise<CatalogCsvImportPreview>;
      importCsv: (input: ImportCatalogCsvInput) => Promise<{ result: CatalogCsvImportResult; snapshot: CatalogSnapshot }>;
      uploadCrewDocuments: (workspaceId: string, crewMemberId: string, sourceFilePaths?: string[]) => Promise<FileUploadMutationResult>;
      openCrewDocument: (fileId: string) => Promise<void>;
      deleteCrewDocument: (fileId: string) => Promise<FileDeleteMutationResult>;
    };
    bukowskiRma?: {
      getSnapshot: (query?: RmaSnapshotQuery) => Promise<RmaSnapshot>;
      getDetail: (rmaCaseId: string) => Promise<RmaCaseDetailSnapshot>;
      create: (input: CreateRmaCaseCommand) => Promise<RmaCaseMutationResult>;
      update: (input: UpdateRmaCaseCommand) => Promise<RmaCaseMutationResult>;
    };
  }
}

export {};
