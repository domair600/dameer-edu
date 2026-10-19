-- Persist teacher course/private lesson announcements in Supabase.
-- Teacher mutations require the teacher's 8-digit control code on every RPC.
BEGIN;

ALTER TABLE public.teacher_listings
  ADD COLUMN IF NOT EXISTS grade_text text;

CREATE OR REPLACE FUNCTION public.teacher_save_listing(
  p_teacher_id bigint,
  p_control_code text,
  p_listing_id bigint,
  p_title text,
  p_listing_type text,
  p_description text,
  p_subject_names text[],
  p_start_date date,
  p_grade_text text,
  p_location text,
  p_price_text text,
  p_image_url text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_listing_id bigint;
  subject_ids bigint[];
  subject_total integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.teachers t
    JOIN public.teacher_access_credentials c ON c.teacher_id=t.id
    WHERE t.id=p_teacher_id AND t.is_published
      AND coalesce(p_control_code,'') ~ '^[0-9]{8}$'
      AND extensions.crypt(p_control_code,c.code_hash)=c.code_hash
  ) THEN
    RAISE EXCEPTION 'تعذر التحقق من بطاقة المعلم ورمز التحكم';
  END IF;

  IF length(trim(coalesce(p_title,''))) NOT BETWEEN 2 AND 200
     OR length(trim(coalesce(p_description,'')))=0
     OR p_listing_type NOT IN ('course','private_lesson')
     OR length(coalesce(p_price_text,'')) > 120 THEN
    RAISE EXCEPTION 'بيانات الإعلان غير مكتملة أو غير صالحة';
  END IF;
  IF coalesce(cardinality(p_subject_names),0)=0 THEN
    RAISE EXCEPTION 'اختر مادة واحدة على الأقل';
  END IF;

  SELECT array_agg(s.id ORDER BY array_position(p_subject_names,s.name)),count(*)
    INTO subject_ids,subject_total
  FROM public.subjects s
  WHERE s.is_active AND s.name=ANY(p_subject_names);
  IF subject_total <> cardinality(p_subject_names) THEN
    RAISE EXCEPTION 'تتضمن المواد المختارة قيمة غير صالحة';
  END IF;

  IF p_listing_id IS NULL THEN
    INSERT INTO public.teacher_listings(
      teacher_id,title,listing_type,description,subject_id,start_date,grade_text,
      location,price_text,image_url,status,published_at,last_bumped_at
    ) VALUES (
      p_teacher_id,trim(p_title),p_listing_type,trim(p_description),subject_ids[1],
      p_start_date,
      nullif(trim(coalesce(p_grade_text,'')),''),nullif(trim(coalesce(p_location,'')),''),
      nullif(trim(coalesce(p_price_text,'')),''),p_image_url,'published',now(),now()
    ) RETURNING id INTO v_listing_id;
  ELSE
    UPDATE public.teacher_listings l SET
      title=trim(p_title),listing_type=p_listing_type,description=trim(p_description),
      subject_id=subject_ids[1],start_date=p_start_date,
      grade_text=nullif(trim(coalesce(p_grade_text,'')),''),
      location=nullif(trim(coalesce(p_location,'')),''),
      price_text=nullif(trim(coalesce(p_price_text,'')),''),
      image_url=coalesce(p_image_url,l.image_url),status='published',updated_at=now()
    WHERE l.id=p_listing_id AND l.teacher_id=p_teacher_id AND l.status<>'deleted'
    RETURNING l.id INTO v_listing_id;
    IF v_listing_id IS NULL THEN RAISE EXCEPTION 'لم نعثر على الإعلان في قائمة هذا المعلم'; END IF;
  END IF;

  DELETE FROM public.teacher_listing_subjects tls WHERE tls.listing_id=v_listing_id;
  INSERT INTO public.teacher_listing_subjects(listing_id,subject_id)
  SELECT v_listing_id,u.subject_id FROM unnest(subject_ids) AS u(subject_id);
  RETURN v_listing_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_delete_listing(
  p_teacher_id bigint,p_control_code text,p_listing_id bigint
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.teachers t
    JOIN public.teacher_access_credentials c ON c.teacher_id=t.id
    WHERE t.id=p_teacher_id AND t.is_published
      AND coalesce(p_control_code,'') ~ '^[0-9]{8}$'
      AND extensions.crypt(p_control_code,c.code_hash)=c.code_hash
  ) THEN RAISE EXCEPTION 'تعذر التحقق من بطاقة المعلم ورمز التحكم'; END IF;
  UPDATE public.teacher_listings SET status='deleted',updated_at=now()
  WHERE id=p_listing_id AND teacher_id=p_teacher_id AND status<>'deleted';
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed=0 THEN RAISE EXCEPTION 'لم نعثر على الإعلان في قائمة هذا المعلم'; END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_bump_listing(
  p_teacher_id bigint,p_control_code text,p_listing_id bigint
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous_bump timestamptz; new_bump timestamptz;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.teachers t
    JOIN public.teacher_access_credentials c ON c.teacher_id=t.id
    WHERE t.id=p_teacher_id AND t.is_published
      AND coalesce(p_control_code,'') ~ '^[0-9]{8}$'
      AND extensions.crypt(p_control_code,c.code_hash)=c.code_hash
  ) THEN RAISE EXCEPTION 'تعذر التحقق من بطاقة المعلم ورمز التحكم'; END IF;
  SELECT last_bumped_at INTO previous_bump FROM public.teacher_listings
  WHERE id=p_listing_id AND teacher_id=p_teacher_id AND status='published' FOR UPDATE;
  IF previous_bump IS NULL THEN RAISE EXCEPTION 'لم نعثر على إعلان منشور لهذا المعلم'; END IF;
  IF previous_bump > now()-interval '72 hours' THEN RAISE EXCEPTION 'يمكن إعادة النشر مرة كل 3 أيام'; END IF;
  UPDATE public.teacher_listings SET last_bumped_at=now(),updated_at=now()
  WHERE id=p_listing_id RETURNING last_bumped_at INTO new_bump;
  INSERT INTO public.listing_bump_history(listing_id,bumped_at) VALUES(p_listing_id,new_bump);
  RETURN new_bump;
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_save_listing(bigint,text,bigint,text,text,text,text[],date,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teacher_delete_listing(bigint,text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teacher_bump_listing(bigint,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.teacher_save_listing(bigint,text,bigint,text,text,text,text[],date,text,text,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_delete_listing(bigint,text,bigint) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_bump_listing(bigint,text,bigint) TO anon,authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
