-- 20260707155722 — Supabase linter hardening pass.
--
-- Scope:
--   1) Keep SECURITY DEFINER helpers internal to RLS instead of exposing them
--      as PostgREST RPC endpoints.
--   2) Remove broad SELECT policies from public buckets. Public object URLs do
--      not require list/read policies on storage.objects, and those policies
--      allow clients to enumerate files.
--   3) Pin the trigger function search_path.
--   4) Give sync_conflicts workspace-scoped policies when that cloud table
--      exists, so RLS is not enabled without policies.

CREATE OR REPLACE FUNCTION public.touch_user_settings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version    := COALESCE(OLD.version, 0) + 1;
  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS "user-avatars: anyone can read" ON storage.objects;
DROP POLICY IF EXISTS "user-avatars read public" ON storage.objects;
DROP POLICY IF EXISTS "workspace-assets read public" ON storage.objects;

DO $$
DECLARE
  helper regprocedure;
  helper_signatures text[] := ARRAY[
    'public.can_access_workspace_document(text,text)',
    'public.can_access_workspace_file(uuid,text,text)',
    'public.has_permission(uuid,text)',
    'public.is_workspace_member(uuid)',
    'public.rls_auto_enable()'
  ];
  helper_signature text;
BEGIN
  FOREACH helper_signature IN ARRAY helper_signatures LOOP
    helper := to_regprocedure(helper_signature);

    IF helper IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', helper);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', helper);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', helper);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sync_conflicts'
      AND column_name = 'workspace_id'
  ) THEN
    ALTER TABLE public.sync_conflicts ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS sync_conflicts_members_read ON public.sync_conflicts;
    DROP POLICY IF EXISTS sync_conflicts_members_insert ON public.sync_conflicts;
    DROP POLICY IF EXISTS sync_conflicts_members_update ON public.sync_conflicts;
    DROP POLICY IF EXISTS sync_conflicts_members_delete ON public.sync_conflicts;

    CREATE POLICY sync_conflicts_members_read ON public.sync_conflicts
      FOR SELECT TO authenticated
      USING (
        CASE
          WHEN workspace_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN public.is_workspace_member(workspace_id::text::uuid)
          ELSE false
        END
      );

    CREATE POLICY sync_conflicts_members_insert ON public.sync_conflicts
      FOR INSERT TO authenticated
      WITH CHECK (
        CASE
          WHEN workspace_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN public.is_workspace_member(workspace_id::text::uuid)
          ELSE false
        END
      );

    CREATE POLICY sync_conflicts_members_update ON public.sync_conflicts
      FOR UPDATE TO authenticated
      USING (
        CASE
          WHEN workspace_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN public.is_workspace_member(workspace_id::text::uuid)
          ELSE false
        END
      )
      WITH CHECK (
        CASE
          WHEN workspace_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN public.is_workspace_member(workspace_id::text::uuid)
          ELSE false
        END
      );

    CREATE POLICY sync_conflicts_members_delete ON public.sync_conflicts
      FOR DELETE TO authenticated
      USING (
        CASE
          WHEN workspace_id::text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN public.is_workspace_member(workspace_id::text::uuid)
          ELSE false
        END
      );
  END IF;
END $$;
