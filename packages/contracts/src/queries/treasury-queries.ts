import type {
  BankAccountType,
  BankName,
  FiscalStatus,
  ReimbursementStatus,
  StatementSourceFormat,
  TransactionDirection,
  TransactionKind,
} from "../commands/treasury-commands";

export type TreasuryPeriodPreset = "month" | "quarter" | "year" | "fiscal" | "all" | "custom";

export type BankAccountRow = {
  id: string;
  workspaceId: string;
  bankName: BankName;
  accountLabel: string;
  accountNumberMasked: string | null;
  accountNumberFull: string | null;
  currency: string;
  accountType: BankAccountType | null;
  openingBalance: number;
  openingBalanceDate: string | null;
  isActive: boolean;
  notes: string | null;
  /** Latest running balance seen in imported transactions (display only). */
  currentBalance: number | null;
  transactionCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectAllocationRow = {
  id: string;
  transactionId: string;
  projectId: string | null;
  projectNameSnapshot: string | null;
  amount: number;
  percent: number | null;
  notes: string | null;
};

export type TransactionAnnotationView = {
  txnKind: TransactionKind | null;
  concept: string | null;
  counterparty: string | null;
  counterpartyRnc: string | null;
  expenseCategory: string | null;
  isInternalTransfer: boolean;
  reimbursementStatus: ReimbursementStatus;
  claimedAmount: number | null;
  deductibleAmount: number | null;
  fiscalStatus: FiscalStatus;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  supportDocFileId: string | null;
  notes: string | null;
};

export type BankTransactionRow = {
  id: string;
  workspaceId: string;
  bankAccountId: string;
  bankAccountLabel: string;
  importId: string | null;
  txnDate: string;
  valueDate: string | null;
  rawDescription: string | null;
  reference: string | null;
  serial: string | null;
  amount: number;
  direction: TransactionDirection;
  /** Signed amount: credit positive, debit negative. */
  signedAmount: number;
  runningBalance: number | null;
  currency: string;
  /** True when this row is excluded from income/expense totals. */
  excludedFromTotals: boolean;
  annotation: TransactionAnnotationView | null;
  allocations: ProjectAllocationRow[];
  createdAt: string;
};

export type BankStatementImportRow = {
  id: string;
  workspaceId: string;
  bankAccountId: string;
  sourceFormat: StatementSourceFormat;
  originalFilename: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  rowCount: number;
  insertedCount: number;
  duplicateCount: number;
  importedByUserId: string | null;
  notes: string | null;
  createdAt: string;
};

export type TreasuryTransactionListQuery = {
  workspaceId?: string;
  bankAccountId?: string;
  dateFrom?: string;
  dateTo?: string;
  kind?: TransactionKind;
  direction?: TransactionDirection;
  projectId?: string;
  /** Only rows with no human classification yet. */
  unclassifiedOnly?: boolean;
  /** Only reimbursements awaiting accountant review. */
  pendingReviewOnly?: boolean;
  search?: string;
  limit?: number;
};

export type CounterpartyRulePreviewQuery = {
  workspaceId: string;
  transactionId: string;
  matchPattern?: string | null;
  matchType?: "exact" | "contains";
};

export type CounterpartyRulePreview = {
  transactionId: string;
  matchPattern: string;
  matchType: "exact" | "contains";
  matchCount: number;
  sampleDescriptions: string[];
};

export type TreasuryOverviewQuery = {
  workspaceId?: string;
  period: TreasuryPeriodPreset;
  customStartDate?: string | null;
  customEndDate?: string | null;
};

export type TreasuryMonthlyPoint = {
  month: string;
  income: number;
  expense: number;
  net: number;
};

export type TreasuryCategoryBreakdown = {
  category: string;
  amount: number;
  percentage: number;
};

export type TreasuryOverviewSnapshot = {
  activePeriodLabel: string;
  /** Real income (excludes transfers/fx and internal transfers). */
  totalIncome: number;
  totalExpense: number;
  net: number;
  /** Deductible-adjusted expense (uses deductible_amount when reviewed). */
  totalDeductibleExpense: number;
  excludedTransferTotal: number;
  unclassifiedCount: number;
  pendingReviewCount: number;
  accounts: BankAccountRow[];
  monthly: TreasuryMonthlyPoint[];
  expenseByCategory: TreasuryCategoryBreakdown[];
};

export type ReviewQueueRow = {
  transactionId: string;
  bankAccountLabel: string;
  txnDate: string;
  rawDescription: string | null;
  concept: string | null;
  counterparty: string | null;
  amount: number;
  currency: string;
  reimbursementStatus: ReimbursementStatus;
  claimedAmount: number | null;
  deductibleAmount: number | null;
  fiscalStatus: FiscalStatus;
};

export type ProjectPnlRow = {
  projectId: string | null;
  projectName: string;
  income: number;
  expense: number;
  net: number;
  marginPercent: number | null;
};
