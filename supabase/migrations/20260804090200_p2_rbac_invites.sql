-- =============================================================================
-- BakeFlow — Phase 2: RBAC, Branch Assignments, Invites, JWT Claims
-- =============================================================================
-- Creates: roles (seeded), user_roles, branch_assignments, organization_invites
-- Plus:    has_branch_access(), custom_access_token_hook(),
--          create_organization_with_owner(), create_organization_invite(),
--          accept_organization_invite()
--
-- Conforms to: docs/SCHEMA-REFERENCE.md §1,
--              docs/RLS-POLICY-PATTERNS.md §2 §7 §8 §9,
--              docs/API-CONTRACT.md §2.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. roles — platform reference data, NOT tenant-scoped
-- -----------------------------------------------------------------------------
create table public.roles (
  id   uuid primary key default gen_random_uuid(),
  key  text not null unique
         check (key in ('owner', 'admin', 'branch_manager', 'baker',
                        'cashier', 'driver', 'accountant')),
  name text not null,
  -- Lower = more privileged. Enables "at least manager" comparisons without
  -- enumerating role keys at every call site.
  rank smallint not null unique check (rank > 0)
);

comment on table public.roles is
  'Platform-defined roles, seeded by migration. Never tenant-scoped and never written at runtime.';

-- Deterministic UUIDs: reference data must have the same identifiers in every
-- environment so that seeds, fixtures and tests are portable.
insert into public.roles (id, key, name, rank) values
  ('00000000-0000-4000-8000-000000000001', 'owner',          'Owner',          1),
  ('00000000-0000-4000-8000-000000000002', 'admin',          'Admin',          2),
  ('00000000-0000-4000-8000-000000000003', 'branch_manager', 'Branch Manager', 3),
  ('00000000-0000-4000-8000-000000000004', 'accountant',     'Accountant',     4),
  ('00000000-0000-4000-8000-000000000005', 'baker',          'Baker',          5),
  ('00000000-0000-4000-8000-000000000006', 'cashier',        'Cashier',        6),
  ('00000000-0000-4000-8000-000000000007', 'driver',         'Driver',         7);


-- -----------------------------------------------------------------------------
-- 2. user_roles
-- -----------------------------------------------------------------------------
create table public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.organizations(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_id    uuid not null references public.roles(id) on delete restrict,
  -- NULL = the role applies organization-wide rather than to one branch.
  branch_id  uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,

  -- Composite FK: a role can never be granted on another tenant's branch.
  constraint user_roles_branch_fkey
    foreign key (tenant_id, branch_id) references public.branches(tenant_id, id)
    on delete restrict
);

-- UNIQUE (tenant_id, profile_id, role_id, branch_id) split in two, because a
-- plain unique constraint treats every NULL branch_id as distinct and would
-- allow the same org-wide role to be granted repeatedly.
create unique index user_roles_unique_branch_scoped
  on public.user_roles (tenant_id, profile_id, role_id, branch_id)
  where branch_id is not null;

create unique index user_roles_unique_org_wide
  on public.user_roles (tenant_id, profile_id, role_id)
  where branch_id is null;

create index idx_user_roles_tenant  on public.user_roles (tenant_id);
create index idx_user_roles_profile on public.user_roles (profile_id);
create index idx_user_roles_role    on public.user_roles (role_id);
create index idx_user_roles_branch  on public.user_roles (branch_id);


-- -----------------------------------------------------------------------------
-- 3. branch_assignments
-- -----------------------------------------------------------------------------
create table public.branch_assignments (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.organizations(id) on delete restrict,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  branch_id  uuid not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,

  constraint branch_assignments_tenant_profile_branch_key
    unique (tenant_id, profile_id, branch_id),
  constraint branch_assignments_branch_fkey
    foreign key (tenant_id, branch_id) references public.branches(tenant_id, id)
    on delete restrict
);

create unique index branch_assignments_one_default_per_profile
  on public.branch_assignments (tenant_id, profile_id) where is_default;

