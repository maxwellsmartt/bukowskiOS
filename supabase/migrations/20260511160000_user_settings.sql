-- user_settings: per-user, cross-device application settings.
--
-- Rationale: we already have `user_profiles` for identity ("who is the user")
-- and used to lean on `localStorage` for everything else. Synced settings
-- (auto-logout timeout, future preferences like theme/language/etc.) belong
-- to a dedicated row so that:
--   1) profile updates and settings updates don't pollute each other,
--   2) jsonb lets us add keys without new migrations,
--   3) realtime subscriptions stay scoped to the settings concern.

CREATE TABLE IF NOT EXISTS public.user_settings (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  settings   jsonb NOT NULL DEFAULT '{}'::jsonb,
  version    integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can read own settings"   ON public.user_settings;
DROP POLICY IF EXISTS "users can insert own settings" ON public.user_settings;
DROP POLICY IF EXISTS "users can update own settings" ON public.user_settings;
DROP POLICY IF EXISTS "users can delete own settings" ON public.user_settings;

CREATE POLICY "users can read own settings"
  ON public.user_settings FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "users can insert own settings"
  ON public.user_settings FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users can update own settings"
  ON public.user_settings FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "users can delete own settings"
  ON public.user_settings FOR DELETE
  USING (user_id = auth.uid());

-- Keep updated_at fresh on every write so last-write-wins conflict
-- resolution on the client can rely on it.
CREATE OR REPLACE FUNCTION public.touch_user_settings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version    := COALESCE(OLD.version, 0) + 1;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_settings_touch_updated_at ON public.user_settings;
CREATE TRIGGER trg_user_settings_touch_updated_at
BEFORE UPDATE ON public.user_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_user_settings_updated_at();
