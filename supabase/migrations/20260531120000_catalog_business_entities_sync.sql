-- Mirror the business catalog tables (clients / manufacturers /
-- production_companies) into Supabase so they sync cross-machine and hydrate a
-- clean install. These were SQLite-only; unlike asset_categories/locations they
-- hold user data (not a static base list), so they rely on the outbound sync
-- (sync_outbox) to populate Supabase and the catalog pull to hydrate locally.
--
-- Notes:
--  * PK is `text` to match the locally generated slug ids (e.g. "client-acme-...").
--  * No UNIQUE(workspace_id, name): two machines may independently create a
--    same-named entity; the merge point must not hard-fail on sync. App-level
--    dedupe handles duplicates. Conflict resolution is last-writer-wins by id.

CREATE TABLE IF NOT EXISTS public.clients (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_name text,
  email text,
  phone text,
  rnc text,
  notes text,
  is_active integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.manufacturers (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_name text,
  support_email text,
  phone text,
  notes text,
  is_active integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.production_companies (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_name text,
  email text,
  phone text,
  pur text,
  notes text,
  is_active integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clients_workspace ON public.clients(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_manufacturers_workspace ON public.manufacturers(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_production_companies_workspace ON public.production_companies(workspace_id, updated_at);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_companies ENABLE ROW LEVEL SECURITY;

-- Read: any workspace member. Write: workspace admins (same proxy permission
-- the existing catalog tables use for management).
DROP POLICY IF EXISTS "members can read clients" ON public.clients;
DROP POLICY IF EXISTS "admins can manage clients" ON public.clients;
CREATE POLICY "members can read clients" ON public.clients
  FOR SELECT USING (public.is_workspace_member(workspace_id));
CREATE POLICY "admins can manage clients" ON public.clients
  FOR ALL USING (public.has_permission(workspace_id, 'users.invite'))
  WITH CHECK (public.has_permission(workspace_id, 'users.invite'));

DROP POLICY IF EXISTS "members can read manufacturers" ON public.manufacturers;
DROP POLICY IF EXISTS "admins can manage manufacturers" ON public.manufacturers;
CREATE POLICY "members can read manufacturers" ON public.manufacturers
  FOR SELECT USING (public.is_workspace_member(workspace_id));
CREATE POLICY "admins can manage manufacturers" ON public.manufacturers
  FOR ALL USING (public.has_permission(workspace_id, 'users.invite'))
  WITH CHECK (public.has_permission(workspace_id, 'users.invite'));

DROP POLICY IF EXISTS "members can read production_companies" ON public.production_companies;
DROP POLICY IF EXISTS "admins can manage production_companies" ON public.production_companies;
CREATE POLICY "members can read production_companies" ON public.production_companies
  FOR SELECT USING (public.is_workspace_member(workspace_id));
CREATE POLICY "admins can manage production_companies" ON public.production_companies
  FOR ALL USING (public.has_permission(workspace_id, 'users.invite'))
  WITH CHECK (public.has_permission(workspace_id, 'users.invite'));

-- Data API grants ------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients               TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manufacturers         TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_companies  TO authenticated;
