-- 20260504090000 — currency settings + exchange rates + RNC/PUR snapshots
-- (Plan L FQ1). Mirrors the local SQLite migration 0018 with proper RLS.

CREATE TABLE IF NOT EXISTS public.currency_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  base_currency text NOT NULL DEFAULT 'DOP',
  default_quote_currency text NOT NULL DEFAULT 'DOP',
  enabled_currencies_json jsonb NOT NULL DEFAULT '["DOP","USD","EUR"]'::jsonb,
  default_rate_source text NOT NULL DEFAULT 'manual',
  default_rate_type text NOT NULL DEFAULT 'manual',
  default_itbis_rate numeric(6,4) NOT NULL DEFAULT 0.18,
  default_quote_validity_days integer NOT NULL DEFAULT 30,
  sirecine_number text,
  workspace_logo_url text,
  workspace_seal_url text,
  workspace_signature_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.exchange_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  base_currency text NOT NULL,
  quote_currency text NOT NULL,
  rate numeric(18,6) NOT NULL,
  rate_type text NOT NULL DEFAULT 'manual',
  source text NOT NULL DEFAULT 'manual',
  source_label text,
  effective_date date NOT NULL,
  fetched_at timestamptz,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exchange_rates_lookup
  ON public.exchange_rates (workspace_id, base_currency, quote_currency, effective_date DESC);

-- `clients` and `production_companies` only live in SQLite right now (preexisting
-- debt, see plan F12). Add the snapshot columns only if the tables already exist
-- in Supabase, otherwise skip silently — the future migration that creates these
-- tables remotely should include `rnc` / `pur` from the start.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'clients') THEN
    EXECUTE 'ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS rnc text';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'production_companies') THEN
    EXECUTE 'ALTER TABLE public.production_companies ADD COLUMN IF NOT EXISTS pur text';
  END IF;
END$$;

INSERT INTO public.permissions (key, label, description)
VALUES ('currency.manage_rates', 'Manage exchange rates', 'Create and edit currency settings and exchange rates.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.key = 'admin' AND p.key = 'currency.manage_rates'
ON CONFLICT DO NOTHING;

ALTER TABLE public.currency_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_rates    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "currency_settings_member_read"   ON public.currency_settings;
DROP POLICY IF EXISTS "currency_settings_admin_manage"  ON public.currency_settings;
DROP POLICY IF EXISTS "exchange_rates_member_read"      ON public.exchange_rates;
DROP POLICY IF EXISTS "exchange_rates_admin_manage"     ON public.exchange_rates;

CREATE POLICY "currency_settings_member_read" ON public.currency_settings
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.workspace_memberships m
            WHERE m.workspace_id = currency_settings.workspace_id
              AND m.user_id = auth.uid() AND m.status = 'active')
  );

CREATE POLICY "currency_settings_admin_manage" ON public.currency_settings
  FOR ALL USING (public.has_permission(workspace_id, 'currency.manage_rates'))
  WITH CHECK (public.has_permission(workspace_id, 'currency.manage_rates'));

CREATE POLICY "exchange_rates_member_read" ON public.exchange_rates
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.workspace_memberships m
            WHERE m.workspace_id = exchange_rates.workspace_id
              AND m.user_id = auth.uid() AND m.status = 'active')
  );

CREATE POLICY "exchange_rates_admin_manage" ON public.exchange_rates
  FOR ALL USING (public.has_permission(workspace_id, 'currency.manage_rates'))
  WITH CHECK (public.has_permission(workspace_id, 'currency.manage_rates'));
