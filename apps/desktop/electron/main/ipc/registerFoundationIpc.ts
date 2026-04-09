import type { AssignMoveAssetsInput, CreateProjectInput, DeleteProjectInput, UpdateProjectInput } from "@contracts";
import { ipcMain } from "electron";

import { ipcChannels } from "@contracts";

import type { FoundationReadService } from "../services/data/foundationReadService";

type RegisterFoundationIpcOptions = {
  foundationReads: FoundationReadService;
  projectMutations: {
    createProject: (input: CreateProjectInput) => void;
    updateProject: (input: UpdateProjectInput) => void;
    deleteProject: (input: DeleteProjectInput) => void;
  };
  assetMutations: {
    assignMoveAssets: (input: AssignMoveAssetsInput) => unknown;
  };
};

export const registerFoundationIpc = ({ foundationReads, projectMutations, assetMutations }: RegisterFoundationIpcOptions) => {
  ipcMain.handle(ipcChannels.shell.getBootstrap, () => foundationReads.getShellBootstrap());
  ipcMain.handle(ipcChannels.overview.getSnapshot, () => foundationReads.getOverviewSnapshot());
  ipcMain.handle(ipcChannels.assets.getList, () => foundationReads.getAssets());
  ipcMain.handle(ipcChannels.assets.getDetail, (_event, assetId: string) => foundationReads.getAssetDetail(assetId));
  ipcMain.handle(ipcChannels.assets.assignMove, (_event, input: AssignMoveAssetsInput) => assetMutations.assignMoveAssets(input));
  ipcMain.handle(ipcChannels.packing.getList, () => foundationReads.getPackingSlips());
  ipcMain.handle(ipcChannels.incidents.getList, () => foundationReads.getIncidents());
  ipcMain.handle(ipcChannels.projects.getList, () => foundationReads.getProjects());
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
  ipcMain.handle(ipcChannels.finance.getOverview, () => foundationReads.getFinanceOverview());
  ipcMain.handle(ipcChannels.finance.getCostLinks, () => foundationReads.getFinanceCostLinks());
  ipcMain.handle(ipcChannels.finance.getEntries, () => foundationReads.getFinanceEntries());
};
