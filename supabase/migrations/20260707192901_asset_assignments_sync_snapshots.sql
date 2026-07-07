-- Remote asset assignment snapshots.
--
-- The asset outbox transport uploads the active assignment together with the
-- asset + current-state snapshot. Without this table, assigned/reserved assets
-- jam the sync queue with:
--   Could not find the table 'public.asset_assignments' in the schema cache
--
-- Keep this table intentionally lightweight like asset_events:
--   * workspace_id is the tenant boundary and RLS scope.
--   * asset_id references the remote assets mirror, which is upserted first.
--   * project/department/unit/user/location ids remain text because those
--     catalog rows can be hydrated in a different order across machines.

CREATE TABLE IF NOT EXISTS public.asset_assignments (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  asset_id text NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  project_id text,
  department_id text,
  project_unit_id text,
  assigned_to_user_id text,
  assigned_by_user_id text NOT NULL,
  source_location_id text,
  target_location_id text,
  quantity integer NOT NULL DEFAULT 1,
  assignment_status text NOT NULL,
  checked_out_at timestamptz,
  expected_return_at timestamptz,
  returned_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- If an environment already has a partial table from manual SQL, make the
-- migration self-healing instead of leaving sync in a new failure mode.
ALTER TABLE public.asset_assignments
  ADD COLUMN IF NOT EXISTS workspace_id uuid,
  ADD COLUMN IF NOT EXISTS asset_id text,
  ADD COLUMN IF NOT EXISTS project_id text,
  ADD COLUMN IF NOT EXISTS department_id text,
  ADD COLUMN IF NOT EXISTS project_unit_id text,
  ADD COLUMN IF NOT EXISTS assigned_to_user_id text,
  ADD COLUMN IF NOT EXISTS assigned_by_user_id text,
  ADD COLUMN IF NOT EXISTS source_location_id text,
  ADD COLUMN IF NOT EXISTS target_location_id text,
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS assignment_status text,
  ADD COLUMN IF NOT EXISTS checked_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS expected_return_at timestamptz,
  ADD COLUMN IF NOT EXISTS returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_asset_assignments_workspace_updated
  ON public.asset_assignments(workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_asset_assignments_asset_active
  ON public.asset_assignments(asset_id)
  WHERE returned_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_asset_assignments_project_unit
  ON public.asset_assignments(workspace_id, project_id, project_unit_id);

ALTER TABLE public.asset_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members can read workspace asset assignments" ON public.asset_assignments;
DROP POLICY IF EXISTS "members can insert workspace asset assignments" ON public.asset_assignments;
DROP POLICY IF EXISTS "members can update workspace asset assignments" ON public.asset_assignments;
DROP POLICY IF EXISTS "members can delete workspace asset assignments" ON public.asset_assignments;

CREATE POLICY "members can read workspace asset assignments"
  ON public.asset_assignments FOR SELECT
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "members can insert workspace asset assignments"
  ON public.asset_assignments FOR INSERT
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "members can update workspace asset assignments"
  ON public.asset_assignments FOR UPDATE
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "members can delete workspace asset assignments"
  ON public.asset_assignments FOR DELETE
  USING (public.is_workspace_member(workspace_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.asset_assignments TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.stamp_sync_updated_at()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS stamp_sync_updated_at_before_write ON public.asset_assignments;
    CREATE TRIGGER stamp_sync_updated_at_before_write
      BEFORE INSERT OR UPDATE ON public.asset_assignments
      FOR EACH ROW EXECUTE FUNCTION public.stamp_sync_updated_at();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'asset_assignments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.asset_assignments;
  END IF;
END
$$;

-- Ask PostgREST to refresh its schema cache immediately after this migration.
NOTIFY pgrst, 'reload schema';
