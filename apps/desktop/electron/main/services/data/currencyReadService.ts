import type { DatabaseSync } from "node:sqlite";

import type {
  CurrencyRateSource,
  CurrencyRateType,
  CurrencySettingsRow,
  ExchangeRateRow,
} from "@contracts";

const parseEnabledCurrencies = (raw: string | null): string[] => {
  if (!raw) return ["DOP", "USD", "EUR"];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((value): value is string => typeof value === "string" && value.length > 0);
    }
  } catch {
    /* fall through */
  }
  return ["DOP", "USD", "EUR"];
};

const mapSettings = (row: Record<string, unknown>): CurrencySettingsRow => ({
  id: row.id as string,
  workspaceId: row.workspace_id as string,
  baseCurrency: row.base_currency as string,
  defaultQuoteCurrency: row.default_quote_currency as string,
  enabledCurrencies: parseEnabledCurrencies(row.enabled_currencies_json as string | null),
  defaultRateSource: row.default_rate_source as CurrencyRateSource,
  defaultRateType: row.default_rate_type as CurrencyRateType,
  defaultItbisRate: Number(row.default_itbis_rate),
  defaultQuoteValidityDays: Number(row.default_quote_validity_days),
  sirecineNumber: (row.sirecine_number as string | null) ?? null,
  workspaceLogoUrl: (row.workspace_logo_url as string | null) ?? null,
  workspaceSealUrl: (row.workspace_seal_url as string | null) ?? null,
  workspaceSignatureUrl: (row.workspace_signature_url as string | null) ?? null,
  ncfSeriesActive: (row.ncf_series_active as string | null) ?? null,
  ncfSequenceNext:
    row.ncf_sequence_next === null || row.ncf_sequence_next === undefined
      ? null
      : Number(row.ncf_sequence_next),
  ncfSequenceMax:
    row.ncf_sequence_max === null || row.ncf_sequence_max === undefined
      ? null
      : Number(row.ncf_sequence_max),
  ncfExpiresAt: (row.ncf_expires_at as string | null) ?? null,
  createdAt: row.created_at as string,
  updatedAt: row.updated_at as string,
});

const mapRate = (row: Record<string, unknown>): ExchangeRateRow => ({
  id: row.id as string,
  workspaceId: row.workspace_id as string,
  baseCurrency: row.base_currency as string,
  quoteCurrency: row.quote_currency as string,
  rate: Number(row.rate),
  rateType: row.rate_type as CurrencyRateType,
  source: row.source as CurrencyRateSource,
  sourceLabel: (row.source_label as string | null) ?? null,
  effectiveDate: row.effective_date as string,
  fetchedAt: (row.fetched_at as string | null) ?? null,
  createdByUserId: (row.created_by_user_id as string | null) ?? null,
  notes: (row.notes as string | null) ?? null,
  createdAt: row.created_at as string,
});

const DEFAULT_SETTINGS = (workspaceId: string): CurrencySettingsRow => ({
  id: `currency-settings-${workspaceId}`,
  workspaceId,
  baseCurrency: "DOP",
  defaultQuoteCurrency: "DOP",
  enabledCurrencies: ["DOP", "USD", "EUR"],
  defaultRateSource: "manual",
  defaultRateType: "manual",
  defaultItbisRate: 0.18,
  defaultQuoteValidityDays: 30,
  sirecineNumber: null,
  workspaceLogoUrl: null,
  workspaceSealUrl: null,
  workspaceSignatureUrl: null,
  ncfSeriesActive: null,
  ncfSequenceNext: null,
  ncfSequenceMax: null,
  ncfExpiresAt: null,
  createdAt: "",
  updatedAt: "",
});

export const createCurrencyReadService = (db: DatabaseSync) => ({
  getSettings(workspaceId: string): CurrencySettingsRow {
    const row = db
      .prepare("SELECT * FROM currency_settings WHERE workspace_id = ? LIMIT 1")
      .get(workspaceId) as Record<string, unknown> | undefined;
    if (!row) {
      // The base_currency might be stored on `workspaces` already — derive a
      // sensible default settings shape so the UI can render before the user
      // saves anything.
      const ws = db
        .prepare("SELECT base_currency FROM workspaces WHERE id = ? LIMIT 1")
        .get(workspaceId) as { base_currency: string } | undefined;
      const defaults = DEFAULT_SETTINGS(workspaceId);
      if (ws?.base_currency) {
        defaults.baseCurrency = ws.base_currency.toUpperCase();
        if (!defaults.enabledCurrencies.includes(defaults.baseCurrency)) {
          defaults.enabledCurrencies = [defaults.baseCurrency, ...defaults.enabledCurrencies];
        }
      }
      return defaults;
    }
    return mapSettings(row);
  },

  listRates(
    workspaceId: string,
    filter?: { baseCurrency?: string; quoteCurrency?: string; limit?: number },
  ): ExchangeRateRow[] {
    const conditions: string[] = ["workspace_id = ?"];
    const params: Array<string | number> = [workspaceId];
    if (filter?.baseCurrency) {
      conditions.push("base_currency = ?");
      params.push(filter.baseCurrency.trim().toUpperCase());
    }
    if (filter?.quoteCurrency) {
      conditions.push("quote_currency = ?");
      params.push(filter.quoteCurrency.trim().toUpperCase());
    }
    const limit = filter?.limit && filter.limit > 0 ? Math.min(filter.limit, 200) : 50;
    const rows = db
      .prepare(
        `
          SELECT * FROM exchange_rates
          WHERE ${conditions.join(" AND ")}
          ORDER BY effective_date DESC, created_at DESC
          LIMIT ${limit}
        `,
      )
      .all(...params) as Record<string, unknown>[];
    return rows.map(mapRate);
  },

  getLatestRate(
    workspaceId: string,
    baseCurrency: string,
    quoteCurrency: string,
    rateType?: CurrencyRateType,
  ): ExchangeRateRow | null {
    const params: Array<string | number> = [
      workspaceId,
      baseCurrency.trim().toUpperCase(),
      quoteCurrency.trim().toUpperCase(),
    ];
    let condition = "workspace_id = ? AND base_currency = ? AND quote_currency = ?";
    if (rateType) {
      condition += " AND rate_type = ?";
      params.push(rateType);
    }
    const row = db
      .prepare(
        `
          SELECT * FROM exchange_rates
          WHERE ${condition}
          ORDER BY effective_date DESC, created_at DESC
          LIMIT 1
        `,
      )
      .get(...params) as Record<string, unknown> | undefined;
    return row ? mapRate(row) : null;
  },
});

export type CurrencyReadService = ReturnType<typeof createCurrencyReadService>;
