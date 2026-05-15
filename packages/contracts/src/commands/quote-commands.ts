import type { CommandActorType, CommandSourceChannel } from "./asset-commands";
import type {
  CurrencyRateSource,
  CurrencyRateType,
} from "./finance-currency-commands";

export type QuoteTaxProfile = "film_law_exempt" | "standard_itbis" | "mixed" | "manual";
export type QuoteItemTaxBehavior = "follows_quote" | "taxable" | "exempt" | "show_only" | "included";
export type QuoteStatus = "draft" | "sent" | "approved" | "rejected" | "expired" | "cancelled";
export type QuoteItemDurationUnit = "day" | "week" | "month" | "unit" | "flat";

export type QuoteItemInput = {
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

export type QuoteHeaderInput = {
  quoteDate: string;
  validityDays: number;
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

export type CreateQuoteCommand = QuoteHeaderInput & {
  commandId: string;
  workspaceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
  items: QuoteItemInput[];
};

export type UpdateQuoteCommand = QuoteHeaderInput & {
  commandId: string;
  workspaceId: string;
  quoteId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
  items: QuoteItemInput[];
  changeSummary?: string | null;
};

export type SetQuoteStatusCommand = {
  commandId: string;
  workspaceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
  quoteId: string;
  status: Exclude<QuoteStatus, "draft" | "expired">;
  reason?: string | null;
};

export type DuplicateQuoteCommand = {
  commandId: string;
  workspaceId: string;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
  quoteId: string;
};

/**
 * Restore a quote draft back to an earlier saved version. Behaviour:
 *
 *   - Requires the quote to currently be in `draft` status (same gate as
 *     edits — issued/approved/etc. quotes are immutable).
 *   - Requires the target version's snapshot to have been written with
 *     `schemaVersion >= 2` (the full snapshot shape). Older "header-only"
 *     snapshots cannot be restored — the UI will surface this and disable
 *     the action.
 *   - Never overwrites history: the restore inserts a new version on top
 *     (`vN+1`) whose `changeSummary` is `"Restored from v{N}"`.
 */
export type RestoreQuoteFromVersionCommand = {
  commandId: string;
  workspaceId: string;
  quoteId: string;
  versionNumber: number;
  actorType: CommandActorType;
  sourceChannel: CommandSourceChannel;
};

export type QuoteMutationResult = {
  commandId: string;
  quoteId: string;
  quoteNumber: string;
  repeated: boolean;
  summary: string;
};

export type QuoteItemRow = {
  id: string;
  quoteId: string;
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

export type QuoteRow = {
  id: string;
  workspaceId: string;
  quoteNumber: string;
  quoteYear: number;
  quoteSequence: number;
  status: QuoteStatus;
  quoteDate: string;
  validityDays: number;
  validUntil: string;
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
  observations: string | null;
  sentAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  expiredAt: string | null;
  cancelledAt: string | null;
  createdByActorType: CommandActorType;
  sourceChannel: CommandSourceChannel | null;
  createdAt: string;
  updatedAt: string;
};

export type QuoteDetail = QuoteRow & {
  items: QuoteItemRow[];
};

/**
 * Shape of the snapshot stored inside `quote_versions.snapshot_json` from
 * `schemaVersion >= 2` onwards. Pre-v2 snapshots ("header-only" — see
 * `quote_versions` rows written before the diff/restore feature) lack
 * `schemaVersion` and most of these fields; consumers must handle both
 * shapes defensively.
 *
 * Items and totals are persisted so the snapshot is enough to reconstruct
 * the full quote without re-running calculations.
 */
export type QuoteVersionSnapshotV2 = {
  schemaVersion: 2;
  // Identification context (snapshotted from the live row).
  quoteNumber: string;
  status: string;
  quoteDate: string;
  validityDays: number;
  validUntil: string;
  // Header — same fields as `QuoteHeaderInput`.
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
  discountRate: number | null;
  discountAmount: number | null;
  observations: string | null;
  // Items, in order.
  items: QuoteItemInput[];
  // Computed totals captured at save time so the version row is
  // self-contained for display.
  totals: {
    subtotal: number;
    discountAmount: number;
    taxAmount: number;
    total: number;
    baseCurrencyTotal: number;
  };
  // Legacy header-summary keys kept so older UI code that reads
  // `snapshot.total` / `snapshot.client` keeps working.
  client: string;
  productionCompany: string | null;
  total: number;
  baseCurrencyTotal: number;
  itemCount: number;
};

export type QuoteListFilter = {
  workspaceId: string;
  status?: QuoteStatus;
  clientId?: string;
  projectId?: string;
  dateFrom?: string;
  dateTo?: string;
  currency?: string;
  search?: string;
  limit?: number;
};
