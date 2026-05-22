-- 20260522120000 — Treasury / bank reconciliation schema. Mirrors local
-- SQLite migration 0022. See the plan "PILAR T — Tesorería, conciliación
-- bancaria y gastos". Raw imported bank rows stay immutable; the human
-- classification layer lives in separate tables so re-imports never clobber
-- manual work. Currency exchanges / inter-account transfers are flagged so
-- they are excluded from income/expense totals.

CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  bank_name text NOT NULL,
  account_label text NOT NULL,
  account_number_masked text,
  account_number_full text,
  currency text NOT NULL,
  account_type text,
  opening_balance numeric(18,2) NOT NULL DEFAULT 0,
  opening_balance_date date,
  is_active integer NOT NULL DEFAULT 1,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_workspace
  ON public.bank_accounts(workspace_id, is_active);

CREATE TABLE IF NOT EXISTS public.bank_statement_imports (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  bank_account_id text NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  source_format text NOT NULL,
  original_filename text,
  period_start date,
  period_end date,
  row_count integer NOT NULL DEFAULT 0,
  inserted_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  imported_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_imports_account
  ON public.bank_statement_imports(bank_account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bank_transactions (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  bank_account_id text NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
  import_id text REFERENCES public.bank_statement_imports(id) ON DELETE SET NULL,
  txn_date date NOT NULL,
  value_date date,
  raw_description text,
  reference text,
  serial text,
  amount numeric(18,2) NOT NULL,
  direction text NOT NULL,
  running_balance numeric(18,2),
  currency text NOT NULL,
  dedupe_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, bank_account_id, dedupe_hash)
);

CREATE INDEX IF NOT EXISTS idx_bank_txns_account_date
  ON public.bank_transactions(workspace_id, bank_account_id, txn_date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_txns_workspace_date
  ON public.bank_transactions(workspace_id, txn_date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_txns_import
  ON public.bank_transactions(import_id);

CREATE TABLE IF NOT EXISTS public.transaction_annotations (
  transaction_id text PRIMARY KEY REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  txn_kind text,
  concept text,
  counterparty text,
  counterparty_rnc text,
  expense_category text,
  is_internal_transfer integer NOT NULL DEFAULT 0,
  reimbursement_status text NOT NULL DEFAULT 'n/a',
  claimed_amount numeric(18,2),
  deductible_amount numeric(18,2),
  fiscal_status text NOT NULL DEFAULT 'pending',
  reviewed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  support_doc_file_id text,
  notes text,
  classified_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_txn_annotations_workspace_kind
  ON public.transaction_annotations(workspace_id, txn_kind);
CREATE INDEX IF NOT EXISTS idx_txn_annotations_review
  ON public.transaction_annotations(workspace_id, reimbursement_status, fiscal_status);

CREATE TABLE IF NOT EXISTS public.transaction_project_allocations (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  transaction_id text NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  project_id text,
  project_name_snapshot text,
  amount numeric(18,2) NOT NULL,
  percent numeric(8,4),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_txn_allocations_transaction
  ON public.transaction_project_allocations(transaction_id);
CREATE INDEX IF NOT EXISTS idx_txn_allocations_project
  ON public.transaction_project_allocations(workspace_id, project_id);

CREATE TABLE IF NOT EXISTS public.transaction_links (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  transaction_id text NOT NULL REFERENCES public.bank_transactions(id) ON DELETE CASCADE,
  linked_entity_type text NOT NULL,
  linked_entity_id text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, linked_entity_type, linked_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_txn_links_entity
  ON public.transaction_links(workspace_id, linked_entity_type, linked_entity_id);

CREATE TABLE IF NOT EXISTS public.counterparty_rules (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  match_pattern text NOT NULL,
  match_type text NOT NULL DEFAULT 'contains',
  default_kind text,
  default_category text,
  default_counterparty text,
  default_project_id text,
  priority integer NOT NULL DEFAULT 0,
  is_active integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_counterparty_rules_workspace
  ON public.counterparty_rules(workspace_id, is_active, priority DESC);

-- RLS ------------------------------------------------------------------------

ALTER TABLE public.bank_accounts                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_imports         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_transactions              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_annotations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_project_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_links              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counterparty_rules             ENABLE ROW LEVEL SECURITY;

-- Read: any active workspace member with treasury.transactions.read.
-- Write: gated by the specific treasury.* permission.

DROP POLICY IF EXISTS "bank_accounts_read"   ON public.bank_accounts;
DROP POLICY IF EXISTS "bank_accounts_manage" ON public.bank_accounts;
CREATE POLICY "bank_accounts_read" ON public.bank_accounts
  FOR SELECT USING (public.has_permission(workspace_id, 'treasury.transactions.read'));
CREATE POLICY "bank_accounts_manage" ON public.bank_accounts
  FOR ALL USING (public.has_permission(workspace_id, 'treasury.accounts.manage'))
  WITH CHECK (public.has_permission(workspace_id, 'treasury.accounts.manage'));

DROP POLICY IF EXISTS "bank_imports_read"   ON public.bank_statement_imports;
DROP POLICY IF EXISTS "bank_imports_manage" ON public.bank_statement_imports;
CREATE POLICY "bank_imports_read" ON public.bank_statement_imports
  FOR SELECT USING (public.has_permission(workspace_id, 'treasury.transactions.read'));
CREATE POLICY "bank_imports_manage" ON public.bank_statement_imports
  FOR ALL USING (public.has_permission(workspace_id, 'treasury.import'))
  WITH CHECK (public.has_permission(workspace_id, 'treasury.import'));

DROP POLICY IF EXISTS "bank_txns_read"   ON public.bank_transactions;
DROP POLICY IF EXISTS "bank_txns_import" ON public.bank_transactions;
CREATE POLICY "bank_txns_read" ON public.bank_transactions
  FOR SELECT USING (public.has_permission(workspace_id, 'treasury.transactions.read'));
CREATE POLICY "bank_txns_import" ON public.bank_transactions
  FOR ALL USING (public.has_permission(workspace_id, 'treasury.import'))
  WITH CHECK (public.has_permission(workspace_id, 'treasury.import'));

DROP POLICY IF EXISTS "txn_annotations_read"     ON public.transaction_annotations;
DROP POLICY IF EXISTS "txn_annotations_classify" ON public.transaction_annotations;
DROP POLICY IF EXISTS "txn_annotations_review"   ON public.transaction_annotations;
CREATE POLICY "txn_annotations_read" ON public.transaction_annotations
  FOR SELECT USING (public.has_permission(workspace_id, 'treasury.transactions.read'));
CREATE POLICY "txn_annotations_classify" ON public.transaction_annotations
  FOR ALL USING (
    public.has_permission(workspace_id, 'treasury.transactions.classify')
    OR public.has_permission(workspace_id, 'treasury.reimbursements.review')
  )
  WITH CHECK (
    public.has_permission(workspace_id, 'treasury.transactions.classify')
    OR public.has_permission(workspace_id, 'treasury.reimbursements.review')
  );

DROP POLICY IF EXISTS "txn_allocations_read"   ON public.transaction_project_allocations;
DROP POLICY IF EXISTS "txn_allocations_manage" ON public.transaction_project_allocations;
CREATE POLICY "txn_allocations_read" ON public.transaction_project_allocations
  FOR SELECT USING (public.has_permission(workspace_id, 'treasury.transactions.read'));
CREATE POLICY "txn_allocations_manage" ON public.transaction_project_allocations
  FOR ALL USING (public.has_permission(workspace_id, 'treasury.transactions.classify'))
  WITH CHECK (public.has_permission(workspace_id, 'treasury.transactions.classify'));

DROP POLICY IF EXISTS "txn_links_read"   ON public.transaction_links;
DROP POLICY IF EXISTS "txn_links_manage" ON public.transaction_links;
CREATE POLICY "txn_links_read" ON public.transaction_links
  FOR SELECT USING (public.has_permission(workspace_id, 'treasury.transactions.read'));
CREATE POLICY "txn_links_manage" ON public.transaction_links
  FOR ALL USING (public.has_permission(workspace_id, 'treasury.transactions.classify'))
  WITH CHECK (public.has_permission(workspace_id, 'treasury.transactions.classify'));

DROP POLICY IF EXISTS "counterparty_rules_read"   ON public.counterparty_rules;
DROP POLICY IF EXISTS "counterparty_rules_manage" ON public.counterparty_rules;
CREATE POLICY "counterparty_rules_read" ON public.counterparty_rules
  FOR SELECT USING (public.has_permission(workspace_id, 'treasury.transactions.read'));
CREATE POLICY "counterparty_rules_manage" ON public.counterparty_rules
  FOR ALL USING (public.has_permission(workspace_id, 'treasury.transactions.classify'))
  WITH CHECK (public.has_permission(workspace_id, 'treasury.transactions.classify'));

-- Data API grants (PostgREST) -----------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_accounts                  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_statement_imports         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bank_transactions              TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_annotations        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_project_allocations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transaction_links              TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.counterparty_rules             TO authenticated;
