-- =============================================================================
-- BakeFlow — Phase 1: Tenancy, Identity, Audit, Shared Infrastructure
-- =============================================================================
-- Creates: organizations, branches, profiles, audit_log, document_sequences
-- Plus:    set_updated_at(), handle_new_user(), log_audit_event(),
--          next_document_number(), current_tenant_id(), has_role()
--
-- Conforms to: CLAUDE.md non-negotiable rules 1-10,
--              docs/SCHEMA-REFERENCE.md §1 §8 §9,
--              docs/RLS-POLICY-PATTERNS.md §1 §2 §7 §8.
--
-- NOTE ON HELPER SCHEMA: RLS-POLICY-PATTERNS.md §2 defines the helpers as
-- public.current_tenant_id() / auth.has_role() / auth.has_branch_access().
-- Supabase no longer grants CREATE on the auth schema to the migration role
-- ("permission denied for schema auth"), and its own guidance is to keep custom
-- objects out of auth. The helpers therefore live in public with identical
-- signatures and semantics. Recorded in docs/PROJECT-OVERVIEW.md §7.
--
-- NOTE ON BUILD ORDER: SCHEMA-REFERENCE.md §10 lists `audit_log` in phase 6.
-- It is created here instead because every phase from 3 onward attaches status
-- guards that must write audit rows, and audit_log's only foreign keys
-- (organizations, profiles) exist in this phase. Recorded in
-- docs/PROJECT-OVERVIEW.md §7.
-- =============================================================================

-- gen_random_uuid() is in pg_catalog on PostgreSQL 13+, which Supabase runs.
-- pgcrypto is required for digest() used by the invite-token flow in phase 2.
create extension if not exists pgcrypto with schema extensions;


-- -----------------------------------------------------------------------------
-- 1. Shared trigger function — updated_at
-- -----------------------------------------------------------------------------
-- Rule: updated_at is maintained by the database, never by the application.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger. Attached to every mutable table. Applications must never set updated_at.';


-- -----------------------------------------------------------------------------
-- 2. Auth helper functions (RLS-POLICY-PATTERNS.md §2)
-- -----------------------------------------------------------------------------
-- STABLE, not VOLATILE: Postgres then evaluates these once per statement rather
-- than once per row. Marking them VOLATILE makes large list queries slow.
--
-- public.has_branch_access() is defined in phase 2, after branch_assignments
-- exists (a `language sql` body is validated at CREATE time).

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'tenant_id', '')::uuid
$$;

comment on function public.current_tenant_id() is
  'The caller''s tenant, read from the tenant_id JWT claim populated by public.custom_access_token_hook(). Returns NULL when the claim is absent, which denies everything.';

create or replace function public.has_role(role_keys text[])
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'roles') ?| role_keys, false)
$$;

comment on function public.has_role(text[]) is
  'True when the caller holds at least one of the given role keys, read from the roles JWT claim. Claims are stale until the token refreshes.';

grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.has_role(text[]) to authenticated;


-- -----------------------------------------------------------------------------
-- 3. organizations — the tenant root
-- -----------------------------------------------------------------------------
create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) > 0),
  slug          text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  country_code  text not null default 'NG' check (country_code ~ '^[A-Z]{2}$'),
  currency_code text not null default 'NGN' check (currency_code ~ '^[A-Z]{3}$'),
  timezone      text not null default 'Africa/Lagos',
  status        text not null default 'active'
                  check (status in ('active', 'suspended', 'closed')),

  -- Addition beyond SCHEMA-REFERENCE.md §1: required to implement the negative
  -- stock rule in §9 ("adjustments and waste may go negative only if the tenant
  -- has explicitly enabled it — default is deny").
  allow_negative_stock boolean not null default false,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid  -- FK to profiles added below, after profiles exists
);

comment on table public.organizations is
  'The tenant root. One row per bakery business. Not itself tenant-scoped — it IS the tenant.';
comment on column public.organizations.allow_negative_stock is
  'When false (default), apply_stock_movement() refuses any movement that would drive a stock level below zero. Never permits negative stock for production_consume or sale regardless of this flag.';


