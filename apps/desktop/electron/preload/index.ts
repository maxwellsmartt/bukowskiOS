import { contextBridge, ipcRenderer } from "electron";

import { ipcChannels } from "@contracts/ipc/channels";
import type {
  ArchiveAssetCommand,
  AssignMoveAssetsInput,
  AssignMoveAssetsResult,
  AppInfo,
  AssetDetailSnapshot,
  AssetEditorMutationResult,
  AssetListRow,
  CatalogSnapshot,
  CreateAssetCommand,
  CreateCatalogEntityInput,
  CreatePackingSlipCommand,
  CreatePackingSlipResult,
  CreateProjectInput,
  CreateProjectUnitInput,
  DeleteCatalogEntityInput,
  DeleteProjectInput,
  DeleteProjectUnitInput,
  FinanceCostLinkRow,
  FinanceEntryRow,
  FinanceOverviewSnapshot,
  IncidentListRow,
  OverviewSnapshot,
  PackingSlipDetailSnapshot,
  PackingSlipRow,
  ProjectCardRow,
  ProjectDetailSnapshot,
  ReportIncidentCommand,
  ReportIncidentResult,
  ReturnPackingSlipItemsCommand,
  ReturnPackingSlipItemsResult,
  ScheduleTimelineRange,
  ScheduleTimelineScale,
  ScheduleTimelineSnapshot,
  ShellBootstrap,
  AssignCrewToProjectUnitInput,
  UnassignCrewFromProjectUnitInput,
  UpdateAssetCommand,
  UpdateCatalogEntityInput,
  UpdateProjectInput,
  UpdateProjectUnitInput,
} from "@contracts";

const bukowskiApp = {
  getAppInfo: () => ipcRenderer.invoke(ipcChannels.app.getInfo) as Promise<AppInfo>,
};

const bukowskiShell = {
  getBootstrap: () => ipcRenderer.invoke(ipcChannels.shell.getBootstrap) as Promise<ShellBootstrap>,
};

const bukowskiOverview = {
  getSnapshot: () => ipcRenderer.invoke(ipcChannels.overview.getSnapshot) as Promise<OverviewSnapshot>,
  getTimeline: (range: ScheduleTimelineRange, scale: ScheduleTimelineScale) =>
    ipcRenderer.invoke(ipcChannels.overview.getTimeline, range, scale) as Promise<ScheduleTimelineSnapshot>,
};

const bukowskiAssets = {
  getList: () => ipcRenderer.invoke(ipcChannels.assets.getList) as Promise<AssetListRow[]>,
  getDetail: (assetId: string) =>
    ipcRenderer.invoke(ipcChannels.assets.getDetail, assetId) as Promise<AssetDetailSnapshot>,
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
  getList: () => ipcRenderer.invoke(ipcChannels.packing.getList) as Promise<PackingSlipRow[]>,
  getDetail: (packingSlipId: string) =>
    ipcRenderer.invoke(ipcChannels.packing.getDetail, packingSlipId) as Promise<PackingSlipDetailSnapshot>,
  create: (input: CreatePackingSlipCommand) =>
    ipcRenderer.invoke(ipcChannels.packing.create, input) as Promise<CreatePackingSlipResult>,
  returnItems: (input: ReturnPackingSlipItemsCommand) =>
    ipcRenderer.invoke(ipcChannels.packing.returnItems, input) as Promise<ReturnPackingSlipItemsResult>,
};

const bukowskiIncidents = {
  getList: () => ipcRenderer.invoke(ipcChannels.incidents.getList) as Promise<IncidentListRow[]>,
  report: (input: ReportIncidentCommand) =>
    ipcRenderer.invoke(ipcChannels.incidents.report, input) as Promise<ReportIncidentResult>,
};

const bukowskiProjects = {
  getList: () => ipcRenderer.invoke(ipcChannels.projects.getList) as Promise<ProjectCardRow[]>,
  getDetail: (projectId: string) => ipcRenderer.invoke(ipcChannels.projects.getDetail, projectId) as Promise<ProjectDetailSnapshot>,
  getCatalog: () => ipcRenderer.invoke(ipcChannels.projects.getCatalog) as Promise<CatalogSnapshot>,
  create: (input: CreateProjectInput) => ipcRenderer.invoke(ipcChannels.projects.create, input) as Promise<ProjectCardRow[]>,
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
  getOverview: () => ipcRenderer.invoke(ipcChannels.finance.getOverview) as Promise<FinanceOverviewSnapshot>,
  getCostLinks: () => ipcRenderer.invoke(ipcChannels.finance.getCostLinks) as Promise<FinanceCostLinkRow[]>,
  getEntries: () => ipcRenderer.invoke(ipcChannels.finance.getEntries) as Promise<FinanceEntryRow[]>,
};

const bukowskiCatalog = {
  getSnapshot: () => ipcRenderer.invoke(ipcChannels.catalog.getSnapshot) as Promise<CatalogSnapshot>,
  create: (input: CreateCatalogEntityInput) => ipcRenderer.invoke(ipcChannels.catalog.create, input) as Promise<CatalogSnapshot>,
  update: (input: UpdateCatalogEntityInput) => ipcRenderer.invoke(ipcChannels.catalog.update, input) as Promise<CatalogSnapshot>,
  remove: (input: DeleteCatalogEntityInput) => ipcRenderer.invoke(ipcChannels.catalog.delete, input) as Promise<CatalogSnapshot>,
};

contextBridge.exposeInMainWorld("bukowskiApp", bukowskiApp);
contextBridge.exposeInMainWorld("bukowskiShell", bukowskiShell);
contextBridge.exposeInMainWorld("bukowskiOverview", bukowskiOverview);
contextBridge.exposeInMainWorld("bukowskiAssets", bukowskiAssets);
contextBridge.exposeInMainWorld("bukowskiPacking", bukowskiPacking);
contextBridge.exposeInMainWorld("bukowskiIncidents", bukowskiIncidents);
contextBridge.exposeInMainWorld("bukowskiProjects", bukowskiProjects);
contextBridge.exposeInMainWorld("bukowskiFinance", bukowskiFinance);
contextBridge.exposeInMainWorld("bukowskiCatalog", bukowskiCatalog);
