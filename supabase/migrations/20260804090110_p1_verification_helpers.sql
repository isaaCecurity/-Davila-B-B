-- =============================================================================
-- BakeFlow — Phase 1b: Schema invariant verification functions
-- =============================================================================
-- Implements the standing checks from docs/TESTING-STRATEGY.md §3 and §4 as
-- callable functions rather than as scripts run by hand.
--
-- Every later phase migration ends with `perform public.assert_schema_invariants()`,
-- so a phase that introduces a table without RLS, a money column that is not
-- NUMERIC(19,4), or a nullable tenant_id fails at apply time and rolls back.
-- A broken invariant can therefore never reach the database in the first place.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. RLS coverage — TESTING-STRATEGY.md §3
-- -----------------------------------------------------------------------------
-- "This query must return zero rows. It is the single most valuable test in the
-- suite." Extended to also require FORCE (RLS-POLICY-PATTERNS.md §1.2) and at
-- least one policy, so a table cannot be added without policies.
create or replace function public.verify_rls_coverage()
returns table (table_name text, problem text)
language sql
stable
security definer
set search_path = public
as $$
  select c.relname::text,
         case
           when not c.relrowsecurity      then 'RLS not enabled'
           when not c.relforcerowsecurity then 'RLS not forced (table owner is exempt)'
           else 'no policies defined (deny-all, almost certainly unintended)'
         end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and (
      not c.relrowsecurity
      or not c.relforcerowsecurity
      or not exists (select 1 from pg_policy p where p.polrelid = c.oid)
    );
$$;

comment on function public.verify_rls_coverage() is
  'Returns every public table missing RLS, FORCE RLS, or policies. Must always return zero rows.';


-- -----------------------------------------------------------------------------
-- 2. Money type enforcement — TESTING-STRATEGY.md §4
-- -----------------------------------------------------------------------------
-- Catches any float or NUMERIC(18,2) slipping back in. CLAUDE.md rule 5.
create or replace function public.verify_money_columns()
returns table (table_name text, column_name text, actual_type text)
language sql
stable
security definer
set search_path = public
as $$
  select c.table_name::text,
         c.column_name::text,
         c.data_type || coalesce('(' || c.numeric_precision || ',' || c.numeric_scale || ')', '')
  from information_schema.columns c
  join pg_class     pc on pc.relname = c.table_name
  join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
  where c.table_schema = 'public'
    and pc.relkind = 'r'
    and (c.column_name like '%amount%' or c.column_name like '%price%'
         or c.column_name like '%total%' or c.column_name like '%cost%'
         or c.column_name like '%float%')
    and (c.data_type <> 'numeric' or c.numeric_precision <> 19 or c.numeric_scale <> 4);
$$;

comment on function public.verify_money_columns() is
  'Returns every monetary column that is not NUMERIC(19,4). Must always return zero rows.';


-- -----------------------------------------------------------------------------
-- 3. Quantity type enforcement — CLAUDE.md rule 5
-- -----------------------------------------------------------------------------
create or replace function public.verify_quantity_columns()
returns table (table_name text, column_name text, actual_type text)
language sql
stable
security definer
set search_path = public
as $$
  select c.table_name::text,
         c.column_name::text,
         c.data_type || coalesce('(' || c.numeric_precision || ',' || c.numeric_scale || ')', '')
  from information_schema.columns c
  join pg_class     pc on pc.relname = c.table_name
  join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
  where c.table_schema = 'public'
    and pc.relkind = 'r'
    and c.column_name like '%quantity%'
    and (c.data_type <> 'numeric' or c.numeric_precision <> 18 or c.numeric_scale <> 4);
$$;

comment on function public.verify_quantity_columns() is
  'Returns every physical-quantity column that is not NUMERIC(18,4). Must always return zero rows.';


