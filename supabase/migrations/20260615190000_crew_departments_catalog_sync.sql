-- Mirror the crew_members and departments catalogs into Supabase so they sync
-- cross-machine. These were SQLite-only (created in local migration
-- 0003_admin_foundation): like clients/manufacturers/production_companies they
-- hold user data, so they rely on the outbound sync (sync_outbox) to populate
-- Supabase and the catalog pull (useCatalogPull) to hydrate locally.
--
-- Why this matters: project unit crew assignments and unit/department links
-- reference these catalogs. Without a sync mirror, the project operational
-- snapshot arrives on a second machine but its crew/department links are
-- dropped ("related crew/department is unavailable") because the parent rows
-- never sync. This closes that gap.
--
-- Notes:
--  * PK is `text` to match the locally generated slug ids ("crew-...", "department-...").
--  * departments has no local updated_at column; the mirror keeps one
--    (DEFAULT now()) so the catalog pull can cursor on it. The local apply
--    ignores it (the local table has only created_at).
--  * No UNIQUE(workspace_id, code/name): two machines may independently create
--    the same entity; the merge must not hard-fail. Conflict resolution is
--    last-writer-wins by id, with app-level dedupe.

CREATE TABLE IF NOT EXISTS public.crew_members (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  role_label text,
  email text,
  phone text,
  notes text,
  is_active integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.departments (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  is_active integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crew_members_workspace ON public.crew_members(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_departments_workspace ON public.departments(workspace_id, updated_at);

ALTER TABLE public.crew_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments  ENABLE ROW LEVEL SECURITY;

-- Read: any workspace member. Write: workspace admins (same proxy permission
-- the existing business catalogs use for management).
DROP POLICY IF EXISTS "members can read crew_members" ON public.crew_members;
DROP POLICY IF EXISTS "admins can manage crew_members" ON public.crew_members;
CREATE POLICY "members can read crew_members" ON public.crew_members
  FOR SELECT USING (public.is_workspace_member(workspace_id));
CREATE POLICY "admins can manage crew_members" ON public.crew_members
  FOR ALL USING (public.has_permission(workspace_id, 'users.invite'))
  WITH CHECK (public.has_permission(workspace_id, 'users.invite'));

DROP POLICY IF EXISTS "members can read departments" ON public.departments;
DROP POLICY IF EXISTS "admins can manage departments" ON public.departments;
CREATE POLICY "members can read departments" ON public.departments
  FOR SELECT USING (public.is_workspace_member(workspace_id));
CREATE POLICY "admins can manage departments" ON public.departments
  FOR ALL USING (public.has_permission(workspace_id, 'users.invite'))
  WITH CHECK (public.has_permission(workspace_id, 'users.invite'));

-- Data API grants ------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON public.crew_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.departments  TO authenticated;
