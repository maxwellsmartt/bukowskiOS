-- Publish `user_settings` over Supabase Realtime so that a change made
-- on one device propagates to the user's other open sessions live,
-- without needing a sign-out / sign-in cycle.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'user_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_settings;
  END IF;
END $$;

-- REPLICA IDENTITY FULL is needed so that UPDATE payloads include the
-- full row (we read `settings` from `payload.new`).
ALTER TABLE public.user_settings REPLICA IDENTITY FULL;
