import { contextBridge, ipcRenderer } from "electron";

import { ipcChannels } from "@contracts/ipc/channels";
import type {
  AssignMoveAssetsInput,
  AssignMoveAssetsResult,
  AppInfo,
  AssetDetailSnapshot,
  AssetListRow,
  CatalogSnapshot,
  CreateProjectInput,
  DeleteProjectInput,
  FinanceCostLinkRow,
  FinanceEntryRow,
  FinanceOverviewSnapshot,
  IncidentListRow,
  OverviewSnapshot,
  PackingSlipRow,
  ProjectCardRow,
  ProjectDetailSnapshot,
  ShellBootstrap,
  UpdateProjectInput,
} from "@contracts";

const bukowskiApp = {
  getAppInfo: () => ipcRenderer.invoke(ipcChannels.app.getInfo) as Promise<AppInfo>,
};

const bukowskiShell = {
  getBootstrap: () => ipcRenderer.invoke(ipcChannels.shell.getBootstrap) as Promise<ShellBootstrap>,
};

const bukowskiOverview = {
  getSnapshot: () => ipcRenderer.invoke(ipcChannels.overview.getSnapshot) as Promise<OverviewSnapshot>,
};

const bukowskiAssets = {
  getList: () => ipcRenderer.invoke(ipcChannels.assets.getList) as Promise<AssetListRow[]>,
  getDetail: (assetId: string) =>
    ipcRenderer.invoke(ipcChannels.assets.getDetail, assetId) as Promise<AssetDetailSnapshot>,
  assignMove: (input: AssignMoveAssetsInput) =>
    ipcRenderer.invoke(ipcChannels.assets.assignMove, input) as Promise<AssignMoveAssetsResult>,
};

const bukowskiPacking = {
  getList: () => ipcRenderer.invoke(ipcChannels.packing.getList) as Promise<PackingSlipRow[]>,
};

const bukowskiIncidents = {
  getList: () => ipcRenderer.invoke(ipcChannels.incidents.getList) as Promise<IncidentListRow[]>,
};

const bukowskiProjects = {
  getList: () => ipcRenderer.invoke(ipcChannels.projects.getList) as Promise<ProjectCardRow[]>,
  getDetail: (projectId: string) => ipcRenderer.invoke(ipcChannels.projects.getDetail, projectId) as Promise<ProjectDetailSnapshot>,
  getCatalog: () => ipcRenderer.invoke(ipcChannels.projects.getCatalog) as Promise<CatalogSnapshot>,
  create: (input: CreateProjectInput) => ipcRenderer.invoke(ipcChannels.projects.create, input) as Promise<ProjectCardRow[]>,
  update: (input: UpdateProjectInput) => ipcRenderer.invoke(ipcChannels.projects.update, input) as Promise<ProjectCardRow[]>,
  remove: (input: DeleteProjectInput) => ipcRenderer.invoke(ipcChannels.projects.delete, input) as Promise<ProjectCardRow[]>,
};

const bukowskiFinance = {
  getOverview: () => ipcRenderer.invoke(ipcChannels.finance.getOverview) as Promise<FinanceOverviewSnapshot>,
  getCostLinks: () => ipcRenderer.invoke(ipcChannels.finance.getCostLinks) as Promise<FinanceCostLinkRow[]>,
  getEntries: () => ipcRenderer.invoke(ipcChannels.finance.getEntries) as Promise<FinanceEntryRow[]>,
};

contextBridge.exposeInMainWorld("bukowskiApp", bukowskiApp);
contextBridge.exposeInMainWorld("bukowskiShell", bukowskiShell);
contextBridge.exposeInMainWorld("bukowskiOverview", bukowskiOverview);
contextBridge.exposeInMainWorld("bukowskiAssets", bukowskiAssets);
contextBridge.exposeInMainWorld("bukowskiPacking", bukowskiPacking);
contextBridge.exposeInMainWorld("bukowskiIncidents", bukowskiIncidents);
contextBridge.exposeInMainWorld("bukowskiProjects", bukowskiProjects);
contextBridge.exposeInMainWorld("bukowskiFinance", bukowskiFinance);
