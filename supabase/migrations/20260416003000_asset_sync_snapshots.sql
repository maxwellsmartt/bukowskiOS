-- Remote asset snapshots for workspace-scoped sync verification.
-- These tables intentionally keep only a strong FK to workspaces.
-- Related ids (category, project, user, location, assignment) stay as text for MVP auditability.

CREATE TABLE IF NOT EXISTS public.assets (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  category_id text NOT NULL,
  name text NOT NULL,
  brand text,
  model text,
  serial_number text,
  internal_code text NOT NULL,
  description text,
  purchase_date timestamptz,
  purchase_price numeric,
  currency text,
  replacement_value numeric,
  current_book_value numeric,
  ownership_type text,
  default_location_id text,
  qr_code_value text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (workspace_id, internal_code)
);

CREATE INDEX IF NOT EXISTS idx_assets_workspace_updated
  ON public.assets(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.asset_current_state (
  asset_id text PRIMARY KEY REFERENCES public.assets(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  current_location_id text,
  current_project_id text,
  current_department_id text,
  current_responsible_user_id text,
  active_assignment_id text,
  condition_status text NOT NULL,
  operational_status text NOT NULL,
  custody_status text NOT NULL,
  last_event_id text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL,
  project_unit_id text,
  total_quantity integer NOT NULL DEFAULT 1,
  available_quantity integer NOT NULL DEFAULT 1,
  assigned_quantity integer NOT NULL DEFAULT 0,
  checked_out_quantity integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_asset_current_state_workspace_updated
  ON public.asset_current_state(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.asset_events (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  asset_id text NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  assignment_id text,
  project_id text,
  department_id text,
  performed_by_user_id text NOT NULL,
  event_type text NOT NULL,
  location_id text,
  from_location_id text,
  to_location_id text,
  event_timestamp timestamptz NOT NULL,
  command_id text NOT NULL,
  actor_type text NOT NULL,
  source_channel text NOT NULL,
  notes text,
  metadata_json jsonb,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_asset_events_workspace_asset_time
  ON public.asset_events(workspace_id, asset_id, event_timestamp DESC);

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_current_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can read workspace assets"
  ON public.assets FOR SELECT
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "members can insert workspace assets"
  ON public.assets FOR INSERT
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "members can update workspace assets"
  ON public.assets FOR UPDATE
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "members can read workspace asset state"
  ON public.asset_current_state FOR SELECT
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "members can insert workspace asset state"
  ON public.asset_current_state FOR INSERT
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "members can update workspace asset state"
  ON public.asset_current_state FOR UPDATE
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "members can read workspace asset events"
  ON public.asset_events FOR SELECT
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "members can insert workspace asset events"
  ON public.asset_events FOR INSERT
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "members can update workspace asset events"
  ON public.asset_events FOR UPDATE
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
