import type { DatabaseSync } from "node:sqlite";

import type {
  CommandActorType,
  CommandSourceChannel,
  CurrencyRateSource,
  CurrencyRateType,
  InvoiceDetail,
  InvoiceItemRow,
  InvoiceListFilter,
  InvoicePaymentRow,
  InvoiceRow,
  InvoiceStatus,
  QuoteItemDurationUnit,
  QuoteItemTaxBehavior,
  QuoteTaxProfile,
} from "@contracts";

const mapItem = (row: Record<string, unknown>): InvoiceItemRow => ({
  id: row.id as string,
  invoiceId: row.invoice_id as string,
  sortOrder: Number(row.sort_order),
  quantity: Number(row.quantity),
  title: row.title as string,
  description: (row.description as string | null) ?? null,
  durationValue:
    row.duration_value === null || row.duration_value === undefined ? null : Number(row.duration_value),
  durationUnit: (row.duration_unit as QuoteItemDurationUnit | null) ?? null,
  unitPrice: Number(row.unit_price),
  lineSubtotal: Number(row.line_subtotal),
  discountRate:
    row.discount_rate === null || row.discount_rate === undefined ? null : Number(row.discount_rate),
  discountAmount: Number(row.discount_amount),
  taxBehavior: row.tax_behavior as QuoteItemTaxBehavior,
  taxRate: row.tax_rate === null || row.tax_rate === undefined ? null : Number(row.tax_rate),
  taxAmount: Number(row.tax_amount),
  lineTotal: Number(row.line_total),
  notes: (row.notes as string | null) ?? null,
});

const mapPayment = (row: Record<string, unknown>): InvoicePaymentRow => ({
  id: row.id as string,
  invoiceId: row.invoice_id as string,
  paidAt: row.paid_at as string,
  amount: Number(row.amount),
  currency: row.currency as string,
  exchangeRate: Number(row.exchange_rate),
  baseCurrencyAmount: Number(row.base_currency_amount),
  paymentMethod: (row.payment_method as string | null) ?? null,
  reference: (row.reference as string | null) ?? null,
  notes: (row.notes as string | null) ?? null,
  recordedByUserId: (row.recorded_by_user_id as string | null) ?? null,
  createdAt: row.created_at as string,
});

