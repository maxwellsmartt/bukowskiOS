-- Migration 0018: currency settings + exchange rates + RNC/PUR catalog snapshots.
-- Foundation for FinanceOps Quotes v1 (Plan L). Money kept as REAL with 2 decimals
-- to stay consistent with `financial_entries`.

CREATE TABLE IF NOT EXISTS currency_settings (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  base_currency TEXT NOT NULL DEFAULT 'DOP',
  default_quote_currency TEXT NOT NULL DEFAULT 'DOP',
  enabled_currencies_json TEXT NOT NULL DEFAULT '["DOP","USD","EUR"]',
  default_rate_source TEXT NOT NULL DEFAULT 'manual',
  default_rate_type TEXT NOT NULL DEFAULT 'manual',
  default_itbis_rate REAL NOT NULL DEFAULT 0.18,
  default_quote_validity_days INTEGER NOT NULL DEFAULT 30,
  sirecine_number TEXT,
  workspace_logo_url TEXT,
  workspace_seal_url TEXT,
  workspace_signature_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exchange_rates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate REAL NOT NULL,
  rate_type TEXT NOT NULL DEFAULT 'manual',
  source TEXT NOT NULL DEFAULT 'manual',
  source_label TEXT,
  effective_date TEXT NOT NULL,
  fetched_at TEXT,
  created_by_user_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup
  ON exchange_rates(workspace_id, base_currency, quote_currency, effective_date DESC);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_workspace_recent
  ON exchange_rates(workspace_id, effective_date DESC);

-- Catalog snapshots needed for quote PDFs (RNC / PUR).
ALTER TABLE clients ADD COLUMN rnc TEXT;
ALTER TABLE production_companies ADD COLUMN pur TEXT;
