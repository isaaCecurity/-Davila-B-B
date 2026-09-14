-- AD-026: invitations are by role, to an email OR a phone number, and branch managers may invite
-- crew into the branches they manage. Builds on AD-025 (acceptance bound to the addressee).
--
-- Owner decisions (2026-09-14): "the invite link is by role only … the role needs to be selected …
-- the person sending the invite link has to input the email or number of the user"; phone invites
-- are bound to a phone verified by SMS sign-in; a branch manager invites cashier, baker, driver or
-- supervisor, only into a branch they manage.
--
-- 1. organization_invites: `email` becomes nullable, new `phone` (E.164, e.g. +2348031234567);
--    exactly one of the two is set. One pending invite per phone per organization, as for email.
-- 2. private.manages_branch(branch): the caller holds branch_manager for that branch (or
--    organization-wide) in the active organization.
-- 3. create_organization_invite(): gains p_phone (the function is dropped and recreated — adding a
--    parameter with CREATE OR REPLACE would leave an ambiguous overload). Owner/admin rules are
--    unchanged (including organization-wide crew invites, which tests/sql/rate_limit_enforcement.sql
--    relies on); a branch manager may invite cashier/baker/driver/supervisor only into a branch they
--    manage, so a branch is always required from them.
-- 4. accept_organization_invite(): an email invite needs the signed-in account's CONFIRMED email to
--    match; a phone invite needs its CONFIRMED phone (auth.users.phone, which Supabase stores
--    without the +) to match — reason `phone_mismatch`.
-- 5. organization_invites_select: branch managers also see invites for branches they manage.
-- 6. handle_new_user(): a phone sign-up's number is copied into profiles.phone.

-- 1 ── schema ──────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.organization_invites ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.organization_invites ADD COLUMN phone text;

ALTER TABLE public.organization_invites
  ADD CONSTRAINT organization_invites_one_contact CHECK ((email IS NULL) <> (phone IS NULL));
ALTER TABLE public.organization_invites
  ADD CONSTRAINT organization_invites_phone_e164 CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$');

CREATE UNIQUE INDEX organization_invites_one_pending_per_phone
  ON public.organization_invites (tenant_id, phone)
  WHERE status = 'pending' AND phone IS NOT NULL;

COMMENT ON COLUMN public.organization_invites.phone IS
  'AD-026: invitee phone in E.164 (+234…). Exactly one of email/phone is set.';

-- 2 ── helper ──────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.manages_branch(p_branch_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p_branch_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
     WHERE ur.profile_id = auth.uid()
       AND ur.tenant_id  = public.current_tenant_id()
       AND r.key         = 'branch_manager'
       AND (ur.branch_id = p_branch_id OR ur.branch_id IS NULL)
       AND ur.deleted_at IS NULL
       AND r.deleted_at  IS NULL
  );
$function$;

