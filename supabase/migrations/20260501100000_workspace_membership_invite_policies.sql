-- Allow admins (with `users.invite` permission) to revoke pending invites in their workspace.
-- Without this policy RLS blocks DELETE entirely, even for admins.

CREATE POLICY "admins can revoke invited memberships"
  ON public.workspace_memberships FOR DELETE
  USING (
    status = 'invited'
    AND public.has_permission(workspace_id, 'users.invite')
  );
