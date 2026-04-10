/// <reference types="vite/client" />

import type {
  ArchiveAssetCommand,
  AssignCrewToProjectUnitInput,
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
  UnassignCrewFromProjectUnitInput,
  UpdateAssetCommand,
  UpdateCatalogEntityInput,
  UpdateProjectInput,
  UpdateProjectUnitInput,
} from "@contracts";

declare global {
  interface Window {
    bukowskiApp?: {
      getAppInfo: () => Promise<AppInfo>;
    };
    bukowskiShell?: {
      getBootstrap: () => Promise<ShellBootstrap>;
    };
    bukowskiOverview?: {
      getSnapshot: () => Promise<OverviewSnapshot>;
      getTimeline: (range: ScheduleTimelineRange, scale: ScheduleTimelineScale) => Promise<ScheduleTimelineSnapshot>;
    };
    bukowskiAssets?: {
      getList: () => Promise<AssetListRow[]>;
      getDetail: (assetId: string) => Promise<AssetDetailSnapshot>;
      assignMove: (input: AssignMoveAssetsInput) => Promise<AssignMoveAssetsResult>;
      create: (input: CreateAssetCommand) => Promise<AssetEditorMutationResult>;
      update: (input: UpdateAssetCommand) => Promise<AssetEditorMutationResult>;
      archive: (input: ArchiveAssetCommand) => Promise<AssetEditorMutationResult>;
    };
    bukowskiPacking?: {
      getList: () => Promise<PackingSlipRow[]>;
      getDetail: (packingSlipId: string) => Promise<PackingSlipDetailSnapshot>;
      create: (input: CreatePackingSlipCommand) => Promise<CreatePackingSlipResult>;
      returnItems: (input: ReturnPackingSlipItemsCommand) => Promise<ReturnPackingSlipItemsResult>;
    };
    bukowskiIncidents?: {
      getList: () => Promise<IncidentListRow[]>;
      report: (input: ReportIncidentCommand) => Promise<ReportIncidentResult>;
    };
    bukowskiProjects?: {
      getList: () => Promise<ProjectCardRow[]>;
      getDetail: (projectId: string) => Promise<ProjectDetailSnapshot>;
      getCatalog: () => Promise<CatalogSnapshot>;
      create: (input: CreateProjectInput) => Promise<ProjectCardRow[]>;
      update: (input: UpdateProjectInput) => Promise<ProjectCardRow[]>;
      remove: (input: DeleteProjectInput) => Promise<ProjectCardRow[]>;
      createUnit: (input: CreateProjectUnitInput) => Promise<ProjectDetailSnapshot>;
      updateUnit: (input: UpdateProjectUnitInput) => Promise<ProjectDetailSnapshot>;
      removeUnit: (input: DeleteProjectUnitInput) => Promise<ProjectDetailSnapshot>;
      assignCrewToUnit: (input: AssignCrewToProjectUnitInput) => Promise<ProjectDetailSnapshot>;
      unassignCrewFromUnit: (input: UnassignCrewFromProjectUnitInput) => Promise<ProjectDetailSnapshot>;
    };
    bukowskiFinance?: {
      getOverview: () => Promise<FinanceOverviewSnapshot>;
      getCostLinks: () => Promise<FinanceCostLinkRow[]>;
      getEntries: () => Promise<FinanceEntryRow[]>;
    };
    bukowskiCatalog?: {
      getSnapshot: () => Promise<CatalogSnapshot>;
      create: (input: CreateCatalogEntityInput) => Promise<CatalogSnapshot>;
      update: (input: UpdateCatalogEntityInput) => Promise<CatalogSnapshot>;
      remove: (input: DeleteCatalogEntityInput) => Promise<CatalogSnapshot>;
    };
  }
}

export {};
