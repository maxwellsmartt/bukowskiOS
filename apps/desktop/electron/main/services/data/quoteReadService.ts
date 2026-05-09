import type { DatabaseSync } from "node:sqlite";

import type {
  CommandActorType,
  CommandSourceChannel,
  CurrencyRateSource,
  CurrencyRateType,
  QuoteDetail,
  QuoteItemDurationUnit,
  QuoteItemRow,
  QuoteItemTaxBehavior,
  QuoteListFilter,
  QuoteRow,
  QuoteStatus,
  QuoteTaxProfile,
} from "@contracts";

const mapItem = (row: Record<string, unknown>): QuoteItemRow => ({
  id: row.id as string,
  quoteId: row.quote_id as string,
  sortOrder: Number(row.sort_order),
  quantity: Number(row.quantity),
  title: row.title as string,
  description: (row.description as string | null) ?? null,
  durationValue: row.duration_value === null || row.duration_value === undefined ? null : Number(row.duration_value),
  durationUnit: (row.duration_unit as QuoteItemDurationUnit | null) ?? null,
  unitPrice: Number(row.unit_price),
  lineSubtotal: Number(row.line_subtotal),
  discountRate: row.discount_rate === null || row.discount_rate === undefined ? null : Number(row.discount_rate),
  discountAmount: Number(row.discount_amount),
  taxBehavior: row.tax_behavior as QuoteItemTaxBehavior,
  taxRate: row.tax_rate === null || row.tax_rate === undefined ? null : Number(row.tax_rate),
  taxAmount: Number(row.tax_amount),
  lineTotal: Number(row.line_total),
  notes: (row.notes as string | null) ?? null,
});

const mapQuote = (row: Record<string, unknown>): QuoteRow => ({
  id: row.id as string,
  workspaceId: row.workspace_id as string,
  quoteNumber: row.quote_number as string,
  quoteYear: Number(row.quote_year),
  quoteSequence: Number(row.quote_sequence),
  status: row.status as QuoteStatus,
  quoteDate: row.quote_date as string,
  validityDays: Number(row.validity_days),
  validUntil: row.valid_until as string,
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
  discountRate: row.discount_rate === null || row.discount_rate === undefined ? null : Number(row.discount_rate),
  taxAmount: Number(row.tax_amount),
  totalAmount: Number(row.total_amount),
  baseCurrencyTotalAmount: Number(row.base_currency_total_amount),
  observations: (row.observations as string | null) ?? null,
  sentAt: (row.sent_at as string | null) ?? null,
  approvedAt: (row.approved_at as string | null) ?? null,
  rejectedAt: (row.rejected_at as string | null) ?? null,
  expiredAt: (row.expired_at as string | null) ?? null,
  cancelledAt: (row.cancelled_at as string | null) ?? null,
  createdByActorType: ((row.created_by_actor_type as CommandActorType | null) ?? "user") as CommandActorType,
  sourceChannel: (row.source_channel as CommandSourceChannel | null) ?? null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

export const createQuoteReadService = (db: DatabaseSync) => ({
  listQuotes(filter: QuoteListFilter): QuoteRow[] {
    const conditions: string[] = ["workspace_id = ?"];
    const params: Array<string | number> = [filter.workspaceId];
    if (filter.status) {
      conditions.push("status = ?");
      params.push(filter.status);
    }
    if (filter.clientId) {
      conditions.push("client_id = ?");
      params.push(filter.clientId);
    }
    if (filter.projectId) {
      conditions.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (filter.dateFrom) {
      conditions.push("quote_date >= ?");
      params.push(filter.dateFrom);
    }
    if (filter.dateTo) {
      conditions.push("quote_date <= ?");
      params.push(filter.dateTo);
    }
    if (filter.currency) {
      conditions.push("currency = ?");
      params.push(filter.currency.toUpperCase());
    }
    if (filter.search?.trim()) {
      conditions.push(
        "(quote_number LIKE ? OR client_name_snapshot LIKE ? OR project_name_snapshot LIKE ? OR package_title LIKE ?)",
      );
      const needle = `%${filter.search.trim()}%`;
      params.push(needle, needle, needle, needle);
    }
    const limit = filter.limit && filter.limit > 0 ? Math.min(filter.limit, 500) : 200;
    const rows = db
      .prepare(
        `SELECT * FROM quotes WHERE ${conditions.join(" AND ")} ORDER BY quote_date DESC, quote_sequence DESC LIMIT ${limit}`,
      )
      .all(...params) as Record<string, unknown>[];
    return rows.map(mapQuote);
  },

  getQuoteDetail(workspaceId: string, quoteId: string): QuoteDetail | null {
    const row = db
      .prepare("SELECT * FROM quotes WHERE workspace_id = ? AND id = ?")
      .get(workspaceId, quoteId) as Record<string, unknown> | undefined;
    if (!row) return null;
    const items = db
      .prepare("SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order ASC")
      .all(quoteId) as Record<string, unknown>[];
    return { ...mapQuote(row), items: items.map(mapItem) };
  },

  /**
   * Quote versions, newest first. Each row carries a serialised snapshot of
   * the quote at that save plus a short change_summary. Used by the editor's
   * version timeline side rail.
   */
  listQuoteVersions(
    workspaceId: string,
    quoteId: string,
  ): Array<{
    id: string;
    versionNumber: number;
    changeSummary: string | null;
    createdAt: string;
    createdByUserId: string | null;
    snapshot: Record<string, unknown>;
  }> {
    const rows = db
      .prepare(
        `
          SELECT id, version_number, change_summary, snapshot_json,
                 created_by_user_id, created_at
          FROM quote_versions
          WHERE workspace_id = ? AND quote_id = ?
          ORDER BY version_number DESC
        `,
      )
      .all(workspaceId, quoteId) as Array<{
      id: string;
      version_number: number;
      change_summary: string | null;
      snapshot_json: string;
      created_by_user_id: string | null;
      created_at: string;
    }>;

    return rows.map((row) => {
      let snapshot: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(row.snapshot_json);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          snapshot = parsed as Record<string, unknown>;
        }
      } catch {
        /* ignore malformed snapshots */
      }
      return {
        id: row.id,
        versionNumber: row.version_number,
        changeSummary: row.change_summary,
        createdAt: row.created_at,
        createdByUserId: row.created_by_user_id,
        snapshot,
      };
    });
  },
});

export type QuoteReadService = ReturnType<typeof createQuoteReadService>;