create index idx_branch_assignments_tenant  on public.branch_assignments (tenant_id);
create index idx_branch_assignments_profile on public.branch_assignments (profile_id);
create index idx_branch_assignments_branch  on public.branch_assignments (branch_id);

comment on table public.branch_assignments is
  'Which branches a user may operate in. Read by has_branch_access(); owners and admins bypass it by design.';


-- -----------------------------------------------------------------------------
-- 4. organization_invites
-- -----------------------------------------------------------------------------
create table public.organization_invites (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.organizations(id) on delete restrict,
  email       text not null check (position('@' in email) > 1),
  role_id     uuid not null references public.roles(id) on delete restrict,
  branch_id   uuid,
  -- The raw token is returned to the caller exactly once and never stored.
  token_hash  text not null unique,
  status      text not null default 'pending'
                check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at  timestamptz not null,
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id) on delete set null,

  constraint organization_invites_branch_fkey
    foreign key (tenant_id, branch_id) references public.branches(tenant_id, id)
    on delete restrict,
  constraint organization_invites_accepted_consistent
    check ((status = 'accepted') = (accepted_at is not null))
);

create index idx_organization_invites_tenant on public.organization_invites (tenant_id);
create index idx_organization_invites_role   on public.organization_invites (role_id);
create index idx_organization_invites_branch on public.organization_invites (branch_id);
create index idx_organization_invites_email  on public.organization_invites (tenant_id, lower(email));

-- Only one live invite per email per tenant.
create unique index organization_invites_one_pending_per_email
  on public.organization_invites (tenant_id, lower(email)) where status = 'pending';

comment on column public.organization_invites.token_hash is
  'SHA-256 of the raw invite token. The raw token is never persisted, so a database leak does not yield working invites.';


-- -----------------------------------------------------------------------------
-- 5. has_branch_access — RLS-POLICY-PATTERNS.md §2
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER deliberately: it reads branch_assignments, and a policy on
-- that table would otherwise recurse.
create or replace function public.has_branch_access(target_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.has_role(array['owner', 'admin'])
    or exists (
      select 1
      from public.branch_assignments ba
      where ba.profile_id = auth.uid()
        and ba.branch_id  = target_branch_id
        and ba.tenant_id  = public.current_tenant_id()
    )
$$;

comment on function public.has_branch_access(uuid) is
  'True when the caller may operate in the given branch. Owners and admins bypass branch scoping; every other role sees only assigned branches.';

grant execute on function public.has_branch_access(uuid) to authenticated;


-- -----------------------------------------------------------------------------
-- 6. custom_access_token_hook — RLS-POLICY-PATTERNS.md §9
-- -----------------------------------------------------------------------------
-- Embeds tenant_id and role keys in the access token. Every RLS policy in the
-- system depends on these claims, so if this hook is not enabled in
-- Dashboard → Authentication → Hooks, every policy denies everything.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims   jsonb := event -> 'claims';
  v_user   uuid  := (event ->> 'user_id')::uuid;
  v_tenant uuid;
  v_roles  text[];
begin
  select p.tenant_id into v_tenant
  from public.profiles p
  where p.id = v_user;

  select coalesce(array_agg(r.key), '{}')
  into v_roles
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  where ur.profile_id = v_user
    and ur.tenant_id is not distinct from v_tenant;

  claims := jsonb_set(claims, '{tenant_id}', to_jsonb(v_tenant));
  claims := jsonb_set(claims, '{roles}',     to_jsonb(v_roles));

  return jsonb_set(event, '{claims}', claims);
end $$;

comment on function public.custom_access_token_hook(jsonb) is
  'Supabase auth hook. Populates the tenant_id and roles claims. Claims are stale until the token refreshes — any RPC that changes roles or tenancy must make the client refresh its session.';

-- The hook is invoked by GoTrue as supabase_auth_admin.
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;

-- Belt and braces: the hook is SECURITY DEFINER, but FORCE ROW LEVEL SECURITY
-- means the definer is not automatically exempt from policies. These grants and
-- read-only policies guarantee the hook can resolve claims whichever identity
-- it ends up executing as.
grant select on public.profiles, public.user_roles, public.roles to supabase_auth_admin;

create policy profiles_auth_hook_read on public.profiles
  for select to supabase_auth_admin using (true);
create policy user_roles_auth_hook_read on public.user_roles
  for select to supabase_auth_admin using (true);
create policy roles_auth_hook_read on public.roles
  for select to supabase_auth_admin using (true);


-- -----------------------------------------------------------------------------
-- 7. updated_at triggers
-- -----------------------------------------------------------------------------
create trigger user_roles_set_updated_at
  before update on public.user_roles
  for each row execute function public.set_updated_at();

create trigger branch_assignments_set_updated_at
  before update on public.branch_assignments
  for each row execute function public.set_updated_at();

create trigger organization_invites_set_updated_at
  before update on public.organization_invites
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 8. Row-Level Security
-- -----------------------------------------------------------------------------
alter table public.roles                 enable row level security;
alter table public.roles                 force  row level security;
alter table public.user_roles            enable row level security;
alter table public.user_roles            force  row level security;
alter table public.branch_assignments    enable row level security;
alter table public.branch_assignments    force  row level security;
alter table public.organization_invites  enable row level security;
alter table public.organization_invites  force  row level security;

-- --- roles (RLS-POLICY-PATTERNS.md §8: platform reference data) --------------
create policy roles_select on public.roles
  for select to authenticated using (true);
-- No write policies at all. Seeded by migration.

-- --- user_roles (Pattern E — self-scoped) ------------------------------------
create policy user_roles_select on public.user_roles
  for select to authenticated
  using (
    profile_id = auth.uid()
    or (tenant_id = public.current_tenant_id()
        and public.has_role(array['owner', 'admin', 'branch_manager']))
  );

-- Role assignment is never self-service: `profile_id <> auth.uid()` is what
-- stops a branch manager from granting themselves owner. The invite path runs
-- through accept_organization_invite(), a SECURITY DEFINER RPC.
create policy user_roles_insert on public.user_roles
  for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['owner', 'admin'])
    and profile_id <> auth.uid()
  );

