-- Public image storage for teacher and memorial applications, listings and slides.
-- Run after schema.sql. Image bytes stay in Storage; database fields keep only URLs.
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dameer-media',
  'dameer-media',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS dameer_media_public_read ON storage.objects;
CREATE POLICY dameer_media_public_read
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'dameer-media');

DROP POLICY IF EXISTS dameer_media_public_upload ON storage.objects;
CREATE POLICY dameer_media_public_upload
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'dameer-media'
    AND array_length(storage.foldername(name), 1) = 1
    AND (storage.foldername(name))[1] IN ('profiles', 'memorials', 'listings', 'slides')
  );

DROP POLICY IF EXISTS dameer_schools_photo_upload ON storage.objects;
CREATE POLICY dameer_schools_photo_upload
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'dameer-media'
    AND (storage.foldername(name))[1] = 'schools'
  );

-- Only authenticated administrators may permanently remove media objects.
DROP POLICY IF EXISTS dameer_media_admin_delete ON storage.objects;
CREATE POLICY dameer_media_admin_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'dameer-media' AND public.is_dameer_admin());

COMMIT;
