/// <reference types="vite/client" />

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
  ReportIncidentCommand,
  ReportIncidentResult,
  ShellBootstrap,
  UpdateProjectInput,
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
    };
    bukowskiAssets?: {
      getList: () => Promise<AssetListRow[]>;
      getDetail: (assetId: string) => Promise<AssetDetailSnapshot>;
      assignMove: (input: AssignMoveAssetsInput) => Promise<AssignMoveAssetsResult>;
    };
    bukowskiPacking?: {
      getList: () => Promise<PackingSlipRow[]>;
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
    };
    bukowskiFinance?: {
      getOverview: () => Promise<FinanceOverviewSnapshot>;
      getCostLinks: () => Promise<FinanceCostLinkRow[]>;
      getEntries: () => Promise<FinanceEntryRow[]>;
    };
  }
}

export {};
