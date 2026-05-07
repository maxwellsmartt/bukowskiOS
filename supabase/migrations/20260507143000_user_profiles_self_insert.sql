DROP POLICY IF EXISTS "users can insert own profile" ON public.user_profiles;

CREATE POLICY "users can insert own profile"
  ON public.user_profiles FOR INSERT
  WITH CHECK (user_id = auth.uid());