const mapInvoice = (row: Record<string, unknown>): InvoiceRow => ({
  id: row.id as string,
  workspaceId: row.workspace_id as string,
  sourceQuoteId: (row.source_quote_id as string | null) ?? null,
  invoiceNumber: row.invoice_number as string,
  invoiceYear: Number(row.invoice_year),
  invoiceSequence: Number(row.invoice_sequence),
  ncf: (row.ncf as string | null) ?? null,
  ncfSeries: (row.ncf_series as string | null) ?? null,
  ncfSequence: row.ncf_sequence === null || row.ncf_sequence === undefined ? null : Number(row.ncf_sequence),
  status: row.status as InvoiceStatus,
  issueDate: row.issue_date as string,
  dueDate: (row.due_date as string | null) ?? null,
  paymentTermsDays: Number(row.payment_terms_days ?? 0),
  clientId: (row.client_id as string | null) ?? null,
  clientNameSnapshot: row.client_name_snapshot as string,
  clientRncSnapshot: (row.client_rnc_snapshot as string | null) ?? null,
  productionCompanyId: (row.production_company_id as string | null) ?? null,
  productionCompanyNameSnapshot: (row.production_company_name_snapshot as string | null) ?? null,
  productionPurSnapshot: (row.production_pur_snapshot as string | null) ?? null,
  workspaceSirecineSnapshot: (row.workspace_sirecine_snapshot as string | null) ?? null,
  attentionName: (row.attention_name as string | null) ?? null,
  attentionPhone: (row.attention_phone as string | null) ?? null,
  projectId: (row.project_id as string | null) ?? null,
  projectNameSnapshot: (row.project_name_snapshot as string | null) ?? null,
  productionName: (row.production_name as string | null) ?? null,
  description: (row.description as string | null) ?? null,
  packageTitle: (row.package_title as string | null) ?? null,
  currency: row.currency as string,
  baseCurrency: row.base_currency as string,
  exchangeRate: Number(row.exchange_rate),
  exchangeRateSource: row.exchange_rate_source as CurrencyRateSource,
  exchangeRateType: row.exchange_rate_type as CurrencyRateType,
  exchangeRateEffectiveDate: (row.exchange_rate_effective_date as string | null) ?? null,
  taxProfile: row.tax_profile as QuoteTaxProfile,
  itbisRate: Number(row.itbis_rate),
  taxAddedToTotal: Number(row.tax_added_to_total) === 1,
  taxNotes: (row.tax_notes as string | null) ?? null,
  subtotalAmount: Number(row.subtotal_amount),
  discountAmount: Number(row.discount_amount),
  discountRate:
    row.discount_rate === null || row.discount_rate === undefined ? null : Number(row.discount_rate),
  taxAmount: Number(row.tax_amount),
  totalAmount: Number(row.total_amount),
  baseCurrencyTotalAmount: Number(row.base_currency_total_amount),
  paidAmount: Number(row.paid_amount ?? 0),
  outstandingAmount: Number(row.outstanding_amount ?? 0),
  observations: (row.observations as string | null) ?? null,
  issuedAt: (row.issued_at as string | null) ?? null,
  cancelledAt: (row.cancelled_at as string | null) ?? null,
  voidedAt: (row.voided_at as string | null) ?? null,
  fullyPaidAt: (row.fully_paid_at as string | null) ?? null,
  createdByActorType: row.created_by_actor_type as CommandActorType,
  sourceChannel: (row.source_channel as CommandSourceChannel | null) ?? null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

export const createInvoiceReadService = (db: DatabaseSync) => ({
  /**
   * Workspace-scoped list with the same filter knobs as the Quotes list,
   * plus an `hasOutstanding` flag that filters to invoices whose balance
   * is greater than zero (useful for the accounts-receivable view).
   */
  listInvoices(filter: InvoiceListFilter): InvoiceRow[] {
    const clauses: string[] = ["workspace_id = ?"];
    const params: Array<string | number> = [filter.workspaceId];

    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter.clientId) {
      clauses.push("client_id = ?");
      params.push(filter.clientId);
    }
    if (filter.projectId) {
      clauses.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (filter.dateFrom) {
      clauses.push("issue_date >= ?");
      params.push(filter.dateFrom);
    }
    if (filter.dateTo) {
      clauses.push("issue_date <= ?");
      params.push(filter.dateTo);
    }
    if (filter.currency) {
      clauses.push("currency = ?");
      params.push(filter.currency.toUpperCase());
    }
    if (filter.search) {
      const like = `%${filter.search.toLowerCase()}%`;
      clauses.push(
        "(LOWER(invoice_number) LIKE ? OR LOWER(client_name_snapshot) LIKE ? OR LOWER(COALESCE(project_name_snapshot,'')) LIKE ? OR LOWER(COALESCE(ncf,'')) LIKE ?)",
      );
      params.push(like, like, like, like);
    }
    if (filter.hasOutstanding) {
      clauses.push("outstanding_amount > 0");
    }

    const limit = Math.min(500, Math.max(1, filter.limit ?? 200));
    const rows = db
      .prepare(
        `
          SELECT * FROM invoices
          WHERE ${clauses.join(" AND ")}
          ORDER BY issue_date DESC, invoice_sequence DESC
          LIMIT ${limit}
        `,
      )
      .all(...params) as Record<string, unknown>[];

    return rows.map(mapInvoice);
  },

  getInvoiceDetail(workspaceId: string, invoiceId: string): InvoiceDetail | null {
    const row = db
      .prepare("SELECT * FROM invoices WHERE workspace_id = ? AND id = ?")
      .get(workspaceId, invoiceId) as Record<string, unknown> | undefined;
    if (!row) return null;

    const items = db
      .prepare("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order ASC")
      .all(invoiceId) as Record<string, unknown>[];
    const payments = db
      .prepare("SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_at DESC, created_at DESC")
      .all(invoiceId) as Record<string, unknown>[];

    return {
      ...mapInvoice(row),
      items: items.map(mapItem),
      payments: payments.map(mapPayment),
    };
  },
});

export type InvoiceReadService = ReturnType<typeof createInvoiceReadService>;
