ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS email text;

CREATE INDEX IF NOT EXISTS idx_user_profiles_email
  ON public.user_profiles (lower(email))
  WHERE email IS NOT NULL;

DROP POLICY IF EXISTS "workspace members can read teammate profiles" ON public.user_profiles;

CREATE POLICY "workspace members can read teammate profiles"
  ON public.user_profiles FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.workspace_memberships reader
      JOIN public.workspace_memberships target
        ON target.workspace_id = reader.workspace_id
      WHERE reader.user_id = auth.uid()
        AND reader.status = 'active'
        AND target.user_id = user_profiles.user_id
        AND target.status IN ('active', 'invited')
    )
  );
