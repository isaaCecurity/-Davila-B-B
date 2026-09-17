-- BACKEND_ROADMAP P9.9 Q9, narrowed by the owner (2026-09-17): "The only upload that's needed for now
-- is the profile photo."
--
-- The app uploads the photo to the private `avatars` bucket under
--   <active organization id>/profiles/<user id>/<unique name>.(jpg|jpeg|png|webp)
-- (bucket limits: 2 MB, JPEG/PNG/WebP; storage policies already require the organization folder), then
-- calls set_my_avatar() to point profiles.avatar_url at that object path. The function:
--   • accepts only a path in the caller's own profile folder under the active organization;
--   • requires the object to exist in `avatars` and to have been uploaded by the caller (owner_id);
--   • with NULL clears the photo;
--   • audits the change. Photos are shown through short-lived signed URLs (the bucket is private).
-- Old photo files are not deleted here (storage delete is limited to owner/admin/manager); unique names
-- mean an upload never overwrites anything.

CREATE OR REPLACE FUNCTION public.set_my_avatar(p_object_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user   uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_path   text := nullif(btrim(coalesce(p_object_path, '')), '');
  v_before public.profiles;
  v_after  public.profiles;
BEGIN
  IF v_user IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'authentication and an active organization are required'
      USING errcode = 'P0001', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  IF v_path IS NOT NULL THEN
    IF v_path !~ ('^' || v_tenant::text || '/profiles/' || v_user::text || '/[A-Za-z0-9._-]{1,100}\.(jpg|jpeg|png|webp)$') THEN
      RAISE EXCEPTION 'photo path must be in your own profile folder'
        USING errcode = 'P0001', detail = json_build_object('code','invalid_request','reason','invalid_avatar_path')::text;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM storage.objects o
       WHERE o.bucket_id = 'avatars' AND o.name = v_path AND o.owner_id = v_user::text
    ) THEN
      RAISE EXCEPTION 'photo not found'
        USING errcode = 'P0001', detail = json_build_object('code','invalid_request','reason','avatar_not_uploaded')::text;
    END IF;
  END IF;

  SELECT * INTO v_before FROM public.profiles WHERE id = v_user AND deleted_at IS NULL FOR UPDATE;
  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'profile not found'
      USING errcode = 'P0001', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  UPDATE public.profiles SET avatar_url = v_path WHERE id = v_user RETURNING * INTO v_after;

  IF v_before.avatar_url IS DISTINCT FROM v_after.avatar_url THEN
    PERFORM public.log_audit_event(
      v_tenant, 'profile', v_user, 'update',
      jsonb_build_object('avatar_url', v_before.avatar_url),
      jsonb_build_object('avatar_url', v_after.avatar_url));
  END IF;

  RETURN jsonb_build_object('id', v_after.id, 'full_name', v_after.full_name, 'phone', v_after.phone,
                            'avatar_url', v_after.avatar_url);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_my_avatar(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_my_avatar(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_my_avatar(text) TO authenticated, service_role;
