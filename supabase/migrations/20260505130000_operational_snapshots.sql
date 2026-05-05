-- Generic operational snapshots for multi-user pilot sync.
-- Keeps operational entities shareable before the full normalized remote schema lands.

CREATE TABLE IF NOT EXISTS public.operational_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('project', 'packing_slip', 'incident', 'rma_case')),
  entity_id text NOT NULL,
  snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_operational_snapshots_workspace_entity_updated
  ON public.operational_snapshots(workspace_id, entity_type, updated_at DESC);

ALTER TABLE public.operational_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can read operational snapshots"
  ON public.operational_snapshots FOR SELECT
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "members can insert operational snapshots"
  ON public.operational_snapshots FOR INSERT
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "members can update operational snapshots"
  ON public.operational_snapshots FOR UPDATE
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
