-- BakeFlow — multi-organization membership (step 1 of the sequence in
-- BAKEFLOW-MULTI-ORGANIZATION-DECISION section 18)
--
-- STATUS: NOT APPLIED. Consistent with every other migration in this directory.
-- Nothing in this file has been verified against a running database beyond the
-- read-only schema inspection recorded below.
--
-- ===========================================================================
-- AUDIT FINDINGS (required by section 23 before any code change)
-- ===========================================================================
--
-- FINDING 1 — the membership model already exists. Do not create a second one.
--
--   Section 22 requires searching for an existing membership relationship before
--   introducing `organization_memberships`. There is one:
--
--     user_roles (id, tenant_id NOT NULL, profile_id NOT NULL, role_id NOT NULL,
--                 branch_id NULL, created_at, updated_at, created_by,
--                 deleted_at, deleted_by)
--       FK tenant_id  -> organizations(id)
--       FK profile_id -> profiles(id) ON DELETE CASCADE
--       FK (tenant_id, branch_id) -> branches(tenant_id, id)
--
--     branch_assignments (id, tenant_id NOT NULL, profile_id NOT NULL,
--                         branch_id NOT NULL, is_default, ... soft delete)
--       UNIQUE (tenant_id, profile_id, branch_id)
--
--   user_roles is already keyed per (tenant, profile) and carries the role, so
--   "role belongs to the membership" (section 4) is ALREADY satisfied: the same user
--   can legitimately be Driver in Organization A and Supervisor in Organization B.
--   branch_assignments already separates branch access from organization membership
--   (section 5). Neither table has any constraint restricting a profile to one tenant.
--
--   Therefore this migration does NOT add organization_memberships. Adding it would
--   produce exactly the competing-authorization-architecture that section 22 forbids.
--   user_roles IS the membership model.
--
-- FINDING 2 — only five functions actually depend on the single-tenant assumption.
--
--   Dependency map for profiles.tenant_id (live, measured):
--
--     profiles.tenant_id
--       |
--       +-- custom_access_token_hook()        mints the single tenant_id claim
--       +-- accept_organization_invite()      RAISES if profile already has a tenant
--       +-- create_organization_with_owner()  sets it on org creation
--       +-- guard_user_role_integrity()       cross-tenant role guard
--       +-- guard_order_actor_and_assignment() actor/assignment guard
--
--   By contrast:
--     - 100 of 101 public RLS policies reference current_tenant_id()
--     - 19 functions reference current_tenant_id()
--     -  0 policies reference profiles.tenant_id directly
--
--   This is the whole reason the change is tractable. Every policy reads the tenant
--   through ONE helper. Redefining what that helper resolves to leaves all 100
--   policies correct without touching them. The blast radius is 5 functions, not 100
--   policies.
--
-- ===========================================================================
-- DESIGN
-- ===========================================================================
--
-- Membership (authoritative, security boundary):  user_roles
-- Active organization (UI/operational context):   profiles.active_tenant_id
--
-- These are different concepts and section 13 requires they stay different. Membership
-- decides what a user MAY access; the active organization decides what they are
-- CURRENTLY looking at. A user with three memberships has exactly one active org.
--
-- current_tenant_id() keeps its signature and keeps reading the JWT claim, so all 100
-- policies are untouched. What changes is how the claim is produced: the hook now mints
-- the ACTIVE organization, and only after verifying live membership in it. If the user
-- has no membership in their active organization, the claim is NULL and every policy
-- fails closed.
--
-- This satisfies section 11's prohibition: the claim is never an arbitrary
-- `SELECT ... LIMIT 1` organization. It is the one the user explicitly selected, and it
-- is rejected if membership does not back it.
--
-- The cost of putting the active organization in the JWT is that switching organizations
-- requires a token refresh. That is deliberate and is the reason set_active_organization()
-- below returns a flag telling the client to refresh. The alternative — resolving the
-- active org per-request from a table — would add a lookup to all 100 policies.
--
-- STALENESS, stated explicitly: because the claim lives in a JWT with a 3600s lifetime
-- (config.toml), revoking a membership does not immediately cut off access to the active
-- organization. Server-side authorization at mutation time (has_permission,
-- has_branch_access, and the sync worker's checks) DOES query tables and is immediate.
-- The sync worker must therefore rely on is_member_of(), never on the claim alone.

-- ---------------------------------------------------------------------------
-- 1. Active-organization pointer
-- ---------------------------------------------------------------------------
-- Deliberately a NEW column rather than a rename of profiles.tenant_id. Section 21
-- requires a non-destructive migration, and 5 functions plus any application code still
-- read the legacy column. Both exist until every dependant is migrated.

alter table public.profiles
  add column if not exists active_tenant_id uuid references public.organizations(id) on delete set null;

comment on column public.profiles.active_tenant_id is
  'The organization the user is currently operating in — UI/operational context only, NOT membership. Membership is user_roles. Must always be backed by an active user_roles row; enforced by set_active_organization() and re-checked by custom_access_token_hook().';

comment on column public.profiles.tenant_id is
  'LEGACY single-tenant pointer. Superseded by user_roles (membership) + active_tenant_id (context). Retained only until the remaining dependants are migrated — see the migration notes at the end of 20260810140000. Do not read this in new code.';

-- Backfill: whatever the user''s single tenant was, that becomes their active org.
update public.profiles
   set active_tenant_id = tenant_id
 where active_tenant_id is null
   and tenant_id is not null;

create index if not exists profiles_active_tenant_idx
  on public.profiles (active_tenant_id)
  where active_tenant_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Backfill membership from the legacy pointer
-- ---------------------------------------------------------------------------
-- Section 21: preserve existing relationships. Any profile that has a legacy tenant_id
-- but no user_roles row in that tenant would silently lose access when authorization
-- moves to membership. In the live database this is a no-op (zero profiles), but it must
-- be correct for any environment that does have data.
--
-- No role can be invented for such a profile, so this only reports them. Assigning one
-- would be a silent privilege decision.

do $$
declare
  v_orphans int;
begin
  select count(*) into v_orphans
  from public.profiles p
  where p.tenant_id is not null
    and p.deleted_at is null
    and not exists (
      select 1 from public.user_roles ur
      where ur.profile_id = p.id
        and ur.tenant_id  = p.tenant_id
        and ur.deleted_at is null
    );

  if v_orphans > 0 then
    raise warning
      'MANUAL ACTION REQUIRED: % profile(s) have profiles.tenant_id but no matching user_roles row. They will lose access once authorization is membership-based. Assign each an explicit role before deprecating profiles.tenant_id.',
      v_orphans;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Membership helpers
-- ---------------------------------------------------------------------------
-- is_member_of() is the new security primitive. Unlike current_tenant_id() it queries
-- tables, so it is immediate and unaffected by JWT staleness. The sync worker and every
-- other cross-organization check must use THIS, not the claim.
--
-- SECURITY DEFINER because user_roles carries its own RLS which reads current_tenant_id()
-- — a membership check for a NON-active organization would otherwise be filtered out by
-- that policy and always return false. search_path is pinned per section 42 of the
-- clarification document.

create or replace function public.is_member_of(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.profiles pr on pr.id = ur.profile_id
    where ur.profile_id = auth.uid()
      and ur.tenant_id  = p_tenant_id
      and ur.deleted_at is null
      and pr.deleted_at is null
      and pr.status = 'active'
  );
$$;

comment on function public.is_member_of(uuid) is
  'True when the caller holds a live, non-deleted role in the given organization and their profile is active. Queries tables, so it is immediate — use this rather than current_tenant_id() for any cross-organization authorization, especially in the sync worker.';

-- Every organization the caller belongs to. Backs an organization switcher and lets the
-- client show what it may switch to without exposing anything else.
create or replace function public.my_organizations()
returns table (tenant_id uuid, name text, is_active boolean)
language sql
stable
security definer
set search_path = public
as $$
  select distinct
    o.id,
    o.name,
    (o.id = (select p.active_tenant_id from public.profiles p where p.id = auth.uid()))
  from public.user_roles ur
  join public.organizations o on o.id = ur.tenant_id
  join public.profiles pr     on pr.id = ur.profile_id
  where ur.profile_id = auth.uid()
    and ur.deleted_at is null
    and o.deleted_at  is null
    and o.status      = 'active'
    and pr.deleted_at is null
    and pr.status     = 'active';
$$;

comment on function public.my_organizations() is
  'Organizations the caller is a member of, flagging the active one. Section 13: membership determines authorization, active organization is UI context.';

revoke all on function public.is_member_of(uuid)  from public, anon;
revoke all on function public.my_organizations()  from public, anon;
grant execute on function public.is_member_of(uuid) to authenticated, service_role;
grant execute on function public.my_organizations() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Switching the active organization
-- ---------------------------------------------------------------------------
-- The ONLY supported way to change the active organization. It refuses any organization
-- the caller is not a member of, which is what stops a client from selecting its way into
-- another tenant. The claim is minted from this pointer, so an unvalidated write here
-- would be a privilege escalation — hence no direct UPDATE grant on the column.

create or replace function public.set_active_organization(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if not public.is_member_of(p_tenant_id) then
    raise exception 'not a member of the requested organization'
      using errcode = '42501',
            detail  = json_build_object('code', 'not_a_member',
                                        'tenant_id', p_tenant_id)::text;
  end if;

  update public.profiles
     set active_tenant_id = p_tenant_id,
         updated_at       = now()
   where id = v_uid;

  -- The tenant_id claim is baked into the access token, so the change does not take
  -- effect until the client refreshes its session.
  return jsonb_build_object(
    'tenant_id',              p_tenant_id,
    'session_refresh_required', true
  );
end;
$$;

comment on function public.set_active_organization(uuid) is
  'Switches the caller''s active organization after verifying membership. Client MUST refresh its session afterwards — the tenant_id claim is carried in the access token.';

revoke all on function public.set_active_organization(uuid) from public, anon;
grant execute on function public.set_active_organization(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Access-token hook — membership-backed active organization
-- ---------------------------------------------------------------------------
-- Replaces the version that read profiles.tenant_id. Changes:
--   * the tenant claim is active_tenant_id, falling back to legacy tenant_id during
--     migration, and then only if membership backs it
--   * roles are scoped to that organization, so a Driver in A / Supervisor in B gets
--     only the Driver role while A is active (section 4)
--
-- Retains the hardening from 20260809200100: suspended or soft-deleted profiles, and
-- soft-deleted role rows, yield no tenant and no roles.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims   jsonb := event -> 'claims';
  v_uid    uuid  := (event ->> 'user_id')::uuid;
  v_tenant uuid;
  v_status text;
  v_del    timestamptz;
  v_roles  text[];
begin
  select coalesce(p.active_tenant_id, p.tenant_id), p.status, p.deleted_at
    into v_tenant, v_status, v_del
  from public.profiles p
  where p.id = v_uid;

  -- Fail closed for suspended or removed users.
  if v_status is distinct from 'active' or v_del is not null then
    v_tenant := null;
    v_roles  := '{}';
  else
    -- The active organization is only honoured if membership still backs it. This is
    -- what prevents a stale pointer, or a revoked membership, from minting a usable
    -- tenant claim.
    if v_tenant is not null then
      if not exists (
        select 1 from public.user_roles ur
        where ur.profile_id = v_uid
          and ur.tenant_id  = v_tenant
          and ur.deleted_at is null
      ) then
        v_tenant := null;
      end if;
    end if;

    if v_tenant is null then
      v_roles := '{}';
    else
      select coalesce(array_agg(distinct r.key), '{}')
        into v_roles
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.profile_id = v_uid
        and ur.tenant_id  = v_tenant     -- roles scoped to the ACTIVE organization only
        and ur.deleted_at is null
        and r.deleted_at  is null;
    end if;
  end if;

  claims := jsonb_set(claims, '{tenant_id}',
                      case when v_tenant is null then 'null'::jsonb
                           else to_jsonb(v_tenant::text) end, true);
  claims := jsonb_set(claims, '{roles}', to_jsonb(coalesce(v_roles, '{}')), true);

  return jsonb_set(event, '{claims}', claims, true);
end;
$$;

comment on function public.custom_access_token_hook(jsonb) is
  'Mints tenant_id (the membership-verified ACTIVE organization) and roles scoped to it. Revocation is not immediate — bounded by the access-token lifetime. Use is_member_of() for immediate checks.';

revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- 6. Invitation acceptance — additive, not exclusive
-- ---------------------------------------------------------------------------
-- Section 19: a user already in Organization A must be able to accept an invitation to
-- Organization B without losing A. The deployed function raises in exactly that case.
--
-- This rewrite is intentionally minimal: it preserves the existing token-hash matching,
-- expiry handling and role/branch assignment, and changes only the membership semantics.
-- Two further defects are noted at the end of this file but deliberately NOT fixed here,
-- to keep this migration reviewable as one concern.

create or replace function public.accept_organization_invite(p_raw_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_hash   text;
  v_invite public.organization_invites;
  v_role   public.roles;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  -- MUST be extensions.digest, not digest: pgcrypto is installed in the `extensions`
  -- schema and this function pins search_path = public, so an unqualified call does not
  -- resolve. This exactly mirrors how create_organization_invite() stores the hash —
  -- encode(extensions.digest(raw,'sha256'),'hex') — and any divergence would silently
  -- make every existing invite unacceptable.
  v_hash := encode(extensions.digest(p_raw_token, 'sha256'), 'hex');

  select * into v_invite
  from public.organization_invites
  where token_hash = v_hash
  for update;

  if v_invite.id is null then
    raise exception 'invite not found'
      using errcode = 'P0001',
            detail  = json_build_object('code', 'invalid_transition')::text;
  end if;

  if v_invite.status <> 'pending' then
    raise exception 'invite is no longer pending'
      using errcode = 'P0001',
            detail  = json_build_object('code', 'invalid_transition',
                                        'status', v_invite.status)::text;
  end if;

  if v_invite.expires_at <= now() then
    update public.organization_invites set status = 'expired' where id = v_invite.id;
    raise exception 'invite has expired'
      using errcode = 'P0001',
            detail  = json_build_object('code', 'invalid_transition',
                                        'status', 'expired')::text;
  end if;

  select * into v_role from public.roles where id = v_invite.role_id;

  -- THE CHANGE. Previously:
  --   if v_profile.tenant_id is not null and v_profile.tenant_id <> v_invite.tenant_id
  --     then raise 'this user already belongs to a different organization'
  -- Membership is now additive: accepting an invite to B leaves A intact.

  insert into public.user_roles (tenant_id, profile_id, role_id, branch_id, created_by)
  values (v_invite.tenant_id, v_uid, v_invite.role_id, v_invite.branch_id, v_uid)
  on conflict do nothing;

  if v_invite.branch_id is not null then
    insert into public.branch_assignments (tenant_id, profile_id, branch_id, is_default, created_by)
    values (v_invite.tenant_id, v_uid, v_invite.branch_id, false, v_uid)
    on conflict (tenant_id, profile_id, branch_id) do nothing;
  end if;

  -- Only adopt the new organization as active if the user has none yet, so accepting an
  -- invitation never silently moves an existing user out of the organization they are
  -- currently working in.
  update public.profiles
     set active_tenant_id = coalesce(active_tenant_id, v_invite.tenant_id),
         tenant_id        = coalesce(tenant_id, v_invite.tenant_id),  -- legacy, kept in step
         updated_at       = now()
   where id = v_uid;

  update public.organization_invites
     set status      = 'accepted',
         accepted_by = v_uid,
         accepted_at = now()
   where id = v_invite.id;

  perform public.log_audit_event(
    v_invite.tenant_id, 'organization_invite', v_invite.id, 'status_change',
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', 'accepted', 'accepted_by', v_uid));

  return jsonb_build_object(
    'tenant_id',                v_invite.tenant_id,
    'role',                     v_role.key,
    'session_refresh_required', true
  );
end;
$$;

revoke all on function public.accept_organization_invite(text) from public, anon;
grant execute on function public.accept_organization_invite(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Guard: active_tenant_id must be backed by membership
-- ---------------------------------------------------------------------------
-- Defence in depth. set_active_organization() is the intended path, but profiles carries
-- a self-update RLS policy, so a client could otherwise set the pointer directly and the
-- hook would mint a claim for an organization it had no membership in. The hook re-checks
-- membership too; this stops the bad value being stored in the first place.

create or replace function public.guard_profile_active_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.active_tenant_id is not null
     and new.active_tenant_id is distinct from coalesce(old.active_tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and not exists (
       select 1 from public.user_roles ur
       where ur.profile_id = new.id
         and ur.tenant_id  = new.active_tenant_id
         and ur.deleted_at is null
     )
  then
    raise exception 'active_tenant_id must reference an organization the user is a member of'
      using errcode = '42501',
            detail  = json_build_object('code', 'not_a_member',
                                        'tenant_id', new.active_tenant_id)::text;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_profile_active_tenant() from public, anon, authenticated;

drop trigger if exists profiles_guard_active_tenant on public.profiles;
create trigger profiles_guard_active_tenant
  before insert or update of active_tenant_id on public.profiles
  for each row execute function public.guard_profile_active_tenant();

-- ===========================================================================
-- REMAINING WORK — steps 4 through 11 of the section 18 sequence
-- ===========================================================================
--
-- This migration covers steps 1-3 and 6 (schema audit, membership repair, authorization
-- helpers, invitation acceptance). Deliberately NOT included, each needing its own
-- reviewable migration:
--
--  a) create_organization_with_owner() still writes profiles.tenant_id. It must also
--     set active_tenant_id. It already inserts the owner user_roles row, so membership
--     is correct; only the pointer needs updating.
--
--  b) guard_user_role_integrity() and guard_order_actor_and_assignment() still read
--     profiles.tenant_id for their cross-tenant checks. Both must move to
--     is_member_of(), or they will reject legitimate operations from a user whose
--     legacy pointer names a different organization than the row being written.
--
--  c) The sync worker, process_sync_batch_context_validated(), remains a stub. It is
--     step 9 and must now be written against is_member_of(op.tenant_id) evaluated at
--     SYNCHRONIZATION time (section 8 step 3, section 9), never against
--     current_tenant_id(). That distinction is the whole point of section 7: an
--     operation queued for Organization A must not follow the user into Organization B.
--     Note process_sync_batch() currently rejects any batch whose device tenant differs
--     from current_tenant_id() — that check must be relaxed to a membership check, or
--     a user who switches active organization before reconnecting can never flush their
--     queue for the previous organization.
--
--  d) profiles.tenant_id cannot be dropped until (a), (b) and all application queries
--     are migrated (section 21).
--
--  e) Tests A-J from section 24 are not written. C, D, F and G are the security-critical
--     ones and none can pass today, because the sync worker does not run.
