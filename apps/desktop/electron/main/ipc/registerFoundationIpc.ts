import type {
  AssistantChatSnapshot,
  AssignAgentModelCommand,
  CreateAssistantThreadCommand,
  AssistantGatewayRequest,
  SaveAIProviderConfigCommand,
  TestAIProviderConnectionCommand,
  AssistantGatewayResponse,
  DeleteAssistantThreadCommand,
  CreateAgentCommand,
  ArchiveAssetCommand,
  CreateDraftRunFromChatCommand,
  RecordRuntimeErrorCommand,
  ReviewAgentRunCommand,
  SendAssistantChatTurnCommand,
  AssetListQuery,
  SetActiveAssistantThreadCommand,
  UpdateAssistantThreadPreferencesCommand,
  SetAgentApprovalModeCommand,
  SetAgentStatusCommand,
  AssignMoveAssetsInput,
  AssignCrewToProjectUnitInput,
  CatalogListQuery,
  CreateAssetCommand,
  CreateCatalogEntityInput,
  CreatePackingSlipCommand,
  CreateRmaCaseCommand,
  CreateProjectInput,
  CreateProjectUnitInput,
  DeleteCatalogEntityInput,
  DeleteProjectInput,
  DeleteProjectUnitInput,
  FinanceEntryListQuery,
  GlobalSearchQuery,
  IncidentListQuery,
  PackingSlipListQuery,
  ProjectListQuery,
  ReportIncidentCommand,
  ReturnPackingSlipItemsCommand,
  ScheduleTimelineRange,
  ScheduleTimelineScale,
  ScheduleTimelineSnapshot,
  UnassignCrewFromProjectUnitInput,
  UpdateAssetCommand,
  UpdateCatalogEntityInput,
  UpdateProjectInput,
  UpdateProjectUnitInput,
  UpdateRmaCaseCommand,
  UpdateAgentCommand,
} from "@contracts";
import { ipcMain } from "electron";

import { ipcChannels } from "@contracts";

import type { FoundationReadService } from "../services/data/foundationReadService";

type RegisterFoundationIpcOptions = {
  foundationReads: FoundationReadService;
  agentReads: {
    getMissionControlSnapshot: () => unknown;
    getAgentsList: () => unknown;
    getAgentDetail: (agentId: string) => unknown;
    getRunsList: () => unknown;
    getModelsSnapshot: () => unknown;
    getAIProviderConfigs: () => unknown;
    getConnectorsSnapshot: () => unknown;
  };
  projectMutations: {
    createProject: (input: CreateProjectInput) => void;
    updateProject: (input: UpdateProjectInput) => void;
    deleteProject: (input: DeleteProjectInput) => void;
    createProjectUnit: (input: CreateProjectUnitInput) => void;
    updateProjectUnit: (input: UpdateProjectUnitInput) => void;
    deleteProjectUnit: (input: DeleteProjectUnitInput) => void;
    assignCrewToProjectUnit: (input: AssignCrewToProjectUnitInput) => void;
    unassignCrewFromProjectUnit: (input: UnassignCrewFromProjectUnitInput) => void;
  };
  catalogMutations: {
    createEntity: (input: CreateCatalogEntityInput) => void;
    updateEntity: (input: UpdateCatalogEntityInput) => void;
    deleteEntity: (input: DeleteCatalogEntityInput) => void;
  };
  assetMutations: {
    assignMoveAssets: (input: AssignMoveAssetsInput) => unknown;
    createAsset: (input: CreateAssetCommand) => unknown;
    updateAsset: (input: UpdateAssetCommand) => unknown;
    archiveAsset: (input: ArchiveAssetCommand) => unknown;
  };
  incidentMutations: {
    reportIncident: (input: ReportIncidentCommand) => unknown;
  };
  packingMutations: {
    createPackingSlip: (input: CreatePackingSlipCommand) => unknown;
    returnPackingSlipItems: (input: ReturnPackingSlipItemsCommand) => unknown;
  };
  rmaMutations: {
    createRmaCase: (input: CreateRmaCaseCommand) => unknown;
    updateRmaCase: (input: UpdateRmaCaseCommand) => unknown;
  };
  agentMutations: {
    createAgent: (input: CreateAgentCommand) => unknown;
    updateAgent: (input: UpdateAgentCommand) => unknown;
    setAgentStatus: (input: SetAgentStatusCommand) => unknown;
    setAgentApprovalMode: (input: SetAgentApprovalModeCommand) => unknown;
    saveAIProviderConfig: (input: SaveAIProviderConfigCommand) => unknown;
    testAIProviderConnection: (input: TestAIProviderConnectionCommand) => unknown;
    assignAgentModel: (input: AssignAgentModelCommand) => unknown;
    getAssistantChatSnapshot: () => AssistantChatSnapshot;
    createAssistantThread: (input: CreateAssistantThreadCommand) => AssistantChatSnapshot;
    deleteAssistantThread: (input: DeleteAssistantThreadCommand) => AssistantChatSnapshot;
    setActiveAssistantThread: (input: SetActiveAssistantThreadCommand) => AssistantChatSnapshot;
    updateAssistantThreadPreferences: (input: UpdateAssistantThreadPreferencesCommand) => AssistantChatSnapshot;
    sendAssistantChatTurn: (input: SendAssistantChatTurnCommand) => Promise<AssistantChatSnapshot>;
    reviewRun: (input: ReviewAgentRunCommand) => unknown;
    sendAssistantMessage: (input: AssistantGatewayRequest) => Promise<AssistantGatewayResponse>;
    createDraftRunFromChat: (input: CreateDraftRunFromChatCommand) => unknown;
  };
  runtimeDiagnostics: {
    recordRuntimeError: (input: RecordRuntimeErrorCommand) => unknown;
  };
};

