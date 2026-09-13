-- AD-025 (resolves BLOCKER-031): an invitation can only be accepted by the account it was sent to,
-- and expiry is actually recorded.
--
-- 1. accept_organization_invite(): the signed-in account's email (auth.users.email) must equal the
--    invite's email, compared case- and whitespace-insensitively. A mismatch is refused with
--    `insufficient_role` / reason `email_mismatch` and changes nothing; the invited address is never
--    echoed back to the caller.
-- 2. Expiry is persisted. The old body ran `UPDATE … status = 'expired'` and then RAISEd, which
--    rolled the update back — expired invites stayed `pending` forever. Now the expired branch marks
--    the row and RETURNS `{ accepted: false, code: 'invalid_transition', status: 'expired' }`, so the
--    update commits. A successful acceptance now also carries `accepted: true`.
-- 3. create_organization_invite() first sweeps this organization's pending invites that are past
--    `expires_at` to `expired`, so the Invites list converges even for links nobody opens.
-- Everything else (role/branch seeding, audit, refresh_session) is unchanged.

CREATE OR REPLACE FUNCTION public.accept_organization_invite(p_raw_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_user    uuid := auth.uid();
  v_email   text;
  v_invite  public.organization_invites;
  v_profile public.profiles;
  v_org     public.organizations;
  v_role    public.roles;
begin
  if v_user is null then
    raise exception 'authentication required'
      using errcode = 'P0001',
            detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  select * into v_invite
  from public.organization_invites
  where token_hash = encode(extensions.digest(p_raw_token, 'sha256'), 'hex')
  for update;

  if v_invite.id is null then
    raise exception 'invite not found'
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition', 'reason', 'unknown_token')::text;
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'invite is already %', v_invite.status
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition', 'status', v_invite.status)::text;
  end if;

  -- AD-025: only the addressee may redeem the link.
  select u.email into v_email from auth.users u where u.id = v_user;

  if v_email is null
     or lower(btrim(v_email)) <> lower(btrim(v_invite.email)) then
    raise exception 'this invite was sent to a different email address'
      using errcode = 'P0001',
            detail = json_build_object('code', 'insufficient_role', 'reason', 'email_mismatch')::text;
  end if;

  -- AD-025: persist expiry. Returning (not raising) lets the status update commit.
  if v_invite.expires_at <= now() then
    update public.organization_invites set status = 'expired' where id = v_invite.id;

    perform public.log_audit_event(
      v_invite.tenant_id, 'organization_invite', v_invite.id, 'status_change',
      jsonb_build_object('status', 'pending'),
      jsonb_build_object('status', 'expired'));

    return jsonb_build_object(
      'accepted', false,
      'code',     'invalid_transition',
      'status',   'expired'
    );
  end if;

  select * into v_profile from public.profiles where id = v_user for update;

  if v_profile.id is null then
    raise exception 'profile not found'
      using errcode = 'P0001',
            detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  -- Membership in another organization is expected and must not block acceptance.
  -- Seed the home organization only on the very first acceptance.
  if v_profile.tenant_id is null then
    update public.profiles
       set tenant_id         = v_invite.tenant_id,
           primary_branch_id = coalesce(primary_branch_id, v_invite.branch_id)
     where id = v_user
    returning * into v_profile;
  end if;

  insert into public.user_roles (tenant_id, profile_id, role_id, branch_id, created_by)
  values (v_invite.tenant_id, v_user, v_invite.role_id, v_invite.branch_id, v_invite.created_by)
  on conflict do nothing;

  if v_invite.branch_id is not null then
    insert into public.branch_assignments (tenant_id, profile_id, branch_id, is_default, created_by)
    values (v_invite.tenant_id, v_user, v_invite.branch_id,
            not exists (select 1 from public.branch_assignments ba
                        where ba.tenant_id = v_invite.tenant_id and ba.profile_id = v_user),
            v_invite.created_by)
    on conflict (tenant_id, profile_id, branch_id) do nothing;
  end if;

  -- Only adopt the invited organization as the active one when the user has none.
  if v_profile.active_tenant_id is null then
    update public.profiles
       set active_tenant_id = v_invite.tenant_id
     where id = v_user
    returning * into v_profile;
  end if;

  update public.organization_invites
     set status = 'accepted', accepted_by = v_user, accepted_at = now()
   where id = v_invite.id
  returning * into v_invite;

  select * into v_org  from public.organizations where id = v_invite.tenant_id;
  select * into v_role from public.roles         where id = v_invite.role_id;

  perform public.log_audit_event(
    v_invite.tenant_id, 'organization_invite', v_invite.id, 'status_change',
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', 'accepted', 'accepted_by', v_user));

  return jsonb_build_object(
    'accepted',        true,
    'organization',    to_jsonb(v_org),
    'role',            to_jsonb(v_role),
    'profile',         to_jsonb(v_profile),
    'refresh_session', true
  );
end $function$;


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

  -- AD-025: converge this organization's lapsed invites before adding another.
  UPDATE public.organization_invites
     SET status = 'expired'
   WHERE tenant_id = v_tenant
     AND status = 'pending'
     AND expires_at <= now()
     AND deleted_at IS NULL;

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
