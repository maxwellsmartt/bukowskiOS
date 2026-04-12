import type { OverviewMetric } from "./overview-queries";
import type { ListSortDirection } from "./list-controls-queries";

export type ProjectExposureRow = {
  project: string;
  exposure: string;
  incidentCount: number;
  assetsOut: string;
};

export type FinanceCostLinkRow = {
  incident: string;
  asset: string;
  project: string;
  responsible: string;
  severity: string;
  costEstimate: string;
  replacementValue: string;
  financialStatus: string;
};

export type FinanceEntryRow = {
  id: string;
  date: string;
  type: string;
  category: string;
  reference: string;
  project: string;
  amount: string;
  status: string;
  amountValue?: number;
  currency?: string;
  projectId?: string | null;
  assetId?: string | null;
  incidentId?: string | null;
  description?: string | null;
  notes?: string | null;
};

export type FinanceEntrySortField = "date" | "type" | "category" | "reference" | "project" | "amount" | "status";

export type FinanceEntryListQuery = {
  search?: string;
  sortBy: FinanceEntrySortField;
  sortDirection: ListSortDirection;
};

export type FinanceOverviewSnapshot = {
  metrics: OverviewMetric[];
  exposureByProject: ProjectExposureRow[];
  costLinks: FinanceCostLinkRow[];
};