export const registerFoundationIpc = ({
  foundationReads,
  agentReads,
  projectMutations,
  catalogMutations,
  assetMutations,
  incidentMutations,
  packingMutations,
  rmaMutations,
  agentMutations,
  runtimeDiagnostics,
}: RegisterFoundationIpcOptions) => {
  ipcMain.handle(ipcChannels.shell.getBootstrap, () => foundationReads.getShellBootstrap());
  ipcMain.handle(ipcChannels.shell.searchGlobal, (_event, query: GlobalSearchQuery) => foundationReads.getGlobalSearch(query));
  ipcMain.handle(ipcChannels.agents.getMissionControlSnapshot, () => agentReads.getMissionControlSnapshot());
  ipcMain.handle(ipcChannels.agents.getAgentsList, () => agentReads.getAgentsList());
  ipcMain.handle(ipcChannels.agents.getAgentDetail, (_event, agentId: string) => agentReads.getAgentDetail(agentId));
  ipcMain.handle(ipcChannels.agents.getRunsList, () => agentReads.getRunsList());
  ipcMain.handle(ipcChannels.agents.getModelsSnapshot, () => agentReads.getModelsSnapshot());
  ipcMain.handle(ipcChannels.agents.getAIProviderConfigs, () => agentReads.getAIProviderConfigs());
  ipcMain.handle(ipcChannels.agents.getConnectorsSnapshot, () => agentReads.getConnectorsSnapshot());
  ipcMain.handle(ipcChannels.agents.getAssistantChatSnapshot, () => agentMutations.getAssistantChatSnapshot());
  ipcMain.handle(ipcChannels.agents.create, (_event, input: CreateAgentCommand) => agentMutations.createAgent(input));
  ipcMain.handle(ipcChannels.agents.update, (_event, input: UpdateAgentCommand) => agentMutations.updateAgent(input));
  ipcMain.handle(ipcChannels.agents.setStatus, (_event, input: SetAgentStatusCommand) => agentMutations.setAgentStatus(input));
  ipcMain.handle(
    ipcChannels.agents.setApprovalMode,
    (_event, input: SetAgentApprovalModeCommand) => agentMutations.setAgentApprovalMode(input),
  );
  ipcMain.handle(
    ipcChannels.agents.saveAIProviderConfig,
    (_event, input: SaveAIProviderConfigCommand) => agentMutations.saveAIProviderConfig(input),
  );
  ipcMain.handle(
    ipcChannels.agents.testAIProviderConnection,
    (_event, input: TestAIProviderConnectionCommand) => agentMutations.testAIProviderConnection(input),
  );
  ipcMain.handle(
    ipcChannels.agents.assignAgentModel,
    (_event, input: AssignAgentModelCommand) => agentMutations.assignAgentModel(input),
  );
  ipcMain.handle(
    ipcChannels.agents.createAssistantThread,
    (_event, input: CreateAssistantThreadCommand) => agentMutations.createAssistantThread(input),
  );
  ipcMain.handle(
    ipcChannels.agents.deleteAssistantThread,
    (_event, input: DeleteAssistantThreadCommand) => agentMutations.deleteAssistantThread(input),
  );
  ipcMain.handle(
    ipcChannels.agents.setActiveAssistantThread,
    (_event, input: SetActiveAssistantThreadCommand) => agentMutations.setActiveAssistantThread(input),
  );
  ipcMain.handle(
    ipcChannels.agents.updateAssistantThreadPreferences,
    (_event, input: UpdateAssistantThreadPreferencesCommand) => agentMutations.updateAssistantThreadPreferences(input),
  );
  ipcMain.handle(
    ipcChannels.agents.sendAssistantChatTurn,
    (_event, input: SendAssistantChatTurnCommand) => agentMutations.sendAssistantChatTurn(input),
  );
  ipcMain.handle(ipcChannels.agents.reviewRun, (_event, input: ReviewAgentRunCommand) => agentMutations.reviewRun(input));
  ipcMain.handle(
    ipcChannels.agents.sendAssistantMessage,
    (_event, input: AssistantGatewayRequest) => agentMutations.sendAssistantMessage(input),
  );
  ipcMain.handle(
    ipcChannels.agents.createDraftRunFromChat,
    (_event, input: CreateDraftRunFromChatCommand) => agentMutations.createDraftRunFromChat(input),
  );
  ipcMain.handle(
    ipcChannels.app.reportRuntimeError,
    (_event, input: RecordRuntimeErrorCommand) => runtimeDiagnostics.recordRuntimeError(input),
  );
  ipcMain.handle(ipcChannels.overview.getSnapshot, () => foundationReads.getOverviewSnapshot());
  ipcMain.handle(
    ipcChannels.overview.getTimeline,
    (_event, range: ScheduleTimelineRange, scale: ScheduleTimelineScale, anchorDate?: string) =>
      foundationReads.getScheduleTimeline(range, scale, anchorDate),
  );
  ipcMain.handle(ipcChannels.assets.getList, (_event, query: AssetListQuery | undefined) => foundationReads.getAssets(query));
  ipcMain.handle(ipcChannels.assets.getSummary, () => foundationReads.getAssetSummary());
  ipcMain.handle(ipcChannels.assets.getOverview, () => foundationReads.getAssetsOverview());
  ipcMain.handle(ipcChannels.assets.getDetail, (_event, assetId: string) => foundationReads.getAssetDetail(assetId));
  ipcMain.handle(ipcChannels.assets.assignMove, (_event, input: AssignMoveAssetsInput) => assetMutations.assignMoveAssets(input));
  ipcMain.handle(ipcChannels.assets.create, (_event, input: CreateAssetCommand) => assetMutations.createAsset(input));
  ipcMain.handle(ipcChannels.assets.update, (_event, input: UpdateAssetCommand) => assetMutations.updateAsset(input));
  ipcMain.handle(ipcChannels.assets.archive, (_event, input: ArchiveAssetCommand) => assetMutations.archiveAsset(input));
  ipcMain.handle(ipcChannels.packing.getList, (_event, query: PackingSlipListQuery | undefined) => foundationReads.getPackingSlips(query));
  ipcMain.handle(ipcChannels.packing.getDetail, (_event, packingSlipId: string) => foundationReads.getPackingSlipDetail(packingSlipId));
  ipcMain.handle(ipcChannels.packing.create, (_event, input: CreatePackingSlipCommand) => packingMutations.createPackingSlip(input));
  ipcMain.handle(ipcChannels.packing.returnItems, (_event, input: ReturnPackingSlipItemsCommand) =>
    packingMutations.returnPackingSlipItems(input),
  );
  ipcMain.handle(ipcChannels.incidents.getList, (_event, query: IncidentListQuery | undefined) => foundationReads.getIncidents(query));
  ipcMain.handle(ipcChannels.incidents.report, (_event, input: ReportIncidentCommand) => incidentMutations.reportIncident(input));
  ipcMain.handle(ipcChannels.projects.getList, (_event, query: ProjectListQuery | undefined) => foundationReads.getProjects(query));
  ipcMain.handle(ipcChannels.projects.getDetail, (_event, projectId: string) => foundationReads.getProjectDetail(projectId));
  ipcMain.handle(ipcChannels.projects.getCatalog, () => foundationReads.getCatalogSnapshot());
  ipcMain.handle(ipcChannels.projects.create, (_event, input: CreateProjectInput) => {
    projectMutations.createProject(input);
    return foundationReads.getProjects();
  });
  ipcMain.handle(ipcChannels.projects.update, (_event, input: UpdateProjectInput) => {
    projectMutations.updateProject(input);
    return foundationReads.getProjects();
  });
  ipcMain.handle(ipcChannels.projects.delete, (_event, input: DeleteProjectInput) => {
    projectMutations.deleteProject(input);
    return foundationReads.getProjects();
  });
  ipcMain.handle(ipcChannels.projects.createUnit, (_event, input: CreateProjectUnitInput) => {
    projectMutations.createProjectUnit(input);
    return foundationReads.getProjectDetail(input.projectId);
  });
  ipcMain.handle(ipcChannels.projects.updateUnit, (_event, input: UpdateProjectUnitInput) => {
    projectMutations.updateProjectUnit(input);
    return foundationReads.getProjectDetail(input.projectId);
  });
  ipcMain.handle(ipcChannels.projects.deleteUnit, (_event, input: DeleteProjectUnitInput) => {
    projectMutations.deleteProjectUnit(input);
    return foundationReads.getProjectDetail(input.projectId);
  });
  ipcMain.handle(ipcChannels.projects.assignCrewToUnit, (_event, input: AssignCrewToProjectUnitInput) => {
    projectMutations.assignCrewToProjectUnit(input);
    return foundationReads.getProjectDetail(input.projectId);
  });
  ipcMain.handle(ipcChannels.projects.unassignCrewFromUnit, (_event, input: UnassignCrewFromProjectUnitInput) => {
    projectMutations.unassignCrewFromProjectUnit(input);
    return foundationReads.getProjectDetail(input.projectId);
  });
  ipcMain.handle(ipcChannels.catalog.getSnapshot, (_event, query: CatalogListQuery | undefined) => foundationReads.getCatalogSnapshot(query));
  ipcMain.handle(ipcChannels.catalog.create, (_event, input: CreateCatalogEntityInput) => {
    catalogMutations.createEntity(input);
    return foundationReads.getCatalogSnapshot();
  });
  ipcMain.handle(ipcChannels.catalog.update, (_event, input: UpdateCatalogEntityInput) => {
    catalogMutations.updateEntity(input);
    return foundationReads.getCatalogSnapshot();
  });
  ipcMain.handle(ipcChannels.catalog.delete, (_event, input: DeleteCatalogEntityInput) => {
    catalogMutations.deleteEntity(input);
    return foundationReads.getCatalogSnapshot();
  });
  ipcMain.handle(ipcChannels.rma.getSnapshot, () => foundationReads.getRmaSnapshot());
  ipcMain.handle(ipcChannels.rma.getDetail, (_event, rmaCaseId: string) => foundationReads.getRmaCaseDetail(rmaCaseId));
  ipcMain.handle(ipcChannels.rma.create, (_event, input: CreateRmaCaseCommand) => rmaMutations.createRmaCase(input));
  ipcMain.handle(ipcChannels.rma.update, (_event, input: UpdateRmaCaseCommand) => rmaMutations.updateRmaCase(input));
  ipcMain.handle(ipcChannels.finance.getOverview, () => foundationReads.getFinanceOverview());
  ipcMain.handle(ipcChannels.finance.getCostLinks, () => foundationReads.getFinanceCostLinks());
  ipcMain.handle(ipcChannels.finance.getEntries, (_event, query: FinanceEntryListQuery | undefined) => foundationReads.getFinanceEntries(query));
};
