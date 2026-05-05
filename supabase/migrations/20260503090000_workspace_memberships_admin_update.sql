-- Allow admins (with `users.invite` permission) to update member status and role
-- in their workspace. This unlocks "change role inline" and "suspend member" UX.

CREATE POLICY "admins can update workspace memberships"
  ON public.workspace_memberships FOR UPDATE
  USING (public.has_permission(workspace_id, 'users.invite'))
  WITH CHECK (public.has_permission(workspace_id, 'users.invite'));
