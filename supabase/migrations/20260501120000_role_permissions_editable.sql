-- Allow admins to manage custom (non-system) roles within their workspace.

-- Create custom roles
CREATE POLICY "admins can create custom roles"
  ON public.roles FOR INSERT
  WITH CHECK (
    is_system_role = false
    AND public.has_permission(workspace_id, 'users.invite')
  );

-- Update name/description of custom roles
CREATE POLICY "admins can update custom roles"
  ON public.roles FOR UPDATE
  USING (
    is_system_role = false
    AND public.has_permission(workspace_id, 'users.invite')
  )
  WITH CHECK (
    is_system_role = false
    AND public.has_permission(workspace_id, 'users.invite')
  );

-- Delete custom roles
CREATE POLICY "admins can delete custom roles"
  ON public.roles FOR DELETE
  USING (
    is_system_role = false
    AND public.has_permission(workspace_id, 'users.invite')
  );

-- Toggle permissions on any non-system role
CREATE POLICY "admins can grant role permissions"
  ON public.role_permissions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.roles r
      WHERE r.id = role_permissions.role_id
        AND r.is_system_role = false
        AND public.has_permission(r.workspace_id, 'users.invite')
    )
  );

CREATE POLICY "admins can revoke role permissions"
  ON public.role_permissions FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.roles r
      WHERE r.id = role_permissions.role_id
        AND r.is_system_role = false
        AND public.has_permission(r.workspace_id, 'users.invite')
    )
  );
