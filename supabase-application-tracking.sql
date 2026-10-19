-- Private-by-token request tracking for teacher and memorial applications.
-- Run once in Supabase SQL Editor after schema.sql and supabase-link.sql.
BEGIN;

-- Ensure the teacher-stage relation is available to the public REST API.
-- This also covers projects where schema.sql was only partially applied.
CREATE TABLE IF NOT EXISTS public.teacher_stage_assignments (
  teacher_id bigint NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  stage_id bigint NOT NULL REFERENCES public.education_stages(id) ON DELETE RESTRICT,
  PRIMARY KEY (teacher_id, stage_id)
);
ALTER TABLE public.teacher_stage_assignments ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.teacher_stage_assignments TO anon, authenticated;
DROP POLICY IF EXISTS public_teacher_stages_read ON public.teacher_stage_assignments;
CREATE POLICY public_teacher_stages_read
  ON public.teacher_stage_assignments FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.teachers t
    WHERE t.id=teacher_id AND t.is_published
  ));

ALTER TABLE public.teacher_requests
  ADD COLUMN IF NOT EXISTS tracking_code_hash text;
ALTER TABLE public.memorial_requests
  ADD COLUMN IF NOT EXISTS tracking_code_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_requests_tracking_hash
  ON public.teacher_requests(tracking_code_hash) WHERE tracking_code_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_memorial_requests_tracking_hash
  ON public.memorial_requests(tracking_code_hash) WHERE tracking_code_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.submit_teacher_application_v2(
  p_requested_name text, p_payload jsonb, p_control_code text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE request_id bigint; tracking_code text;
BEGIN
  IF length(trim(coalesce(p_requested_name,''))) NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION 'اسم المعلم غير صالح';
  END IF;
  IF p_control_code !~ '^[0-9]{8}$' THEN
    RAISE EXCEPTION 'رمز التحكم يجب أن يتكون من ثمانية أرقام';
  END IF;
  IF octet_length(coalesce(p_payload,'{}'::jsonb)::text) > 500000 THEN
    RAISE EXCEPTION 'حجم الطلب أكبر من المسموح';
  END IF;
  tracking_code := upper(encode(extensions.gen_random_bytes(8),'hex'));
  INSERT INTO public.teacher_requests(request_kind,requested_name,payload,control_code_hash,tracking_code_hash)
  VALUES (
    'new_profile',trim(p_requested_name),coalesce(p_payload,'{}'::jsonb),
    extensions.crypt(p_control_code,extensions.gen_salt('bf',10)),
    encode(extensions.digest(tracking_code,'sha256'),'hex')
  ) RETURNING id INTO request_id;
  RETURN jsonb_build_object('id',request_id,'tracking_code',tracking_code,'kind','teacher');
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_memorial_application_v2(
  p_full_name text, p_biography text, p_photo_url text DEFAULT NULL,
  p_submitted_by text DEFAULT NULL, p_submitter_contact text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE request_id bigint; tracking_code text;
BEGIN
  IF length(trim(coalesce(p_full_name,''))) NOT BETWEEN 2 AND 200
     OR length(trim(coalesce(p_biography,''))) NOT BETWEEN 10 AND 10000 THEN
    RAISE EXCEPTION 'يرجى إدخال الاسم والنبذة بشكل صحيح';
  END IF;
  IF octet_length(coalesce(p_photo_url,'')) > 500000 THEN
    RAISE EXCEPTION 'حجم الصورة أكبر من المسموح';
  END IF;
  tracking_code := upper(encode(extensions.gen_random_bytes(8),'hex'));
  INSERT INTO public.memorial_requests(full_name,biography,photo_url,submitted_by,submitter_contact,tracking_code_hash)
  VALUES (
    trim(p_full_name),trim(p_biography),p_photo_url,
    nullif(trim(coalesce(p_submitted_by,'')),''),nullif(trim(coalesce(p_submitter_contact,'')),''),
    encode(extensions.digest(tracking_code,'sha256'),'hex')
  ) RETURNING id INTO request_id;
  RETURN jsonb_build_object('id',request_id,'tracking_code',tracking_code,'kind','memorial');
END;
$$;

CREATE OR REPLACE FUNCTION public.track_application(p_tracking_code text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE token_hash text; request_row record;
BEGIN
  IF coalesce(p_tracking_code,'') !~* '^[A-F0-9]{16}$' THEN
    RETURN jsonb_build_object('found',false);
  END IF;
  token_hash := encode(extensions.digest(upper(p_tracking_code),'sha256'),'hex');
  SELECT r.requested_name AS display_name,r.status::text AS status,r.review_message,
    r.created_at,r.reviewed_at,'teacher'::text AS kind
  INTO request_row FROM public.teacher_requests r WHERE r.tracking_code_hash=token_hash LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('found',true,'name',request_row.display_name,'status',request_row.status,
      'message',request_row.review_message,'created_at',request_row.created_at,
      'reviewed_at',request_row.reviewed_at,'kind',request_row.kind);
  END IF;
  SELECT r.full_name AS display_name,r.status::text AS status,r.review_message,
    r.created_at,r.reviewed_at,'memorial'::text AS kind
  INTO request_row FROM public.memorial_requests r WHERE r.tracking_code_hash=token_hash LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('found',true,'name',request_row.display_name,'status',request_row.status,
      'message',request_row.review_message,'created_at',request_row.created_at,
      'reviewed_at',request_row.reviewed_at,'kind',request_row.kind);
  END IF;
  RETURN jsonb_build_object('found',false);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_teacher_application_v2(text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_memorial_application_v2(text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.track_application(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_teacher_application_v2(text,jsonb,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_memorial_application_v2(text,text,text,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.track_application(text) TO anon,authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
