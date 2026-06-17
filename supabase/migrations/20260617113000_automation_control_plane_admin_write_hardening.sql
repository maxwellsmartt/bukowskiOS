-- 20260617113000 — Align remote automation control-plane writes with the
-- desktop IPC guard. Local admin surfaces already require `users.invite`
-- before mutating agents, AI provider configs, or connector configs; the
-- mirrored Supabase tables must enforce the same rule so direct REST writes
-- from an ordinary workspace member cannot bypass the desktop app.

DROP POLICY IF EXISTS "members can insert agents control plane" ON public.agents;
DROP POLICY IF EXISTS "members can update agents control plane" ON public.agents;
DROP POLICY IF EXISTS "members can delete agents control plane" ON public.agents;

CREATE POLICY "admins can insert agents control plane"
  ON public.agents FOR INSERT
  WITH CHECK (public.has_permission(workspace_id, 'users.invite'));

CREATE POLICY "admins can update agents control plane"
  ON public.agents FOR UPDATE
  USING (public.has_permission(workspace_id, 'users.invite'))
  WITH CHECK (public.has_permission(workspace_id, 'users.invite'));

CREATE POLICY "admins can delete agents control plane"
  ON public.agents FOR DELETE
  USING (public.has_permission(workspace_id, 'users.invite'));

DROP POLICY IF EXISTS "members can insert ai provider configs" ON public.ai_provider_configs;
DROP POLICY IF EXISTS "members can update ai provider configs" ON public.ai_provider_configs;
DROP POLICY IF EXISTS "members can delete ai provider configs" ON public.ai_provider_configs;

CREATE POLICY "admins can insert ai provider configs"
  ON public.ai_provider_configs FOR INSERT
  WITH CHECK (public.has_permission(workspace_id, 'users.invite'));

CREATE POLICY "admins can update ai provider configs"
  ON public.ai_provider_configs FOR UPDATE
  USING (public.has_permission(workspace_id, 'users.invite'))
  WITH CHECK (public.has_permission(workspace_id, 'users.invite'));

CREATE POLICY "admins can delete ai provider configs"
  ON public.ai_provider_configs FOR DELETE
  USING (public.has_permission(workspace_id, 'users.invite'));

DROP POLICY IF EXISTS "members can insert agent connector configs" ON public.agent_connector_configs;
DROP POLICY IF EXISTS "members can update agent connector configs" ON public.agent_connector_configs;
DROP POLICY IF EXISTS "members can delete agent connector configs" ON public.agent_connector_configs;

CREATE POLICY "admins can insert agent connector configs"
  ON public.agent_connector_configs FOR INSERT
  WITH CHECK (public.has_permission(workspace_id, 'users.invite'));

CREATE POLICY "admins can update agent connector configs"
  ON public.agent_connector_configs FOR UPDATE
  USING (public.has_permission(workspace_id, 'users.invite'))
  WITH CHECK (public.has_permission(workspace_id, 'users.invite'));

CREATE POLICY "admins can delete agent connector configs"
  ON public.agent_connector_configs FOR DELETE
  USING (public.has_permission(workspace_id, 'users.invite'));
