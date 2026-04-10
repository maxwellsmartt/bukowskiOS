import type {
  ArchiveAssetCommand,
  AssetListQuery,
  AssignMoveAssetsInput,
  AssignCrewToProjectUnitInput,
  CatalogListQuery,
  CreateAssetCommand,
  CreateCatalogEntityInput,
  CreatePackingSlipCommand,
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
} from "@contracts";
import { ipcMain } from "electron";

import { ipcChannels } from "@contracts";

import type { FoundationReadService } from "../services/data/foundationReadService";

type RegisterFoundationIpcOptions = {
  foundationReads: FoundationReadService;
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
};

export const registerFoundationIpc = ({
  foundationReads,
  projectMutations,
  catalogMutations,
  assetMutations,
  incidentMutations,
  packingMutations,
}: RegisterFoundationIpcOptions) => {
  ipcMain.handle(ipcChannels.shell.getBootstrap, () => foundationReads.getShellBootstrap());
  ipcMain.handle(ipcChannels.shell.searchGlobal, (_event, query: GlobalSearchQuery) => foundationReads.getGlobalSearch(query));
  ipcMain.handle(ipcChannels.overview.getSnapshot, () => foundationReads.getOverviewSnapshot());
  ipcMain.handle(
    ipcChannels.overview.getTimeline,
    (_event, range: ScheduleTimelineRange, scale: ScheduleTimelineScale, anchorDate?: string) =>
      foundationReads.getScheduleTimeline(range, scale, anchorDate),
  );
  ipcMain.handle(ipcChannels.assets.getList, (_event, query: AssetListQuery | undefined) => foundationReads.getAssets(query));
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
  ipcMain.handle(ipcChannels.finance.getOverview, () => foundationReads.getFinanceOverview());
  ipcMain.handle(ipcChannels.finance.getCostLinks, () => foundationReads.getFinanceCostLinks());
  ipcMain.handle(ipcChannels.finance.getEntries, (_event, query: FinanceEntryListQuery | undefined) => foundationReads.getFinanceEntries(query));
};
