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
  isInternalTransfer?: boolean;
  reimbursementStatus?: ReimbursementStatus;
  claimedAmount?: number | null;
  supportDocFileId?: string | null;
  notes?: string | null;
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

export type TransactionMutationResult = {
  commandId: string;
  transactionId: string;
  repeated: boolean;
  summary: string;
};
