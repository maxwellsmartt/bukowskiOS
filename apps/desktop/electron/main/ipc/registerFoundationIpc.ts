import { app, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";

import {
  archiveProjectSchema,
  archiveAssetSchema,
  assignAgentModelSchema,
  assignCrewToProjectUnitSchema,
  assignMoveAssetsSchema,
  createAgentSchema,
  createAssetSchema,
  createAssistantThreadSchema,
  createCatalogEntitySchema,
  createConnectorLinkTokenSchema,
  deleteCatalogEntitiesSchema,
  createDraftRunFromChatSchema,
  createFinancialEntrySchema,
  createPackingSlipSchema,
  createProjectBlueprintReadArgsSchema,
  createProjectBlueprintSchema,
  createProjectSchema,
  createProjectUnitSchema,
  createRmaCaseSchema,
  idReadArgsSchema,
  deleteAssistantThreadSchema,
  deleteCatalogEntitySchema,
  exportCatalogCsvSchema,
  deleteProjectSchema,
  deleteProjectUnitSchema,
  emptyReadArgsSchema,
  financeEntryListReadArgsSchema,
  financeOverviewReadArgsSchema,
  globalSearchReadArgsSchema,
  assetListReadArgsSchema,
  assetWorkspaceReadArgsSchema,
  incidentListReadArgsSchema,
  packingSlipListReadArgsSchema,
  projectListReadArgsSchema,
  catalogListReadArgsSchema,
  recordRuntimeErrorSchema,
  reportIncidentSchema,
  resolveIncidentSchema,
  returnPackingSlipItemsSchema,
  importCatalogCsvSchema,
  previewCatalogCsvImportSchema,
  rmaSnapshotReadArgsSchema,
  reviewAgentRunSchema,
  saveAiProviderConfigSchema,
  saveConnectorConfigSchema,
  sendAssistantChatTurnSchema,
  setActiveAssistantThreadSchema,
  setAgentApprovalModeSchema,
  setAgentStatusSchema,
  testConnectorConnectionSchema,
  testAiProviderConnectionSchema,
  unarchiveProjectSchema,
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
  scheduleTimelineReadArgsSchema,
  uploadCrewCatalogDocumentsReadArgsSchema,
  DEFAULT_WORKSPACE_ID,
} from "@contracts";
import type {
  AssistantChatSnapshot,
  AssignAgentModelCommand,
  CreateAssistantThreadCommand,
  AssistantGatewayRequest,
  SaveAIProviderConfigCommand,
  SaveConnectorConfigCommand,
  TestAIProviderConnectionCommand,
  TestConnectorConnectionCommand,
  AssistantGatewayResponse,
  DeleteAssistantThreadCommand,
  CreateAgentCommand,
  ArchiveAssetCommand,
  ArchiveProjectInput,
  CreateDraftRunFromChatCommand,
  CreateConnectorLinkTokenCommand,
  RecordRuntimeErrorCommand,
  ReviewAgentRunCommand,
  SendAssistantChatTurnCommand,
  AssetListQuery,
  AssetWorkspaceQuery,
  SetActiveAssistantThreadCommand,
  UpdateAssistantThreadPreferencesCommand,
  SetAgentApprovalModeCommand,
  SetAgentStatusCommand,
  AssignMoveAssetsInput,
  AssignCrewToProjectUnitInput,
  CatalogListQuery,
  CatalogCsvImportResult,
  CatalogCsvImportPreview,
  CreateAssetCommand,
  CreateCatalogEntityInput,
  CreateFinancialEntryCommand,
  CreatePackingSlipCommand,
  CreateProjectBlueprintInput,
  CreateRmaCaseCommand,
  CreateProjectInput,
  CreateProjectUnitInput,
  DeleteCatalogEntityInput,
  DeleteCatalogEntitiesInput,
  ExportCatalogCsvInput,
  DeleteProjectInput,
  DeleteProjectUnitInput,
  FinanceEntryListQuery,
  FinanceOverviewQuery,
  FinanceEntryMutationResult,
  GlobalSearchQuery,
  IncidentListQuery,
  PackingSlipListQuery,
  ProjectListQuery,
  ReportIncidentCommand,
  ResolveIncidentCommand,
  ReturnPackingSlipItemsCommand,
  RmaSnapshotQuery,
  ScheduleTimelineQuery,
  ScheduleTimelineRange,
  ScheduleTimelineScale,
  ScheduleTimelineSnapshot,
  UnarchiveProjectInput,
  UnassignCrewFromProjectUnitInput,
  PreviewCatalogCsvImportInput,
  ImportCatalogCsvInput,
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
import type { WorkspaceAccessGuard } from "../services/auth/workspaceAccessGuard";
import { safeHandle, safeHandleRead, safeHandleReadWithSchema } from "./ipcSafeHandler";

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
    createProjectBlueprint: (input: CreateProjectBlueprintInput) => void;
    updateProject: (input: UpdateProjectInput) => void;
    archiveProject: (input: ArchiveProjectInput) => void;
    unarchiveProject: (input: UnarchiveProjectInput) => void;
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
    deleteEntities: (input: DeleteCatalogEntitiesInput) => void;
    buildCsvExport: (input: ExportCatalogCsvInput) => { fileName: string; csvText: string };
    previewCsvImport: (input: PreviewCatalogCsvImportInput) => CatalogCsvImportPreview;
    importCsv: (input: ImportCatalogCsvInput) => CatalogCsvImportResult;
  };
  assetMutations: {
    assignMoveAssets: (input: AssignMoveAssetsInput) => unknown;
    createAsset: (input: CreateAssetCommand) => unknown;
    updateAsset: (input: UpdateAssetCommand) => unknown;
    archiveAsset: (input: ArchiveAssetCommand) => unknown;
  };
  workspaceAccess: WorkspaceAccessGuard;
  fileUploads: {
    importAssetFiles: (assetId: string, sourceFilePaths: string[]) => unknown;
    importIncidentFiles: (incidentId: string, sourceFilePaths: string[]) => unknown;
    importFinanceDocuments: (entryId: string, sourceFilePaths: string[]) => unknown;
    importCrewDocuments: (crewMemberId: string, sourceFilePaths: string[]) => unknown;
    openAssetFile: (fileId: string) => Promise<void>;
    openIncidentFile: (fileId: string) => Promise<void>;
    openFinanceDocument: (fileId: string) => Promise<void>;
    openCrewDocument: (fileId: string) => Promise<void>;
    deleteCrewDocument: (fileId: string) => { deletedCount: number; summary: string };
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
  exportPackingSlipPdf: (
    packingSlipId: string,
    targetFilePath: string,
  ) => Promise<{
    fileName: string;
    mimeType: "application/pdf";
    buffer: Buffer;
    targetFilePath: string;
  }>;
  exportFinanceReportPdf: (
    query: FinanceOverviewQuery | undefined,
    targetFilePath: string,
  ) => Promise<{
    fileName: string;
    mimeType: "application/pdf";
      buffer: Buffer;
      targetFilePath: string;
    }>;
  exportProjectBlueprintPdf: (
    input: CreateProjectBlueprintInput,
    targetFilePath: string,
  ) => Promise<{
    fileName: string;
    mimeType: "application/pdf";
    buffer: Buffer;
    targetFilePath: string;
  }>;
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
    saveConnectorConfig: (input: SaveConnectorConfigCommand) => unknown;
    testAIProviderConnection: (input: TestAIProviderConnectionCommand) => unknown;
    testConnectorConnection: (input: TestConnectorConnectionCommand) => unknown;
    createConnectorLinkToken: (input: CreateConnectorLinkTokenCommand) => unknown;
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
  workspaceAccess,
  fileUploads,
  incidentMutations,
  financeMutations,
  packingMutations,
  exportFinanceReportPdf,
  exportPackingSlipPdf,
  exportProjectBlueprintPdf,
  rmaMutations,
  agentMutations,
  runtimeDiagnostics,
}: RegisterFoundationIpcOptions) => {
  const normalizeProjectListQuery = (query: ProjectListQuery | undefined): ProjectListQuery => ({
    workspaceId: query?.workspaceId ?? DEFAULT_WORKSPACE_ID,
    search: query?.search ?? "",
    sortBy: query?.sortBy ?? "name",
    sortDirection: query?.sortDirection ?? "asc",
    includeArchived: query?.includeArchived,
  });

  safeHandleReadWithSchema(
    ipcChannels.shell.getBootstrap,
    emptyReadArgsSchema,
    () => foundationReads.getShellBootstrap(),
    "The app could not load the shell bootstrap.",
  );
  safeHandleReadWithSchema(
    ipcChannels.shell.searchGlobal,
    globalSearchReadArgsSchema,
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
    ipcChannels.agents.saveConnectorConfig,
    saveConnectorConfigSchema,
    (_event, input) => agentMutations.saveConnectorConfig(input),
  );
  safeHandle(
    ipcChannels.agents.testAIProviderConnection,
    testAiProviderConnectionSchema,
    (_event, input) => agentMutations.testAIProviderConnection(input),
  );
  safeHandle(
    ipcChannels.agents.testConnectorConnection,
    testConnectorConnectionSchema,
    (_event, input) => agentMutations.testConnectorConnection(input),
  );
  safeHandle(
    ipcChannels.agents.createConnectorLinkToken,
    createConnectorLinkTokenSchema,
    (_event, input) => agentMutations.createConnectorLinkToken(input),
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
  safeHandleReadWithSchema(
    ipcChannels.overview.getSnapshot,
    emptyReadArgsSchema,
    () => foundationReads.getOverviewSnapshot(),
    "The app could not load the overview.",
  );
  safeHandleReadWithSchema(
    ipcChannels.overview.getTimeline,
    scheduleTimelineReadArgsSchema,
    async (
      _event,
      range: ScheduleTimelineRange,
      scale: ScheduleTimelineScale,
      anchorDate?: string,
      query?: ScheduleTimelineQuery,
    ) => {
      if (query?.workspaceId) {
        await workspaceAccess.assertWorkspaceAccess({
          workspaceId: query.workspaceId,
          action: "load schedule overview",
          accessLevel: "read",
          requiredPermission: "projects.read",
        });
      }

      return foundationReads.getScheduleTimeline(range, scale, anchorDate, query);
    },
    "The app could not load the schedule timeline.",
  );
  safeHandleReadWithSchema(
    ipcChannels.assets.getList,
    assetListReadArgsSchema,
    async (_event, query: AssetListQuery | undefined) => {
      if (query?.workspaceId) {
        await workspaceAccess.assertWorkspaceAccess({
          workspaceId: query.workspaceId,
          action: "load assets",
          accessLevel: "read",
          requiredPermission: "assets.read",
        });
      }

      return foundationReads.getAssets(query);
    },
    "The app could not load assets.",
  );
  safeHandleReadWithSchema(
    ipcChannels.assets.getSummary,
    assetWorkspaceReadArgsSchema,
    async (_event, query: AssetWorkspaceQuery | undefined) => {
      if (query?.workspaceId) {
        await workspaceAccess.assertWorkspaceAccess({
          workspaceId: query.workspaceId,
          action: "load the asset summary",
          accessLevel: "read",
          requiredPermission: "assets.read",
        });
      }

      return foundationReads.getAssetSummary(query);
    },
    "The app could not load the asset summary.",
  );
  safeHandleReadWithSchema(
    ipcChannels.assets.getOverview,
    assetWorkspaceReadArgsSchema,
    async (_event, query: AssetWorkspaceQuery | undefined) => {
      if (query?.workspaceId) {
        await workspaceAccess.assertWorkspaceAccess({
          workspaceId: query.workspaceId,
          action: "load the asset overview",
          accessLevel: "read",
          requiredPermission: "assets.read",
        });
      }

      return foundationReads.getAssetsOverview(query);
    },
    "The app could not load the asset overview.",
  );
  safeHandleReadWithSchema(
    ipcChannels.assets.getDetail,
    idReadArgsSchema,
    async (_event, assetId: string) => {
      await workspaceAccess.assertAssetAccess(assetId, "load that asset", "read", "assets.read");
      return foundationReads.getAssetDetail(assetId);
    },
    "The app could not load that asset.",
  );
  safeHandle(ipcChannels.assets.assignMove, assignMoveAssetsSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "assign or move assets",
      accessLevel: "write",
      requiredPermission: "assets.manage",
    });

    return assetMutations.assignMoveAssets(input);
  });
  safeHandle(ipcChannels.assets.create, createAssetSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "create assets",
      accessLevel: "write",
      requiredPermission: "assets.manage",
    });

    return assetMutations.createAsset(input);
  });
  safeHandle(ipcChannels.assets.update, updateAssetSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "update assets",
      accessLevel: "write",
      requiredPermission: "assets.manage",
    });

    return assetMutations.updateAsset(input);
  });
  safeHandle(ipcChannels.assets.archive, archiveAssetSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "archive assets",
      accessLevel: "write",
      requiredPermission: "assets.manage",
    });

    return assetMutations.archiveAsset(input);
  });
  safeHandleReadWithSchema(
    ipcChannels.assets.uploadFiles,
    idReadArgsSchema,
    async (_event, assetId: string) => {
      await workspaceAccess.assertAssetAccess(assetId, "attach files to that asset", "write", "assets.manage");
      const detail = foundationReads.getAssetDetail(assetId);

      if (!detail.asset) {
        throw new Error("Asset was not found.");
      }

      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: `Attach files to ${detail.asset.name}`,
        buttonLabel: "Attach files",
        properties: ["openFile", "multiSelections"],
        filters: [
          { name: "Supported files", extensions: ["png", "jpg", "jpeg", "webp", "gif", "heic", "pdf"] },
          { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "heic"] },
          { name: "PDF", extensions: ["pdf"] },
        ],
      });

      if (canceled || !filePaths.length) {
        return {
          uploadedCount: 0,
          summary: "No asset files were selected.",
        };
      }

      return fileUploads.importAssetFiles(assetId, filePaths);
    },
    "The app could not attach files to that asset.",
  );
  safeHandleReadWithSchema(
    ipcChannels.assets.openFile,
    idReadArgsSchema,
    async (_event, fileId: string) => {
      await workspaceAccess.assertAssetFileAccess(fileId, "open that asset file", "read", "assets.read");
      await fileUploads.openAssetFile(fileId);
      return null;
    },
    "The app could not open that asset file.",
  );
  safeHandleReadWithSchema(
    ipcChannels.packing.getList,
    packingSlipListReadArgsSchema,
    async (_event, query: PackingSlipListQuery | undefined) => {
      if (!query?.workspaceId) {
        throw new Error("Workspace scope is required to load packing slips.");
      }

      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load packing slips",
        accessLevel: "read",
        requiredPermission: "packing-slips.read",
      });

      return foundationReads.getPackingSlips(query);
    },
    "The app could not load packing slips.",
  );
  safeHandleReadWithSchema(
    ipcChannels.packing.getDetail,
    idReadArgsSchema,
    async (_event, packingSlipId: string) => {
      await workspaceAccess.assertPackingSlipAccess(packingSlipId, "load that packing slip", "read", "packing-slips.read");
      return foundationReads.getPackingSlipDetail(packingSlipId);
    },
    "The app could not load that packing slip.",
  );
  safeHandleReadWithSchema(
    ipcChannels.packing.exportPdf,
    idReadArgsSchema,
    async (_event, packingSlipId: string) => {
      await workspaceAccess.assertPackingSlipAccess(packingSlipId, "export that packing slip", "read", "packing-slips.read");
      const detail = foundationReads.getPackingSlipDetail(packingSlipId);

      if (!detail.slip) {
        throw new Error("Packing slip was not found.");
      }

      const { canceled, filePath } = await dialog.showSaveDialog({
        title: "Export packing slip PDF",
        defaultPath: path.join(app.getPath("documents"), `${detail.slip.number}.pdf`),
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (canceled || !filePath) {
        return {
          saved: false,
          fileName: null,
          savedPath: null,
          summary: "Packing slip PDF export cancelled.",
        };
      }

      const pdf = await exportPackingSlipPdf(packingSlipId, filePath);
      fs.writeFileSync(filePath, pdf.buffer);

      return {
        saved: true,
        fileName: path.basename(filePath),
        savedPath: filePath,
        summary: `Exported ${pdf.fileName} to ${path.basename(filePath)}.`,
      };
    },
    "The app could not export that packing slip PDF.",
  );
  safeHandle(ipcChannels.packing.create, createPackingSlipSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "create packing slips",
      accessLevel: "write",
      requiredPermission: "packing-slips.create",
    });

    return packingMutations.createPackingSlip(input);
  });
  safeHandle(ipcChannels.packing.returnItems, returnPackingSlipItemsSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "return packing slip items",
      accessLevel: "write",
      requiredPermission: "packing-slips.create",
    });

    return packingMutations.returnPackingSlipItems(input);
  });
  safeHandleReadWithSchema(
    ipcChannels.incidents.getList,
    incidentListReadArgsSchema,
    async (_event, query: IncidentListQuery | undefined) => {
      if (!query?.workspaceId) {
        throw new Error("Workspace scope is required to load incidents.");
      }

      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load incidents",
        accessLevel: "read",
        requiredPermission: "incidents.read",
      });

      return foundationReads.getIncidents(query);
    },
    "The app could not load incidents.",
  );
  safeHandleReadWithSchema(
    ipcChannels.incidents.getDetail,
    idReadArgsSchema,
    async (_event, incidentId: string) => {
      await workspaceAccess.assertIncidentAccess(incidentId, "load that incident", "read", "incidents.read");
      return foundationReads.getIncidentDetail(incidentId);
    },
    "The app could not load that incident.",
  );
  safeHandle(ipcChannels.incidents.report, reportIncidentSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "report incidents",
      accessLevel: "write",
      requiredPermission: "incidents.create",
    });

    return incidentMutations.reportIncident(input);
  });
  safeHandle(ipcChannels.incidents.update, updateIncidentSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "update incidents",
      accessLevel: "write",
      requiredPermission: "incidents.create",
    });

    return incidentMutations.updateIncident(input);
  });
  safeHandle(ipcChannels.incidents.resolve, resolveIncidentSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "resolve incidents",
      accessLevel: "write",
      requiredPermission: "incidents.create",
    });

    return incidentMutations.resolveIncident(input);
  });
  safeHandleReadWithSchema(
    ipcChannels.incidents.uploadFiles,
    idReadArgsSchema,
    async (_event, incidentId: string) => {
      await workspaceAccess.assertIncidentAccess(incidentId, "attach files to that incident", "write", "incidents.create");
      const detail = foundationReads.getIncidentDetail(incidentId);

      if (!detail.incident) {
        throw new Error("Incident was not found.");
      }

      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: `Attach evidence to ${detail.incident.title}`,
        buttonLabel: "Attach evidence",
        properties: ["openFile", "multiSelections"],
        filters: [
          { name: "Supported files", extensions: ["png", "jpg", "jpeg", "webp", "gif", "heic", "pdf"] },
          { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "heic"] },
          { name: "PDF", extensions: ["pdf"] },
        ],
      });

      if (canceled || !filePaths.length) {
        return {
          uploadedCount: 0,
          summary: "No incident evidence files were selected.",
        };
      }

      return fileUploads.importIncidentFiles(incidentId, filePaths);
    },
    "The app could not attach files to that incident.",
  );
  safeHandleReadWithSchema(
    ipcChannels.incidents.openFile,
    idReadArgsSchema,
    async (_event, fileId: string) => {
      await workspaceAccess.assertIncidentFileAccess(fileId, "open that incident file", "read", "incidents.read");
      await fileUploads.openIncidentFile(fileId);
      return null;
    },
    "The app could not open that incident file.",
  );
  safeHandleReadWithSchema(
    ipcChannels.projects.getList,
    projectListReadArgsSchema,
    async (_event, query: ProjectListQuery | undefined) => {
      const scopedQuery = normalizeProjectListQuery(query);
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: scopedQuery.workspaceId ?? DEFAULT_WORKSPACE_ID,
        action: "load projects",
        accessLevel: "read",
        requiredPermission: "projects.read",
      });
      return foundationReads.getProjects(scopedQuery);
    },
    "The app could not load projects.",
  );
  safeHandleReadWithSchema(
    ipcChannels.projects.getDetail,
    idReadArgsSchema,
    async (_event, projectId: string) => {
      await workspaceAccess.assertProjectAccess(projectId, "load that project", "read", "projects.read");
      return foundationReads.getProjectDetail(projectId);
    },
    "The app could not load that project.",
  );
  safeHandleReadWithSchema(
    ipcChannels.projects.getDeletePreview,
    idReadArgsSchema,
    async (_event, projectId: string) => {
      await workspaceAccess.assertProjectAccess(projectId, "load that project lifecycle preview", "read", "projects.manage");
      return foundationReads.getProjectDeletePreview(projectId);
    },
    "The app could not load that project lifecycle preview.",
  );
  safeHandleRead(ipcChannels.projects.getCatalog, () => foundationReads.getCatalogSnapshot(), "The app could not load the catalog.");
  safeHandle(ipcChannels.projects.create, createProjectSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "create projects",
      accessLevel: "write",
      requiredPermission: "projects.manage",
    });
    projectMutations.createProject(input);
    return foundationReads.getProjects(normalizeProjectListQuery({ workspaceId: input.workspaceId, search: "", sortBy: "name", sortDirection: "asc" }));
  });
  safeHandleReadWithSchema(
    ipcChannels.projects.getStagingPackingSlips,
    emptyReadArgsSchema,
    () => foundationReads.getStagingPackingSlips(),
    "The app could not load staging packing slips.",
  );
  safeHandleReadWithSchema(
    ipcChannels.projects.getCreationConflicts,
    createProjectBlueprintReadArgsSchema,
    async (_event, input: CreateProjectBlueprintInput) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: input.workspaceId,
        action: "preview project setup",
        accessLevel: "read",
        requiredPermission: "projects.read",
      });
      return foundationReads.getProjectCreationConflicts(input);
    },
    "The app could not preview project setup conflicts.",
  );
  safeHandle(ipcChannels.projects.createBlueprint, createProjectBlueprintSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "create projects",
      accessLevel: "write",
      requiredPermission: "projects.manage",
    });
    projectMutations.createProjectBlueprint(input);
    return foundationReads.getProjects(normalizeProjectListQuery({ workspaceId: input.workspaceId, search: "", sortBy: "name", sortDirection: "asc" }));
  });
  safeHandleReadWithSchema(
    ipcChannels.projects.exportBlueprintPdf,
    createProjectBlueprintReadArgsSchema,
    async (_event, input: CreateProjectBlueprintInput) => {
      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: input.workspaceId,
        action: "export project setup",
        accessLevel: "read",
        requiredPermission: "projects.read",
      });
      const baseName = input.generalInfo.code?.trim() || input.generalInfo.name?.trim() || "project-setup-summary";
      const safeBaseName = baseName.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "project-setup-summary";
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: "Export project setup summary",
        defaultPath: path.join(app.getPath("documents"), `${safeBaseName}.pdf`),
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (canceled || !filePath) {
        return {
          saved: false,
          fileName: null,
          savedPath: null,
          summary: "Project setup summary export cancelled.",
        };
      }

      const pdf = await exportProjectBlueprintPdf(input, filePath);
      fs.writeFileSync(filePath, pdf.buffer);

      return {
        saved: true,
        fileName: path.basename(filePath),
        savedPath: filePath,
        summary: `Exported ${pdf.fileName} to ${path.basename(filePath)}.`,
      };
    },
    "The app could not export that project setup summary.",
  );
  safeHandle(ipcChannels.projects.update, updateProjectSchema, async (_event, input) => {
    const workspaceId = await workspaceAccess.assertProjectAccess(input.projectId, "update that project", "write", "projects.manage");
    projectMutations.updateProject(input);
    return foundationReads.getProjects(normalizeProjectListQuery({ workspaceId, search: "", sortBy: "name", sortDirection: "asc" }));
  });
  safeHandle(ipcChannels.projects.archive, archiveProjectSchema, async (_event, input) => {
    const workspaceId = await workspaceAccess.assertProjectAccess(input.projectId, "archive that project", "write", "projects.manage");
    projectMutations.archiveProject(input);
    return foundationReads.getProjects({ workspaceId, search: "", sortBy: "name", sortDirection: "asc", includeArchived: true });
  });
  safeHandle(ipcChannels.projects.unarchive, unarchiveProjectSchema, async (_event, input) => {
    const workspaceId = await workspaceAccess.assertProjectAccess(input.projectId, "restore that project", "write", "projects.manage");
    projectMutations.unarchiveProject(input);
    return foundationReads.getProjects({ workspaceId, search: "", sortBy: "name", sortDirection: "asc", includeArchived: true });
  });
  safeHandle(ipcChannels.projects.delete, deleteProjectSchema, async (_event, input) => {
    const workspaceId = await workspaceAccess.assertProjectAccess(input.projectId, "delete that project", "write", "projects.manage");
    projectMutations.deleteProject(input);
    return foundationReads.getProjects(normalizeProjectListQuery({ workspaceId, search: "", sortBy: "name", sortDirection: "asc" }));
  });
  safeHandle(ipcChannels.projects.createUnit, createProjectUnitSchema, async (_event, input) => {
    await workspaceAccess.assertProjectAccess(input.projectId, "create project units", "write", "projects.manage");
    projectMutations.createProjectUnit(input);
    return foundationReads.getProjectDetail(input.projectId);
  });
  safeHandle(ipcChannels.projects.updateUnit, updateProjectUnitSchema, async (_event, input) => {
    await workspaceAccess.assertProjectAccess(input.projectId, "update project units", "write", "projects.manage");
    projectMutations.updateProjectUnit(input);
    return foundationReads.getProjectDetail(input.projectId);
  });
  safeHandle(ipcChannels.projects.deleteUnit, deleteProjectUnitSchema, async (_event, input) => {
    await workspaceAccess.assertProjectAccess(input.projectId, "delete project units", "write", "projects.manage");
    projectMutations.deleteProjectUnit(input);
    return foundationReads.getProjectDetail(input.projectId);
  });
  safeHandle(ipcChannels.projects.assignCrewToUnit, assignCrewToProjectUnitSchema, async (_event, input) => {
    await workspaceAccess.assertProjectAccess(input.projectId, "assign crew to project units", "write", "projects.manage");
    projectMutations.assignCrewToProjectUnit(input);
    return foundationReads.getProjectDetail(input.projectId);
  });
  safeHandle(ipcChannels.projects.unassignCrewFromUnit, unassignCrewFromProjectUnitSchema, async (_event, input) => {
    await workspaceAccess.assertProjectAccess(input.projectId, "remove crew from project units", "write", "projects.manage");
    projectMutations.unassignCrewFromProjectUnit(input);
    return foundationReads.getProjectDetail(input.projectId);
  });
  safeHandleReadWithSchema(
    ipcChannels.catalog.getSnapshot,
    catalogListReadArgsSchema,
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
  safeHandle(ipcChannels.catalog.deleteMany, deleteCatalogEntitiesSchema, (_event, input) => {
    catalogMutations.deleteEntities(input);
    return foundationReads.getCatalogSnapshot();
  });
  safeHandle(
    ipcChannels.catalog.exportCsv,
    exportCatalogCsvSchema,
    async (_event, input: ExportCatalogCsvInput) => {
      const exportPayload = catalogMutations.buildCsvExport(input);
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: `Export ${input.entityType} CSV`,
        defaultPath: path.join(app.getPath("documents"), exportPayload.fileName),
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });

      if (canceled || !filePath) {
        return {
          saved: false,
          fileName: null,
          savedPath: null,
          summary: "CSV export cancelled.",
        };
      }

      fs.writeFileSync(filePath, exportPayload.csvText, "utf8");

      return {
        saved: true,
        fileName: path.basename(filePath),
        savedPath: filePath,
        summary: `Exported ${exportPayload.fileName} to ${path.basename(filePath)}.`,
      };
    },
  );
  safeHandle(ipcChannels.catalog.previewImportCsv, previewCatalogCsvImportSchema, (_event, input) =>
    catalogMutations.previewCsvImport(input),
  );
  safeHandle(ipcChannels.catalog.importCsv, importCatalogCsvSchema, (_event, input) => {
    const result = catalogMutations.importCsv(input);
    return {
      result,
      snapshot: foundationReads.getCatalogSnapshot(),
    };
  });
  safeHandleReadWithSchema(
    ipcChannels.catalog.uploadCrewDocuments,
    uploadCrewCatalogDocumentsReadArgsSchema,
    async (_event, input: { crewMemberId: string; sourceFilePaths?: string[] }) => {
      const crewMemberId = input.crewMemberId;
      const crewMember = foundationReads
        .getCatalogSnapshot({
          entityType: "crew",
          search: "",
          sortBy: "fullName",
          sortDirection: "asc",
        })
        .crewMembers.find((row) => row.id === crewMemberId);

      if (!crewMember) {
        throw new Error("Crew member was not found.");
      }

      const resolvedPaths =
        input.sourceFilePaths && input.sourceFilePaths.length
          ? input.sourceFilePaths
          : (() => null)();

      if (resolvedPaths) {
        return fileUploads.importCrewDocuments(crewMemberId, resolvedPaths);
      }

      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: `Attach crew documents to ${crewMember.fullName}`,
        buttonLabel: "Attach documents",
        properties: ["openFile", "multiSelections"],
        filters: [
          { name: "Supported files", extensions: ["png", "jpg", "jpeg", "webp", "gif", "heic", "pdf"] },
          { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "heic"] },
          { name: "PDF", extensions: ["pdf"] },
        ],
      });

      if (canceled || !filePaths.length) {
        return {
          uploadedCount: 0,
          summary: "No crew documents were selected.",
        };
      }

      return fileUploads.importCrewDocuments(crewMemberId, filePaths);
    },
    "The app could not attach documents to that crew member.",
  );
  safeHandleReadWithSchema(
    ipcChannels.catalog.openCrewDocument,
    idReadArgsSchema,
    async (_event, fileId: string) => {
      await fileUploads.openCrewDocument(fileId);
      return null;
    },
    "The app could not open that crew document.",
  );
  safeHandleReadWithSchema(
    ipcChannels.catalog.deleteCrewDocument,
    idReadArgsSchema,
    async (_event, fileId: string) => fileUploads.deleteCrewDocument(fileId),
    "The app could not remove that crew document.",
  );
  safeHandleReadWithSchema(
    ipcChannels.rma.getSnapshot,
    rmaSnapshotReadArgsSchema,
    async (_event, query: RmaSnapshotQuery | undefined) => {
      if (!query?.workspaceId) {
        throw new Error("Select a workspace before loading RMAs.");
      }

      await workspaceAccess.assertWorkspaceAccess({
        workspaceId: query.workspaceId,
        action: "load RMAs",
        accessLevel: "read",
        requiredPermission: "rma.read",
      });

      return foundationReads.getRmaSnapshot(query);
    },
    "The app could not load the RMA snapshot.",
  );
  safeHandleReadWithSchema(
    ipcChannels.rma.getDetail,
    idReadArgsSchema,
    async (_event, rmaCaseId: string) => {
      await workspaceAccess.assertRmaCaseAccess(rmaCaseId, "load that RMA case", "read", "rma.read");
      return foundationReads.getRmaCaseDetail(rmaCaseId);
    },
    "The app could not load that RMA case.",
  );
  safeHandle(ipcChannels.rma.create, createRmaCaseSchema, async (_event, input) => {
    await workspaceAccess.assertWorkspaceAccess({
      workspaceId: input.workspaceId,
      action: "create RMAs",
      accessLevel: "write",
      requiredPermission: "rma.create",
    });
    return rmaMutations.createRmaCase(input);
  });
  safeHandle(ipcChannels.rma.update, updateRmaCaseSchema, async (_event, input) => {
    const workspaceId = await workspaceAccess.assertRmaCaseAccess(input.rmaCaseId, "update that RMA case", "write", "rma.create");
    if (workspaceId !== input.workspaceId) {
      throw new Error("That RMA case belongs to another workspace.");
    }

    return rmaMutations.updateRmaCase(input);
  });
  safeHandleReadWithSchema(
    ipcChannels.finance.getOverview,
    financeOverviewReadArgsSchema,
    (_event, query: FinanceOverviewQuery | undefined) => foundationReads.getFinanceOverview(query),
    "The app could not load finance overview.",
  );
  safeHandleReadWithSchema(
    ipcChannels.finance.getDocuments,
    idReadArgsSchema,
    (_event, entryId: string) => foundationReads.getFinanceEntryDocuments(entryId),
    "The app could not load finance documents.",
  );
  safeHandleReadWithSchema(
    ipcChannels.finance.uploadDocuments,
    idReadArgsSchema,
    async (_event, entryId: string) => {
      const entry = foundationReads.getFinanceEntries({
        search: "",
        sortBy: "date",
        sortDirection: "desc",
      }).find((row) => row.id === entryId);

      if (!entry) {
        throw new Error("Finance entry was not found.");
      }

      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: `Attach documents to ${entry.reference}`,
        buttonLabel: "Attach documents",
        properties: ["openFile", "multiSelections"],
        filters: [
          { name: "Supported files", extensions: ["png", "jpg", "jpeg", "webp", "gif", "heic", "pdf"] },
          { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "heic"] },
          { name: "PDF", extensions: ["pdf"] },
        ],
      });

      if (canceled || !filePaths.length) {
        return {
          uploadedCount: 0,
          summary: "No finance documents were selected.",
        };
      }

      return fileUploads.importFinanceDocuments(entryId, filePaths);
    },
    "The app could not attach documents to that finance entry.",
  );
  safeHandleReadWithSchema(
    ipcChannels.finance.openDocument,
    idReadArgsSchema,
    async (_event, fileId: string) => {
      await fileUploads.openFinanceDocument(fileId);
      return null;
    },
    "The app could not open that finance document.",
  );
  safeHandleReadWithSchema(
    ipcChannels.finance.exportReportPdf,
    financeOverviewReadArgsSchema,
    async (_event, query: FinanceOverviewQuery | undefined) => {
      const dateStamp = new Date().toISOString().slice(0, 10);
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: "Export finance report PDF",
        defaultPath: path.join(app.getPath("documents"), `finance-report-${dateStamp}.pdf`),
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (canceled || !filePath) {
        return {
          saved: false,
          fileName: null,
          savedPath: null,
          summary: "Finance report PDF export cancelled.",
        };
      }

      const pdf = await exportFinanceReportPdf(query, filePath);
      fs.writeFileSync(filePath, pdf.buffer);

      return {
        saved: true,
        fileName: path.basename(filePath),
        savedPath: filePath,
        summary: `Exported ${pdf.fileName} to ${path.basename(filePath)}.`,
      };
    },
    "The app could not export the finance report PDF.",
  );
  safeHandleRead(ipcChannels.finance.getCostLinks, () => foundationReads.getFinanceCostLinks(), "The app could not load finance cost links.");
  safeHandleReadWithSchema(
    ipcChannels.finance.getEntries,
    financeEntryListReadArgsSchema,
    (_event, query: FinanceEntryListQuery | undefined) => foundationReads.getFinanceEntries(query),
    "The app could not load finance entries.",
  );
  safeHandle(ipcChannels.finance.create, createFinancialEntrySchema, (_event, input) => financeMutations.createEntry(input));
  safeHandle(ipcChannels.finance.update, updateFinancialEntrySchema, (_event, input) => financeMutations.updateEntry(input));
};
