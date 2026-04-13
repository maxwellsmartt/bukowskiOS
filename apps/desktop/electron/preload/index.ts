import { contextBridge, ipcRenderer } from "electron";

import { ipcChannels } from "@contracts/ipc/channels";
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
  AssignAgentModelCommand,
  ArchiveAssetCommand,
  AssetListQuery,
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
  CreateProjectBlueprintInput,
  CreateRmaCaseCommand,
  DeleteAssistantThreadCommand,
  CreateProjectInput,
  CreateProjectUnitInput,
  DeleteCatalogEntityInput,
  DeleteProjectInput,
  DeleteProjectUnitInput,
  FinanceEntryListQuery,
  FinanceOverviewQuery,
  FinanceEntryMutationResult,
  FinanceCostLinkRow,
  FinanceEntryRow,
  FinancialDocumentRow,
  FinanceOverviewSnapshot,
  GlobalSearchGroup,
  GlobalSearchQuery,
  IncidentDetailSnapshot,
  IncidentMutationResult,
  IncidentListQuery,
  IncidentListRow,
  OverviewSnapshot,
  PackingSlipDetailSnapshot,
  PackingSlipListQuery,
  PackingSlipRow,
  ProjectListQuery,
  ProjectCardRow,
  ProjectCreationConflictsSnapshot,
  ProjectDetailSnapshot,
  ReportIncidentCommand,
  ReportIncidentResult,
  ResolveIncidentCommand,
  RecordRuntimeErrorCommand,
  ReturnPackingSlipItemsCommand,
  ReturnPackingSlipItemsResult,
  ScheduleTimelineRange,
  ScheduleTimelinePagination,
  ScheduleTimelineScale,
  ScheduleTimelineSnapshot,
  ShellAppAction,
  ShellBootstrap,
  SetAgentApprovalModeCommand,
  SetActiveAssistantThreadCommand,
  SetAgentStatusCommand,
  SaveAIProviderConfigCommand,
  MissionControlSnapshot,
  TestAIProviderConnectionCommand,
  AssignCrewToProjectUnitInput,
  UnassignCrewFromProjectUnitInput,
  UpdateAssetCommand,
  UpdateCatalogEntityInput,
  UpdateFinancialEntryCommand,
  UpdateAgentCommand,
  UpdateProjectInput,
  UpdateProjectUnitInput,
  UpdateRmaCaseCommand,
  UpdateIncidentCommand,
  RmaCaseDetailSnapshot,
  RmaCaseMutationResult,
  RmaSnapshot,
  ReviewAgentRunCommand,
  AgentRunReviewResult,
  DraftRunFromChatResult,
  SendAssistantChatTurnCommand,
  UpdateAssistantThreadPreferencesCommand,
  StagingPackingSlipRow,
} from "@contracts";

const shellActionListeners = new Set<(action: ShellAppAction) => void>();

ipcRenderer.on(ipcChannels.shell.appAction, (_event, action: ShellAppAction) => {
  shellActionListeners.forEach((listener) => {
    listener(action);
  });
});

const bukowskiApp = {
  getAppInfo: () => ipcRenderer.invoke(ipcChannels.app.getInfo) as Promise<AppInfo>,
  getDiagnostics: () => ipcRenderer.invoke(ipcChannels.app.getDiagnostics) as Promise<AppDiagnosticsSnapshot>,
  getSupportSnapshot: () => ipcRenderer.invoke(ipcChannels.app.getSupportSnapshot) as Promise<AppSupportSnapshot>,
  createBackup: () => ipcRenderer.invoke(ipcChannels.app.createBackup) as Promise<AppActionResult>,
  runIntegrityCheck: () => ipcRenderer.invoke(ipcChannels.app.runIntegrityCheck) as Promise<AppActionResult>,
  runLocalSync: () => ipcRenderer.invoke(ipcChannels.app.runLocalSync) as Promise<AppActionResult>,
  getSyncOutboxRows: () => ipcRenderer.invoke(ipcChannels.app.getSyncOutboxRows) as Promise<AppSyncOutboxRow[]>,
  retrySyncOutboxRow: (id: string) =>
    ipcRenderer.invoke(ipcChannels.app.retrySyncOutboxRow, id) as Promise<AppActionResult>,
  retryAllFailedSyncOutboxRows: () =>
    ipcRenderer.invoke(ipcChannels.app.retryAllFailedSyncOutboxRows) as Promise<AppActionResult>,
  exportWorkspaceData: () => ipcRenderer.invoke(ipcChannels.app.exportWorkspaceData) as Promise<AppExportResult>,
  exportSupportBundle: () => ipcRenderer.invoke(ipcChannels.app.exportSupportBundle) as Promise<AppExportResult>,
  exportRecentLogs: () => ipcRenderer.invoke(ipcChannels.app.exportRecentLogs) as Promise<AppExportResult>,
  openExternal: (url: string) => ipcRenderer.invoke(ipcChannels.app.openExternal, url) as Promise<void>,
};

