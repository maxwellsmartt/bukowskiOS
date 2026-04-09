/// <reference types="vite/client" />

import type {
  AppInfo,
  AssetDetailSnapshot,
  AssetListRow,
  CatalogSnapshot,
  FinanceCostLinkRow,
  FinanceEntryRow,
  FinanceOverviewSnapshot,
  IncidentListRow,
  OverviewSnapshot,
  PackingSlipRow,
  ProjectCardRow,
  ShellBootstrap,
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
    };
    bukowskiPacking?: {
      getList: () => Promise<PackingSlipRow[]>;
    };
    bukowskiIncidents?: {
      getList: () => Promise<IncidentListRow[]>;
    };
    bukowskiProjects?: {
      getList: () => Promise<ProjectCardRow[]>;
      getCatalog: () => Promise<CatalogSnapshot>;
    };
    bukowskiFinance?: {
      getOverview: () => Promise<FinanceOverviewSnapshot>;
      getCostLinks: () => Promise<FinanceCostLinkRow[]>;
      getEntries: () => Promise<FinanceEntryRow[]>;
    };
  }
}

export {};
