-- Allow admins (with `users.invite` permission, granted to the admin role by default)
-- to update their workspace's identity (name, slug, base_currency, icon_color).
-- We reuse the existing `users.invite` permission as the gating signal for "workspace admin"
-- until granular `workspace.manage` is introduced.

CREATE POLICY "admins can update their workspace"
  ON public.workspaces FOR UPDATE
  USING (public.has_permission(id, 'users.invite'))
  WITH CHECK (public.has_permission(id, 'users.invite'));