const bukowskiShell = {
  getBootstrap: () => ipcRenderer.invoke(ipcChannels.shell.getBootstrap) as Promise<ShellBootstrap>,
  searchGlobal: (query: GlobalSearchQuery) => ipcRenderer.invoke(ipcChannels.shell.searchGlobal, query) as Promise<GlobalSearchGroup[]>,
  onAppAction: (listener: (action: ShellAppAction) => void) => {
    shellActionListeners.add(listener);

    return () => {
      shellActionListeners.delete(listener);
    };
  },
};

const bukowskiOverview = {
  getSnapshot: () => ipcRenderer.invoke(ipcChannels.overview.getSnapshot) as Promise<OverviewSnapshot>,
  getTimeline: (
    range: ScheduleTimelineRange,
    scale: ScheduleTimelineScale,
    anchorDate?: string,
    pagination?: ScheduleTimelinePagination,
  ) =>
    ipcRenderer.invoke(ipcChannels.overview.getTimeline, range, scale, anchorDate, pagination) as Promise<ScheduleTimelineSnapshot>,
};

const bukowskiAgents = {
  getMissionControlSnapshot: () =>
    ipcRenderer.invoke(ipcChannels.agents.getMissionControlSnapshot) as Promise<MissionControlSnapshot>,
  getAgentsList: () => ipcRenderer.invoke(ipcChannels.agents.getAgentsList) as Promise<AgentRosterRow[]>,
  getAgentDetail: (agentId: string) => ipcRenderer.invoke(ipcChannels.agents.getAgentDetail, agentId) as Promise<AgentDetailSnapshot>,
  getRunsList: () => ipcRenderer.invoke(ipcChannels.agents.getRunsList) as Promise<AgentRunRow[]>,
  getModelsSnapshot: () => ipcRenderer.invoke(ipcChannels.agents.getModelsSnapshot) as Promise<AgentModelsSnapshot>,
  getAIProviderConfigs: () => ipcRenderer.invoke(ipcChannels.agents.getAIProviderConfigs) as Promise<AgentModelRow[]>,
  getConnectorsSnapshot: () => ipcRenderer.invoke(ipcChannels.agents.getConnectorsSnapshot) as Promise<AgentConnectorRow[]>,
  getAssistantChatSnapshot: () => ipcRenderer.invoke(ipcChannels.agents.getAssistantChatSnapshot) as Promise<AssistantChatSnapshot>,
  create: (input: CreateAgentCommand) => ipcRenderer.invoke(ipcChannels.agents.create, input) as Promise<AgentMutationResult>,
  update: (input: UpdateAgentCommand) => ipcRenderer.invoke(ipcChannels.agents.update, input) as Promise<AgentMutationResult>,
  setStatus: (input: SetAgentStatusCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.setStatus, input) as Promise<AgentMutationResult>,
  setApprovalMode: (input: SetAgentApprovalModeCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.setApprovalMode, input) as Promise<AgentMutationResult>,
  saveAIProviderConfig: (input: SaveAIProviderConfigCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.saveAIProviderConfig, input) as Promise<AIProviderMutationResult>,
  testAIProviderConnection: (input: TestAIProviderConnectionCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.testAIProviderConnection, input) as Promise<AIProviderMutationResult>,
  assignAgentModel: (input: AssignAgentModelCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.assignAgentModel, input) as Promise<AgentMutationResult>,
  createAssistantThread: (input: CreateAssistantThreadCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.createAssistantThread, input) as Promise<AssistantChatSnapshot>,
  deleteAssistantThread: (input: DeleteAssistantThreadCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.deleteAssistantThread, input) as Promise<AssistantChatSnapshot>,
  setActiveAssistantThread: (input: SetActiveAssistantThreadCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.setActiveAssistantThread, input) as Promise<AssistantChatSnapshot>,
  updateAssistantThreadPreferences: (input: UpdateAssistantThreadPreferencesCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.updateAssistantThreadPreferences, input) as Promise<AssistantChatSnapshot>,
  sendAssistantChatTurn: (input: SendAssistantChatTurnCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.sendAssistantChatTurn, input) as Promise<AssistantChatSnapshot>,
  reviewRun: (input: ReviewAgentRunCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.reviewRun, input) as Promise<AgentRunReviewResult>,
  sendAssistantMessage: (input: AssistantGatewayRequest) =>
    ipcRenderer.invoke(ipcChannels.agents.sendAssistantMessage, input) as Promise<AssistantGatewayResponse>,
  createDraftRunFromChat: (input: CreateDraftRunFromChatCommand) =>
    ipcRenderer.invoke(ipcChannels.agents.createDraftRunFromChat, input) as Promise<DraftRunFromChatResult>,
};