-- -----------------------------------------------------------------------------
-- 4. Tenant column enforcement — CLAUDE.md rules 1 and 2
-- -----------------------------------------------------------------------------
-- Every tenant_id must be a NOT NULL uuid referencing organizations(id).
-- public.profiles is the one documented exception (SCHEMA-REFERENCE.md §1): a
-- user exists between signing up and joining an organization.
create or replace function public.verify_tenant_columns()
returns table (table_name text, problem text)
language sql
stable
security definer
set search_path = public
as $$
  -- Wrong type, or nullable where it must not be.
  select c.table_name::text,
         case when c.data_type <> 'uuid' then 'tenant_id is ' || c.data_type
              else 'tenant_id is nullable' end
  from information_schema.columns c
  join pg_class     pc on pc.relname = c.table_name
  join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
  where c.table_schema = 'public'
    and pc.relkind = 'r'
    and c.column_name = 'tenant_id'
    and c.table_name <> 'profiles'
    and (c.data_type <> 'uuid' or c.is_nullable = 'YES')

  union all

  -- Missing the foreign key to the tenant root.
  select c.table_name::text, 'tenant_id has no FK to organizations(id)'
  from information_schema.columns c
  join pg_class     pc on pc.relname = c.table_name
  join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
  where c.table_schema = 'public'
    and pc.relkind = 'r'
    and c.column_name = 'tenant_id'
    and not exists (
      select 1
      from pg_constraint con
      join pg_class ref on ref.oid = con.confrelid
      where con.conrelid = pc.oid
        and con.contype = 'f'
        and ref.relname = 'organizations'
        and (
          select array_agg(a.attname::text order by a.attname)
          from unnest(con.conkey) k
          join pg_attribute a on a.attrelid = pc.oid and a.attnum = k
        ) @> array['tenant_id']::text[]
    )

  union all

  -- Superseded tenant column names must never reappear (CLAUDE.md rule 2).
  select c.table_name::text, 'superseded tenant column: ' || c.column_name
  from information_schema.columns c
  join pg_class     pc on pc.relname = c.table_name
  join pg_namespace pn on pn.oid = pc.relnamespace and pn.nspname = 'public'
  where c.table_schema = 'public'
    and pc.relkind = 'r'
    and c.column_name in ('organization_id', 'bakery_id', 'company_id');
$$;

comment on function public.verify_tenant_columns() is
  'Returns tables whose tenant scoping deviates from CLAUDE.md rules 1-2. Must always return zero rows.';


-- -----------------------------------------------------------------------------
-- 5. The combined gate
-- -----------------------------------------------------------------------------
create or replace function public.assert_schema_invariants()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_problems text := '';
  r          record;
begin
  for r in select table_name, problem from public.verify_rls_coverage() loop
    v_problems := v_problems || format(E'\n  [RLS] %s: %s', r.table_name, r.problem);
  end loop;

  for r in select table_name, column_name, actual_type from public.verify_money_columns() loop
    v_problems := v_problems || format(E'\n  [MONEY] %s.%s is %s, must be numeric(19,4)',
                                       r.table_name, r.column_name, r.actual_type);
  end loop;

  for r in select table_name, column_name, actual_type from public.verify_quantity_columns() loop
    v_problems := v_problems || format(E'\n  [QUANTITY] %s.%s is %s, must be numeric(18,4)',
                                       r.table_name, r.column_name, r.actual_type);
  end loop;

  for r in select table_name, problem from public.verify_tenant_columns() loop
    v_problems := v_problems || format(E'\n  [TENANT] %s: %s', r.table_name, r.problem);
  end loop;

  if v_problems <> '' then
    raise exception 'schema invariant violations:%', v_problems
      using errcode = 'P0001',
            detail = json_build_object('code', 'schema_invariant_violation')::text;
  end if;
end $$;

comment on function public.assert_schema_invariants() is
  'Raises if any schema invariant from CLAUDE.md or TESTING-STRATEGY.md is violated. Called at the end of every phase migration, so a bad phase rolls back rather than landing.';

grant execute on function public.verify_rls_coverage()      to authenticated;
grant execute on function public.verify_money_columns()     to authenticated;
grant execute on function public.verify_quantity_columns()  to authenticated;
grant execute on function public.verify_tenant_columns()    to authenticated;
grant execute on function public.assert_schema_invariants() to authenticated;


-- -----------------------------------------------------------------------------
-- 6. Gate phase 1 retroactively
-- -----------------------------------------------------------------------------
do $$
begin
  perform public.assert_schema_invariants();
  raise notice 'BakeFlow phase 1: schema invariants OK';
end $$;
