export type OverviewMetric = {
  label: string;
  value: string;
  tone: "neutral" | "info" | "warning" | "critical" | "success";
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
  date: string;
  type: string;
  category: string;
  reference: string;
  project: string;
  amount: string;
  status: string;
};
