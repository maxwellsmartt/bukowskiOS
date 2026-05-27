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
  AppApplyRemoteFinanceBusinessRowsCommand,
  AppApplyRemoteFinanceBusinessRowsResult,
  AppApplyRemoteAssetSnapshotsCommand,
  AppApplyRemoteAssetSnapshotsResult,
  AppApplyRemoteCatalogRowsCommand,
  AppApplyRemoteCatalogRowsResult,
  AppApplyRemoteTreasuryRowsCommand,
  AppApplyRemoteTreasuryRowsResult,
  AppDiagnosticsSnapshot,
  AppExportResult,
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
  CreateProjectInput,
  CreateProjectUnitInput,
  CreateRmaCaseCommand,
  DeleteAssistantThreadCommand,
  DeleteCatalogEntityInput,
  PreviewCatalogCsvImportInput,
  DeleteProjectInput,
  DeleteProjectUnitInput,
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
      createUser: (input: CreateAppUserCommand) => Promise<AppUserMutationResult>;
      updateUser: (input: UpdateAppUserCommand) => Promise<AppUserMutationResult>;
      setUserActive: (input: SetAppUserActiveCommand) => Promise<AppUserMutationResult>;
      revokeTelegramLink: (input: RevokeTelegramLinkCommand) => Promise<AppUserMutationResult>;
      deleteUser: (input: DeleteAppUserCommand) => Promise<AppUserMutationResult>;
      ensureLocalWorkspaces: (workspaces: EnsureLocalWorkspaceInput[]) => Promise<AppActionResult>;
      getLocalWorkspaces: () => Promise<AppLocalWorkspaceRow[]>;
      runIntegrityCheck: () => Promise<AppActionResult>;
      runLocalSync: () => Promise<AppActionResult>;
      getSyncOutboxRows: () => Promise<AppSyncOutboxRow[]>;
      getSyncPullCursors: () => Promise<AppSyncPullCursorRow[]>;
      retrySyncOutboxRow: (id: string) => Promise<AppActionResult>;
      retryAllFailedSyncOutboxRows: () => Promise<AppActionResult>;
      backfillOperationalSnapshots: (
        input: AppOperationalBackfillCommand,
      ) => Promise<AppOperationalBackfillResult>;
      exportWorkspaceData: () => Promise<AppExportResult>;
      exportSupportBundle: () => Promise<AppExportResult>;
      exportRecentLogs: () => Promise<AppExportResult>;
      openExternal: (url: string) => Promise<void>;
      applyRemoteCatalogRows: (
        input: AppApplyRemoteCatalogRowsCommand,
      ) => Promise<AppApplyRemoteCatalogRowsResult>;
      applyRemoteExchangeRates: (
        input: import("@contracts").AppApplyRemoteExchangeRatesCommand,
      ) => Promise<import("@contracts").AppApplyRemoteExchangeRatesResult>;
      applyRemoteAssetSnapshots: (
        input: AppApplyRemoteAssetSnapshotsCommand,
      ) => Promise<AppApplyRemoteAssetSnapshotsResult>;
      applyRemoteOperationalSnapshots: (
        input: import("@contracts").AppApplyRemoteOperationalSnapshotsCommand,
      ) => Promise<import("@contracts").AppApplyRemoteOperationalSnapshotsResult>;
      applyRemoteTreasuryRows: (
        input: AppApplyRemoteTreasuryRowsCommand,
      ) => Promise<AppApplyRemoteTreasuryRowsResult>;
      applyRemoteCollaboratorPaymentRows: (
        input: AppApplyRemoteCollaboratorPaymentRowsCommand,
      ) => Promise<AppApplyRemoteCollaboratorPaymentRowsResult>;
      applyRemoteFinanceBusinessRows: (
        input: AppApplyRemoteFinanceBusinessRowsCommand,
      ) => Promise<AppApplyRemoteFinanceBusinessRowsResult>;
    };
    bukowskiAuth?: {
      getStoredTokens: () => Promise<{
        accessToken: string | null;
        refreshToken: string | null;
      }>;
      getOAuthRedirectUrl: () => Promise<string>;
      getAvatarDataUrl: (url: string) => Promise<string | null>;
      setStoredTokens: (tokens: { accessToken: string | null; refreshToken: string | null }) => Promise<void>;
      clearStoredTokens: () => Promise<void>;
    };
    bukowskiNotifications?: {
      showNative: (input: import("@contracts").ShowNativeNotificationCommand) => Promise<void>;
      setDockBadge: (count: number) => Promise<void>;
      getForegroundState: () => Promise<{ isForeground: boolean }>;
    };
    bukowskiShell?: {
      getBootstrap: () => Promise<ShellBootstrap>;
      searchGlobal: (query: GlobalSearchQuery) => Promise<GlobalSearchGroup[]>;
      onAppAction: (listener: (action: ShellAppAction) => void) => () => void;
    };
    bukowskiAgents?: {
      getMissionControlSnapshot: () => Promise<MissionControlSnapshot>;
      getAgentsList: () => Promise<AgentRosterRow[]>;
      getAgentDetail: (agentId: string) => Promise<AgentDetailSnapshot>;
      getRunsList: () => Promise<AgentRunRow[]>;
      getModelsSnapshot: () => Promise<AgentModelsSnapshot>;
      getAIProviderConfigs: () => Promise<AgentModelRow[]>;
      getConnectorsSnapshot: () => Promise<AgentConnectorRow[]>;
      getAssistantChatSnapshot: () => Promise<AssistantChatSnapshot>;
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
      exportInsurancePdf: (packingSlipId: string) => Promise<AppExportResult>;
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
      createBlueprint: (input: CreateProjectBlueprintInput) => Promise<ProjectCardRow[]>;
      exportBlueprintPdf: (input: CreateProjectBlueprintInput) => Promise<AppExportResult>;
      update: (input: UpdateProjectInput) => Promise<ProjectCardRow[]>;
      archive: (input: ArchiveProjectInput) => Promise<ProjectCardRow[]>;
      unarchive: (input: UnarchiveProjectInput) => Promise<ProjectCardRow[]>;
      remove: (input: DeleteProjectInput) => Promise<ProjectCardRow[]>;
      createUnit: (input: CreateProjectUnitInput) => Promise<ProjectDetailSnapshot>;
      updateUnit: (input: UpdateProjectUnitInput) => Promise<ProjectDetailSnapshot>;
      removeUnit: (input: DeleteProjectUnitInput) => Promise<ProjectDetailSnapshot>;
      assignCrewToUnit: (input: AssignCrewToProjectUnitInput) => Promise<ProjectDetailSnapshot>;
      unassignCrewFromUnit: (input: UnassignCrewFromProjectUnitInput) => Promise<ProjectDetailSnapshot>;
    };
    bukowskiFinance?: {
      getOverview: (query?: FinanceOverviewQuery) => Promise<FinanceOverviewSnapshot>;
      exportReportPdf: (query?: FinanceOverviewQuery) => Promise<AppExportResult>;
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
    bukowskiTreasury?: {
      listAccounts: (workspaceId: string) => Promise<import("@contracts").BankAccountRow[]>;
      upsertAccount: (
        input: import("@contracts").UpsertBankAccountCommand,
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
      exportDeductibleLedger: (
        input: import("@contracts").TreasuryDeductibleLedgerExportInput,
      ) => Promise<import("@contracts").AppExportResult>;
      dgiiReport: (query: import("@contracts").DgiiReportQuery) => Promise<import("@contracts").DgiiReport>;
      exportDgiiReport: (
        input: import("@contracts").DgiiReportExportInput,
      ) => Promise<import("@contracts").AppExportResult>;
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
      invoiceInboxPreview: (
        workspaceId: string,
        extractionId: string,
      ) => Promise<{ fileName: string; mimeType: string; dataUrl: string } | null>;
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
