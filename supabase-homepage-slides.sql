-- Dynamic homepage slider management. Keeps the existing CSS illustration and colors.
BEGIN;

ALTER TABLE public.homepage_slides
  ALTER COLUMN image_url DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS eyebrow text,
  ADD COLUMN IF NOT EXISTS title_line text,
  ADD COLUMN IF NOT EXISTS title_emphasis text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS primary_text text,
  ADD COLUMN IF NOT EXISTS primary_view text DEFAULT 'teachers',
  ADD COLUMN IF NOT EXISTS secondary_text text,
  ADD COLUMN IF NOT EXISTS secondary_view text DEFAULT 'lessons';

UPDATE public.homepage_slides
SET primary_view=coalesce(primary_view,'teachers'),
    secondary_view=coalesce(secondary_view,'lessons');

DROP POLICY IF EXISTS public_slides_read ON public.homepage_slides;
CREATE POLICY public_slides_read ON public.homepage_slides
  FOR SELECT TO anon, authenticated USING (is_active);
GRANT SELECT ON public.homepage_slides TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_homepage_slides()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF NOT public.is_dameer_admin() THEN RAISE EXCEPTION 'غير مصرح بحساب الإدارة'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.sort_order,s.id),'[]'::jsonb)
    INTO result FROM public.homepage_slides AS s;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_save_homepage_slide(
  p_slide_id bigint,
  p_eyebrow text,
  p_title_line text,
  p_title_emphasis text,
  p_description text,
  p_primary_text text,
  p_primary_view text,
  p_secondary_text text,
  p_secondary_view text,
  p_image_url text,
  p_sort_order integer,
  p_is_active boolean
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE saved_id bigint;
BEGIN
  IF NOT public.is_dameer_admin() THEN RAISE EXCEPTION 'غير مصرح بحساب الإدارة'; END IF;
  IF length(trim(coalesce(p_eyebrow,''))) NOT BETWEEN 1 AND 100
     OR length(trim(coalesce(p_title_line,''))) NOT BETWEEN 1 AND 200
     OR length(trim(coalesce(p_title_emphasis,''))) NOT BETWEEN 1 AND 200
     OR length(trim(coalesce(p_description,''))) NOT BETWEEN 1 AND 600
     OR length(trim(coalesce(p_primary_text,''))) NOT BETWEEN 1 AND 80
     OR length(trim(coalesce(p_secondary_text,''))) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'أكمل نصوص الشريحة ضمن الحدود المسموحة';
  END IF;
  IF p_primary_view NOT IN ('teachers','lessons','schools','memorials','apply')
     OR p_secondary_view NOT IN ('teachers','lessons','schools','memorials','apply') THEN
    RAISE EXCEPTION 'وجهة أحد الأزرار غير صالحة';
  END IF;
  IF p_slide_id IS NULL THEN
    INSERT INTO public.homepage_slides(
      image_url,eyebrow,title_line,title_emphasis,description,primary_text,primary_view,
      secondary_text,secondary_view,sort_order,is_active
    ) VALUES (
      nullif(trim(coalesce(p_image_url,'')),''),trim(p_eyebrow),trim(p_title_line),trim(p_title_emphasis),trim(p_description),
      trim(p_primary_text),p_primary_view,trim(p_secondary_text),p_secondary_view,greatest(coalesce(p_sort_order,0),0),coalesce(p_is_active,true)
    ) RETURNING id INTO saved_id;
  ELSE
    UPDATE public.homepage_slides SET
      image_url=coalesce(nullif(trim(coalesce(p_image_url,'')),''),image_url),
      eyebrow=trim(p_eyebrow),title_line=trim(p_title_line),title_emphasis=trim(p_title_emphasis),
      description=trim(p_description),primary_text=trim(p_primary_text),primary_view=p_primary_view,
      secondary_text=trim(p_secondary_text),secondary_view=p_secondary_view,
      sort_order=greatest(coalesce(p_sort_order,0),0),is_active=coalesce(p_is_active,true),updated_at=now()
    WHERE id=p_slide_id RETURNING id INTO saved_id;
    IF saved_id IS NULL THEN RAISE EXCEPTION 'لم نعثر على الشريحة المطلوبة'; END IF;
  END IF;
  RETURN saved_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_homepage_slide(p_slide_id bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed integer;
BEGIN
  IF NOT public.is_dameer_admin() THEN RAISE EXCEPTION 'غير مصرح بحساب الإدارة'; END IF;
  DELETE FROM public.homepage_slides WHERE id=p_slide_id;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed=0 THEN RAISE EXCEPTION 'لم نعثر على الشريحة المطلوبة'; END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_homepage_slides() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_save_homepage_slide(bigint,text,text,text,text,text,text,text,text,text,integer,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_homepage_slide(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_homepage_slides() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_homepage_slide(bigint,text,text,text,text,text,text,text,text,text,integer,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_homepage_slide(bigint) TO authenticated;

INSERT INTO public.homepage_slides(
  eyebrow,title_line,title_emphasis,description,primary_text,primary_view,
  secondary_text,secondary_view,sort_order,is_active
)
SELECT v.eyebrow,v.title_line,v.title_emphasis,v.description,v.primary_text,v.primary_view,
       v.secondary_text,v.secondary_view,v.sort_order,true
FROM (VALUES
  ('مجتمعنا التعليمي','كل خبرة لها مكان،','وكل أثر يستحق أن يُروى.','اكتشفوا معلمي ومعلمات الضمير، وتعرّفوا على الدورات والمدارس القريبة منكم.','اكتشف المعلمين','teachers','تصفّح الدورات','lessons',0),
  ('فرص تعلّم أقرب','خطوة صغيرة اليوم،','تصنع فرقًا في الغد.','ابحثوا عن الدروس الخصوصية والدورات المناسبة للمادة والصف الذي تبحثون عنه.','ابحث عن درس','teachers','اعرض المدارس','schools',1),
  ('أثر يبقى','نحتفي بمن علّمنا،','ونحفظ أسماءهم في الذاكرة.','مساحة وفاء لمعلمي ومعلمات الضمير الذين تركوا أثرًا لا يُنسى.','معلمون تركوا أثرًا','memorials','أضف بطاقة','apply',2)
) AS v(eyebrow,title_line,title_emphasis,description,primary_text,primary_view,secondary_text,secondary_view,sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.homepage_slides);

NOTIFY pgrst, 'reload schema';
COMMIT;
