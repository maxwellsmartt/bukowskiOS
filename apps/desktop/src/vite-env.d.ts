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
  AgentRosterRow,
  AgentRunRow,
  ArchiveAssetCommand,
  AssetListQuery,
  AssignAgentModelCommand,
  AssignCrewToProjectUnitInput,
  AssignMoveAssetsInput,
  AssignMoveAssetsResult,
  AppActionResult,
  AppDiagnosticsSnapshot,
  AppExportResult,
  AppInfo,
  AppSupportSnapshot,
  AppSyncOutboxRow,
  AssetsOverviewSnapshot,
  CreateAgentCommand,
  CreateAssistantThreadCommand,
  AssetDetailSnapshot,
  AssetEditorMutationResult,
  FileUploadMutationResult,
  AssetListRow,
  AssetSummarySnapshot,
  CatalogListQuery,
  CatalogSnapshot,
  CreateAssetCommand,
  CreateCatalogEntityInput,
  CreateFinancialEntryCommand,
  CreateDraftRunFromChatCommand,
  CreatePackingSlipCommand,
  CreatePackingSlipResult,
  CreateProjectInput,
  CreateProjectUnitInput,
  CreateRmaCaseCommand,
  DeleteAssistantThreadCommand,
  DeleteCatalogEntityInput,
  DeleteProjectInput,
  DeleteProjectUnitInput,
  DraftRunFromChatResult,
  FinanceCostLinkRow,
  FinanceEntryListQuery,
  FinanceEntryMutationResult,
  FinanceEntryRow,
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
  ProjectDetailSnapshot,
  ProjectListQuery,
  ReportIncidentCommand,
  ReportIncidentResult,
  ResolveIncidentCommand,
  ReviewAgentRunCommand,
  AgentRunReviewResult,
  ReturnPackingSlipItemsCommand,
  ReturnPackingSlipItemsResult,
  RmaCaseDetailSnapshot,
  RmaCaseMutationResult,
  RmaSnapshot,
  SaveAIProviderConfigCommand,
  ScheduleTimelinePagination,
  ScheduleTimelineRange,
  ScheduleTimelineScale,
  ScheduleTimelineSnapshot,
  SetAgentApprovalModeCommand,
  SetActiveAssistantThreadCommand,
  SetAgentStatusCommand,
  ShellAppAction,
  ShellBootstrap,
  SendAssistantChatTurnCommand,
  TestAIProviderConnectionCommand,
  UnassignCrewFromProjectUnitInput,
  UpdateAgentCommand,
  UpdateAssetCommand,
  UpdateAssistantThreadPreferencesCommand,
  UpdateCatalogEntityInput,
  UpdateFinancialEntryCommand,
  UpdateIncidentCommand,
  UpdateProjectInput,
  UpdateProjectUnitInput,
  UpdateRmaCaseCommand,
} from "@contracts";

declare global {
  interface Window {
    bukowskiApp?: {
      getAppInfo: () => Promise<AppInfo>;
      getDiagnostics: () => Promise<AppDiagnosticsSnapshot>;
      getSupportSnapshot: () => Promise<AppSupportSnapshot>;
      createBackup: () => Promise<AppActionResult>;
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
      testAIProviderConnection: (input: TestAIProviderConnectionCommand) => Promise<AIProviderMutationResult>;
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
        pagination?: ScheduleTimelinePagination,
      ) => Promise<ScheduleTimelineSnapshot>;
    };
    bukowskiAssets?: {
      getList: (query?: AssetListQuery) => Promise<AssetListRow[]>;
      getSummary: () => Promise<AssetSummarySnapshot>;
      getOverview: () => Promise<AssetsOverviewSnapshot>;
      getDetail: (assetId: string) => Promise<AssetDetailSnapshot>;
      uploadFiles: (assetId: string) => Promise<FileUploadMutationResult>;
      openFile: (fileId: string) => Promise<void>;
      assignMove: (input: AssignMoveAssetsInput) => Promise<AssignMoveAssetsResult>;
      create: (input: CreateAssetCommand) => Promise<AssetEditorMutationResult>;
      update: (input: UpdateAssetCommand) => Promise<AssetEditorMutationResult>;
      archive: (input: ArchiveAssetCommand) => Promise<AssetEditorMutationResult>;
    };
    bukowskiPacking?: {
      getList: (query?: PackingSlipListQuery) => Promise<PackingSlipRow[]>;
      getDetail: (packingSlipId: string) => Promise<PackingSlipDetailSnapshot>;
      exportPdf: (packingSlipId: string) => Promise<AppExportResult>;
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
      getCatalog: () => Promise<CatalogSnapshot>;
      create: (input: CreateProjectInput) => Promise<ProjectCardRow[]>;
      update: (input: UpdateProjectInput) => Promise<ProjectCardRow[]>;
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
      create: (input: CreateFinancialEntryCommand) => Promise<FinanceEntryMutationResult>;
      update: (input: UpdateFinancialEntryCommand) => Promise<FinanceEntryMutationResult>;
    };
    bukowskiCatalog?: {
      getSnapshot: (query?: CatalogListQuery) => Promise<CatalogSnapshot>;
      create: (input: CreateCatalogEntityInput) => Promise<CatalogSnapshot>;
      update: (input: UpdateCatalogEntityInput) => Promise<CatalogSnapshot>;
      remove: (input: DeleteCatalogEntityInput) => Promise<CatalogSnapshot>;
    };
    bukowskiRma?: {
      getSnapshot: () => Promise<RmaSnapshot>;
      getDetail: (rmaCaseId: string) => Promise<RmaCaseDetailSnapshot>;
      create: (input: CreateRmaCaseCommand) => Promise<RmaCaseMutationResult>;
      update: (input: UpdateRmaCaseCommand) => Promise<RmaCaseMutationResult>;
    };
  }
}

export {};
