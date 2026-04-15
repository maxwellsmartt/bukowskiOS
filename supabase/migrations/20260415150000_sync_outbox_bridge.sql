-- Remote audit bridge for local sync_outbox.
-- This table receives idempotent outbox pushes from Electron using the user's JWT.

CREATE TABLE IF NOT EXISTS public.sync_outbox (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  event_id text,
  operation_type text NOT NULL,
  payload_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('pending', 'processing', 'failed', 'sent')),
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  next_retry_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_workspace_status
  ON public.sync_outbox(workspace_id, status, updated_at DESC);

ALTER TABLE public.sync_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can read workspace sync outbox"
  ON public.sync_outbox FOR SELECT
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "members can insert workspace sync outbox"
  ON public.sync_outbox FOR INSERT
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "members can update workspace sync outbox"
  ON public.sync_outbox FOR UPDATE
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));
