-- 20260524180840 — Financial entries sync schema.
--
-- Local-first Finance Entries live in SQLite. This table mirrors the local
-- shape so `financial_entry` outbox rows can materialize into Supabase and
-- hydrate clean installs. It intentionally keeps optional links as text
-- because catalog/project hydration may lag behind finance hydration.

-- Repair earlier currency tables so they truly mirror SQLite. The desktop app
-- uses deterministic text IDs (`currency-settings-...`, `rate-...`), while the
-- first Supabase migration used uuid defaults. Text keeps existing uuid values
-- valid and allows local-first IDs to materialize through PostgREST.
ALTER TABLE public.currency_settings ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.currency_settings ALTER COLUMN id TYPE text USING id::text;
ALTER TABLE public.exchange_rates ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.exchange_rates ALTER COLUMN id TYPE text USING id::text;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.currency_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exchange_rates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quotes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quote_items TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.quote_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.invoice_payments TO authenticated;

DROP POLICY IF EXISTS "quote_versions_sync_update" ON public.quote_versions;
CREATE POLICY "quote_versions_sync_update" ON public.quote_versions
  FOR UPDATE USING (public.has_permission(workspace_id, 'quotes.edit'))
  WITH CHECK (public.has_permission(workspace_id, 'quotes.edit'));

DROP POLICY IF EXISTS "invoice_payments_sync_update" ON public.invoice_payments;
CREATE POLICY "invoice_payments_sync_update" ON public.invoice_payments
  FOR UPDATE USING (public.has_permission(workspace_id, 'invoices.record_payment'))
  WITH CHECK (public.has_permission(workspace_id, 'invoices.record_payment'));

CREATE TABLE IF NOT EXISTS public.financial_entries (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entry_type text NOT NULL,
  category text NOT NULL,
  amount numeric(18,2) NOT NULL,
  currency text NOT NULL,
  exchange_rate numeric(18,8),
  base_currency_amount numeric(18,2),
  status text NOT NULL,
  project_id text,
  project_unit_id text,
  asset_id text,
  incident_id text,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  entry_date date NOT NULL,
  description text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_entries_workspace_date
  ON public.financial_entries(workspace_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_financial_entries_workspace_type
  ON public.financial_entries(workspace_id, entry_type, status);
CREATE INDEX IF NOT EXISTS idx_financial_entries_project
  ON public.financial_entries(workspace_id, project_id);
CREATE INDEX IF NOT EXISTS idx_financial_entries_asset
  ON public.financial_entries(workspace_id, asset_id);
CREATE INDEX IF NOT EXISTS idx_financial_entries_incident
  ON public.financial_entries(workspace_id, incident_id);

ALTER TABLE public.financial_entries ENABLE ROW LEVEL SECURITY;

INSERT INTO public.permissions (key, label, description)
VALUES ('finance.manage', 'Manage finance entries', 'Create and update financial entries.')
ON CONFLICT (key) DO UPDATE
SET label = EXCLUDED.label,
    description = EXCLUDED.description;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.key = 'admin'
  AND p.key = 'finance.manage'
ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS "financial_entries_member_read" ON public.financial_entries;
DROP POLICY IF EXISTS "financial_entries_manage" ON public.financial_entries;

CREATE POLICY "financial_entries_member_read" ON public.financial_entries
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.workspace_memberships m
            WHERE m.workspace_id = financial_entries.workspace_id
              AND m.user_id = auth.uid()
              AND m.status = 'active')
  );

CREATE POLICY "financial_entries_manage" ON public.financial_entries
  FOR ALL USING (public.has_permission(workspace_id, 'finance.manage'))
  WITH CHECK (public.has_permission(workspace_id, 'finance.manage'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_entries TO authenticated;
