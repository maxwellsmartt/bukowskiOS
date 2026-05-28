import type { CommandActorType, CommandSourceChannel } from "./asset-commands";

/**
 * PILAR T — Treasury / bank reconciliation.
 *
 * Raw imported bank rows are immutable; the human classification layer lives
 * in `transaction_annotations`. Currency exchanges / inter-account transfers
 * are flagged (`txn_kind` ∈ {transfer, fx_exchange} or `is_internal_transfer`)
 * so they are excluded from income/expense totals.
 */

export type BankName = "popular" | "santa_cruz" | "custom";
export type BankAccountType = "checking" | "savings" | "other";

export type TransactionDirection = "debit" | "credit";

export type TransactionKind =
  | "income"
  | "expense"
  | "transfer"
  | "fx_exchange"
  | "salary"
  | "reimbursement"
  | "tax"
  | "tss"
  | "bank_fee"
  | "interest"
  | "owner_draw"
  | "other";

export type ReimbursementStatus = "n/a" | "pending" | "accepted" | "rejected" | "partial";
export type FiscalStatus = "pending" | "accepted" | "rejected";

export type StatementSourceFormat = "csv" | "xlsx" | "manual" | "pdf";

export type TransactionLinkEntityType =
  | "invoice"
  | "invoice_payment"
  | "crew_voucher"
  | "financial_entry";

/* ----------------------------------------------------------------------- */
/* Bank accounts                                                            */
/* ----------------------------------------------------------------------- */

export type UpsertBankAccountCommand = {
  commandId: string;
  workspaceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
  /** Omit to create; pass an existing id to update. */
  bankAccountId?: string | null;
  bankName: BankName;
  accountLabel: string;
  accountNumberMasked?: string | null;
  accountNumberFull?: string | null;
  currency: string;
  accountType?: BankAccountType | null;
  openingBalance?: number | null;
  openingBalanceDate?: string | null;
  isActive?: boolean;
  notes?: string | null;
};

export type BankAccountMutationResult = {
  commandId: string;
  bankAccountId: string;
  repeated: boolean;
  summary: string;
};

/* ----------------------------------------------------------------------- */
/* Statement import                                                         */
/* ----------------------------------------------------------------------- */

/**
 * One normalized statement row. The importer (or a dev-side backfill) parses
 * the bank-specific format into this shape before handing it to the service,
 * which computes the dedupe hash and inserts.
 */
export type ParsedBankTransaction = {
  txnDate: string;
  valueDate?: string | null;
  rawDescription?: string | null;
  reference?: string | null;
  serial?: string | null;
  amount: number;
  direction: TransactionDirection;
  runningBalance?: number | null;
};

export type ImportStatementCommand = {
  commandId: string;
  workspaceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
  bankAccountId: string;
  sourceFormat: StatementSourceFormat;
  originalFilename?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  rows: ParsedBankTransaction[];
  notes?: string | null;
};

export type AddManualTransactionsCommand = ImportStatementCommand;

export type ImportStatementResult = {
  commandId: string;
  importId: string;
  bankAccountId: string;
  rowCount: number;
  insertedCount: number;
  duplicateCount: number;
  repeated: boolean;
  summary: string;
};

export type DeleteImportCommand = {
  commandId: string;
  workspaceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
  importId: string;
};

export type CorrectTransactionCommand = {
  commandId: string;
  workspaceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
  transactionId: string;
  txnDate?: string;
  valueDate?: string | null;
  rawDescription?: string | null;
  reference?: string | null;
  serial?: string | null;
  amount?: number;
  direction?: TransactionDirection;
  runningBalance?: number | null;
  notes?: string | null;
};

/* ----------------------------------------------------------------------- */
/* Classification / annotation                                              */
/* ----------------------------------------------------------------------- */

export type AnnotateTransactionCommand = {
  commandId: string;
  workspaceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
  transactionId: string;
  txnKind?: TransactionKind | null;
  concept?: string | null;
  counterparty?: string | null;
  counterpartyRnc?: string | null;
  expenseCategory?: string | null;
  supplierNcf?: string | null;
  dgiiExpenseType?: string | null;
  withholdingType?: string | null;
  withholdingRate?: number | null;
  withholdingAmount?: number | null;
  fiscalPeriod?: string | null;
  isInternalTransfer?: boolean;
  reimbursementStatus?: ReimbursementStatus;
  claimedAmount?: number | null;
  supportDocFileId?: string | null;
  notes?: string | null;
};

export type ApplyCounterpartyRuleCommand = AnnotateTransactionCommand & {
  /** Optional override; defaults to the selected transaction description. */
  matchPattern?: string | null;
  /** MVP keeps this conservative: exact normalized description by default. */
  matchType?: "exact" | "contains";
};

export type ApplyCounterpartyRuleResult = {
  commandId: string;
  transactionId: string;
  ruleId: string;
  matchPattern: string;
  affectedCount: number;
  repeated: boolean;
  summary: string;
};

export type ProjectAllocationInput = {
  projectId?: string | null;
  projectNameSnapshot?: string | null;
  amount: number;
  percent?: number | null;
  notes?: string | null;
};

export type SetAllocationsCommand = {
  commandId: string;
  workspaceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
  transactionId: string;
  allocations: ProjectAllocationInput[];
};

