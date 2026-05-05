-- 20260504200000 — workspace branding assets bucket (Plan L FQ5).
-- Public bucket for logo/sello/firma referenced from quote PDFs and the
-- workspace settings UI. Admin-only writes (gated by `currency.manage_rates`
-- since it controls the same workspace identity surface), public reads so the
-- renderer can <img src=...> the URLs.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'workspace-assets', 'workspace-assets', true, 4194304,
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "workspace-assets read public" ON storage.objects;
DROP POLICY IF EXISTS "workspace-assets admin write" ON storage.objects;
DROP POLICY IF EXISTS "workspace-assets admin update" ON storage.objects;
DROP POLICY IF EXISTS "workspace-assets admin delete" ON storage.objects;

-- Path layout: <workspace_id>/<asset>-<timestamp>.<ext>
-- e.g. "9f8b3c…/logo-1714935600000.png"

CREATE POLICY "workspace-assets read public" ON storage.objects
  FOR SELECT USING (bucket_id = 'workspace-assets');

CREATE POLICY "workspace-assets admin write" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'workspace-assets'
    AND public.has_permission(
      ((storage.foldername(name))[1])::uuid,
      'currency.manage_rates'
    )
  );

CREATE POLICY "workspace-assets admin update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'workspace-assets'
    AND public.has_permission(
      ((storage.foldername(name))[1])::uuid,
      'currency.manage_rates'
    )
  );

CREATE POLICY "workspace-assets admin delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'workspace-assets'
    AND public.has_permission(
      ((storage.foldername(name))[1])::uuid,
      'currency.manage_rates'
    )
  );