REVOKE ALL ON FUNCTION private.manages_branch(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.manages_branch(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION private.manages_branch(uuid) TO authenticated, service_role;

-- 3 ── create ──────────────────────────────────────────────────────────────────────────────────
DROP FUNCTION public.create_organization_invite(text, text, uuid, integer);

CREATE FUNCTION public.create_organization_invite(
  p_email      text,
  p_role_key   text,
  p_branch_id  uuid    DEFAULT NULL,
  p_valid_days integer DEFAULT 7,
  p_phone      text    DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tenant  uuid := public.current_tenant_id();
  v_role    uuid;
  v_raw     text;
  v_email   text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone   text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_invite  public.organization_invites;
  v_org_admin boolean;
BEGIN
  IF v_tenant IS NULL OR NOT public.has_role(ARRAY['owner','admin','branch_manager']) THEN
    RAISE EXCEPTION 'only owners, admins and branch managers may invite members'
      USING errcode='P0001', detail=json_build_object('code','insufficient_role')::text;
  END IF;

  -- AD-026: exactly one way to reach the invitee.
  IF (v_email IS NULL) = (v_phone IS NULL) THEN
    RAISE EXCEPTION 'give either an email or a phone number'
      USING errcode='P0001', detail=json_build_object('code','invalid_request','reason','contact_required')::text;
  END IF;
  IF v_email IS NOT NULL AND position('@' in v_email) <= 1 THEN
    RAISE EXCEPTION 'invalid email'
      USING errcode='P0001', detail=json_build_object('code','invalid_request','reason','invalid_email')::text;
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'phone must be in international format, e.g. +2348031234567'
      USING errcode='P0001', detail=json_build_object('code','invalid_request','reason','invalid_phone')::text;
  END IF;

  SELECT id INTO v_role FROM public.roles WHERE key = p_role_key AND deleted_at IS NULL;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'a role must be chosen'
      USING errcode='P0001', detail=json_build_object('code','invalid_request','reason','role_required')::text;
  END IF;

  IF p_branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches b WHERE b.id = p_branch_id AND b.tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'branch does not belong to this organization'
      USING errcode='P0001', detail=json_build_object('code','insufficient_role')::text;
  END IF;
  IF p_role_key IN ('owner','admin') AND p_branch_id IS NOT NULL THEN
    RAISE EXCEPTION 'owner and admin invitations must be organization-wide'
      USING errcode='P0001', detail=json_build_object('code','invalid_transition')::text;
  END IF;
  v_org_admin := public.has_role(ARRAY['owner','admin']);
  IF v_org_admin THEN
    IF NOT private.can_manage_target_role(v_role) THEN
      RAISE EXCEPTION 'you are not permitted to invite this role'
        USING errcode='P0001', detail=json_build_object('code','insufficient_role','role_key',p_role_key)::text;
    END IF;
  ELSE
    -- AD-026: a branch manager invites crew, into a branch they manage.
    IF p_role_key NOT IN ('cashier','baker','driver','supervisor') THEN
      RAISE EXCEPTION 'branch managers may invite cashiers, bakers, drivers and supervisors'
        USING errcode='P0001', detail=json_build_object('code','insufficient_role','role_key',p_role_key)::text;
    END IF;
    IF NOT private.manages_branch(p_branch_id) THEN
      RAISE EXCEPTION 'you can only invite people to a branch you manage'
        USING errcode='P0001', detail=json_build_object('code','insufficient_role','reason','not_your_branch')::text;
    END IF;
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
    (tenant_id, email, phone, role_id, branch_id, token_hash, expires_at, created_by)
  VALUES
    (v_tenant, v_email, v_phone, v_role, p_branch_id,
     encode(extensions.digest(v_raw,'sha256'),'hex'),
     now() + make_interval(days => greatest(p_valid_days,1)), auth.uid())
  RETURNING * INTO v_invite;

  PERFORM public.log_audit_event(
    v_tenant, 'organization_invite', v_invite.id, 'insert', NULL,
    to_jsonb(v_invite) - 'token_hash'
  );
  RETURN jsonb_build_object('invite', to_jsonb(v_invite) - 'token_hash', 'raw_token', v_raw);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_organization_invite(text, text, uuid, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_organization_invite(text, text, uuid, integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_organization_invite(text, text, uuid, integer, text) TO authenticated, service_role;

-- 4 ── accept ──────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accept_organization_invite(p_raw_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_user            uuid := auth.uid();
  v_email           text;
  v_email_confirmed timestamptz;
  v_phone           text;
  v_phone_confirmed timestamptz;
  v_invite          public.organization_invites;
  v_profile         public.profiles;
  v_org             public.organizations;
  v_role            public.roles;
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

  -- AD-025 / AD-026: only the addressee may redeem the link, proven by a confirmed email or phone.
  select u.email, u.email_confirmed_at, u.phone, u.phone_confirmed_at
    into v_email, v_email_confirmed, v_phone, v_phone_confirmed
    from auth.users u where u.id = v_user;

  if v_invite.email is not null then
    if v_email is null or v_email_confirmed is null
       or lower(btrim(v_email)) <> lower(btrim(v_invite.email)) then
      raise exception 'this invite was sent to a different email address'
        using errcode = 'P0001',
              detail = json_build_object('code', 'insufficient_role', 'reason', 'email_mismatch')::text;
    end if;
  else
    if coalesce(v_phone, '') = '' or v_phone_confirmed is null
       or regexp_replace(v_phone, '[^0-9]', '', 'g') <> regexp_replace(v_invite.phone, '[^0-9]', '', 'g') then
      raise exception 'this invite was sent to a different phone number'
        using errcode = 'P0001',
              detail = json_build_object('code', 'insufficient_role', 'reason', 'phone_mismatch')::text;
    end if;
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

-- 5 ── visibility ──────────────────────────────────────────────────────────────────────────────
DROP POLICY organization_invites_select ON public.organization_invites;
CREATE POLICY organization_invites_select ON public.organization_invites
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND deleted_at IS NULL
    AND (has_role(ARRAY['owner'::text, 'admin'::text]) OR private.manages_branch(branch_id))
  );

-- 6 ── phone sign-ups keep their number ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(
      new.raw_user_meta_data ->> 'phone',
      case when coalesce(new.phone, '') <> '' then '+' || new.phone end
    )
  )
  on conflict (id) do nothing;
  return new;
end $function$;
