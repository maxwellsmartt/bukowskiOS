-- Migration 0022: Treasury / bank reconciliation / expense tracking (PILAR T).
--
-- Carlos needs real visibility of cash-in vs cash-out across multiple bank
-- accounts (Banco Popular DOP/USD, Banco Santa Cruz) fed from imported bank
-- statements, with a human classification layer on top. The design keeps the
-- imported bank rows immutable (statement of record) and layers all human
-- edits in separate tables so a re-import never clobbers manual work.
--
-- Key ideas modelled here:
--   * `bank_accounts` — one row per account (bank + currency).
--   * `bank_statement_imports` — one row per import batch for traceability
--     and dedupe auditing (csv | xlsx | manual | pdf).
--   * `bank_transactions` — the raw, semi-immutable statement rows.
--     `dedupe_hash` is UNIQUE per (workspace, account) to prevent the same
--     movement from being imported twice when statements overlap.
--   * `transaction_annotations` — the mutable human layer (1:1). Currency
--     exchanges / inter-account transfers are flagged here so they are
--     EXCLUDED from income/expense totals (Carlos' "trampa de divisas").
--     `claimed_amount` vs `deductible_amount` drives Yané's DGII review.
--   * `transaction_project_allocations` — split one movement across projects
--     for real per-project P&L.
--   * `transaction_links` — reconcile a movement against an invoice / payment
--     / crew voucher (seeded now, automatic matching later).
--   * `counterparty_rules` — remembered/auto classification by description.

CREATE TABLE IF NOT EXISTS bank_accounts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,                 -- popular | santa_cruz | custom
  account_label TEXT NOT NULL,             -- human label, e.g. "Popular RD$ operativa"
  account_number_masked TEXT,              -- last digits / masked number from statement
  account_number_full TEXT,               -- full number (used for internal-transfer detection)
  currency TEXT NOT NULL,                  -- DOP | USD | EUR
  account_type TEXT,                       -- checking | savings | ...
  opening_balance REAL NOT NULL DEFAULT 0,
  opening_balance_date TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_workspace
  ON bank_accounts(workspace_id, is_active);

CREATE TABLE IF NOT EXISTS bank_statement_imports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  source_format TEXT NOT NULL,             -- csv | xlsx | manual | pdf
  original_filename TEXT,
  period_start TEXT,
  period_end TEXT,
  row_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  imported_by_user_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bank_imports_account
  ON bank_statement_imports(bank_account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS bank_transactions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  bank_account_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  import_id TEXT REFERENCES bank_statement_imports(id) ON DELETE SET NULL,
  txn_date TEXT NOT NULL,                  -- posting date (ISO yyyy-mm-dd)
  value_date TEXT,
  raw_description TEXT,
  reference TEXT,                          -- No. Referencia
  serial TEXT,                             -- No. Serial / No. Cheque
  amount REAL NOT NULL,                    -- always positive magnitude
  direction TEXT NOT NULL,                 -- debit | credit
  running_balance REAL,
  currency TEXT NOT NULL,
  dedupe_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, bank_account_id, dedupe_hash)
);

CREATE INDEX IF NOT EXISTS idx_bank_txns_account_date
  ON bank_transactions(workspace_id, bank_account_id, txn_date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_txns_workspace_date
  ON bank_transactions(workspace_id, txn_date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_txns_import
  ON bank_transactions(import_id);

CREATE TABLE IF NOT EXISTS transaction_annotations (
  transaction_id TEXT PRIMARY KEY REFERENCES bank_transactions(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- income | expense | transfer | fx_exchange | salary | reimbursement |
  -- tax | tss | bank_fee | interest | owner_draw | other
  txn_kind TEXT,
  concept TEXT,
  counterparty TEXT,
  counterparty_rnc TEXT,
  expense_category TEXT,
  is_internal_transfer INTEGER NOT NULL DEFAULT 0,
  -- n/a | pending | accepted | rejected | partial
  reimbursement_status TEXT NOT NULL DEFAULT 'n/a',
  claimed_amount REAL,
  deductible_amount REAL,
  -- pending | accepted | rejected
  fiscal_status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by_user_id TEXT,
  reviewed_at TEXT,
  support_doc_file_id TEXT,
  notes TEXT,
  classified_by_user_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_txn_annotations_workspace_kind
  ON transaction_annotations(workspace_id, txn_kind);
CREATE INDEX IF NOT EXISTS idx_txn_annotations_review
  ON transaction_annotations(workspace_id, reimbursement_status, fiscal_status);

CREATE TABLE IF NOT EXISTS transaction_project_allocations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  project_name_snapshot TEXT,
  amount REAL NOT NULL,
  percent REAL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_txn_allocations_transaction
  ON transaction_project_allocations(transaction_id);
CREATE INDEX IF NOT EXISTS idx_txn_allocations_project
  ON transaction_project_allocations(workspace_id, project_id);

CREATE TABLE IF NOT EXISTS transaction_links (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL REFERENCES bank_transactions(id) ON DELETE CASCADE,
  linked_entity_type TEXT NOT NULL,        -- invoice | invoice_payment | crew_voucher | financial_entry
  linked_entity_id TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (transaction_id, linked_entity_type, linked_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_txn_links_entity
  ON transaction_links(workspace_id, linked_entity_type, linked_entity_id);

CREATE TABLE IF NOT EXISTS counterparty_rules (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  match_pattern TEXT NOT NULL,             -- substring/regex matched against raw_description
  match_type TEXT NOT NULL DEFAULT 'contains', -- contains | regex | exact
  default_kind TEXT,
  default_category TEXT,
  default_counterparty TEXT,
  default_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_counterparty_rules_workspace
  ON counterparty_rules(workspace_id, is_active, priority DESC);
