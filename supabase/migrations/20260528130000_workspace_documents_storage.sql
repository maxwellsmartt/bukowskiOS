-- 20260528130000 — Workspace documents storage bucket (PILAR T iteración 2, A2).
--
-- Private bucket holding the actual file bytes (invoice images, statement
-- PDFs, future cédula/company docs) so they sync across machines/users. The
-- app uploads on document creation and downloads on demand, caching locally.
--
-- Object keys are workspace-scoped: `{workspaceId}/invoices/{id}.ext`. The
-- RLS policies below derive the workspace from the first path segment and
-- only allow active members of that workspace to read/write.

INSERT INTO storage.buckets (id, name, public)
VALUES ('workspace-documents', 'workspace-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Helper predicate inlined per policy: the object's first path segment is a
-- workspace the caller is an active member of.
DROP POLICY IF EXISTS "workspace_documents_read"   ON storage.objects;
DROP POLICY IF EXISTS "workspace_documents_insert" ON storage.objects;
DROP POLICY IF EXISTS "workspace_documents_update" ON storage.objects;
DROP POLICY IF EXISTS "workspace_documents_delete" ON storage.objects;

CREATE POLICY "workspace_documents_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'workspace-documents'
    AND EXISTS (
      SELECT 1 FROM public.workspace_memberships m
      WHERE m.user_id = auth.uid()
        AND m.status = 'active'
        AND m.workspace_id::text = split_part(name, '/', 1)
    )
  );

CREATE POLICY "workspace_documents_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'workspace-documents'
    AND EXISTS (
      SELECT 1 FROM public.workspace_memberships m
      WHERE m.user_id = auth.uid()
        AND m.status = 'active'
        AND m.workspace_id::text = split_part(name, '/', 1)
    )
  );

CREATE POLICY "workspace_documents_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'workspace-documents'
    AND EXISTS (
      SELECT 1 FROM public.workspace_memberships m
      WHERE m.user_id = auth.uid()
        AND m.status = 'active'
        AND m.workspace_id::text = split_part(name, '/', 1)
    )
  )
  WITH CHECK (
    bucket_id = 'workspace-documents'
    AND EXISTS (
      SELECT 1 FROM public.workspace_memberships m
      WHERE m.user_id = auth.uid()
        AND m.status = 'active'
        AND m.workspace_id::text = split_part(name, '/', 1)
    )
  );

CREATE POLICY "workspace_documents_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'workspace-documents'
    AND EXISTS (
      SELECT 1 FROM public.workspace_memberships m
      WHERE m.user_id = auth.uid()
        AND m.status = 'active'
        AND m.workspace_id::text = split_part(name, '/', 1)
    )
  );
