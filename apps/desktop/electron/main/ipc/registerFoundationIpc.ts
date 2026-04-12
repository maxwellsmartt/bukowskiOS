import {
  archiveAssetSchema,
  assignAgentModelSchema,
  assignCrewToProjectUnitSchema,
  assignMoveAssetsSchema,
  createAgentSchema,
  createAssetSchema,
  createAssistantThreadSchema,
  createCatalogEntitySchema,
  createDraftRunFromChatSchema,
  createFinancialEntrySchema,
  createPackingSlipSchema,
  createProjectSchema,
  createProjectUnitSchema,
  createRmaCaseSchema,
  deleteAssistantThreadSchema,
  deleteCatalogEntitySchema,
  deleteProjectSchema,
  deleteProjectUnitSchema,
  recordRuntimeErrorSchema,
  reportIncidentSchema,
  resolveIncidentSchema,
  returnPackingSlipItemsSchema,
  reviewAgentRunSchema,
  saveAiProviderConfigSchema,
  sendAssistantChatTurnSchema,
  setActiveAssistantThreadSchema,
  setAgentApprovalModeSchema,
  setAgentStatusSchema,
  testAiProviderConnectionSchema,
  unassignCrewFromProjectUnitSchema,
  updateAgentSchema,
  updateAssetSchema,
  updateAssistantThreadPreferencesSchema,
  updateCatalogEntitySchema,
  updateIncidentSchema,
  updateFinancialEntrySchema,
  updateProjectSchema,
  updateProjectUnitSchema,
  updateRmaCaseSchema,
} from "@contracts";
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
  CreateFinancialEntryCommand,
  CreatePackingSlipCommand,
  CreateRmaCaseCommand,
  CreateProjectInput,
  CreateProjectUnitInput,
  DeleteCatalogEntityInput,
  DeleteProjectInput,
  DeleteProjectUnitInput,
  FinanceEntryListQuery,
  FinanceEntryMutationResult,
  GlobalSearchQuery,
  IncidentListQuery,
  PackingSlipListQuery,
  ProjectListQuery,
  ReportIncidentCommand,
  ResolveIncidentCommand,
  ReturnPackingSlipItemsCommand,
  ScheduleTimelineRange,
  ScheduleTimelineScale,
  ScheduleTimelineSnapshot,
  UnassignCrewFromProjectUnitInput,
  UpdateAssetCommand,
  UpdateCatalogEntityInput,
  UpdateFinancialEntryCommand,
  UpdateIncidentCommand,
  UpdateProjectInput,
  UpdateProjectUnitInput,
  UpdateRmaCaseCommand,
  UpdateAgentCommand,
} from "@contracts";

import { ipcChannels } from "@contracts";