create policy user_roles_update on public.user_roles
  for update to authenticated
  using (tenant_id = public.current_tenant_id()
         and public.has_role(array['owner', 'admin'])
         and profile_id <> auth.uid())
  with check (tenant_id = public.current_tenant_id()
              and profile_id <> auth.uid());

create policy user_roles_delete on public.user_roles
  for delete to authenticated
  using (tenant_id = public.current_tenant_id()
         and public.has_role(array['owner', 'admin'])
         and profile_id <> auth.uid());

-- --- branch_assignments (Pattern E) ------------------------------------------
-- Scoped by tenant and self, deliberately NOT by has_branch_access(): that
-- function reads this table, and using it here would recurse.
create policy branch_assignments_select on public.branch_assignments
  for select to authenticated
  using (
    profile_id = auth.uid()
    or (tenant_id = public.current_tenant_id()
        and public.has_role(array['owner', 'admin', 'branch_manager']))
  );

create policy branch_assignments_insert on public.branch_assignments
  for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['owner', 'admin', 'branch_manager'])
  );

create policy branch_assignments_update on public.branch_assignments
  for update to authenticated
  using (tenant_id = public.current_tenant_id()
         and public.has_role(array['owner', 'admin', 'branch_manager']))
  with check (tenant_id = public.current_tenant_id());

create policy branch_assignments_delete on public.branch_assignments
  for delete to authenticated
  using (tenant_id = public.current_tenant_id()
         and public.has_role(array['owner', 'admin']));

-- --- organization_invites (RLS-POLICY-PATTERNS.md §8) ------------------------
-- Readable only by owners and admins of the issuing tenant. The unauthenticated
-- accept path does NOT read this table directly — it goes through
-- accept_organization_invite(), which hashes the raw token server-side.
create policy organization_invites_select on public.organization_invites
  for select to authenticated
  using (tenant_id = public.current_tenant_id()
         and public.has_role(array['owner', 'admin']));

create policy organization_invites_insert on public.organization_invites
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id()
              and public.has_role(array['owner', 'admin']));

