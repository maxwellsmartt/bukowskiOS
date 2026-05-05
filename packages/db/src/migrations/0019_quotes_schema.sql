-- Migration 0019: Quotes schema (Plan L FQ2). Money kept as REAL (2 decimals).

CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  quote_number TEXT NOT NULL,
  quote_year INTEGER NOT NULL,
  quote_sequence INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  quote_date TEXT NOT NULL,
  validity_days INTEGER NOT NULL DEFAULT 30,
  valid_until TEXT NOT NULL,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  client_name_snapshot TEXT NOT NULL,
  client_rnc_snapshot TEXT,
  production_company_id TEXT REFERENCES production_companies(id) ON DELETE SET NULL,
  production_company_name_snapshot TEXT,
  production_pur_snapshot TEXT,
  workspace_sirecine_snapshot TEXT,
  attention_name TEXT,
  attention_phone TEXT,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  project_name_snapshot TEXT,
  production_name TEXT,
  description TEXT,
  package_title TEXT,
  currency TEXT NOT NULL,
  base_currency TEXT NOT NULL,
  exchange_rate REAL NOT NULL,
  exchange_rate_source TEXT NOT NULL,
  exchange_rate_type TEXT NOT NULL,
  exchange_rate_effective_date TEXT,
  exchange_rate_snapshot_json TEXT,
  tax_profile TEXT NOT NULL DEFAULT 'standard_itbis',
  itbis_rate REAL NOT NULL DEFAULT 0.18,
  tax_added_to_total INTEGER NOT NULL DEFAULT 1,
  tax_notes TEXT,
  subtotal_amount REAL NOT NULL,
  discount_amount REAL NOT NULL DEFAULT 0,
  discount_rate REAL,
  tax_amount REAL NOT NULL DEFAULT 0,
  total_amount REAL NOT NULL,
  base_currency_total_amount REAL NOT NULL,
  observations TEXT,
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  sent_at TEXT,
  approved_at TEXT,
  rejected_at TEXT,
  expired_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, quote_year, quote_sequence)
);

CREATE INDEX IF NOT EXISTS idx_quotes_workspace_status
  ON quotes(workspace_id, status, quote_date DESC);

CREATE INDEX IF NOT EXISTS idx_quotes_workspace_client
  ON quotes(workspace_id, client_id);

CREATE INDEX IF NOT EXISTS idx_quotes_workspace_project
  ON quotes(workspace_id, project_id);

CREATE INDEX IF NOT EXISTS idx_quotes_valid_until
  ON quotes(workspace_id, status, valid_until);

CREATE TABLE IF NOT EXISTS quote_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  quantity REAL NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  description TEXT,
  duration_value REAL,
  duration_unit TEXT,
  unit_price REAL NOT NULL DEFAULT 0,
  line_subtotal REAL NOT NULL DEFAULT 0,
  discount_rate REAL,
  discount_amount REAL NOT NULL DEFAULT 0,
  tax_behavior TEXT NOT NULL DEFAULT 'follows_quote',
  tax_rate REAL,
  tax_amount REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL DEFAULT 0,
  notes TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quote_items_quote
  ON quote_items(quote_id, sort_order);

CREATE TABLE IF NOT EXISTS quote_versions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  change_summary TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (quote_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_quote_versions_quote
  ON quote_versions(quote_id, version_number DESC);

CREATE TABLE IF NOT EXISTS quote_templates (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  default_currency TEXT,
  default_tax_profile TEXT,
  items_json TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quote_templates_workspace
  ON quote_templates(workspace_id, is_active);
