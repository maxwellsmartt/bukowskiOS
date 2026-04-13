import type { OverviewMetric } from "./overview-queries";
import type { ListSortDirection } from "./list-controls-queries";

export type FinanceOverviewPeriodPreset = "month" | "quarter" | "year" | "custom";

export type FinanceOverviewQuery = {
  period: FinanceOverviewPeriodPreset;
  customStartDate?: string | null;
  customEndDate?: string | null;
};

export type ProjectExposureRow = {
  project: string;
  exposure: string;
  exposureValue: number;
  incidentCount: number;
  assetsOut: string;
  assetsOutValue: number;
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

export type FinancialDocumentRow = {
  id: string;
  fileType: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  status: "available" | "missing" | "deleted";
  createdAt: string;
  isPreviewable: boolean;
  previewDataUrl?: string | null;
};

export type FinanceEntrySortField = "date" | "type" | "category" | "reference" | "project" | "amount" | "status";

export type FinanceEntryListQuery = {
  search?: string;
  sortBy: FinanceEntrySortField;
  sortDirection: ListSortDirection;
};

export type FinanceOverviewSnapshot = {
  metrics: OverviewMetric[];
  activePeriodLabel: string;
  totals: {
    trackedSpend: string;
    trackedSpendValue: number;
    reserve: string;
    reserveValue: number;
    incidentExposure: string;
    incidentExposureValue: number;
    burnRateAverage: string;
    burnRateAverageValue: number;
  };
  exposureByProject: ProjectExposureRow[];
  costLinks: FinanceCostLinkRow[];
  monthlyBurn: Array<{
    month: string;
    amount: string;
    amountValue: number;
  }>;
  categoryBreakdown: Array<{
    category: string;
    amount: string;
    amountValue: number;
    percentage: number;
  }>;
};
