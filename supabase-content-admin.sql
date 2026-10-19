-- إدارة بطاقات المحتوى وصورها من لوحة الإدارة.
-- شغّل هذا الملف مرة واحدة في Supabase SQL Editor.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_list_manageable_content()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_dameer_admin() THEN RAISE EXCEPTION 'غير مصرح بحساب الإدارة'; END IF;
  RETURN jsonb_build_object(
    'teachers',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',t.id,'full_name',t.full_name,'gender',t.gender,'employment_status',t.employment_status,
      'photo_url',t.photo_url,'is_published',t.is_published
    ) ORDER BY t.full_name) FROM public.teachers t),'[]'::jsonb),
    'memorials',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',m.id,'full_name',m.full_name,'photo_url',m.photo_url,'is_published',m.is_published
    ) ORDER BY m.full_name) FROM public.memorial_teachers m),'[]'::jsonb),
    'listings',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',l.id,'teacher_id',l.teacher_id,'teacher_name',t.full_name,'title',l.title,
      'listing_type',l.listing_type,'image_url',l.image_url,'status',l.status
    ) ORDER BY l.created_at DESC) FROM public.teacher_listings l
      JOIN public.teachers t ON t.id=l.teacher_id),'[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_content_visibility(
  p_kind text,p_entity_id bigint,p_is_visible boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE affected integer;
BEGIN
  IF NOT public.is_dameer_admin() THEN RAISE EXCEPTION 'غير مصرح بحساب الإدارة'; END IF;
  IF p_kind='teacher' THEN
    UPDATE public.teachers SET is_published=p_is_visible,published_at=CASE WHEN p_is_visible THEN now() ELSE published_at END,updated_at=now() WHERE id=p_entity_id;
  ELSIF p_kind='memorial' THEN
    UPDATE public.memorial_teachers SET is_published=p_is_visible,published_at=CASE WHEN p_is_visible THEN now() ELSE published_at END,updated_at=now() WHERE id=p_entity_id;
  ELSIF p_kind='listing' THEN
    UPDATE public.teacher_listings SET status=CASE WHEN p_is_visible THEN 'published'::public.listing_status ELSE 'hidden'::public.listing_status END,
      published_at=CASE WHEN p_is_visible THEN now() ELSE published_at END,updated_at=now() WHERE id=p_entity_id;
  ELSE RAISE EXCEPTION 'نوع المحتوى غير صالح'; END IF;
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected=0 THEN RAISE EXCEPTION 'العنصر المطلوب غير موجود'; END IF;
  RETURN jsonb_build_object('ok',true,'kind',p_kind,'id',p_entity_id,'visible',p_is_visible);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_content(p_kind text,p_entity_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE affected integer; source_request bigint;
BEGIN
  IF NOT public.is_dameer_admin() THEN RAISE EXCEPTION 'غير مصرح بحساب الإدارة'; END IF;
  IF p_kind='teacher' THEN
    DELETE FROM public.teacher_requests WHERE teacher_id=p_entity_id;
    DELETE FROM public.teachers WHERE id=p_entity_id;
  ELSIF p_kind='memorial' THEN
    SELECT source_request_id INTO source_request FROM public.memorial_teachers WHERE id=p_entity_id;
    DELETE FROM public.memorial_teachers WHERE id=p_entity_id;
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected=0 THEN RAISE EXCEPTION 'العنصر المطلوب غير موجود'; END IF;
    IF source_request IS NOT NULL THEN DELETE FROM public.memorial_requests WHERE id=source_request; END IF;
  ELSIF p_kind='listing' THEN
    DELETE FROM public.teacher_listings WHERE id=p_entity_id;
  ELSE RAISE EXCEPTION 'نوع المحتوى غير صالح'; END IF;
  IF p_kind<>'memorial' THEN
    GET DIAGNOSTICS affected=ROW_COUNT;
    IF affected=0 THEN RAISE EXCEPTION 'العنصر المطلوب غير موجود'; END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'kind',p_kind,'id',p_entity_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_manageable_content() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_set_content_visibility(text,bigint,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_content(text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_manageable_content() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_content_visibility(text,bigint,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_content(text,bigint) TO authenticated;

DROP POLICY IF EXISTS dameer_media_admin_delete ON storage.objects;
CREATE POLICY dameer_media_admin_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'dameer-media' AND public.is_dameer_admin());

NOTIFY pgrst, 'reload schema';
COMMIT;
