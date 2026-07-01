-- Mirror the kits + kit_assets catalog into Supabase so kits sync cross-machine.
-- A kit is an aggregate: the parent `kits` row plus its `kit_assets` membership.
-- Local-first via sync_outbox (push) + useCatalogPull (pull). Members reference
-- assets, which sync via the asset snapshot path; the local pull skips members
-- whose asset has not landed yet rather than hard-failing.
--
-- Conventions mirror departments/crew (local migration 0003_admin_foundation):
--   * text PK — matches the locally generated slug ids ("kit-...").
--   * uuid workspace_id → workspaces(id) ON DELETE CASCADE.
--   * integer is_active (NOT boolean) — the outbox pushes the raw local value.
--   * No UNIQUE(workspace_id, code): two machines may independently create the
--     same code; the merge must not hard-fail (last-writer-wins by id).
--   * kit_assets carries no workspace_id (the local table doesn't); its RLS is
--     scoped through the parent kit's workspace.

CREATE TABLE IF NOT EXISTS public.kits (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  notes text,
  is_active integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.kit_assets (
  kit_id text NOT NULL REFERENCES public.kits(id) ON DELETE CASCADE,
  asset_id text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kit_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_kits_workspace ON public.kits(workspace_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_kit_assets_kit ON public.kit_assets(kit_id);

ALTER TABLE public.kits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kit_assets ENABLE ROW LEVEL SECURITY;

-- Read: any workspace member. Write: workspace admins (same proxy permission the
-- other business catalogs use for management).
DROP POLICY IF EXISTS "members can read kits" ON public.kits;
DROP POLICY IF EXISTS "admins can manage kits" ON public.kits;
CREATE POLICY "members can read kits" ON public.kits
  FOR SELECT USING (public.is_workspace_member(workspace_id));
CREATE POLICY "admins can manage kits" ON public.kits
  FOR ALL USING (public.has_permission(workspace_id, 'users.invite'))
  WITH CHECK (public.has_permission(workspace_id, 'users.invite'));

-- kit_assets inherits its workspace scope from the parent kit.
DROP POLICY IF EXISTS "members can read kit_assets" ON public.kit_assets;
DROP POLICY IF EXISTS "admins can manage kit_assets" ON public.kit_assets;
CREATE POLICY "members can read kit_assets" ON public.kit_assets
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.kits k
      WHERE k.id = kit_assets.kit_id AND public.is_workspace_member(k.workspace_id)
    )
  );
CREATE POLICY "admins can manage kit_assets" ON public.kit_assets
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.kits k
      WHERE k.id = kit_assets.kit_id AND public.has_permission(k.workspace_id, 'users.invite')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.kits k
      WHERE k.id = kit_assets.kit_id AND public.has_permission(k.workspace_id, 'users.invite')
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kits TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kit_assets TO authenticated;

-- Deletion markers: a disband on one machine records a tombstone so a second
-- machine can drop its local copy. Kit-member deletes cascade with the parent,
-- so only the kits table needs the trigger. record_sync_tombstone() is defined
-- in 20260619201839_sync_tombstones_phase1.sql.
DO $$
BEGIN
  IF to_regclass('public.record_sync_tombstone') IS NOT NULL OR EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'record_sync_tombstone'
  ) THEN
    DROP TRIGGER IF EXISTS record_sync_tombstone_after_delete ON public.kits;
    CREATE TRIGGER record_sync_tombstone_after_delete
      AFTER DELETE ON public.kits
      FOR EACH ROW EXECUTE FUNCTION public.record_sync_tombstone('id');
  END IF;
END
$$;

-- Realtime: keep parity with the other synced catalogs.
DO $$
DECLARE
  target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['kits', 'kit_assets']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = target
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', target);
    END IF;
  END LOOP;
END
$$;
