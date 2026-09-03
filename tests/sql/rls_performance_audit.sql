-- BakeFlow — RLS/index performance audit (future-cost regression guard).
--
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/rls_performance_audit.sql
--
-- Read-only (queries pg_policies/pg_indexes catalogs only) -- no BEGIN...ROLLBACK needed,
-- same shape as function_privilege_audit.sql. Both checks print their own zero-row
-- (healthy) or non-empty (finding) result set, then a closing DO block raises if either
-- found anything.
--
-- EXECUTED 2026-09-03 against project tvfyxpafbpnkneujcnvr: both checks return zero rows
-- live today, after the future-cost audit that motivated this file fixed 23 policies
-- (CHECK 1's motivation) and one duplicate index (CHECK 2's motivation) the same day. See
-- IMPLEMENTATION_LOG.md 2026-09-03 for the full findings, including a fully mechanical
-- (select auth.uid()) rewrite of every affected policy (semantically identical, just
-- avoids re-evaluating the function once per row instead of once per query) and the
-- byte-for-byte-identical pair of indexes on audit_log.
--
-- Why this file exists: the Supabase performance advisor (get_advisors) catches both
-- classes live, but nothing in this repo's own test suite did before today -- a future
-- migration could silently reintroduce either without anyone noticing until the advisor
-- (or a slow query in production) caught it. This file is the permanent guard, matching
-- function_privilege_audit.sql's own reasoning for existing.

-- ============================================================================================
-- CHECK 1: no RLS policy should contain a bare (unwrapped) auth.uid()/auth.jwt()/auth.role()
-- call in its USING or WITH CHECK clause. Wrapping the call in (select ...) lets Postgres
-- hoist it into a cached InitPlan (evaluated once per query) instead of re-evaluating it once
-- per row scanned -- pure performance/cost, no behavior change (same single value either way).
-- Detection: strip every already-wrapped "select auth.<fn>()" occurrence out of the
-- qual/with_check text first (case-insensitive, whitespace-flexible), then check whether a
-- bare auth.<fn>() call still remains in what's left. This correctly handles a policy that
-- mixes wrapped and unwrapped calls, unlike a plain "contains auth.uid()" substring check.
-- ============================================================================================
SELECT schemaname, tablename, policyname, cmd,
  'RLS policy has an unwrapped auth.*() call -- wrap it in (select ...) for InitPlan caching' AS finding
FROM pg_policies
WHERE schemaname = 'public'
  AND regexp_replace(
        coalesce(qual, '') || ' ' || coalesce(with_check, ''),
        'select\s+auth\.(uid|jwt|role)\(\)', '', 'gi'
      ) ~* 'auth\.(uid|jwt|role)\(\)'
ORDER BY tablename, policyname;

-- ============================================================================================
-- CHECK 2: no two indexes on the same table should have byte-for-byte identical definitions
-- (modulo the index name itself). A duplicate index is pure write/storage cost -- every
-- INSERT/UPDATE maintains both, with zero read benefit since the planner only ever needs one.
-- ============================================================================================
WITH normalized AS (
  SELECT schemaname, tablename, indexname,
         regexp_replace(indexdef, 'CREATE (UNIQUE )?INDEX \S+ ON', 'CREATE \1INDEX _ ON') AS shape
  FROM pg_indexes
  WHERE schemaname = 'public'
)
SELECT schemaname, tablename, array_agg(indexname ORDER BY indexname) AS duplicate_indexes,
  'two or more indexes on this table are byte-for-byte identical -- drop all but one' AS finding
FROM normalized
GROUP BY schemaname, tablename, shape
HAVING count(*) > 1
ORDER BY tablename;

-- ============================================================================================
-- VERDICT: fail loudly if either check found anything.
-- ============================================================================================
DO $verdict$
DECLARE
  v_check1 integer;
  v_check2 integer;
BEGIN
  SELECT count(*) INTO v_check1
  FROM pg_policies
  WHERE schemaname = 'public'
    AND regexp_replace(
          coalesce(qual, '') || ' ' || coalesce(with_check, ''),
          'select\s+auth\.(uid|jwt|role)\(\)', '', 'gi'
        ) ~* 'auth\.(uid|jwt|role)\(\)';

  WITH normalized AS (
    SELECT tablename,
           regexp_replace(indexdef, 'CREATE (UNIQUE )?INDEX \S+ ON', 'CREATE \1INDEX _ ON') AS shape
    FROM pg_indexes
    WHERE schemaname = 'public'
  )
  SELECT count(*) INTO v_check2
  FROM (
    SELECT tablename, shape FROM normalized GROUP BY tablename, shape HAVING count(*) > 1
  ) t;

  IF v_check1 > 0 OR v_check2 > 0 THEN
    RAISE EXCEPTION 'rls_performance_audit FAILED: % unwrapped-auth-call finding(s), % duplicate-index finding(s) -- see the result sets above',
      v_check1, v_check2;
  END IF;
  RAISE NOTICE 'rls_performance_audit: both checks clean';
END
$verdict$;
