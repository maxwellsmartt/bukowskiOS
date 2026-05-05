-- Public bucket for user avatars + RLS policies so each user can only manage their own.
-- We keep file paths as `<user_id>/<filename>` to enforce ownership via path.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'user-avatars',
  'user-avatars',
  true,
  2097152, -- 2 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'user-avatars: anyone can read'
  ) THEN
    EXECUTE 'CREATE POLICY "user-avatars: anyone can read" ON storage.objects FOR SELECT USING (bucket_id = ''user-avatars'')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'user-avatars: owner can upload'
  ) THEN
    EXECUTE 'CREATE POLICY "user-avatars: owner can upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = ''user-avatars'' AND (storage.foldername(name))[1] = auth.uid()::text)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'user-avatars: owner can update'
  ) THEN
    EXECUTE 'CREATE POLICY "user-avatars: owner can update" ON storage.objects FOR UPDATE USING (bucket_id = ''user-avatars'' AND (storage.foldername(name))[1] = auth.uid()::text)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'user-avatars: owner can delete'
  ) THEN
    EXECUTE 'CREATE POLICY "user-avatars: owner can delete" ON storage.objects FOR DELETE USING (bucket_id = ''user-avatars'' AND (storage.foldername(name))[1] = auth.uid()::text)';
  END IF;
END $$;