/** Accountant (Contable) review flow: adjust DGII-deductible amount. */
export type ReviewReimbursementCommand = {
  commandId: string;
  workspaceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
  transactionId: string;
  reimbursementStatus: ReimbursementStatus;
  deductibleAmount?: number | null;
  supplierNcf?: string | null;
  dgiiExpenseType?: string | null;
  withholdingType?: string | null;
  withholdingRate?: number | null;
  withholdingAmount?: number | null;
  fiscalPeriod?: string | null;
  fiscalStatus: FiscalStatus;
  notes?: string | null;
};

export type LinkTransactionCommand = {
  commandId: string;
  workspaceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
  transactionId: string;
  linkedEntityType: TransactionLinkEntityType;
  linkedEntityId: string;
  notes?: string | null;
};

export type UndoTreasuryActionCommand = {
  commandId: string;
  workspaceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
  undoId?: string | null;
};

export type TransactionMutationResult = {
  commandId: string;
  transactionId: string;
  repeated: boolean;
  summary: string;
};

/* ----------------------------------------------------------------------- */
/* Invoice Inbox — batch ingestion + vision/text extraction of expense docs */
/* ----------------------------------------------------------------------- */

export type InvoiceExtractionStatus =
  | "pending"
  | "processing"
  | "extracted"
  | "failed"
  | "applied"
  | "dismissed";

/** A project tag on an expense invoice (no amount split — pure tagging). */
export type InvoiceExtractionProjectTag = {
  projectId: string | null;
  projectName: string | null;
};

/** One uploaded expense document (PNG/JPG/PDF) and its extracted fields. */
export type InvoiceExtraction = {
  id: string;
  workspaceId: string;
  batchId: string;
  status: InvoiceExtractionStatus;
  originalName: string;
  mimeType: string;
  byteSize: number;
  uploadedByUserId: string | null;
  uploadedByName: string | null;
  /** Who the expense actually belongs to (distinct from the uploader). */
  linkedUserId: string | null;
  linkedUserName: string | null;
  /** Projects this expense is attributed to. Empty = company-general expense. */
  projects: InvoiceExtractionProjectTag[];
  supplierName: string | null;
  supplierRnc: string | null;
  ncf: string | null;
  invoiceDate: string | null;
  subtotal: number | null;
  itbis: number | null;
  total: number | null;
  currency: string | null;
  dgiiExpenseType: string | null;
  expenseCategory: string | null;
  confidence: number | null;
  rawText: string | null;
  suggestedTransactionId: string | null;
  matchConfidence: number | null;
  appliedTransactionId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

/** One file in an enqueue request — the renderer reads it as a base64 data URL. */
export type InvoiceInboxFileInput = {
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type EnqueueInvoiceBatchCommand = {
  workspaceId: string;
  files: InvoiceInboxFileInput[];
  /** Who uploaded this batch — for grouping/filtering in the inbox. */
  uploadedByUserId?: string | null;
  uploadedByName?: string | null;
};

export type EnqueueInvoiceBatchResult = {
  batchId: string;
  queuedCount: number;
  skippedCount: number;
  summary: string;
};

export type InvoiceInboxListQuery = {
  workspaceId: string;
  /** Optional: only this batch. */
  batchId?: string | null;
  /** Hide rows already applied/dismissed when false-y is the default UI. */
  includeResolved?: boolean;
};

/** A project tag input (name optional — the service snapshots it if absent). */
export type InvoiceExtractionProjectInput = {
  projectId: string;
  projectName?: string | null;
};

/** Patch the extracted fields a human corrected before applying. */
export type UpdateInvoiceExtractionCommand = {
  workspaceId: string;
  extractionId: string;
  supplierName?: string | null;
  supplierRnc?: string | null;
  ncf?: string | null;
  invoiceDate?: string | null;
  subtotal?: number | null;
  itbis?: number | null;
  total?: number | null;
  currency?: string | null;
  dgiiExpenseType?: string | null;
  expenseCategory?: string | null;
  /** Pass null to clear the linked user. Omit to leave unchanged. */
  linkedUserId?: string | null;
  linkedUserName?: string | null;
  /** When provided, replaces the full set of project tags. */
  projects?: InvoiceExtractionProjectInput[];
};

/** A group of exact-duplicate invoices (same file bytes) needing resolution. */
export type InvoiceDuplicateGroup = {
  contentHash: string;
  items: InvoiceExtraction[];
};

/** Assign the linked user and/or project tags to many invoices at once. */
export type BulkLinkInvoiceExtractionsCommand = {
  workspaceId: string;
  extractionIds: string[];
  /** Provided keys are applied; `linkedUserId: null` clears it. */
  linkedUserId?: string | null;
  linkedUserName?: string | null;
  projects?: InvoiceExtractionProjectInput[];
};

export type BulkLinkInvoiceExtractionsResult = {
  updatedCount: number;
  summary: string;
};

/** Apply an extraction onto a chosen bank movement (human-approved write). */
export type ApplyInvoiceExtractionCommand = {
  workspaceId: string;
  extractionId: string;
  /** Movement to annotate; defaults to the suggested match when omitted. */
  transactionId: string;
  deductibleAmount?: number | null;
  fiscalPeriod?: string | null;
};

export type InvoiceExtractionMutationResult = {
  extractionId: string;
  status: InvoiceExtractionStatus;
  summary: string;
};

export type DismissInvoiceExtractionCommand = {
  workspaceId: string;
  extractionId: string;
};
