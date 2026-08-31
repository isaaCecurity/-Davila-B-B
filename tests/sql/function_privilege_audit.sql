-- BakeFlow — Function privilege audit.
--
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/function_privilege_audit.sql
--
-- Unlike the other tests/sql/*.sql suites, this file makes no data changes (it only reads
-- pg_proc/pg_namespace catalogs), so it needs no BEGIN...ROLLBACK wrapper. Both checks below
-- print their own zero-row (healthy) or non-empty (finding) result set directly, then a closing
-- DO block raises an exception if either found anything — so a plain psql run fails loudly under
-- ON_ERROR_STOP=1 instead of requiring a human to notice an empty vs. non-empty SELECT.
--
-- EXECUTED 2026-08-31 against project tvfyxpafbpnkneujcnvr: both queries returned zero rows
-- live, after two real findings this same file exists to prevent were found and fixed earlier
-- the same day (see IMPLEMENTATION_LOG.md 2026-08-31, both entries).
--
-- Why this file exists: TESTING-STRATEGY.md §3 already has "the single most valuable test in
-- the suite" — a query asserting every public table has RLS enabled AND has policies, because a
-- new table can otherwise ship with a silent hole. This file is that same idea applied to
-- FUNCTION privileges instead of TABLE policies, motivated by two real, live findings the same
-- day this file was written:
--
--   1. Adding a parameter to complete_production_batch()/fail_production_batch() via CREATE OR
--      REPLACE silently created a new function overload (Postgres dispatches by argument list),
--      which inherited Postgres/Supabase's default PUBLIC EXECUTE grant rather than the
--      original overload's REVOKE — leaving it `anon`-executable. Since the only role check on
--      the path (a trigger) is unconditionally skipped when auth.uid() IS NULL (true for
--      `anon`), this meant a fully unauthenticated caller could complete or fail ANY tenant's
--      production batch. Confirmed live: zero rows touched during the window (unexploited).
--   2. Independently, 9 pre-existing SECURITY DEFINER functions (record_payment,
--      get_daily_revenue_summary, and the driver-trip lifecycle RPCs) plus 2 trigger functions
--      were found to be `anon`-executable via the same "never explicitly revoked from PUBLIC"
--      root cause, dating from whenever each was first created. None were actually exploitable
--      (each either explicitly checks has_role()/current_tenant_id() IS NULL, or implicitly
--      fails closed because a NULL-tenant lookup matches zero rows) — but none had any reason to
--      be `anon`-executable either, since BakeFlow has no unauthenticated feature at all.
--
-- Both were fixed the same day via REVOKE ALL ... FROM PUBLIC (not just `anon` — an
-- anon-specific REVOKE was tried first for finding 2 and confirmed NOT to work, since the
-- privilege was inherited through PUBLIC, not granted to `anon` directly) plus an explicit
-- re-GRANT to `authenticated` where legitimate. This file automates the check that would have
-- caught both, so a future migration cannot silently reintroduce either class of mistake.
--
-- Both queries below are written to return ZERO ROWS on a healthy schema. Any row returned is a
-- real, actionable finding — either revoke the excess grant, or (if the anon-facing function
-- really is meant to be public) add it to the KNOWN_PUBLIC allowlist below with a comment
-- explaining why, so this file keeps failing loudly for anything not deliberately reviewed.

-- ============================================================================================
-- CHECK 1: no SECURITY DEFINER function in public should be anon-executable, except an
-- explicit, reviewed allowlist. Update KNOWN_PUBLIC_FUNCTIONS below (not the query) if a new
-- function is deliberately meant to be callable without signing in.
-- ============================================================================================
with known_public_functions(proname) as (
  values
  -- (none today — BakeFlow has no unauthenticated-caller feature. Add rows here, each with a
  -- comment explaining the product reason, if that ever changes.)
  (null::text)
)
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
  'anon can EXECUTE this SECURITY DEFINER function and it is not on the KNOWN_PUBLIC allowlist' as finding
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and has_function_privilege('anon', p.oid, 'EXECUTE')
  and p.proname not in (select proname from known_public_functions where proname is not null)
order by p.proname;

-- ============================================================================================
-- CHECK 2: no function name should have sibling overloads with mismatched anon/authenticated
-- EXECUTE privilege, except an explicit, reviewed allowlist. A legitimate reason for two
-- overloads to exist (e.g. an internal, explicit-tenant variant alongside a public,
-- session-scoped one) is not a legitimate reason for them to have different grants BY ACCIDENT
-- — this is exactly finding 1 above: a new overload silently inheriting a different privilege
-- than its sibling because nothing revoked it explicitly.
--
-- complete_production_batch/fail_production_batch are on the allowlist below DELIBERATELY, not
-- as an oversight: each now has two overloads on purpose — the original 4-arg RPC, granted to
-- `authenticated` for the live "complete this batch" UI flow, and a 5-arg explicit-tenant
-- variant used only internally by the P3.7 sync handlers, REVOKE'd from everyone (callable only
-- because SECURITY DEFINER functions execute as their owner). That mismatch is the fix, not the
-- bug it once was — see IMPLEMENTATION_LOG.md 2026-08-31. Any OTHER function appearing below is
-- a real finding.
-- ============================================================================================
with known_intentional_mismatches(proname) as (
  values ('complete_production_batch'), ('fail_production_batch')
),
fn as (
  select p.oid, p.proname,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
)
select proname, count(*) as overload_count,
  bool_or(anon_exec) as any_anon_exec, bool_and(anon_exec) as all_anon_exec,
  bool_or(auth_exec) as any_auth_exec, bool_and(auth_exec) as all_auth_exec,
  'sibling overloads of this function have different anon/authenticated EXECUTE privilege' as finding
from fn
where proname not in (select proname from known_intentional_mismatches)
group by proname
having count(*) > 1
  and (bool_or(anon_exec) <> bool_and(anon_exec) or bool_or(auth_exec) <> bool_and(auth_exec))
order by proname;

-- ============================================================================================
-- VERDICT: fail loudly if either check above found anything, matching every other suite's
-- raise-on-failure convention.
-- ============================================================================================
do $verdict$
declare
  v_check1 integer;
  v_check2 integer;
begin
  select count(*) into v_check1
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE')
    and p.proname not in (
      -- keep this list identical to CHECK 1's known_public_functions above
      select proname from (values (null::text)) as t(proname) where proname is not null
    );

  with fn as (
    select p.oid, p.proname,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  )
  select count(*) into v_check2
  from (
    select proname
    from fn
    where proname not in ('complete_production_batch', 'fail_production_batch')
    group by proname
    having count(*) > 1
      and (bool_or(anon_exec) <> bool_and(anon_exec) or bool_or(auth_exec) <> bool_and(auth_exec))
  ) t;

  if v_check1 > 0 or v_check2 > 0 then
    raise exception 'function_privilege_audit FAILED: % anon-executable finding(s), % mismatched-overload finding(s) -- see the result sets above',
      v_check1, v_check2;
  end if;
end
$verdict$;
