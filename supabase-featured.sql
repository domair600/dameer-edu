-- Persistent editorial highlights for teachers, lessons, and memorial profiles.
-- Run once in the Supabase SQL Editor after supabase-admin.sql.
BEGIN;

ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS home_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS home_badge_text varchar(30);
ALTER TABLE public.teacher_listings
  ADD COLUMN IF NOT EXISTS home_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS home_badge_text varchar(30);
ALTER TABLE public.memorial_teachers
  ADD COLUMN IF NOT EXISTS home_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS home_badge_text varchar(30);

CREATE INDEX IF NOT EXISTS idx_teachers_home_featured
  ON public.teachers (home_featured, full_name) WHERE is_published;
CREATE INDEX IF NOT EXISTS idx_listings_home_featured
  ON public.teacher_listings (home_featured, last_bumped_at DESC) WHERE status='published';
CREATE INDEX IF NOT EXISTS idx_memorials_home_featured
  ON public.memorial_teachers (home_featured, full_name) WHERE is_published;

CREATE OR REPLACE FUNCTION public.admin_set_home_featured(
  p_kind text, p_entity_id bigint, p_featured boolean, p_badge text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed integer;
BEGIN
  IF NOT public.is_dameer_admin() THEN
    RAISE EXCEPTION 'غير مصرح بحساب الإدارة';
  END IF;
  IF p_entity_id IS NULL OR p_featured IS NULL THEN
    RAISE EXCEPTION 'بيانات الاختيار غير مكتملة';
  END IF;
  IF length(trim(coalesce(p_badge,''))) > 30 THEN
    RAISE EXCEPTION 'يجب ألا تتجاوز الشارة 30 حرفاً';
  END IF;

  IF p_kind='teacher' THEN
    UPDATE public.teachers SET home_featured=p_featured,
      home_badge_text=CASE WHEN p_featured THEN nullif(trim(coalesce(p_badge,'')),'') ELSE NULL END,
      updated_at=now()
    WHERE id=p_entity_id AND is_published;
  ELSIF p_kind='listing' THEN
    UPDATE public.teacher_listings AS l SET home_featured=p_featured,
      home_badge_text=CASE WHEN p_featured THEN nullif(trim(coalesce(p_badge,'')),'') ELSE NULL END,
      updated_at=now()
    WHERE id=p_entity_id AND status='published'
      AND EXISTS (SELECT 1 FROM public.teachers t WHERE t.id=l.teacher_id AND t.is_published);
  ELSIF p_kind='memorial' THEN
    UPDATE public.memorial_teachers SET home_featured=p_featured,
      home_badge_text=CASE WHEN p_featured THEN nullif(trim(coalesce(p_badge,'')),'') ELSE NULL END,
      updated_at=now()
    WHERE id=p_entity_id AND is_published;
  ELSE
    RAISE EXCEPTION 'نوع البطاقة غير صالح';
  END IF;

  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed=0 THEN RAISE EXCEPTION 'لم نعثر على بطاقة منشورة بهذا المعرف'; END IF;
  RETURN jsonb_build_object('ok',true,'kind',p_kind,'id',p_entity_id,'featured',p_featured);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_home_featured(text,bigint,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_home_featured(text,bigint,boolean,text) TO authenticated;

-- Administrators may replace a forgotten teacher code; the plaintext is never stored.
CREATE OR REPLACE FUNCTION public.admin_reset_teacher_code(
  p_teacher_id bigint, p_control_code text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE admin_id bigint; changed integer;
BEGIN
  IF NOT public.is_dameer_admin() THEN RAISE EXCEPTION 'غير مصرح بحساب الإدارة'; END IF;
  IF p_control_code !~ '^[0-9]{8}$' THEN RAISE EXCEPTION 'الرمز يجب أن يتكون من ثمانية أرقام'; END IF;
  SELECT a.id INTO admin_id FROM public.admins a WHERE a.auth_user_id=auth.uid() AND a.is_active;
  UPDATE public.teacher_access_credentials c
    SET code_hash=extensions.crypt(p_control_code,extensions.gen_salt('bf',10)),updated_at=now()
    FROM public.teachers t
    WHERE c.teacher_id=p_teacher_id AND t.id=c.teacher_id AND t.is_published;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed=0 THEN RAISE EXCEPTION 'لم نعثر على بطاقة معلم منشورة أو رمز مرتبط بها'; END IF;
  INSERT INTO public.admin_audit_log(admin_id,entity_type,entity_id,action,details)
    VALUES(admin_id,'teacher',p_teacher_id,'reset_control_code','{"method":"administrator_verified_identity"}'::jsonb);
  RETURN jsonb_build_object('ok',true);
END;
$$;

-- The public login RPC returns only the matching published teacher ID.
CREATE OR REPLACE FUNCTION public.teacher_verify_access(
  p_full_name text, p_control_code text
) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.id
  FROM public.teachers t
  JOIN public.teacher_access_credentials c ON c.teacher_id=t.id
  WHERE t.is_published
    AND lower(trim(t.full_name))=lower(trim(coalesce(p_full_name,'')))
    AND coalesce(p_control_code,'') ~ '^[0-9]{8}$'
    AND extensions.crypt(p_control_code,c.code_hash)=c.code_hash
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.admin_reset_teacher_code(bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_reset_teacher_code(bigint,text) TO authenticated;
REVOKE ALL ON FUNCTION public.teacher_verify_access(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.teacher_verify_access(text,text) TO anon, authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
