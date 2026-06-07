-- Add every public table to the `supabase_realtime` publication so the desktop
-- app's realtime subscriber (useRealtimeWorkspaceSync) receives change events and
-- can trigger an immediate cross-machine pull, instead of waiting for the 20–60s
-- polling tick. Without this, the app still syncs — just on the next poll.
--
-- Notes:
--  * Idempotent: each table is added only if it is not already a member, so this
--    is safe to re-run and won't clash with `notifications`, which was published
--    earlier.
--  * Realtime authorizes `postgres_changes` through RLS using the caller's token,
--    so a client only receives events for rows it can already read.
--  * Default REPLICA IDENTITY (primary key) is enough here: the app only needs to
--    know that *something* changed and in which table, then runs its idempotent,
--    cursor-based pull. We deliberately do not force REPLICA IDENTITY FULL.

DO $$
DECLARE
  r record;
BEGIN
  -- The publication is created by Supabase on project setup. If it does not
  -- exist yet (fresh/self-hosted DB), create an empty one first.
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  FOR r IN
    SELECT t.tablename
    FROM pg_tables t
    WHERE t.schemaname = 'public'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables p
        WHERE p.pubname = 'supabase_realtime'
          AND p.schemaname = 'public'
          AND p.tablename = t.tablename
      )
  LOOP
    EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', r.tablename);
  END LOOP;
END $$;