const bukowskiAssets = {
  getList: (query?: AssetListQuery) => ipcRenderer.invoke(ipcChannels.assets.getList, query) as Promise<AssetListRow[]>,
  getSummary: () => ipcRenderer.invoke(ipcChannels.assets.getSummary) as Promise<AssetSummarySnapshot>,
  getOverview: () => ipcRenderer.invoke(ipcChannels.assets.getOverview) as Promise<AssetsOverviewSnapshot>,
  getDetail: (assetId: string) =>
    ipcRenderer.invoke(ipcChannels.assets.getDetail, assetId) as Promise<AssetDetailSnapshot>,
  uploadFiles: (assetId: string) =>
    ipcRenderer.invoke(ipcChannels.assets.uploadFiles, assetId) as Promise<FileUploadMutationResult>,
  openFile: (fileId: string) => ipcRenderer.invoke(ipcChannels.assets.openFile, fileId) as Promise<void>,
  assignMove: (input: AssignMoveAssetsInput) =>
    ipcRenderer.invoke(ipcChannels.assets.assignMove, input) as Promise<AssignMoveAssetsResult>,
  create: (input: CreateAssetCommand) =>
    ipcRenderer.invoke(ipcChannels.assets.create, input) as Promise<AssetEditorMutationResult>,
  update: (input: UpdateAssetCommand) =>
    ipcRenderer.invoke(ipcChannels.assets.update, input) as Promise<AssetEditorMutationResult>,
  archive: (input: ArchiveAssetCommand) =>
    ipcRenderer.invoke(ipcChannels.assets.archive, input) as Promise<AssetEditorMutationResult>,
};

const bukowskiPacking = {
  getList: (query?: PackingSlipListQuery) => ipcRenderer.invoke(ipcChannels.packing.getList, query) as Promise<PackingSlipRow[]>,
  getDetail: (packingSlipId: string) =>
    ipcRenderer.invoke(ipcChannels.packing.getDetail, packingSlipId) as Promise<PackingSlipDetailSnapshot>,
  exportPdf: (packingSlipId: string) =>
    ipcRenderer.invoke(ipcChannels.packing.exportPdf, packingSlipId) as Promise<AppExportResult>,
  create: (input: CreatePackingSlipCommand) =>
    ipcRenderer.invoke(ipcChannels.packing.create, input) as Promise<CreatePackingSlipResult>,
  returnItems: (input: ReturnPackingSlipItemsCommand) =>
    ipcRenderer.invoke(ipcChannels.packing.returnItems, input) as Promise<ReturnPackingSlipItemsResult>,
};