-- -----------------------------------------------------------------------------
-- 4. branches — a physical location within an organization
-- -----------------------------------------------------------------------------
create table public.branches (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.organizations(id) on delete restrict,
  name         text not null check (length(btrim(name)) > 0),
  code         text not null check (length(btrim(code)) > 0),
  address_line text,
  city         text,
  phone        text,
  is_primary   boolean not null default false,
  status       text not null default 'active' check (status in ('active', 'inactive')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid,  -- FK added below

  constraint branches_tenant_code_key unique (tenant_id, code),
  -- Target for tenant-scoped composite foreign keys from every branch-scoped
  -- table. Guarantees a child row can never point at another tenant's branch.
  constraint branches_tenant_id_key unique (tenant_id, id)
);

-- Exactly one primary branch per tenant.
create unique index branches_one_primary_per_tenant
  on public.branches (tenant_id) where is_primary;

create index idx_branches_tenant on public.branches (tenant_id);

comment on table public.branches is
  'A physical location or operating unit. Every branch-scoped table carries both tenant_id and branch_id.';


-- -----------------------------------------------------------------------------
-- 5. profiles — extends auth.users
-- -----------------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  -- Deliberately nullable: a user exists between signing up and creating or
  -- joining an organization. Every OTHER tenant-scoped table is NOT NULL.
  tenant_id         uuid references public.organizations(id) on delete restrict,
  primary_branch_id uuid references public.branches(id) on delete set null,
  full_name         text not null default '',
  phone             text,
  avatar_url        text,
  status            text not null default 'active' check (status in ('active', 'suspended')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_profiles_tenant on public.profiles (tenant_id);
create index idx_profiles_primary_branch on public.profiles (primary_branch_id);

comment on table public.profiles is
  'One row per auth.users row, created by the handle_new_user() trigger. tenant_id is NULL until the user creates or accepts an invite into an organization.';

-- Close the circular reference now that profiles exists.
alter table public.organizations
  add constraint organizations_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.branches
  add constraint branches_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

create index idx_organizations_created_by on public.organizations (created_by);
create index idx_branches_created_by on public.branches (created_by);


-- -----------------------------------------------------------------------------
-- 6. audit_log — append-only record of every significant business event
-- -----------------------------------------------------------------------------
create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.organizations(id) on delete restrict,
  actor_id    uuid references public.profiles(id) on delete set null,
  entity_type text not null,
  entity_id   uuid not null,
  action      text not null
                check (action in ('insert', 'update', 'delete', 'status_change')),
  before      jsonb,
  after       jsonb,
  occurred_at timestamptz not null default now()
);

create index idx_audit_log_entity
  on public.audit_log (tenant_id, entity_type, entity_id, occurred_at desc);
create index idx_audit_log_tenant_time
  on public.audit_log (tenant_id, occurred_at desc);
create index idx_audit_log_actor on public.audit_log (actor_id);

comment on table public.audit_log is
  'Append-only. Satisfies Core Principle 4. occurred_at is the event timestamp and stands in for created_at/updated_at — an immutable log has no update time.';

create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only'
    using errcode = 'P0001',
          detail = json_build_object('code', 'immutable_table', 'table', 'audit_log')::text;
end $$;

create trigger audit_log_immutable
  before update or delete on public.audit_log
  for each row execute function public.prevent_audit_log_mutation();

-- The single writer used by every guard trigger and RPC in later phases.
create or replace function public.log_audit_event(
  p_tenant_id   uuid,
  p_entity_type text,
  p_entity_id   uuid,
  p_action      text,
  p_before      jsonb default null,
  p_after       jsonb default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_log (tenant_id, actor_id, entity_type, entity_id, action, before, after)
  values (p_tenant_id, auth.uid(), p_entity_type, p_entity_id, p_action, p_before, p_after);
$$;

comment on function public.log_audit_event(uuid, text, uuid, text, jsonb, jsonb) is
  'SECURITY DEFINER writer for audit_log. Called from guard triggers and RPCs; never called directly by clients.';

-- Granted to authenticated because SECURITY INVOKER guard triggers in later
-- phases call it on the caller's behalf. This confers no capability the
-- audit_log_insert policy does not already allow, and actor_id is always
-- auth.uid() — a caller cannot forge another actor.
revoke execute on function public.log_audit_event(uuid, text, uuid, text, jsonb, jsonb) from public, anon;
grant  execute on function public.log_audit_event(uuid, text, uuid, text, jsonb, jsonb) to authenticated;


-- -----------------------------------------------------------------------------
-- 7. document_sequences — gapless per-tenant document numbering
-- -----------------------------------------------------------------------------
-- Addition beyond SCHEMA-REFERENCE.md: STATE-MACHINES.md §1 requires an order
-- number on creation and API-CONTRACT.md §2 requires confirm_order to issue an
-- invoice, both of which need a per-tenant counter. A Postgres sequence cannot
-- be used — it is global, not per-tenant, and leaks row counts across tenants.
create table public.document_sequences (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.organizations(id) on delete restrict,
  doc_type      text not null check (doc_type in ('order', 'invoice', 'production_batch')),
  prefix        text not null,
  current_value bigint not null default 0 check (current_value >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint document_sequences_tenant_type_key unique (tenant_id, doc_type)
);

create index idx_document_sequences_tenant on public.document_sequences (tenant_id);

create or replace function public.next_document_number(p_tenant_id uuid, p_doc_type text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_next   bigint;
begin
  v_prefix := case p_doc_type
                when 'order'            then 'ORD'
                when 'invoice'          then 'INV'
                when 'production_batch' then 'BATCH'
              end;

  if v_prefix is null then
    raise exception 'unknown document type: %', p_doc_type
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_document_type', 'doc_type', p_doc_type)::text;
  end if;

  -- Atomic: the upsert takes a row lock, so concurrent callers serialise and
  -- no two orders in one tenant can receive the same number.
  insert into public.document_sequences (tenant_id, doc_type, prefix, current_value)
  values (p_tenant_id, p_doc_type, v_prefix, 1)
  on conflict (tenant_id, doc_type)
    do update set current_value = public.document_sequences.current_value + 1
  returning current_value into v_next;

  return v_prefix || '-' || lpad(v_next::text, 6, '0');
end $$;

revoke execute on function public.next_document_number(uuid, text) from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 8. handle_new_user — create a profile on signup
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'phone'
  )
  on conflict (id) do nothing;
  return new;
end $$;

comment on function public.handle_new_user() is
  'AFTER INSERT on auth.users. Creates the matching public.profiles row with a NULL tenant_id.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- -----------------------------------------------------------------------------
-- 9. updated_at triggers
-- -----------------------------------------------------------------------------
create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create trigger branches_set_updated_at
  before update on public.branches
  for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger document_sequences_set_updated_at
  before update on public.document_sequences
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 10. Row-Level Security
-- -----------------------------------------------------------------------------
-- FORCE so that the table owner is not exempt either. Deny by default: with RLS
-- enabled and no policy, nothing is visible. Separate policy per command —
-- never FOR ALL, because omitting a policy is how a command is forbidden.

alter table public.organizations      enable row level security;
alter table public.organizations      force  row level security;
alter table public.branches           enable row level security;
alter table public.branches           force  row level security;
alter table public.profiles           enable row level security;
alter table public.profiles           force  row level security;
alter table public.audit_log          enable row level security;
alter table public.audit_log          force  row level security;
alter table public.document_sequences enable row level security;
alter table public.document_sequences force  row level security;

-- --- organizations (Pattern: special case, RLS-POLICY-PATTERNS.md §8) --------
create policy organizations_select on public.organizations
  for select to authenticated
  using (id = public.current_tenant_id());

-- A user with no organization yet may create their first one. The
-- create_organization_with_owner() RPC then sets tenant_id and the owner role
-- atomically; this policy exists so the RPC is not the only possible path.
create policy organizations_insert on public.organizations
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.tenant_id is null
    )
  );

create policy organizations_update on public.organizations
  for update to authenticated
  using (id = public.current_tenant_id() and public.has_role(array['owner', 'admin']))
  with check (id = public.current_tenant_id());

-- No DELETE policy. An organization is closed (status = 'closed'), never deleted.

-- --- branches (Pattern A — tenant-scoped) ------------------------------------
create policy branches_select on public.branches
  for select to authenticated
  using (tenant_id = public.current_tenant_id());

create policy branches_insert on public.branches
  for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['owner', 'admin'])
  );

