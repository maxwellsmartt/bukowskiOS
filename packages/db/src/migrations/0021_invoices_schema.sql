-- Migration 0021: Invoices schema (Phase 2 of the Quotes → Invoices flow).
--
-- The shape mirrors `quotes` (REAL+2dp money, status state machine,
-- per-line items, snapshotted catalog identity) but adds:
--   * `source_quote_id` so an invoice can be generated from an approved
--     quote and still keep its own audit trail.
--   * Dominican fiscal numbering — `ncf` + `ncf_series` + `ncf_sequence`
--     consumed atomically from `currency_settings`. The NCF is what
--     Jeannette uses for DGII compliance.
--   * `issue_date`, `due_date`, `payment_terms_days` for collections.
--   * Payment lifecycle: `paid_amount` / `outstanding_amount` are kept
--     in the row so the list view can colour-code aging buckets without
--     having to aggregate `invoice_payments` per query.
--   * `invoice_payments` ledger — every cash event captured.

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_quote_id TEXT REFERENCES quotes(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  invoice_year INTEGER NOT NULL,
  invoice_sequence INTEGER NOT NULL,
  ncf TEXT,
  ncf_series TEXT,
  ncf_sequence INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  issue_date TEXT NOT NULL,
  due_date TEXT,
  payment_terms_days INTEGER NOT NULL DEFAULT 0,
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
  paid_amount REAL NOT NULL DEFAULT 0,
  outstanding_amount REAL NOT NULL DEFAULT 0,
  observations TEXT,
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_by_actor_type TEXT NOT NULL DEFAULT 'user',
  source_channel TEXT,
  issued_at TEXT,
  cancelled_at TEXT,
  voided_at TEXT,
  fully_paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, invoice_year, invoice_sequence),
  UNIQUE (workspace_id, ncf)
);

CREATE INDEX IF NOT EXISTS idx_invoices_workspace_status
  ON invoices(workspace_id, status, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_workspace_client
  ON invoices(workspace_id, client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_workspace_project
  ON invoices(workspace_id, project_id);
CREATE INDEX IF NOT EXISTS idx_invoices_outstanding
  ON invoices(workspace_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_source_quote
  ON invoices(source_quote_id);

CREATE TABLE IF NOT EXISTS invoice_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice
  ON invoice_items(invoice_id, sort_order);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  paid_at TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL,
  exchange_rate REAL NOT NULL DEFAULT 1,
  base_currency_amount REAL NOT NULL,
  payment_method TEXT,
  reference TEXT,
  notes TEXT,
  recorded_by_user_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice
  ON invoice_payments(invoice_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_workspace_date
  ON invoice_payments(workspace_id, paid_at DESC);

-- NCF series state lives next to the rest of the workspace fiscal
-- configuration so a single workspace_settings card edits both.
ALTER TABLE currency_settings ADD COLUMN ncf_series_active TEXT;
ALTER TABLE currency_settings ADD COLUMN ncf_sequence_next INTEGER;
ALTER TABLE currency_settings ADD COLUMN ncf_sequence_max INTEGER;
ALTER TABLE currency_settings ADD COLUMN ncf_expires_at TEXT;
