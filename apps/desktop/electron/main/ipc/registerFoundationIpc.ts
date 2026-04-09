import { ipcMain } from "electron";

import { ipcChannels } from "@contracts";

import type { FoundationReadService } from "../services/data/foundationReadService";

type RegisterFoundationIpcOptions = {
  foundationReads: FoundationReadService;
};

export const registerFoundationIpc = ({ foundationReads }: RegisterFoundationIpcOptions) => {
  ipcMain.handle(ipcChannels.shell.getBootstrap, () => foundationReads.getShellBootstrap());
  ipcMain.handle(ipcChannels.overview.getSnapshot, () => foundationReads.getOverviewSnapshot());
  ipcMain.handle(ipcChannels.assets.getList, () => foundationReads.getAssets());
  ipcMain.handle(ipcChannels.assets.getDetail, (_event, assetId: string) => foundationReads.getAssetDetail(assetId));
  ipcMain.handle(ipcChannels.packing.getList, () => foundationReads.getPackingSlips());
  ipcMain.handle(ipcChannels.incidents.getList, () => foundationReads.getIncidents());
  ipcMain.handle(ipcChannels.projects.getList, () => foundationReads.getProjects());
  ipcMain.handle(ipcChannels.projects.getCatalog, () => foundationReads.getCatalogSnapshot());
  ipcMain.handle(ipcChannels.finance.getOverview, () => foundationReads.getFinanceOverview());
  ipcMain.handle(ipcChannels.finance.getCostLinks, () => foundationReads.getFinanceCostLinks());
  ipcMain.handle(ipcChannels.finance.getEntries, () => foundationReads.getFinanceEntries());
};