create policy branches_update on public.branches
  for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role(array['owner', 'admin']))
  with check (tenant_id = public.current_tenant_id());

-- No DELETE policy. Branches are deactivated (status = 'inactive').

-- --- profiles (Pattern E — self-scoped, RLS-POLICY-PATTERNS.md §7) -----------
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (tenant_id = public.current_tenant_id()
        and public.has_role(array['owner', 'admin', 'branch_manager']))
  );

-- IS NOT DISTINCT FROM rather than = : a user who has not yet joined an
-- organization has tenant_id NULL and current_tenant_id() NULL, and `NULL =
-- NULL` is NULL, which would reject their own profile edits. The clause still
-- blocks moving a profile into a different tenant, which is its whole purpose.
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and tenant_id is not distinct from public.current_tenant_id());

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (tenant_id = public.current_tenant_id() and public.has_role(array['owner', 'admin']))
  with check (tenant_id = public.current_tenant_id());

-- No INSERT policy: profiles are created only by handle_new_user().
-- No DELETE policy: removing a profile happens by deleting the auth.users row.

-- --- audit_log (Pattern C — append-only) -------------------------------------
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['owner', 'admin', 'accountant'])
  );

create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id());

-- No UPDATE or DELETE policy — the absence IS the immutability guarantee.

-- --- document_sequences ------------------------------------------------------
-- Readable for support and diagnostics; written only by next_document_number().
create policy document_sequences_select on public.document_sequences
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['owner', 'admin'])
  );


-- -----------------------------------------------------------------------------
-- 11. Grants
-- -----------------------------------------------------------------------------
-- RLS decides which rows; grants decide which commands are even attemptable.
-- anon receives nothing: BakeFlow has no public-facing reads.
grant usage on schema public to authenticated;

grant select, insert, update on public.organizations to authenticated;
grant select, insert, update on public.branches      to authenticated;
grant select, update          on public.profiles     to authenticated;
grant select, insert          on public.audit_log    to authenticated;
grant select                  on public.document_sequences to authenticated;

revoke all on public.organizations      from anon;
revoke all on public.branches           from anon;
revoke all on public.profiles           from anon;
revoke all on public.audit_log          from anon;
revoke all on public.document_sequences from anon;
