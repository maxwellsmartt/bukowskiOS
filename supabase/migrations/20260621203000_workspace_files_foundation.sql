-- Canonical metadata for cross-machine workspace files.
-- File bytes live in the private workspace-documents bucket under:
--   {workspace_id}/{domain}/{entity_id}/{file_id}/{original_name}

CREATE TABLE IF NOT EXISTS public.workspace_files (
  id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  domain text NOT NULL CHECK (domain IN ('assets', 'incidents', 'finance', 'crew')),
  entity_id text NOT NULL,
  storage_object_key text NOT NULL,
  original_name text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  byte_size bigint NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
  content_hash text,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('pending_upload', 'available', 'missing', 'deleted')),
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (workspace_id, domain, entity_id, content_hash)
);

CREATE INDEX IF NOT EXISTS workspace_files_entity_idx
  ON public.workspace_files(workspace_id, domain, entity_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS workspace_files_pull_idx
  ON public.workspace_files(workspace_id, updated_at, id);

ALTER TABLE public.workspace_files ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.can_access_workspace_file(
  target_workspace_id uuid,
  target_domain text,
  access_mode text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN target_domain = 'assets' AND access_mode = 'read' THEN
      public.has_permission(target_workspace_id, 'assets.read')
    WHEN target_domain = 'assets' THEN
      public.has_permission(target_workspace_id, 'assets.manage')
    WHEN target_domain = 'incidents' AND access_mode = 'read' THEN
      public.has_permission(target_workspace_id, 'incidents.read')
    WHEN target_domain = 'incidents' THEN
      public.has_permission(target_workspace_id, 'incidents.create')
    WHEN target_domain = 'finance' AND access_mode = 'read' THEN
      public.has_permission(target_workspace_id, 'finance.read')
    WHEN target_domain = 'finance' THEN
      public.has_permission(target_workspace_id, 'finance.manage')
    WHEN target_domain = 'crew' THEN
      public.has_permission(target_workspace_id, 'users.manage')
    ELSE false
  END;
$$;

DROP POLICY IF EXISTS workspace_files_read ON public.workspace_files;
DROP POLICY IF EXISTS workspace_files_insert ON public.workspace_files;
DROP POLICY IF EXISTS workspace_files_update ON public.workspace_files;
DROP POLICY IF EXISTS workspace_files_delete ON public.workspace_files;

CREATE POLICY workspace_files_read ON public.workspace_files
  FOR SELECT TO authenticated
  USING (public.can_access_workspace_file(workspace_id, domain, 'read'));

CREATE POLICY workspace_files_insert ON public.workspace_files
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_access_workspace_file(workspace_id, domain, 'write')
    AND storage_object_key LIKE workspace_id::text || '/' || domain || '/%'
  );

CREATE POLICY workspace_files_update ON public.workspace_files
  FOR UPDATE TO authenticated
  USING (public.can_access_workspace_file(workspace_id, domain, 'write'))
  WITH CHECK (
    public.can_access_workspace_file(workspace_id, domain, 'write')
    AND storage_object_key LIKE workspace_id::text || '/' || domain || '/%'
  );

CREATE POLICY workspace_files_delete ON public.workspace_files
  FOR DELETE TO authenticated
  USING (public.can_access_workspace_file(workspace_id, domain, 'write'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_files TO authenticated;

-- Extend the existing private bucket policy to the new domain paths. Invoice
-- compatibility remains intact; unknown domains stay denied by default.
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
    SELECT workspace_id_text::uuid AS workspace_id, document_domain
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
      ELSE public.can_access_workspace_file(workspace_id, document_domain, access_mode)
    END
    FROM scoped
    LIMIT 1
  ), false);
$$;