const bukowskiIncidents = {
  getList: (query?: IncidentListQuery) => ipcRenderer.invoke(ipcChannels.incidents.getList, query) as Promise<IncidentListRow[]>,
  getDetail: (incidentId: string) =>
    ipcRenderer.invoke(ipcChannels.incidents.getDetail, incidentId) as Promise<IncidentDetailSnapshot>,
  uploadFiles: (incidentId: string) =>
    ipcRenderer.invoke(ipcChannels.incidents.uploadFiles, incidentId) as Promise<FileUploadMutationResult>,
  openFile: (fileId: string) => ipcRenderer.invoke(ipcChannels.incidents.openFile, fileId) as Promise<void>,
  report: (input: ReportIncidentCommand) =>
    ipcRenderer.invoke(ipcChannels.incidents.report, input) as Promise<ReportIncidentResult>,
  update: (input: UpdateIncidentCommand) =>
    ipcRenderer.invoke(ipcChannels.incidents.update, input) as Promise<IncidentMutationResult>,
  resolve: (input: ResolveIncidentCommand) =>
    ipcRenderer.invoke(ipcChannels.incidents.resolve, input) as Promise<IncidentMutationResult>,
};

const bukowskiProjects = {
  getList: (query?: ProjectListQuery) => ipcRenderer.invoke(ipcChannels.projects.getList, query) as Promise<ProjectCardRow[]>,
  getDetail: (projectId: string) => ipcRenderer.invoke(ipcChannels.projects.getDetail, projectId) as Promise<ProjectDetailSnapshot>,
  getCatalog: () => ipcRenderer.invoke(ipcChannels.projects.getCatalog) as Promise<CatalogSnapshot>,
  getStagingPackingSlips: () =>
    ipcRenderer.invoke(ipcChannels.projects.getStagingPackingSlips) as Promise<StagingPackingSlipRow[]>,
  getCreationConflicts: (input: CreateProjectBlueprintInput) =>
    ipcRenderer.invoke(ipcChannels.projects.getCreationConflicts, input) as Promise<ProjectCreationConflictsSnapshot>,
  create: (input: CreateProjectInput) => ipcRenderer.invoke(ipcChannels.projects.create, input) as Promise<ProjectCardRow[]>,
  createBlueprint: (input: CreateProjectBlueprintInput) =>
    ipcRenderer.invoke(ipcChannels.projects.createBlueprint, input) as Promise<ProjectCardRow[]>,
  exportBlueprintPdf: (input: CreateProjectBlueprintInput) =>
    ipcRenderer.invoke(ipcChannels.projects.exportBlueprintPdf, input) as Promise<AppExportResult>,
  update: (input: UpdateProjectInput) => ipcRenderer.invoke(ipcChannels.projects.update, input) as Promise<ProjectCardRow[]>,
  remove: (input: DeleteProjectInput) => ipcRenderer.invoke(ipcChannels.projects.delete, input) as Promise<ProjectCardRow[]>,
  createUnit: (input: CreateProjectUnitInput) =>
    ipcRenderer.invoke(ipcChannels.projects.createUnit, input) as Promise<ProjectDetailSnapshot>,
  updateUnit: (input: UpdateProjectUnitInput) =>
    ipcRenderer.invoke(ipcChannels.projects.updateUnit, input) as Promise<ProjectDetailSnapshot>,
  removeUnit: (input: DeleteProjectUnitInput) =>
    ipcRenderer.invoke(ipcChannels.projects.deleteUnit, input) as Promise<ProjectDetailSnapshot>,
  assignCrewToUnit: (input: AssignCrewToProjectUnitInput) =>
    ipcRenderer.invoke(ipcChannels.projects.assignCrewToUnit, input) as Promise<ProjectDetailSnapshot>,
  unassignCrewFromUnit: (input: UnassignCrewFromProjectUnitInput) =>
    ipcRenderer.invoke(ipcChannels.projects.unassignCrewFromUnit, input) as Promise<ProjectDetailSnapshot>,
};

