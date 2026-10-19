-- Multiple subjects and an optional course start date for teacher listings.
-- Run after schema.sql and supabase-link.sql on an existing Supabase project.
BEGIN;

ALTER TABLE public.teacher_listings
  ADD COLUMN IF NOT EXISTS start_date date;

CREATE TABLE IF NOT EXISTS public.teacher_listing_subjects (
  listing_id bigint NOT NULL REFERENCES public.teacher_listings(id) ON DELETE CASCADE,
  subject_id bigint NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  PRIMARY KEY (listing_id,subject_id)
);
CREATE INDEX IF NOT EXISTS idx_listing_subjects_subject
  ON public.teacher_listing_subjects(subject_id,listing_id);

-- Keep each existing announcement's current single subject during migration.
INSERT INTO public.teacher_listing_subjects(listing_id,subject_id)
SELECT id,subject_id FROM public.teacher_listings WHERE subject_id IS NOT NULL
ON CONFLICT DO NOTHING;

GRANT SELECT ON public.teacher_listing_subjects TO anon,authenticated;
ALTER TABLE public.teacher_listing_subjects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS public_listing_subjects_read ON public.teacher_listing_subjects;
CREATE POLICY public_listing_subjects_read ON public.teacher_listing_subjects
  FOR SELECT TO anon,authenticated USING (
    EXISTS (
      SELECT 1 FROM public.teacher_listings l
      JOIN public.teachers t ON t.id=l.teacher_id
      WHERE l.id=listing_id AND l.status='published' AND t.is_published
    )
  );

COMMIT;
NOTIFY pgrst, 'reload schema';
