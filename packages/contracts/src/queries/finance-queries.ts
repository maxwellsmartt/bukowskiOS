import type { OverviewMetric } from "./overview-queries";

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
};

export type FinanceOverviewSnapshot = {
  metrics: OverviewMetric[];
  exposureByProject: ProjectExposureRow[];
  costLinks: FinanceCostLinkRow[];
};
