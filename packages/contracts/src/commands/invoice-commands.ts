import type { CommandActorType, CommandSourceChannel } from "./asset-commands";
import type {
  CurrencyRateSource,
  CurrencyRateType,
} from "./finance-currency-commands";
import type {
  QuoteItemDurationUnit,
  QuoteItemTaxBehavior,
  QuoteTaxProfile,
} from "./quote-commands";

/**
 * Invoice lifecycle:
 *
 *   draft
 *     ↓  issue (consume NCF, freeze items + totals)
 *   issued
 *     ↓  partial payment              ↓  cancel (only while issued, no payment recorded)
 *   partially_paid                    cancelled
 *     ↓  payment completes the total
 *   paid
 *
 *   void — terminal state for an invoice that needs to be wiped out
 *          fiscally (manual marker; auditing is done outside the app).
 *
 * Once an invoice is `issued`, the header is immutable — corrections go
 * through a `cancelled` → re-issue with a fresh draft. Payments are the
 * only mutation allowed on issued invoices.
 */
export type InvoiceStatus =
  | "draft"
  | "issued"
  | "partially_paid"
  | "paid"
  | "cancelled"
  | "void";

/** Header input shared between create and update commands. */
export type InvoiceHeaderInput = {
  issueDate: string;
  dueDate?: string | null;
  paymentTermsDays?: number | null;
  clientId?: string | null;
  clientNameSnapshot: string;
  clientRncSnapshot?: string | null;
  productionCompanyId?: string | null;
  productionCompanyNameSnapshot?: string | null;
  productionPurSnapshot?: string | null;
  workspaceSirecineSnapshot?: string | null;
  attentionName?: string | null;
  attentionPhone?: string | null;
  projectId?: string | null;
  projectNameSnapshot?: string | null;
  productionName?: string | null;
  description?: string | null;
  packageTitle?: string | null;
  currency: string;
  baseCurrency: string;
  exchangeRate: number;
  exchangeRateSource: CurrencyRateSource;
  exchangeRateType: CurrencyRateType;
  exchangeRateEffectiveDate?: string | null;
  taxProfile: QuoteTaxProfile;
  itbisRate: number;
  taxAddedToTotal: boolean;
  taxNotes?: string | null;
  discountRate?: number | null;
  discountAmount?: number | null;
  observations?: string | null;
};

export type InvoiceItemInput = {
  sortOrder: number;
  quantity: number;
  title: string;
  description?: string | null;
  durationValue?: number | null;
  durationUnit?: QuoteItemDurationUnit | null;
  unitPrice: number;
  discountRate?: number | null;
  discountAmount?: number | null;
  taxBehavior: QuoteItemTaxBehavior;
  taxRate?: number | null;
  notes?: string | null;
};

export type CreateInvoiceCommand = InvoiceHeaderInput & {
  commandId: string;
  workspaceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
  items: InvoiceItemInput[];
  /** Optional link back to the quote that seeded this invoice. */
  sourceQuoteId?: string | null;
};

export type UpdateInvoiceCommand = InvoiceHeaderInput & {
  commandId: string;
  workspaceId: string;
  invoiceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
  items: InvoiceItemInput[];
};

/**
 * Issuing an invoice atomically:
 *   1) Asserts the invoice is still in draft.
 *   2) Consumes the workspace's next NCF (transactional).
 *   3) Freezes the totals and snapshots into the row.
 *   4) Status → 'issued'.
 *
 * Once issued, the header is immutable.
 */
export type IssueInvoiceCommand = {
  commandId: string;
  workspaceId: string;
  invoiceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type CancelInvoiceCommand = {
  commandId: string;
  workspaceId: string;
  invoiceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
  reason?: string | null;
};

export type RecordInvoicePaymentCommand = {
  commandId: string;
  workspaceId: string;
  invoiceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
  paidAt: string;
  amount: number;
  currency: string;
  exchangeRate?: number | null;
  paymentMethod?: string | null;
  reference?: string | null;
  notes?: string | null;
};

export type InvoiceMutationResult = {
  commandId: string;
  invoiceId: string;
  invoiceNumber: string;
  repeated: boolean;
  summary: string;
};

export type InvoicePaymentRow = {
  id: string;
  invoiceId: string;
  paidAt: string;
  amount: number;
  currency: string;
  exchangeRate: number;
  baseCurrencyAmount: number;
  paymentMethod: string | null;
  reference: string | null;
  notes: string | null;
  recordedByUserId: string | null;
  createdAt: string;
};

export type InvoiceItemRow = {
  id: string;
  invoiceId: string;
  sortOrder: number;
  quantity: number;
  title: string;
  description: string | null;
  durationValue: number | null;
  durationUnit: QuoteItemDurationUnit | null;
  unitPrice: number;
  lineSubtotal: number;
  discountRate: number | null;
  discountAmount: number;
  taxBehavior: QuoteItemTaxBehavior;
  taxRate: number | null;
  taxAmount: number;
  lineTotal: number;
  notes: string | null;
};

export type InvoiceRow = {
  id: string;
  workspaceId: string;
  sourceQuoteId: string | null;
  invoiceNumber: string;
  invoiceYear: number;
  invoiceSequence: number;
  ncf: string | null;
  ncfSeries: string | null;
  ncfSequence: number | null;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string | null;
  paymentTermsDays: number;
  clientId: string | null;
  clientNameSnapshot: string;
  clientRncSnapshot: string | null;
  productionCompanyId: string | null;
  productionCompanyNameSnapshot: string | null;
  productionPurSnapshot: string | null;
  workspaceSirecineSnapshot: string | null;
  attentionName: string | null;
  attentionPhone: string | null;
  projectId: string | null;
  projectNameSnapshot: string | null;
  productionName: string | null;
  description: string | null;
  packageTitle: string | null;
  currency: string;
  baseCurrency: string;
  exchangeRate: number;
  exchangeRateSource: CurrencyRateSource;
  exchangeRateType: CurrencyRateType;
  exchangeRateEffectiveDate: string | null;
  taxProfile: QuoteTaxProfile;
  itbisRate: number;
  taxAddedToTotal: boolean;
  taxNotes: string | null;
  subtotalAmount: number;
  discountAmount: number;
  discountRate: number | null;
  taxAmount: number;
  totalAmount: number;
  baseCurrencyTotalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  observations: string | null;
  issuedAt: string | null;
  cancelledAt: string | null;
  voidedAt: string | null;
  fullyPaidAt: string | null;
  createdByActorType: CommandActorType;
  sourceChannel: CommandSourceChannel | null;
  createdAt: string;
  updatedAt: string;
};

export type InvoiceDetail = InvoiceRow & {
  items: InvoiceItemRow[];
  payments: InvoicePaymentRow[];
};

export type InvoiceListFilter = {
  workspaceId: string;
  status?: InvoiceStatus;
  sourceQuoteId?: string;
  clientId?: string;
  projectId?: string;
  dateFrom?: string;
  dateTo?: string;
  currency?: string;
  search?: string;
  hasOutstanding?: boolean;
  limit?: number;
};

/**
 * The bit of `currency_settings` that controls NCF consumption.
 * Surfaced separately so the workspace card and the invoice editor
 * can both reason about "do we have a series ready, and how many
 * sequences are left".
 */
export type NcfSeriesState = {
  ncfSeriesActive: string | null;
  ncfSequenceNext: number | null;
  ncfSequenceMax: number | null;
  ncfExpiresAt: string | null;
};
