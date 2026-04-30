/// <reference types="vite/client" />

import type {
  AIProviderMutationResult,
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
  AppDiagnosticsSnapshot,
  AppExportResult,
  AppInfo,
  AppLocalWorkspaceRow,
  AppSupportSnapshot,
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
  TestAIProviderConnectionCommand,
  TestConnectorConnectionCommand,
  UnassignCrewFromProjectUnitInput,
  UpdateAgentCommand,
  UpdateAssetCommand,
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
      retrySyncOutboxRow: (id: string) => Promise<AppActionResult>;
      retryAllFailedSyncOutboxRows: () => Promise<AppActionResult>;
      exportWorkspaceData: () => Promise<AppExportResult>;
      exportSupportBundle: () => Promise<AppExportResult>;
      exportRecentLogs: () => Promise<AppExportResult>;
      openExternal: (url: string) => Promise<void>;
    };
    bukowskiAuth?: {
      getStoredTokens: () => Promise<{
        accessToken: string | null;
        refreshToken: string | null;
      }>;
      setStoredTokens: (tokens: { accessToken: string | null; refreshToken: string | null }) => Promise<void>;
      clearStoredTokens: () => Promise<void>;
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
      saveConnectorConfig: (input: SaveConnectorConfigCommand) => Promise<ConnectorMutationResult>;
      testAIProviderConnection: (input: TestAIProviderConnectionCommand) => Promise<AIProviderMutationResult>;
      testConnectorConnection: (input: TestConnectorConnectionCommand) => Promise<ConnectorMutationResult>;
      createConnectorLinkToken: (input: CreateConnectorLinkTokenCommand) => Promise<ConnectorMutationResult>;
      assignAgentModel: (input: AssignAgentModelCommand) => Promise<AgentMutationResult>;
      createAssistantThread: (input: CreateAssistantThreadCommand) => Promise<AssistantChatSnapshot>;
      deleteAssistantThread: (input: DeleteAssistantThreadCommand) => Promise<AssistantChatSnapshot>;
      setActiveAssistantThread: (input: SetActiveAssistantThreadCommand) => Promise<AssistantChatSnapshot>;
      updateAssistantThreadPreferences: (input: UpdateAssistantThreadPreferencesCommand) => Promise<AssistantChatSnapshot>;
      sendAssistantChatTurn: (input: SendAssistantChatTurnCommand) => Promise<AssistantChatSnapshot>;
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
      getCostLinks: () => Promise<FinanceCostLinkRow[]>;
      getEntries: (query?: FinanceEntryListQuery) => Promise<FinanceEntryRow[]>;
      getDocuments: (entryId: string) => Promise<FinancialDocumentRow[]>;
      uploadDocuments: (entryId: string) => Promise<FileUploadMutationResult>;
      openDocument: (fileId: string) => Promise<void>;
      create: (input: CreateFinancialEntryCommand) => Promise<FinanceEntryMutationResult>;
      update: (input: UpdateFinancialEntryCommand) => Promise<FinanceEntryMutationResult>;
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
