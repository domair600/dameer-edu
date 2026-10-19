-- Allow the public website to upload compressed school photos to dameer-media/schools/.
-- Safe to run repeatedly.
BEGIN;

DROP POLICY IF EXISTS dameer_schools_photo_upload ON storage.objects;
CREATE POLICY dameer_schools_photo_upload
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'dameer-media'
    AND (storage.foldername(name))[1] = 'schools'
  );

COMMIT;
