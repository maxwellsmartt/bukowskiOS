-- Persist a per-project budget target so it follows the workspace across devices.
-- One row per project; the target lives separate from the project record so it can be
-- updated independently and audited without touching the immutable project blueprint.

CREATE TABLE IF NOT EXISTS public.project_budget_targets (
  project_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  amount numeric(14, 2) NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'USD',
  notes text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_budget_targets_workspace
  ON public.project_budget_targets (workspace_id);

ALTER TABLE public.project_budget_targets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname = 'members can read project budget targets'
  ) THEN
    EXECUTE 'CREATE POLICY "members can read project budget targets" ON public.project_budget_targets FOR SELECT USING (public.is_workspace_member(workspace_id))';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname = 'admins can manage project budget targets'
  ) THEN
    EXECUTE 'CREATE POLICY "admins can manage project budget targets" ON public.project_budget_targets FOR ALL USING (public.has_permission(workspace_id, ''projects.manage'')) WITH CHECK (public.has_permission(workspace_id, ''projects.manage''))';
  END IF;
END $$;
