-- Secure teacher profile edits. Apply once after schema.sql and supabase-link.sql.
-- Mutable fields only; the teacher name and education assignments remain protected.
BEGIN;

CREATE OR REPLACE FUNCTION public.teacher_update_profile(
  p_teacher_id bigint,
  p_control_code text,
  p_employment_status text,
  p_experience_years smallint,
  p_school_id bigint,
  p_biography text,
  p_address text,
  p_services text[],
  p_contacts jsonb
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_teacher_id bigint;
BEGIN
  SELECT t.id INTO v_teacher_id
  FROM public.teachers t
  JOIN public.teacher_access_credentials c ON c.teacher_id=t.id
  WHERE t.id=p_teacher_id
    AND t.is_published
    AND coalesce(p_control_code,'') ~ '^[0-9]{8}$'
    AND extensions.crypt(p_control_code,c.code_hash)=c.code_hash
  FOR UPDATE OF t;

  IF v_teacher_id IS NULL THEN
    RAISE EXCEPTION 'تعذر التحقق من بطاقة المعلم ورمز التحكم';
  END IF;
  IF p_employment_status NOT IN ('active','retired') THEN
    RAISE EXCEPTION 'الحالة الوظيفية غير صالحة';
  END IF;
  IF p_experience_years IS NULL OR p_experience_years < 0 OR p_experience_years > 80 THEN
    RAISE EXCEPTION 'سنوات الخبرة يجب أن تكون بين 0 و80';
  END IF;
  IF length(coalesce(p_biography,'')) > 2000 OR length(coalesce(p_address,'')) > 300 THEN
    RAISE EXCEPTION 'تجاوزت النبذة أو العنوان الحد المسموح';
  END IF;
  IF coalesce(cardinality(p_services),0) > 20 OR EXISTS (
    SELECT 1 FROM unnest(coalesce(p_services,'{}'::text[])) AS s(value)
    WHERE length(trim(coalesce(s.value,''))) NOT BETWEEN 1 AND 160
  ) THEN
    RAISE EXCEPTION 'الخدمات غير صالحة؛ الحد الأقصى 20 خدمة و160 حرفًا لكل خدمة';
  END IF;
  IF jsonb_typeof(coalesce(p_contacts,'[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'بيانات أرقام التواصل غير صالحة';
  END IF;
  IF jsonb_array_length(coalesce(p_contacts,'[]'::jsonb)) > 2 THEN
    RAISE EXCEPTION 'يسمح برقمين للتواصل كحد أقصى';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(p_contacts,'[]'::jsonb)) AS c(value)
    WHERE coalesce(c.value->>'type','') NOT IN ('mobile','whatsapp','landline')
       OR ((c.value->>'type') IN ('mobile','whatsapp') AND coalesce(c.value->>'value','') !~ '^\+963[0-9]{9}$')
       OR ((c.value->>'type') = 'landline' AND coalesce(c.value->>'value','') !~ '^\+96311[0-9]{7,9}$')
  ) THEN
    RAISE EXCEPTION 'تحقق من بادئة سوريا وعدد أرقام التواصل';
  END IF;
  IF p_school_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.schools s WHERE s.id=p_school_id AND s.is_active
  ) THEN
    RAISE EXCEPTION 'المدرسة المختارة غير متاحة';
  END IF;

  UPDATE public.teachers SET
    employment_status=p_employment_status::public.teacher_employment_status,
    experience_years=p_experience_years,
    biography=nullif(trim(coalesce(p_biography,'')),''),
    address=nullif(trim(coalesce(p_address,'')),''),
    updated_at=now()
  WHERE id=v_teacher_id;

  DELETE FROM public.teacher_contacts WHERE teacher_id=v_teacher_id;
  INSERT INTO public.teacher_contacts(teacher_id,contact_type,phone_number,sort_order)
  SELECT v_teacher_id,c.value->>'type',c.value->>'value',c.ordinality::smallint
  FROM jsonb_array_elements(coalesce(p_contacts,'[]'::jsonb)) WITH ORDINALITY AS c(value,ordinality);

  DELETE FROM public.teacher_services WHERE teacher_id=v_teacher_id;
  INSERT INTO public.teacher_services(teacher_id,title,sort_order)
  SELECT v_teacher_id,trim(s.value),s.ordinality::smallint
  FROM unnest(coalesce(p_services,'{}'::text[])) WITH ORDINALITY AS s(value,ordinality);

  UPDATE public.teacher_schools SET is_current=false WHERE teacher_id=v_teacher_id AND is_current;
  IF p_school_id IS NOT NULL THEN
    INSERT INTO public.teacher_schools(teacher_id,school_id,is_current)
    VALUES(v_teacher_id,p_school_id,true)
    ON CONFLICT(teacher_id,school_id) DO UPDATE SET is_current=true;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_update_profile(bigint,text,text,smallint,bigint,text,text,text[],jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.teacher_update_profile(bigint,text,text,smallint,bigint,text,text,text[],jsonb) TO anon,authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
