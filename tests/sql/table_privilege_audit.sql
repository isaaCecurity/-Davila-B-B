-- BakeFlow — Table privilege audit.
--
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/table_privilege_audit.sql
--
-- Unlike most tests/sql/*.sql suites, this file makes no data changes (it only reads
-- information_schema/pg_policies catalogs), so it needs no BEGIN...ROLLBACK wrapper. Both
-- checks print their own zero-row (healthy) or non-empty (finding) result set directly,
-- then a closing DO block raises an exception if either found anything -- matching
-- function_privilege_audit.sql's own conventions exactly (this file is that same idea
-- applied to TABLE grants instead of FUNCTION grants).
--
-- Why this file exists: Supabase's default schema privileges auto-grant `authenticated`/
-- sometimes `anon` broad access to every new table unless a migration explicitly revokes
-- it. This exact class of bug has recurred at least three times in this project: full CRUD
-- silently granted on `user_permission_overrides` (migration
-- 20260902090200_revoke_direct_write_grants_user_permission_overrides.sql), a stray `anon`
-- EXECUTE grant on set_supervisor_permission_override(), and nine more instances found
-- during a from-scratch CI database validation pass (see IMPLEMENTATION_LOG.md 2026-09-01).
-- Nothing in this repo's own test suite caught the table-grant version of this pattern
-- before today.
--
-- EXECUTED 2026-09-04 against project tvfyxpafbpnkneujcnvr: CHECK 1 initially found three
-- real (non-exploitable) findings -- authenticated held INSERT/UPDATE on
-- document_sequences/product_stock_levels and INSERT on profiles, none with a matching RLS
-- policy. All three tables have RLS enabled AND forced, so none were ever a live bypass --
-- each table's real write path is a SECURITY DEFINER trigger, which is unaffected by a
-- client-facing grant either way. Fixed via migration
-- revoke_dead_authenticated_grants_no_matching_policy (pure attack-surface reduction, zero
-- behavior change). Both checks return zero rows after that fix.

-- ============================================================================================
-- CHECK 1: no role (anon/authenticated) should hold a table grant for a command that has NO
-- matching RLS policy on that table for that role+command. This deliberately does NOT flag
-- every grant -- a table legitimately needs grants matching its own policies, that's how RLS
-- works (Postgres consults a grant first, then a policy; a policy alone grants nothing). It
-- only flags a grant with zero corresponding policy: either a silent bypass risk (if the table
-- somehow isn't RLS-forced) or dead surface that should be revoked to reduce attack surface.
-- A policy counts as matching if its own `cmd` equals the grant's command (or is 'ALL'), and
-- its `roles` array includes either the exact role or 'public' (a policy created without an
-- explicit `TO` clause defaults to PUBLIC, which applies to every role).
-- ============================================================================================
with grants as (
  select table_name, grantee as role, privilege_type as cmd
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee in ('anon','authenticated')
    and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
),
policies as (
  select tablename as table_name, cmd, unnest(roles)::text as role
  from pg_policies
  where schemaname = 'public'
)
select g.table_name, g.role, g.cmd,
  'this role holds a table grant with no matching RLS policy for the same command -- either a bypass risk or dead surface to revoke' as finding
from grants g
where not exists (
  select 1 from policies p
  where p.table_name = g.table_name
    and p.role in (g.role, 'public')
    and (p.cmd = g.cmd or p.cmd = 'ALL')
)
order by g.table_name, g.role, g.cmd;

-- ============================================================================================
-- CHECK 2: a small, explicit, reviewed allowlist of tables where product intent is "no direct
-- client write of any kind, full stop, even if a future policy would technically satisfy
-- CHECK 1's matching logic". Seeded with user_permission_overrides -- the one documented live
-- incident of this exact shape (writes are RPC-only, via set_supervisor_permission_override()
-- and clear_user_permission_override()). This is deliberately NOT a generic "expected grants
-- per table" config -- that would be exactly the premature abstraction CLAUDE.md warns
-- against, for a problem CHECK 1's generic logic already solves for every other table. This
-- second check exists only for the narrower case CHECK 1 cannot express on its own: a
-- convenience policy added later that would satisfy CHECK 1 but still contradicts a
-- deliberate RPC-only design. Add a table here only after a real, reviewed incident or
-- decision -- not preemptively.
-- ============================================================================================
with known_rpc_only_tables(table_name) as (
  values ('user_permission_overrides')
)
select g.table_name, g.grantee as role, g.privilege_type as cmd,
  'this table is RPC-only by design (see known_rpc_only_tables) but a direct write grant exists' as finding
from information_schema.role_table_grants g
where g.table_schema = 'public'
  and g.grantee in ('anon','authenticated')
  and g.privilege_type in ('INSERT','UPDATE','DELETE')
  and g.table_name in (select table_name from known_rpc_only_tables)
order by g.table_name, g.grantee, g.privilege_type;

-- ============================================================================================
-- VERDICT: fail loudly if either check found anything, matching every other suite's
-- raise-on-failure convention.
-- ============================================================================================
do $verdict$
declare
  v_check1 integer;
  v_check2 integer;
begin
  with grants as (
    select table_name, grantee as role, privilege_type as cmd
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('anon','authenticated')
      and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
  ),
  policies as (
    select tablename as table_name, cmd, unnest(roles)::text as role
    from pg_policies
    where schemaname = 'public'
  )
  select count(*) into v_check1
  from grants g
  where not exists (
    select 1 from policies p
    where p.table_name = g.table_name
      and p.role in (g.role, 'public')
      and (p.cmd = g.cmd or p.cmd = 'ALL')
  );

  with known_rpc_only_tables(table_name) as (
    values ('user_permission_overrides')
  )
  select count(*) into v_check2
  from information_schema.role_table_grants g
  where g.table_schema = 'public'
    and g.grantee in ('anon','authenticated')
    and g.privilege_type in ('INSERT','UPDATE','DELETE')
    and g.table_name in (select table_name from known_rpc_only_tables);

  if v_check1 > 0 or v_check2 > 0 then
    raise exception 'table_privilege_audit FAILED: % unmatched-grant finding(s), % rpc-only-table finding(s) -- see the result sets above',
      v_check1, v_check2;
  end if;
end
$verdict$;
