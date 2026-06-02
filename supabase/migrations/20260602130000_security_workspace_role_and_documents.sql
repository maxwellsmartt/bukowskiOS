-- 20260602130000 — Security hardening: workspace-scoped roles and protected documents.
--
-- Fixes two isolation issues:
-- 1. A workspace membership role must belong to the same workspace.
-- 2. The workspace-documents bucket must enforce domain permissions for
--    sensitive invoice/treasury files instead of plain membership.

UPDATE public.workspace_memberships wm
SET role_id = NULL,
    updated_at = now()
WHERE role_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.roles r
    WHERE r.id = wm.role_id
      AND r.workspace_id = wm.workspace_id
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'roles_workspace_id_id_key'
      AND conrelid = 'public.roles'::regclass
  ) THEN
    ALTER TABLE public.roles
      ADD CONSTRAINT roles_workspace_id_id_key UNIQUE (workspace_id, id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'workspace_memberships_workspace_role_fk'
      AND conrelid = 'public.workspace_memberships'::regclass
  ) THEN
    ALTER TABLE public.workspace_memberships
      ADD CONSTRAINT workspace_memberships_workspace_role_fk
      FOREIGN KEY (workspace_id, role_id)
      REFERENCES public.roles(workspace_id, id)
      ON DELETE SET NULL (role_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.has_permission(target_workspace_id uuid, permission_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_memberships wm
    JOIN public.roles r
      ON r.id = wm.role_id
     AND r.workspace_id = wm.workspace_id
    JOIN public.role_permissions rp ON rp.role_id = r.id
    JOIN public.permissions p ON p.id = rp.permission_id
    WHERE wm.workspace_id = target_workspace_id
      AND wm.user_id = auth.uid()
      AND wm.status = 'active'
      AND p.key = permission_key
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_workspace_document(object_name text, access_mode text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH parsed AS (
    SELECT
      split_part(object_name, '/', 1) AS workspace_id_text,
      split_part(object_name, '/', 2) AS document_domain
  ),
  scoped AS (
    SELECT
      workspace_id_text::uuid AS workspace_id,
      document_domain
    FROM parsed
    WHERE workspace_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  SELECT COALESCE((
    SELECT CASE
      WHEN document_domain = 'invoices' AND access_mode = 'read' THEN
        public.has_permission(workspace_id, 'treasury.transactions.read')
        OR public.has_permission(workspace_id, 'invoices.read')
      WHEN document_domain = 'invoices' THEN
        public.has_permission(workspace_id, 'treasury.import')
        OR public.has_permission(workspace_id, 'treasury.transactions.classify')
        OR public.has_permission(workspace_id, 'invoices.create')
        OR public.has_permission(workspace_id, 'invoices.edit_draft')
      WHEN access_mode = 'read' THEN
        public.has_permission(workspace_id, 'users.invite')
      ELSE
        public.has_permission(workspace_id, 'users.invite')
    END
    FROM scoped
    LIMIT 1
  ), false);
$$;

DROP POLICY IF EXISTS "workspace_documents_read"   ON storage.objects;
DROP POLICY IF EXISTS "workspace_documents_insert" ON storage.objects;
DROP POLICY IF EXISTS "workspace_documents_update" ON storage.objects;
DROP POLICY IF EXISTS "workspace_documents_delete" ON storage.objects;

CREATE POLICY "workspace_documents_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'workspace-documents'
    AND public.can_access_workspace_document(name, 'read')
  );

CREATE POLICY "workspace_documents_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'workspace-documents'
    AND public.can_access_workspace_document(name, 'write')
  );

CREATE POLICY "workspace_documents_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'workspace-documents'
    AND public.can_access_workspace_document(name, 'write')
  )
  WITH CHECK (
    bucket_id = 'workspace-documents'
    AND public.can_access_workspace_document(name, 'write')
  );

CREATE POLICY "workspace_documents_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'workspace-documents'
    AND public.can_access_workspace_document(name, 'write')
  );
