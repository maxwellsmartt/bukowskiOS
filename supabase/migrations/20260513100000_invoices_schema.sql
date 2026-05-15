-- 20260513100000 — Invoices schema. Mirrors local SQLite migration 0021.
-- See `docs/foundation/finance-quotes-v1.md` for the design language we
-- inherit (REAL+2dp money, snapshotted catalog identity, status state
-- machine). What's new vs. quotes:
--   * `source_quote_id` — optional link back to the originating quote.
--   * Dominican NCF columns — consumed atomically from `currency_settings`.
--   * `invoice_payments` ledger drives `paid_amount` / `outstanding_amount`.

CREATE TABLE IF NOT EXISTS public.invoices (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_quote_id text REFERENCES public.quotes(id) ON DELETE SET NULL,
  invoice_number text NOT NULL,
  invoice_year integer NOT NULL,
  invoice_sequence integer NOT NULL,
  ncf text,
  ncf_series text,
  ncf_sequence integer,
  status text NOT NULL DEFAULT 'draft',
  issue_date date NOT NULL,
  due_date date,
  payment_terms_days integer NOT NULL DEFAULT 0,
  client_id text,
  client_name_snapshot text NOT NULL,
  client_rnc_snapshot text,
  production_company_id text,
  production_company_name_snapshot text,
  production_pur_snapshot text,
  workspace_sirecine_snapshot text,
  attention_name text,
  attention_phone text,
  project_id text,
  project_name_snapshot text,
  production_name text,
  description text,
  package_title text,
  currency text NOT NULL,
  base_currency text NOT NULL,
  exchange_rate numeric(18,6) NOT NULL,
  exchange_rate_source text NOT NULL,
  exchange_rate_type text NOT NULL,
  exchange_rate_effective_date date,
  exchange_rate_snapshot_json jsonb,
  tax_profile text NOT NULL DEFAULT 'standard_itbis',
  itbis_rate numeric(6,4) NOT NULL DEFAULT 0.18,
  tax_added_to_total integer NOT NULL DEFAULT 1,
  tax_notes text,
  subtotal_amount numeric(18,2) NOT NULL,
  discount_amount numeric(18,2) NOT NULL DEFAULT 0,
  discount_rate numeric(8,6),
  tax_amount numeric(18,2) NOT NULL DEFAULT 0,
  total_amount numeric(18,2) NOT NULL,
  base_currency_total_amount numeric(18,2) NOT NULL,
  paid_amount numeric(18,2) NOT NULL DEFAULT 0,
  outstanding_amount numeric(18,2) NOT NULL DEFAULT 0,
  observations text,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_actor_type text NOT NULL DEFAULT 'user',
  source_channel text,
  issued_at timestamptz,
  cancelled_at timestamptz,
  voided_at timestamptz,
  fully_paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, invoice_year, invoice_sequence),
  UNIQUE (workspace_id, ncf)
);

CREATE INDEX IF NOT EXISTS idx_invoices_workspace_status
  ON public.invoices(workspace_id, status, issue_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_workspace_client
  ON public.invoices(workspace_id, client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_workspace_project
  ON public.invoices(workspace_id, project_id);
CREATE INDEX IF NOT EXISTS idx_invoices_outstanding
  ON public.invoices(workspace_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_source_quote
  ON public.invoices(source_quote_id);

CREATE TABLE IF NOT EXISTS public.invoice_items (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invoice_id text NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  quantity numeric(12,3) NOT NULL DEFAULT 1,
  title text NOT NULL,
  description text,
  duration_value numeric(12,3),
  duration_unit text,
  unit_price numeric(18,2) NOT NULL DEFAULT 0,
  line_subtotal numeric(18,2) NOT NULL DEFAULT 0,
  discount_rate numeric(8,6),
  discount_amount numeric(18,2) NOT NULL DEFAULT 0,
  tax_behavior text NOT NULL DEFAULT 'follows_quote',
  tax_rate numeric(6,4),
  tax_amount numeric(18,2) NOT NULL DEFAULT 0,
  line_total numeric(18,2) NOT NULL DEFAULT 0,
  notes text,
  metadata_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice
  ON public.invoice_items(invoice_id, sort_order);

CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invoice_id text NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  paid_at date NOT NULL,
  amount numeric(18,2) NOT NULL,
  currency text NOT NULL,
  exchange_rate numeric(18,6) NOT NULL DEFAULT 1,
  base_currency_amount numeric(18,2) NOT NULL,
  payment_method text,
  reference text,
  notes text,
  recorded_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice
  ON public.invoice_payments(invoice_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_workspace_date
  ON public.invoice_payments(workspace_id, paid_at DESC);

-- NCF series state lives on the existing currency_settings row.
ALTER TABLE public.currency_settings
  ADD COLUMN IF NOT EXISTS ncf_series_active text;
ALTER TABLE public.currency_settings
  ADD COLUMN IF NOT EXISTS ncf_sequence_next integer;
ALTER TABLE public.currency_settings
  ADD COLUMN IF NOT EXISTS ncf_sequence_max integer;
ALTER TABLE public.currency_settings
  ADD COLUMN IF NOT EXISTS ncf_expires_at timestamptz;

-- RLS ------------------------------------------------------------------------

ALTER TABLE public.invoices         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoices_member_read"          ON public.invoices;
DROP POLICY IF EXISTS "invoices_create"               ON public.invoices;
DROP POLICY IF EXISTS "invoices_edit"                 ON public.invoices;
DROP POLICY IF EXISTS "invoices_cancel"               ON public.invoices;
DROP POLICY IF EXISTS "invoice_items_member_read"     ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_items_manage"          ON public.invoice_items;
DROP POLICY IF EXISTS "invoice_payments_member_read"  ON public.invoice_payments;
DROP POLICY IF EXISTS "invoice_payments_record"       ON public.invoice_payments;

-- invoices
CREATE POLICY "invoices_member_read" ON public.invoices
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.workspace_memberships m
            WHERE m.workspace_id = invoices.workspace_id
              AND m.user_id = auth.uid()
              AND m.status = 'active')
  );

CREATE POLICY "invoices_create" ON public.invoices
  FOR INSERT WITH CHECK (public.has_permission(workspace_id, 'invoices.create'));

CREATE POLICY "invoices_edit" ON public.invoices
  FOR UPDATE USING (public.has_permission(workspace_id, 'invoices.edit_draft'))
  WITH CHECK (public.has_permission(workspace_id, 'invoices.edit_draft'));

CREATE POLICY "invoices_cancel" ON public.invoices
  FOR DELETE USING (public.has_permission(workspace_id, 'invoices.cancel'));

-- invoice_items
CREATE POLICY "invoice_items_member_read" ON public.invoice_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.workspace_memberships m
            WHERE m.workspace_id = invoice_items.workspace_id
              AND m.user_id = auth.uid()
              AND m.status = 'active')
  );

CREATE POLICY "invoice_items_manage" ON public.invoice_items
  FOR ALL USING (public.has_permission(workspace_id, 'invoices.edit_draft'))
  WITH CHECK (public.has_permission(workspace_id, 'invoices.edit_draft'));

-- invoice_payments
CREATE POLICY "invoice_payments_member_read" ON public.invoice_payments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.workspace_memberships m
            WHERE m.workspace_id = invoice_payments.workspace_id
              AND m.user_id = auth.uid()
              AND m.status = 'active')
  );

CREATE POLICY "invoice_payments_record" ON public.invoice_payments
  FOR INSERT WITH CHECK (public.has_permission(workspace_id, 'invoices.record_payment'));