create policy organization_invites_update on public.organization_invites
  for update to authenticated
  using (tenant_id = public.current_tenant_id()
         and public.has_role(array['owner', 'admin']))
  with check (tenant_id = public.current_tenant_id());

-- No DELETE policy: invites are revoked (status = 'revoked'), never deleted.


-- -----------------------------------------------------------------------------
-- 9. RPC — create_organization_with_owner (API-CONTRACT.md §2)
-- -----------------------------------------------------------------------------
create or replace function public.create_organization_with_owner(
  p_name        text,
  p_branch_name text default 'Main Branch',
  p_timezone    text default 'Africa/Lagos'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user     uuid := auth.uid();
  v_slug     text;
  v_org      public.organizations;
  v_branch   public.branches;
  v_profile  public.profiles;
  v_owner    uuid;
  v_attempt  int := 0;
begin
  if v_user is null then
    raise exception 'authentication required'
      using errcode = 'P0001',
            detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  select * into v_profile from public.profiles where id = v_user for update;

  if v_profile.id is null then
    raise exception 'profile not found'
      using errcode = 'P0001',
            detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  if v_profile.tenant_id is not null then
    raise exception 'this user already belongs to an organization'
      using errcode = 'P0001',
            detail = json_build_object('code', 'duplicate_reference', 'field', 'organization')::text;
  end if;

  -- Slug: URL-safe, unique across the platform. Retry with a random suffix
  -- rather than failing the whole signup on a name collision.
  v_slug := btrim(regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'), '-');
  if v_slug = '' then
    v_slug := 'bakery';
  end if;

  while exists (select 1 from public.organizations o where o.slug = v_slug) loop
    v_attempt := v_attempt + 1;
    if v_attempt > 10 then
      raise exception 'could not allocate a unique slug for %', p_name
        using errcode = 'P0001',
              detail = json_build_object('code', 'duplicate_reference', 'field', 'slug')::text;
    end if;
    v_slug := btrim(regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'), '-')
              || '-' || substr(md5(random()::text), 1, 6);
  end loop;

  insert into public.organizations (name, slug, timezone, created_by)
  values (btrim(p_name), v_slug, coalesce(nullif(btrim(p_timezone), ''), 'Africa/Lagos'), v_user)
  returning * into v_org;

  insert into public.branches (tenant_id, name, code, is_primary, created_by)
  values (v_org.id, btrim(p_branch_name), 'MAIN', true, v_user)
  returning * into v_branch;

  update public.profiles
     set tenant_id = v_org.id,
         primary_branch_id = v_branch.id
   where id = v_user
  returning * into v_profile;

  select id into v_owner from public.roles where key = 'owner';

  insert into public.user_roles (tenant_id, profile_id, role_id, created_by)
  values (v_org.id, v_user, v_owner, v_user);

  insert into public.branch_assignments (tenant_id, profile_id, branch_id, is_default, created_by)
  values (v_org.id, v_user, v_branch.id, true, v_user);

  perform public.log_audit_event(
    v_org.id, 'organization', v_org.id, 'insert', null, to_jsonb(v_org));

  return jsonb_build_object(
    'organization',   to_jsonb(v_org),
    'branch',         to_jsonb(v_branch),
    'profile',        to_jsonb(v_profile),
    -- The tenant_id and roles claims do not exist in the caller's current token.
    -- The client MUST refresh the session before any RLS-protected query.
    'refresh_session', true
  );
end $$;

comment on function public.create_organization_with_owner(text, text, text) is
  'Creates the organization, its first branch, the owner role grant and the branch assignment atomically. The client must refresh its session afterwards — RLS denies everything until the new claims are in the token.';

revoke execute on function public.create_organization_with_owner(text, text, text) from public, anon;
grant  execute on function public.create_organization_with_owner(text, text, text) to authenticated;


-- -----------------------------------------------------------------------------
-- 10. RPC — create_organization_invite
-- -----------------------------------------------------------------------------
-- Addition beyond API-CONTRACT.md §2: the table stores only token_hash, so the
-- raw token must be minted server-side. Returned exactly once, then unreadable.
create or replace function public.create_organization_invite(
  p_email      text,
  p_role_key   text,
  p_branch_id  uuid default null,
  p_valid_days int  default 7
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.current_tenant_id();
  v_role   uuid;
  v_raw    text;
  v_invite public.organization_invites;
begin
  if v_tenant is null or not public.has_role(array['owner', 'admin']) then
    raise exception 'only owners and admins may invite members'
      using errcode = 'P0001',
            detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  select id into v_role from public.roles where key = p_role_key;
  if v_role is null then
    raise exception 'unknown role: %', p_role_key
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition', 'role_key', p_role_key)::text;
  end if;

  if p_branch_id is not null
     and not exists (select 1 from public.branches b
                     where b.id = p_branch_id and b.tenant_id = v_tenant) then
    raise exception 'branch does not belong to this organization'
      using errcode = 'P0001',
            detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  v_raw := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.organization_invites
    (tenant_id, email, role_id, branch_id, token_hash, expires_at, created_by)
  values
    (v_tenant, lower(btrim(p_email)), v_role, p_branch_id,
     encode(extensions.digest(v_raw, 'sha256'), 'hex'),
     now() + make_interval(days => greatest(p_valid_days, 1)),
     auth.uid())
  returning * into v_invite;

  perform public.log_audit_event(
    v_tenant, 'organization_invite', v_invite.id, 'insert', null,
    to_jsonb(v_invite) - 'token_hash');

  -- raw_token is returned here and nowhere else, ever.
  return jsonb_build_object(
    'invite',    to_jsonb(v_invite) - 'token_hash',
    'raw_token', v_raw
  );
end $$;

revoke execute on function public.create_organization_invite(text, text, uuid, int) from public, anon;
grant  execute on function public.create_organization_invite(text, text, uuid, int) to authenticated;


-- -----------------------------------------------------------------------------
-- 11. RPC — accept_organization_invite (API-CONTRACT.md §2)
-- -----------------------------------------------------------------------------
create or replace function public.accept_organization_invite(p_raw_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user    uuid := auth.uid();
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

  if v_invite.expires_at <= now() then
    update public.organization_invites set status = 'expired' where id = v_invite.id;
    raise exception 'invite has expired'
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition', 'status', 'expired')::text;
  end if;

  select * into v_profile from public.profiles where id = v_user for update;

  if v_profile.tenant_id is not null and v_profile.tenant_id <> v_invite.tenant_id then
    raise exception 'this user already belongs to a different organization'
      using errcode = 'P0001',
            detail = json_build_object('code', 'duplicate_reference', 'field', 'organization')::text;
  end if;

  update public.profiles
     set tenant_id = v_invite.tenant_id,
         primary_branch_id = coalesce(primary_branch_id, v_invite.branch_id)
   where id = v_user
  returning * into v_profile;

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
    'organization',    to_jsonb(v_org),
    'role',            to_jsonb(v_role),
    'profile',         to_jsonb(v_profile),
    'refresh_session', true
  );
end $$;

comment on function public.accept_organization_invite(text) is
  'Hashes the raw token, validates status and expiry, grants the role and branch assignment, and marks the invite accepted — atomically. The client must refresh its session afterwards.';

revoke execute on function public.accept_organization_invite(text) from public, anon;
grant  execute on function public.accept_organization_invite(text) to authenticated;


-- -----------------------------------------------------------------------------
-- 12. Grants
-- -----------------------------------------------------------------------------
grant select                         on public.roles                to authenticated;
grant select, insert, update, delete on public.user_roles           to authenticated;
grant select, insert, update, delete on public.branch_assignments   to authenticated;
grant select, insert, update         on public.organization_invites to authenticated;

revoke all on public.roles                from anon;
revoke all on public.user_roles           from anon;
revoke all on public.branch_assignments   from anon;
revoke all on public.organization_invites from anon;


-- -----------------------------------------------------------------------------
-- 13. Phase gate
-- -----------------------------------------------------------------------------
do $$
begin
  perform public.assert_schema_invariants();
  raise notice 'BakeFlow phase 2: schema invariants OK';
end $$;
