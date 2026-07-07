-- Restore authenticated access to internal authorization helpers used by RLS.
--
-- The previous security lint hardening pass correctly removed implicit PUBLIC
-- execution from SECURITY DEFINER helpers, but revoking `authenticated` also
-- prevents Postgres from evaluating workspace-scoped RLS policies for signed-in
-- users. The app also calls `has_permission` through an authenticated RPC in
-- the workspace access guard.
--
-- Keep these helpers unavailable to unauthenticated callers while allowing
-- signed-in users to evaluate policies/RPCs that still enforce workspace
-- membership and permission checks internally.

DO $$
DECLARE
  helper regprocedure;
  helper_signatures text[] := ARRAY[
    'public.can_access_workspace_document(text,text)',
    'public.can_access_workspace_file(uuid,text,text)',
    'public.has_permission(uuid,text)',
    'public.is_workspace_member(uuid)'
  ];
  helper_signature text;
BEGIN
  FOREACH helper_signature IN ARRAY helper_signatures LOOP
    helper := to_regprocedure(helper_signature);

    IF helper IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', helper);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', helper);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', helper);
    END IF;
  END LOOP;
END $$;
