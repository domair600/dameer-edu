-- School photos live in Supabase Storage; the table stores only their public URL.
-- Run this migration once in the Supabase SQL Editor.
BEGIN;

ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS image_url text;

CREATE OR REPLACE FUNCTION public.admin_save_school(
  p_name text,
  p_type text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_whatsapp text DEFAULT NULL,
  p_location_url text DEFAULT NULL,
  p_image_url text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE new_school_id bigint;
BEGIN
  IF NOT public.is_dameer_admin() THEN RAISE EXCEPTION 'غير مصرح بحساب الإدارة'; END IF;
  IF length(trim(coalesce(p_name,''))) NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION 'أدخل اسم مدرسة صحيحًا';
  END IF;
  INSERT INTO public.schools(name,description,address,phone,whatsapp,location_url,image_url,is_active)
  VALUES (
    trim(p_name),nullif(trim(coalesce(p_type,'')),''),nullif(trim(coalesce(p_address,'')),''),
    nullif(trim(coalesce(p_phone,'')),''),nullif(trim(coalesce(p_whatsapp,'')),''),
    nullif(trim(coalesce(p_location_url,'')),''),p_image_url,true
  ) RETURNING id INTO new_school_id;
  RETURN new_school_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_school(p_school_id bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed integer;
BEGIN
  IF NOT public.is_dameer_admin() THEN RAISE EXCEPTION 'غير مصرح بحساب الإدارة'; END IF;
  UPDATE public.schools SET is_active=false,updated_at=now()
  WHERE id=p_school_id AND is_active;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed=0 THEN RAISE EXCEPTION 'المدرسة غير موجودة أو سبق حذفها'; END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_school(
  p_school_id bigint,
  p_name text,
  p_type text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_whatsapp text DEFAULT NULL,
  p_location_url text DEFAULT NULL,
  p_image_url text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed integer;
BEGIN
  IF NOT public.is_dameer_admin() THEN RAISE EXCEPTION 'غير مصرح بحساب الإدارة'; END IF;
  IF length(trim(coalesce(p_name,''))) NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION 'أدخل اسم مدرسة صحيحًا';
  END IF;
  UPDATE public.schools SET
    name=trim(p_name),description=nullif(trim(coalesce(p_type,'')),''),
    address=nullif(trim(coalesce(p_address,'')),''),phone=nullif(trim(coalesce(p_phone,'')),''),
    whatsapp=nullif(trim(coalesce(p_whatsapp,'')),''),location_url=nullif(trim(coalesce(p_location_url,'')),''),
    image_url=coalesce(p_image_url,image_url),updated_at=now()
  WHERE id=p_school_id AND is_active;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed=0 THEN RAISE EXCEPTION 'المدرسة غير موجودة أو غير نشطة'; END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_school(text,text,text,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_school(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_school(bigint,text,text,text,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_school(text,text,text,text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_school(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_school(bigint,text,text,text,text,text,text,text) TO authenticated;

DROP POLICY IF EXISTS dameer_media_public_upload ON storage.objects;
CREATE POLICY dameer_media_public_upload
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'dameer-media'
    AND array_length(storage.foldername(name), 1) = 1
    AND (storage.foldername(name))[1] IN ('profiles', 'memorials', 'listings', 'slides')
  );

-- Separate policy for school photos, so an older general upload policy cannot block them.
DROP POLICY IF EXISTS dameer_schools_photo_upload ON storage.objects;
CREATE POLICY dameer_schools_photo_upload
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (
    bucket_id = 'dameer-media'
    AND (storage.foldername(name))[1] = 'schools'
  );

COMMIT;
NOTIFY pgrst, 'reload schema';