const bukowskiFinance = {
  getOverview: (query?: FinanceOverviewQuery) =>
    ipcRenderer.invoke(ipcChannels.finance.getOverview, query) as Promise<FinanceOverviewSnapshot>,
  exportReportPdf: (query?: FinanceOverviewQuery) =>
    ipcRenderer.invoke(ipcChannels.finance.exportReportPdf, query) as Promise<AppExportResult>,
  getCostLinks: () => ipcRenderer.invoke(ipcChannels.finance.getCostLinks) as Promise<FinanceCostLinkRow[]>,
  getEntries: (query?: FinanceEntryListQuery) => ipcRenderer.invoke(ipcChannels.finance.getEntries, query) as Promise<FinanceEntryRow[]>,
  getDocuments: (entryId: string) =>
    ipcRenderer.invoke(ipcChannels.finance.getDocuments, entryId) as Promise<FinancialDocumentRow[]>,
  uploadDocuments: (entryId: string) =>
    ipcRenderer.invoke(ipcChannels.finance.uploadDocuments, entryId) as Promise<FileUploadMutationResult>,
  openDocument: (fileId: string) => ipcRenderer.invoke(ipcChannels.finance.openDocument, fileId) as Promise<void>,
  create: (input: CreateFinancialEntryCommand) =>
    ipcRenderer.invoke(ipcChannels.finance.create, input) as Promise<FinanceEntryMutationResult>,
  update: (input: UpdateFinancialEntryCommand) =>
    ipcRenderer.invoke(ipcChannels.finance.update, input) as Promise<FinanceEntryMutationResult>,
};

const bukowskiCatalog = {
  getSnapshot: (query?: CatalogListQuery) => ipcRenderer.invoke(ipcChannels.catalog.getSnapshot, query) as Promise<CatalogSnapshot>,
  create: (input: CreateCatalogEntityInput) => ipcRenderer.invoke(ipcChannels.catalog.create, input) as Promise<CatalogSnapshot>,
  update: (input: UpdateCatalogEntityInput) => ipcRenderer.invoke(ipcChannels.catalog.update, input) as Promise<CatalogSnapshot>,
  remove: (input: DeleteCatalogEntityInput) => ipcRenderer.invoke(ipcChannels.catalog.delete, input) as Promise<CatalogSnapshot>,
};

const bukowskiRma = {
  getSnapshot: () => ipcRenderer.invoke(ipcChannels.rma.getSnapshot) as Promise<RmaSnapshot>,
  getDetail: (rmaCaseId: string) => ipcRenderer.invoke(ipcChannels.rma.getDetail, rmaCaseId) as Promise<RmaCaseDetailSnapshot>,
  create: (input: CreateRmaCaseCommand) => ipcRenderer.invoke(ipcChannels.rma.create, input) as Promise<RmaCaseMutationResult>,
  update: (input: UpdateRmaCaseCommand) => ipcRenderer.invoke(ipcChannels.rma.update, input) as Promise<RmaCaseMutationResult>,
};

const reportRuntimeError = (input: RecordRuntimeErrorCommand) =>
  ipcRenderer.invoke(ipcChannels.app.reportRuntimeError, input).catch(() => undefined);

window.addEventListener("error", (event) => {
  const runtimeError = event.error instanceof Error ? event.error : null;

  void reportRuntimeError({
    sourceKind: "renderer",
    processLabel: "Renderer",
    errorName: runtimeError?.name ?? "window.error",
    message: runtimeError?.message ?? event.message ?? "Renderer error",
    stack: runtimeError?.stack ?? null,
    severity: "medium",
    context: {
      pathname: window.location.pathname,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    },
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason instanceof Error ? event.reason : new Error(String(event.reason));

  void reportRuntimeError({
    sourceKind: "renderer",
    processLabel: "Renderer",
    errorName: reason.name || "unhandledrejection",
    message: reason.message || "Unhandled renderer rejection",
    stack: reason.stack ?? null,
    severity: "medium",
    context: {
      pathname: window.location.pathname,
    },
  });
});

contextBridge.exposeInMainWorld("bukowskiApp", bukowskiApp);
contextBridge.exposeInMainWorld("bukowskiShell", bukowskiShell);
contextBridge.exposeInMainWorld("bukowskiAgents", bukowskiAgents);
contextBridge.exposeInMainWorld("bukowskiOverview", bukowskiOverview);
contextBridge.exposeInMainWorld("bukowskiAssets", bukowskiAssets);
contextBridge.exposeInMainWorld("bukowskiPacking", bukowskiPacking);
contextBridge.exposeInMainWorld("bukowskiIncidents", bukowskiIncidents);
contextBridge.exposeInMainWorld("bukowskiProjects", bukowskiProjects);
contextBridge.exposeInMainWorld("bukowskiFinance", bukowskiFinance);
contextBridge.exposeInMainWorld("bukowskiCatalog", bukowskiCatalog);
contextBridge.exposeInMainWorld("bukowskiRma", bukowskiRma);
