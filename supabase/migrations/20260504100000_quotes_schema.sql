-- 20260504100000 — Quotes schema (Plan L FQ2/FQ3). Mirrors the local SQLite
-- migration 0019 with proper RLS. Money kept as numeric(18,2) to align with
-- the REAL columns in SQLite while still parsing as numbers cleanly.
--
-- Notes:
--  * `clients` and `production_companies` may not exist remotely (deuda
--    preexistente). FK references are added conditionally below.
--  * RLS is gated by per-permission predicates so admins manage and members
--    read.

CREATE TABLE IF NOT EXISTS public.quotes (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  quote_number text NOT NULL,
  quote_year integer NOT NULL,
  quote_sequence integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  quote_date date NOT NULL,
  validity_days integer NOT NULL DEFAULT 30,
  valid_until date NOT NULL,
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
  observations text,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  expired_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, quote_year, quote_sequence)
);

CREATE INDEX IF NOT EXISTS idx_quotes_workspace_status
  ON public.quotes(workspace_id, status, quote_date DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_workspace_client
  ON public.quotes(workspace_id, client_id);
CREATE INDEX IF NOT EXISTS idx_quotes_workspace_project
  ON public.quotes(workspace_id, project_id);
CREATE INDEX IF NOT EXISTS idx_quotes_valid_until
  ON public.quotes(workspace_id, status, valid_until);

CREATE TABLE IF NOT EXISTS public.quote_items (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  quote_id text NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_quote_items_quote
  ON public.quote_items(quote_id, sort_order);

CREATE TABLE IF NOT EXISTS public.quote_versions (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  quote_id text NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  snapshot_json jsonb NOT NULL,
  change_summary text,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quote_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_quote_versions_quote
  ON public.quote_versions(quote_id, version_number DESC);

CREATE TABLE IF NOT EXISTS public.quote_templates (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  category text,
  default_currency text,
  default_tax_profile text,
  items_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quote_templates_workspace
  ON public.quote_templates(workspace_id, is_active);

-- RLS ------------------------------------------------------------------------

ALTER TABLE public.quotes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_versions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_templates  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quotes_member_read"        ON public.quotes;
DROP POLICY IF EXISTS "quotes_create"             ON public.quotes;
DROP POLICY IF EXISTS "quotes_edit"               ON public.quotes;
DROP POLICY IF EXISTS "quotes_delete"             ON public.quotes;
DROP POLICY IF EXISTS "quote_items_member_read"   ON public.quote_items;
DROP POLICY IF EXISTS "quote_items_manage"        ON public.quote_items;
DROP POLICY IF EXISTS "quote_versions_member_read" ON public.quote_versions;
DROP POLICY IF EXISTS "quote_versions_create"     ON public.quote_versions;
DROP POLICY IF EXISTS "quote_templates_member_read" ON public.quote_templates;
DROP POLICY IF EXISTS "quote_templates_manage"    ON public.quote_templates;

-- quotes
CREATE POLICY "quotes_member_read" ON public.quotes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.workspace_memberships m
            WHERE m.workspace_id = quotes.workspace_id
              AND m.user_id = auth.uid()
              AND m.status = 'active')
  );

CREATE POLICY "quotes_create" ON public.quotes
  FOR INSERT WITH CHECK (public.has_permission(workspace_id, 'quotes.create'));

CREATE POLICY "quotes_edit" ON public.quotes
  FOR UPDATE USING (public.has_permission(workspace_id, 'quotes.edit'))
  WITH CHECK (public.has_permission(workspace_id, 'quotes.edit'));

CREATE POLICY "quotes_delete" ON public.quotes
  FOR DELETE USING (public.has_permission(workspace_id, 'quotes.cancel'));

-- quote_items (mirror parent permissions)
CREATE POLICY "quote_items_member_read" ON public.quote_items
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.workspace_memberships m
            WHERE m.workspace_id = quote_items.workspace_id
              AND m.user_id = auth.uid()
              AND m.status = 'active')
  );

CREATE POLICY "quote_items_manage" ON public.quote_items
  FOR ALL USING (public.has_permission(workspace_id, 'quotes.edit'))
  WITH CHECK (public.has_permission(workspace_id, 'quotes.edit'));

-- quote_versions (members read, anyone with quotes.edit creates snapshots)
CREATE POLICY "quote_versions_member_read" ON public.quote_versions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.workspace_memberships m
            WHERE m.workspace_id = quote_versions.workspace_id
              AND m.user_id = auth.uid()
              AND m.status = 'active')
  );

CREATE POLICY "quote_versions_create" ON public.quote_versions
  FOR INSERT WITH CHECK (public.has_permission(workspace_id, 'quotes.edit'));

-- quote_templates
CREATE POLICY "quote_templates_member_read" ON public.quote_templates
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.workspace_memberships m
            WHERE m.workspace_id = quote_templates.workspace_id
              AND m.user_id = auth.uid()
              AND m.status = 'active')
  );

CREATE POLICY "quote_templates_manage" ON public.quote_templates
  FOR ALL USING (public.has_permission(workspace_id, 'quotes.manage_templates'))
  WITH CHECK (public.has_permission(workspace_id, 'quotes.manage_templates'));
