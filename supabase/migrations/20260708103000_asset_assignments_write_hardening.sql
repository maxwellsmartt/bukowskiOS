-- Asset assignment writes must follow the same permission boundary as the
-- desktop mutation flow: read for members with assets.read, writes only for
-- roles that can manage assets.

DROP POLICY IF EXISTS "members can read workspace asset assignments" ON public.asset_assignments;
DROP POLICY IF EXISTS "members can insert workspace asset assignments" ON public.asset_assignments;
DROP POLICY IF EXISTS "members can update workspace asset assignments" ON public.asset_assignments;
DROP POLICY IF EXISTS "members can delete workspace asset assignments" ON public.asset_assignments;

CREATE POLICY "members can read workspace asset assignments"
  ON public.asset_assignments FOR SELECT
  TO authenticated
  USING (
    public.has_permission(workspace_id, 'assets.read')
    OR public.has_permission(workspace_id, 'assets.manage')
  );

CREATE POLICY "admins can insert workspace asset assignments"
  ON public.asset_assignments FOR INSERT
  TO authenticated
  WITH CHECK (public.has_permission(workspace_id, 'assets.manage'));

CREATE POLICY "admins can update workspace asset assignments"
  ON public.asset_assignments FOR UPDATE
  TO authenticated
  USING (public.has_permission(workspace_id, 'assets.manage'))
  WITH CHECK (public.has_permission(workspace_id, 'assets.manage'));

CREATE POLICY "admins can delete workspace asset assignments"
  ON public.asset_assignments FOR DELETE
  TO authenticated
  USING (public.has_permission(workspace_id, 'assets.manage'));