import type { FoundationReadService } from "../services/data/foundationReadService";
import { safeHandle, safeHandleRead } from "./ipcSafeHandler";

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
    updateIncident: (input: UpdateIncidentCommand) => unknown;
    resolveIncident: (input: ResolveIncidentCommand) => unknown;
  };
  financeMutations: {
    createEntry: (input: CreateFinancialEntryCommand) => FinanceEntryMutationResult;
    updateEntry: (input: UpdateFinancialEntryCommand) => FinanceEntryMutationResult;
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
    financeMutations,
    packingMutations,
  rmaMutations,
  agentMutations,
  runtimeDiagnostics,
}: RegisterFoundationIpcOptions) => {
  safeHandleRead(ipcChannels.shell.getBootstrap, () => foundationReads.getShellBootstrap(), "The app could not load the shell bootstrap.");
  safeHandleRead(
    ipcChannels.shell.searchGlobal,
    (_event, query: GlobalSearchQuery) => foundationReads.getGlobalSearch(query),
    "The app could not complete that search.",
  );
  safeHandleRead(
    ipcChannels.agents.getMissionControlSnapshot,
    () => agentReads.getMissionControlSnapshot(),
    "The app could not load Mission Control.",
  );
  safeHandleRead(ipcChannels.agents.getAgentsList, () => agentReads.getAgentsList(), "The app could not load the agents list.");
  safeHandleRead(
    ipcChannels.agents.getAgentDetail,
    (_event, agentId: string) => agentReads.getAgentDetail(agentId),
    "The app could not load that agent.",
  );
  safeHandleRead(ipcChannels.agents.getRunsList, () => agentReads.getRunsList(), "The app could not load the run history.");
  safeHandleRead(
    ipcChannels.agents.getModelsSnapshot,
    () => agentReads.getModelsSnapshot(),
    "The app could not load the models snapshot.",
  );
  safeHandleRead(
    ipcChannels.agents.getAIProviderConfigs,
    () => agentReads.getAIProviderConfigs(),
    "The app could not load AI provider settings.",
  );
  safeHandleRead(
    ipcChannels.agents.getConnectorsSnapshot,
    () => agentReads.getConnectorsSnapshot(),
    "The app could not load the connectors snapshot.",
  );
  safeHandleRead(
    ipcChannels.agents.getAssistantChatSnapshot,
    () => agentMutations.getAssistantChatSnapshot(),
    "The app could not load the assistant chat.",
  );
  safeHandle(ipcChannels.agents.create, createAgentSchema, (_event, input) => agentMutations.createAgent(input));
  safeHandle(ipcChannels.agents.update, updateAgentSchema, (_event, input) => agentMutations.updateAgent(input));
  safeHandle(ipcChannels.agents.setStatus, setAgentStatusSchema, (_event, input) => agentMutations.setAgentStatus(input));
  safeHandle(
    ipcChannels.agents.setApprovalMode,
    setAgentApprovalModeSchema,
    (_event, input) => agentMutations.setAgentApprovalMode(input),
  );
  safeHandle(
    ipcChannels.agents.saveAIProviderConfig,
    saveAiProviderConfigSchema,
    (_event, input) => agentMutations.saveAIProviderConfig(input),
  );
  safeHandle(
    ipcChannels.agents.testAIProviderConnection,
    testAiProviderConnectionSchema,
    (_event, input) => agentMutations.testAIProviderConnection(input),
  );
  safeHandle(
    ipcChannels.agents.assignAgentModel,
    assignAgentModelSchema,
    (_event, input) => agentMutations.assignAgentModel(input),
  );
  safeHandle(
    ipcChannels.agents.createAssistantThread,
    createAssistantThreadSchema,
    (_event, input) => agentMutations.createAssistantThread(input),
  );
  safeHandle(
    ipcChannels.agents.deleteAssistantThread,
    deleteAssistantThreadSchema,
    (_event, input) => agentMutations.deleteAssistantThread(input),
  );
  safeHandle(
    ipcChannels.agents.setActiveAssistantThread,
    setActiveAssistantThreadSchema,
    (_event, input) => agentMutations.setActiveAssistantThread(input),
  );
  safeHandle(
    ipcChannels.agents.updateAssistantThreadPreferences,
    updateAssistantThreadPreferencesSchema,
    (_event, input) => agentMutations.updateAssistantThreadPreferences(input),
  );
  safeHandle(
    ipcChannels.agents.sendAssistantChatTurn,
    sendAssistantChatTurnSchema,
    (_event, input) => agentMutations.sendAssistantChatTurn(input),
  );
  safeHandle(ipcChannels.agents.reviewRun, reviewAgentRunSchema, (_event, input) => agentMutations.reviewRun(input));
  safeHandle(
    ipcChannels.agents.sendAssistantMessage,
    sendAssistantChatTurnSchema,
    (_event, input) => agentMutations.sendAssistantMessage(input),
  );
  safeHandle(
    ipcChannels.agents.createDraftRunFromChat,
    createDraftRunFromChatSchema,
    (_event, input) => agentMutations.createDraftRunFromChat(input),
  );
  safeHandle(
    ipcChannels.app.reportRuntimeError,
    recordRuntimeErrorSchema,
    (_event, input) => runtimeDiagnostics.recordRuntimeError(input),
  );
  safeHandleRead(ipcChannels.overview.getSnapshot, () => foundationReads.getOverviewSnapshot(), "The app could not load the overview.");
  safeHandleRead(
    ipcChannels.overview.getTimeline,
    (_event, range: ScheduleTimelineRange, scale: ScheduleTimelineScale, anchorDate?: string) =>
      foundationReads.getScheduleTimeline(range, scale, anchorDate),
    "The app could not load the schedule timeline.",
  );
  safeHandleRead(ipcChannels.assets.getList, (_event, query: AssetListQuery | undefined) => foundationReads.getAssets(query), "The app could not load assets.");
  safeHandleRead(ipcChannels.assets.getSummary, () => foundationReads.getAssetSummary(), "The app could not load the asset summary.");
  safeHandleRead(ipcChannels.assets.getOverview, () => foundationReads.getAssetsOverview(), "The app could not load the asset overview.");
  safeHandleRead(
    ipcChannels.assets.getDetail,
    (_event, assetId: string) => foundationReads.getAssetDetail(assetId),
    "The app could not load that asset.",
  );
  safeHandle(ipcChannels.assets.assignMove, assignMoveAssetsSchema, (_event, input) => assetMutations.assignMoveAssets(input));
  safeHandle(ipcChannels.assets.create, createAssetSchema, (_event, input) => assetMutations.createAsset(input));
  safeHandle(ipcChannels.assets.update, updateAssetSchema, (_event, input) => assetMutations.updateAsset(input));
  safeHandle(ipcChannels.assets.archive, archiveAssetSchema, (_event, input) => assetMutations.archiveAsset(input));
  safeHandleRead(
    ipcChannels.packing.getList,
    (_event, query: PackingSlipListQuery | undefined) => foundationReads.getPackingSlips(query),
    "The app could not load packing slips.",
  );
  safeHandleRead(
    ipcChannels.packing.getDetail,
    (_event, packingSlipId: string) => foundationReads.getPackingSlipDetail(packingSlipId),
    "The app could not load that packing slip.",
  );
  safeHandle(ipcChannels.packing.create, createPackingSlipSchema, (_event, input) => packingMutations.createPackingSlip(input));
  safeHandle(ipcChannels.packing.returnItems, returnPackingSlipItemsSchema, (_event, input) =>
    packingMutations.returnPackingSlipItems(input),
  );
  safeHandleRead(
    ipcChannels.incidents.getList,
    (_event, query: IncidentListQuery | undefined) => foundationReads.getIncidents(query),
    "The app could not load incidents.",
  );
  safeHandleRead(
    ipcChannels.incidents.getDetail,
    (_event, incidentId: string) => foundationReads.getIncidentDetail(incidentId),
    "The app could not load that incident.",
  );
  safeHandle(ipcChannels.incidents.report, reportIncidentSchema, (_event, input) => incidentMutations.reportIncident(input));
  safeHandle(ipcChannels.incidents.update, updateIncidentSchema, (_event, input) => incidentMutations.updateIncident(input));
  safeHandle(ipcChannels.incidents.resolve, resolveIncidentSchema, (_event, input) => incidentMutations.resolveIncident(input));
  safeHandleRead(
    ipcChannels.projects.getList,
    (_event, query: ProjectListQuery | undefined) => foundationReads.getProjects(query),
    "The app could not load projects.",
  );
  safeHandleRead(
    ipcChannels.projects.getDetail,
    (_event, projectId: string) => foundationReads.getProjectDetail(projectId),
    "The app could not load that project.",
  );
  safeHandleRead(ipcChannels.projects.getCatalog, () => foundationReads.getCatalogSnapshot(), "The app could not load the catalog.");
  safeHandle(ipcChannels.projects.create, createProjectSchema, (_event, input) => {
    projectMutations.createProject(input);
    return foundationReads.getProjects();
  });
  safeHandle(ipcChannels.projects.update, updateProjectSchema, (_event, input) => {
    projectMutations.updateProject(input);
    return foundationReads.getProjects();
  });
  safeHandle(ipcChannels.projects.delete, deleteProjectSchema, (_event, input) => {
    projectMutations.deleteProject(input);
    return foundationReads.getProjects();
  });
  safeHandle(ipcChannels.projects.createUnit, createProjectUnitSchema, (_event, input) => {
    projectMutations.createProjectUnit(input);
    return foundationReads.getProjectDetail(input.projectId);
  });
  safeHandle(ipcChannels.projects.updateUnit, updateProjectUnitSchema, (_event, input) => {
    projectMutations.updateProjectUnit(input);
    return foundationReads.getProjectDetail(input.projectId);
  });
  safeHandle(ipcChannels.projects.deleteUnit, deleteProjectUnitSchema, (_event, input) => {
    projectMutations.deleteProjectUnit(input);
    return foundationReads.getProjectDetail(input.projectId);
  });
  safeHandle(ipcChannels.projects.assignCrewToUnit, assignCrewToProjectUnitSchema, (_event, input) => {
    projectMutations.assignCrewToProjectUnit(input);
    return foundationReads.getProjectDetail(input.projectId);
  });
  safeHandle(ipcChannels.projects.unassignCrewFromUnit, unassignCrewFromProjectUnitSchema, (_event, input) => {
    projectMutations.unassignCrewFromProjectUnit(input);
    return foundationReads.getProjectDetail(input.projectId);
  });
  safeHandleRead(
    ipcChannels.catalog.getSnapshot,
    (_event, query: CatalogListQuery | undefined) => foundationReads.getCatalogSnapshot(query),
    "The app could not load the catalog snapshot.",
  );
  safeHandle(ipcChannels.catalog.create, createCatalogEntitySchema, (_event, input) => {
    catalogMutations.createEntity(input);
    return foundationReads.getCatalogSnapshot();
  });
  safeHandle(ipcChannels.catalog.update, updateCatalogEntitySchema, (_event, input) => {
    catalogMutations.updateEntity(input);
    return foundationReads.getCatalogSnapshot();
  });
  safeHandle(ipcChannels.catalog.delete, deleteCatalogEntitySchema, (_event, input) => {
    catalogMutations.deleteEntity(input);
    return foundationReads.getCatalogSnapshot();
  });
  safeHandleRead(ipcChannels.rma.getSnapshot, () => foundationReads.getRmaSnapshot(), "The app could not load the RMA snapshot.");
  safeHandleRead(
    ipcChannels.rma.getDetail,
    (_event, rmaCaseId: string) => foundationReads.getRmaCaseDetail(rmaCaseId),
    "The app could not load that RMA case.",
  );
  safeHandle(ipcChannels.rma.create, createRmaCaseSchema, (_event, input) => rmaMutations.createRmaCase(input));
  safeHandle(ipcChannels.rma.update, updateRmaCaseSchema, (_event, input) => rmaMutations.updateRmaCase(input));
  safeHandleRead(ipcChannels.finance.getOverview, () => foundationReads.getFinanceOverview(), "The app could not load finance overview.");
  safeHandleRead(ipcChannels.finance.getCostLinks, () => foundationReads.getFinanceCostLinks(), "The app could not load finance cost links.");
  safeHandleRead(
    ipcChannels.finance.getEntries,
    (_event, query: FinanceEntryListQuery | undefined) => foundationReads.getFinanceEntries(query),
    "The app could not load finance entries.",
  );
  safeHandle(ipcChannels.finance.create, createFinancialEntrySchema, (_event, input) => financeMutations.createEntry(input));
  safeHandle(ipcChannels.finance.update, updateFinancialEntrySchema, (_event, input) => financeMutations.updateEntry(input));
};
