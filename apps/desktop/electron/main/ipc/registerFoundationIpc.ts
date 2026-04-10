import type {
  ArchiveAssetCommand,
  AssignMoveAssetsInput,
  CreateAssetCommand,
  CreateCatalogEntityInput,
  CreatePackingSlipCommand,
  CreateProjectInput,
  DeleteCatalogEntityInput,
  DeleteProjectInput,
  ReportIncidentCommand,
  ReturnPackingSlipItemsCommand,
  UpdateAssetCommand,
  UpdateCatalogEntityInput,
  UpdateProjectInput,
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
  ipcMain.handle(ipcChannels.overview.getSnapshot, () => foundationReads.getOverviewSnapshot());
  ipcMain.handle(ipcChannels.assets.getList, () => foundationReads.getAssets());
  ipcMain.handle(ipcChannels.assets.getDetail, (_event, assetId: string) => foundationReads.getAssetDetail(assetId));
  ipcMain.handle(ipcChannels.assets.assignMove, (_event, input: AssignMoveAssetsInput) => assetMutations.assignMoveAssets(input));
  ipcMain.handle(ipcChannels.assets.create, (_event, input: CreateAssetCommand) => assetMutations.createAsset(input));
  ipcMain.handle(ipcChannels.assets.update, (_event, input: UpdateAssetCommand) => assetMutations.updateAsset(input));
  ipcMain.handle(ipcChannels.assets.archive, (_event, input: ArchiveAssetCommand) => assetMutations.archiveAsset(input));
  ipcMain.handle(ipcChannels.packing.getList, () => foundationReads.getPackingSlips());
  ipcMain.handle(ipcChannels.packing.getDetail, (_event, packingSlipId: string) => foundationReads.getPackingSlipDetail(packingSlipId));
  ipcMain.handle(ipcChannels.packing.create, (_event, input: CreatePackingSlipCommand) => packingMutations.createPackingSlip(input));
  ipcMain.handle(ipcChannels.packing.returnItems, (_event, input: ReturnPackingSlipItemsCommand) =>
    packingMutations.returnPackingSlipItems(input),
  );
  ipcMain.handle(ipcChannels.incidents.getList, () => foundationReads.getIncidents());
  ipcMain.handle(ipcChannels.incidents.report, (_event, input: ReportIncidentCommand) => incidentMutations.reportIncident(input));
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
  ipcMain.handle(ipcChannels.catalog.getSnapshot, () => foundationReads.getCatalogSnapshot());
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
  ipcMain.handle(ipcChannels.finance.getEntries, () => foundationReads.getFinanceEntries());
};
