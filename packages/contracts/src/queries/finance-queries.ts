import type { OverviewMetric } from "./overview-queries";
import type { ListSortDirection } from "./list-controls-queries";
import type { CollaboratorFeeStatus } from "../commands/finance-commands";

export type FinanceOverviewPeriodPreset = "month" | "quarter" | "year" | "custom";

export type FinanceOverviewQuery = {
  workspaceId?: string;
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
  workspaceId?: string;
  projectId?: string | null;
  search?: string;
  sortBy: FinanceEntrySortField;
  sortDirection: ListSortDirection;
};

export type CollaboratorFeeSortField =
  | "expectedDate"
  | "crew"
  | "project"
  | "feeType"
  | "amount"
  | "outstanding"
  | "status";

export type CollaboratorFeeListQuery = {
  workspaceId?: string;
  search?: string;
  sortBy: CollaboratorFeeSortField;
  sortDirection: ListSortDirection;
  status?: CollaboratorFeeStatus | "all";
  projectId?: string | null;
  crewMemberId?: string | null;
};

export type CollaboratorFeeRow = {
  id: string;
  workspaceId: string;
  crewMemberId: string;
  crewMemberName: string;
  projectId: string | null;
  projectName: string | null;
  projectUnitId: string | null;
  projectUnitName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  sourceAssignmentId: string | null;
  feeType: string;
  description: string | null;
  agreedAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  currency: string;
  exchangeRate: number | null;
  baseCurrencyAmount: number | null;
  status: CollaboratorFeeStatus;
  expectedPaymentDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CollaboratorPaymentRow = {
  id: string;
  paymentBatchId: string;
  feeId: string;
  paidAt: string;
  amount: number;
  currency: string;
  paymentMethod: string | null;
  reference: string | null;
  notes: string | null;
  createdAt: string;
};

export type CollaboratorFeeDetail = CollaboratorFeeRow & {
  payments: CollaboratorPaymentRow[];
};

export type CollaboratorFeeSummary = {
  pendingAmount: number;
  approvedAmount: number;
  paidThisMonth: number;
  collaboratorsWithBalance: number;
  byCollaborator: Array<{
    crewMemberId: string;
    crewMemberName: string;
    pendingAmount: number;
    paidAmount: number;
    currency: string;
  }>;
  byProject: Array<{
    projectId: string | null;
    projectName: string;
    pendingAmount: number;
    paidAmount: number;
    currency: string;
  }>;
};

export type CollaboratorFeeSuggestion = {
  suggestionId: string;
  crewMemberId: string;
  crewMemberName: string;
  projectId: string;
  projectName: string;
  projectUnitId: string;
  projectUnitName: string;
  departmentId: string | null;
  departmentName: string | null;
  sourceAssignmentId: string;
  roleLabel: string | null;
  startDate: string | null;
  endDate: string | null;
  feeType: string;
  description: string;
  currency: string;
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
