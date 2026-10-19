-- Authenticated administration for the Dameer education directory.
-- Run this after schema.sql and supabase-link.sql. Only explicitly mapped Auth users are admins.
BEGIN;

ALTER TABLE public.admins
  ADD COLUMN IF NOT EXISTS auth_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.is_dameer_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admins a
    WHERE a.auth_user_id = auth.uid() AND a.is_active
  );
$$;
REVOKE ALL ON FUNCTION public.is_dameer_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_dameer_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_review_queue()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.is_dameer_admin() THEN RAISE EXCEPTION 'غير مصرح بحساب الإدارة'; END IF;
  RETURN jsonb_build_object(
    'teachers', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',r.id,'requested_name',r.requested_name,'payload',r.payload,'status',r.status,
      'review_message',r.review_message,'created_at',r.created_at
    ) ORDER BY r.created_at DESC) FROM public.teacher_requests r), '[]'::jsonb),
    'memorials', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',r.id,'full_name',r.full_name,'biography',r.biography,'photo_url',r.photo_url,
      'submitted_by',r.submitted_by,'submitter_contact',r.submitter_contact,'status',r.status,
      'review_message',r.review_message,'created_at',r.created_at
    ) ORDER BY r.created_at DESC) FROM public.memorial_requests r), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_decide_request(
  p_request_id bigint, p_kind text, p_decision text, p_message text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  admin_id bigint;
  request_row record;
  new_teacher_id bigint;
  new_memorial_id bigint;
BEGIN
  IF NOT public.is_dameer_admin() THEN RAISE EXCEPTION 'غير مصرح بحساب الإدارة'; END IF;
  IF p_decision NOT IN ('approve','needs_changes','reject') THEN RAISE EXCEPTION 'قرار المراجعة غير صالح'; END IF;
  IF p_decision <> 'approve' AND length(trim(coalesce(p_message,''))) = 0 THEN
    RAISE EXCEPTION 'أضف رسالة تشرح قرار المراجعة';
  END IF;
  SELECT a.id INTO admin_id FROM public.admins a WHERE a.auth_user_id=auth.uid() AND a.is_active;

  IF p_kind='teacher' THEN
    SELECT * INTO request_row FROM public.teacher_requests WHERE id=p_request_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'طلب المعلم غير موجود'; END IF;
    IF request_row.status='approved' THEN RAISE EXCEPTION 'سبق اعتماد هذا الطلب'; END IF;
    IF p_decision='approve' THEN
      IF request_row.request_kind <> 'new_profile' OR request_row.control_code_hash IS NULL THEN
        RAISE EXCEPTION 'نوع طلب المعلم غير مدعوم للاعتماد التلقائي';
      END IF;
      INSERT INTO public.teachers(full_name,gender,employment_status,biography,experience_years,address,photo_url,is_published,published_at)
      VALUES (
        request_row.requested_name,
        request_row.payload->>'gender',
        coalesce(nullif(request_row.payload->>'status',''),'active')::public.teacher_employment_status,
        request_row.payload->>'bio',
        nullif(request_row.payload->>'years','')::smallint,
        request_row.payload->>'address',
        request_row.payload->>'photo',true,now()
      ) RETURNING id INTO new_teacher_id;
      INSERT INTO public.teacher_access_credentials(teacher_id,code_hash)
      VALUES (new_teacher_id,request_row.control_code_hash);
      INSERT INTO public.teacher_contacts(teacher_id,contact_type,phone_number,sort_order)
      SELECT new_teacher_id, coalesce(x->>'type','mobile'), x->>'value', ordinality::smallint
      FROM jsonb_array_elements(coalesce(request_row.payload->'contacts','[]'::jsonb)) WITH ORDINALITY AS c(x,ordinality)
      WHERE coalesce(x->>'value','') <> '';
      INSERT INTO public.teacher_subjects(teacher_id,subject_id)
      SELECT new_teacher_id,s.id FROM public.subjects s
      JOIN jsonb_array_elements_text(coalesce(request_row.payload->'subjects','[]'::jsonb)) n(name) ON n.name=s.name
      ON CONFLICT DO NOTHING;
      INSERT INTO public.teacher_grade_assignments(teacher_id,stage_id,grade_id)
      SELECT DISTINCT new_teacher_id,g.stage_id,g.id
      FROM public.grades g
      JOIN public.education_stages e ON e.id=g.stage_id
      JOIN jsonb_array_elements_text(coalesce(request_row.payload->'grades','[]'::jsonb)) gn(name) ON gn.name=g.name
      JOIN jsonb_array_elements_text(coalesce(request_row.payload->'stages','[]'::jsonb)) sn(name) ON sn.name=e.name
      ON CONFLICT DO NOTHING;
      INSERT INTO public.teacher_schools(teacher_id,school_id,is_current)
      SELECT new_teacher_id,s.id,true FROM public.schools s
      WHERE request_row.payload->>'schoolId' ~ '^[0-9]+$'
        AND s.id=(request_row.payload->>'schoolId')::bigint AND s.is_active
      ON CONFLICT DO NOTHING;
      INSERT INTO public.teacher_services(teacher_id,title,sort_order)
      SELECT new_teacher_id,c.title,ordinality::smallint
      FROM jsonb_array_elements_text(coalesce(request_row.payload->'services','[]'::jsonb)) WITH ORDINALITY AS c(title,ordinality);
    END IF;
    UPDATE public.teacher_requests SET status=CASE p_decision WHEN 'approve' THEN 'approved'::public.request_status WHEN 'needs_changes' THEN 'needs_changes'::public.request_status ELSE 'rejected'::public.request_status END,
      teacher_id=CASE WHEN p_decision='approve' THEN new_teacher_id ELSE teacher_id END,
      review_message=nullif(trim(coalesce(p_message,'')),''),reviewer_admin_id=admin_id,reviewed_at=now(),updated_at=now()
    WHERE id=p_request_id;
    INSERT INTO public.admin_audit_log(admin_id,entity_type,entity_id,action,details)
    VALUES(admin_id,'teacher_request',p_request_id,p_decision,jsonb_build_object('message',p_message));
    RETURN jsonb_build_object('ok',true,'teacher_id',new_teacher_id);
  ELSIF p_kind='memorial' THEN
    SELECT * INTO request_row FROM public.memorial_requests WHERE id=p_request_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'الطلب التذكاري غير موجود'; END IF;
    IF request_row.status='approved' THEN RAISE EXCEPTION 'سبق اعتماد هذا الطلب'; END IF;
    IF p_decision='approve' THEN
      INSERT INTO public.memorial_teachers(full_name,biography,photo_url,is_published,published_at,source_request_id)
      VALUES(request_row.full_name,request_row.biography,request_row.photo_url,true,now(),request_row.id)
      RETURNING id INTO new_memorial_id;
    END IF;
    UPDATE public.memorial_requests SET status=CASE p_decision WHEN 'approve' THEN 'approved'::public.request_status WHEN 'needs_changes' THEN 'needs_changes'::public.request_status ELSE 'rejected'::public.request_status END,
      review_message=nullif(trim(coalesce(p_message,'')),''),reviewer_admin_id=admin_id,reviewed_at=now(),updated_at=now()
    WHERE id=p_request_id;
    INSERT INTO public.admin_audit_log(admin_id,entity_type,entity_id,action,details)
    VALUES(admin_id,'memorial_request',p_request_id,p_decision,jsonb_build_object('message',p_message));
    RETURN jsonb_build_object('ok',true,'memorial_id',new_memorial_id);
  ELSE
    RAISE EXCEPTION 'نوع الطلب غير صالح';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_review_queue() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_decide_request(bigint,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_review_queue() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_decide_request(bigint,text,text,text) TO authenticated;

COMMIT;
