-- create_organization_invite() had no rate limit of its own -- only the separate
-- send-invite-email Edge Function call (email DISPATCH) was capped. Invite CREATION
-- itself was unbounded: a compromised/malicious owner/admin account could loop this RPC
-- against its own tenant with real downstream cost (unbounded organization_invites row
-- growth today, and a pre-staged spam/phishing-relay vector against BakeFlow's own
-- sender reputation once real email delivery goes live per AD-023's trigger condition).
--
-- Rate limit added after every other validation check (role, target-role, branch), so a
-- malformed/unauthorized request never consumes a legitimate caller's quota -- mirroring
-- send-invite-email's own established ordering. 20/hour matches that function's existing
-- precedent order of magnitude.
CREATE OR REPLACE FUNCTION public.create_organization_invite(p_email text, p_role_key text, p_branch_id uuid DEFAULT NULL::uuid, p_valid_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_role uuid;
  v_raw text;
  v_invite public.organization_invites;
BEGIN
  IF v_tenant IS NULL OR NOT public.has_role(ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'only owners and admins may invite members'
      USING errcode='P0001', detail=json_build_object('code','insufficient_role')::text;
  END IF;
  SELECT id INTO v_role FROM public.roles WHERE key=p_role_key;
  IF v_role IS NULL OR NOT private.can_manage_target_role(v_role) THEN
    RAISE EXCEPTION 'you are not permitted to invite this role'
      USING errcode='P0001', detail=json_build_object('code','insufficient_role','role_key',p_role_key)::text;
  END IF;
  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches b WHERE b.id=p_branch_id AND b.tenant_id=v_tenant
  ) THEN
    RAISE EXCEPTION 'branch does not belong to this organization'
      USING errcode='P0001', detail=json_build_object('code','insufficient_role')::text;
  END IF;
  IF p_role_key IN ('owner','admin') AND p_branch_id IS NOT NULL THEN
    RAISE EXCEPTION 'owner and admin invitations must be organization-wide'
      USING errcode='P0001', detail=json_build_object('code','invalid_transition')::text;
  END IF;

  PERFORM public.enforce_rate_limit(v_tenant, auth.uid(), 'org_invite_create', 20, 60);

  v_raw := encode(extensions.gen_random_bytes(32),'hex');
  INSERT INTO public.organization_invites
    (tenant_id,email,role_id,branch_id,token_hash,expires_at,created_by)
  VALUES
    (v_tenant,lower(btrim(p_email)),v_role,p_branch_id,
     encode(extensions.digest(v_raw,'sha256'),'hex'),
     now()+make_interval(days=>greatest(p_valid_days,1)),auth.uid())
  RETURNING * INTO v_invite;
  PERFORM public.log_audit_event(
    v_tenant,'organization_invite',v_invite.id,'insert',NULL,
    to_jsonb(v_invite)-'token_hash'
  );
  RETURN jsonb_build_object('invite',to_jsonb(v_invite)-'token_hash','raw_token',v_raw);
END;
$function$;
