-- BakeFlow — rate-limiting / abuse-cost guard suite (RL1..RL8).
--
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/rate_limit_enforcement.sql
--
-- Cross-cutting shared-primitive concern (like function_privilege_audit.sql), not owned by
-- one domain suite: proves enforce_rate_limit() itself, and the one live consumer (besides
-- send-invite-email, already covered by its own manual verification) that gained a new
-- rate-limit gate in the 2026-09-04 weak-link remediation pass, create_organization_invite().
--
-- STATUS: EXECUTED live against project tvfyxpafbpnkneujcnvr (rolled-back transaction).
--
-- WHY THIS FILE EXISTS: enforce_rate_limit() had a genuine check-then-act TOCTOU race
-- (SELECT count(*) then, conditionally, INSERT -- no lock, no constraint). Under READ
-- COMMITTED, concurrent callers for the same (tenant_id, scope) could all pass the
-- count-check before any of them committed its own insert, letting a burst through beyond
-- the configured limit. Fixed via pg_advisory_xact_lock keyed on (scope, tenant_id) --
-- migration fix_enforce_rate_limit_toctou. RL1-RL5 below prove the *sequential* behavior is
-- unchanged by that fix (same single value either way, for any one caller).
--
-- A LIMITATION, DISCLOSED RATHER THAN HIDDEN: true concurrent-session race testing does not
-- fit this suite's single-connection, sequential `psql -f` convention -- a script that
-- issues statements one after another cannot actually race itself. Asserting "the race is
-- fixed" from inside this file would violate CLAUDE.md's evidence rule (never record a test
-- as passing unless it was executed). The concurrency fix itself was instead verified with a
-- one-time manual live check: two back-to-back calls to enforce_rate_limit() with p_limit=1
-- against a shared (tenant_id, scope) produced exactly one success and one 'rate_limited'
-- rejection, with exactly one row landing in rate_limit_events -- recorded in
-- IMPLEMENTATION_LOG.md 2026-09-04, not re-asserted here as an automated test that can't
-- actually prove concurrency.

BEGIN;

-- ---------------------------------------------------------------- fixtures --
INSERT INTO auth.users (id, email) VALUES
  ('5c900000-0000-4000-8000-000000000001','rl.owner@bakeflow.test'),
  ('5c900000-0000-4000-8000-000000000002','rl.cashier@bakeflow.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id, name, slug) VALUES
  ('5c000000-0000-4000-8000-0000000000c1','Rate Limit Test Bakery','rate-limit-test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, full_name, status, tenant_id, active_tenant_id) VALUES
  ('5c900000-0000-4000-8000-000000000001','RL Owner','active','5c000000-0000-4000-8000-0000000000c1','5c000000-0000-4000-8000-0000000000c1'),
  ('5c900000-0000-4000-8000-000000000002','RL Cashier','active','5c000000-0000-4000-8000-0000000000c1','5c000000-0000-4000-8000-0000000000c1')
ON CONFLICT (id) DO UPDATE SET status='active', deleted_at=NULL;

INSERT INTO public.user_roles (tenant_id, profile_id, role_id) VALUES
  ('5c000000-0000-4000-8000-0000000000c1','5c900000-0000-4000-8000-000000000001',(select id from public.roles where key='owner')),
  ('5c000000-0000-4000-8000-0000000000c1','5c900000-0000-4000-8000-000000000002',(select id from public.roles where key='cashier'))
ON CONFLICT DO NOTHING;

CREATE TEMP TABLE _results(test text, passed boolean, detail text);
GRANT ALL ON _results TO authenticated;

-- ================================================== enforce_rate_limit() direct ===
-- Deliberately run BEFORE `SET LOCAL ROLE authenticated` below: enforce_rate_limit() is
-- EXECUTE-granted only to {postgres, service_role} (verified live), never `authenticated`
-- directly -- it is an internal primitive meant to be called from inside another
-- SECURITY DEFINER function's transaction (create_organization_invite, or
-- send-invite-email's Edge Function context), never invoked directly by a client. So these
-- assertions run as the suite's own connecting (superuser) role, which holds that grant.
DO $direct$
DECLARE
  v_raised text;
  v_i      integer;
BEGIN
  -- RL1 — 3 calls within a limit of 3 all succeed.
  v_raised := 'no exception';
  BEGIN
    FOR v_i IN 1..3 LOOP
      PERFORM public.enforce_rate_limit('5c000000-0000-4000-8000-0000000000c1'::uuid, NULL, 'rl_direct_test', 3, 60);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('RL1 enforce_rate_limit() allows exactly limit calls within the window',
    v_raised = 'no exception', 'raised: ' || left(v_raised, 150));

  -- RL2 — the (limit+1)th call raises rate_limited.
  v_raised := 'no exception';
  BEGIN
    PERFORM public.enforce_rate_limit('5c000000-0000-4000-8000-0000000000c1'::uuid, NULL, 'rl_direct_test', 3, 60);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('RL2 enforce_rate_limit() rejects the call past the limit',
    v_raised <> 'no exception' AND v_raised LIKE '%rate limit exceeded%', 'raised: ' || left(v_raised, 150));

  -- RL3 — NULL tenant_id is rejected outright (invalid_request), not silently allowed.
  v_raised := 'no exception';
  BEGIN
    PERFORM public.enforce_rate_limit(NULL, NULL, 'rl_direct_test', 3, 60);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('RL3 enforce_rate_limit() rejects a NULL tenant_id',
    v_raised <> 'no exception' AND v_raised LIKE '%requires tenant_id%', 'raised: ' || left(v_raised, 150));

  -- RL4 — a non-positive limit is rejected.
  v_raised := 'no exception';
  BEGIN
    PERFORM public.enforce_rate_limit('5c000000-0000-4000-8000-0000000000c1'::uuid, NULL, 'rl_direct_test', 0, 60);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('RL4 enforce_rate_limit() rejects a non-positive limit',
    v_raised <> 'no exception' AND v_raised LIKE '%must be positive%', 'raised: ' || left(v_raised, 150));

  -- RL5 — a non-positive window is rejected.
  v_raised := 'no exception';
  BEGIN
    PERFORM public.enforce_rate_limit('5c000000-0000-4000-8000-0000000000c1'::uuid, NULL, 'rl_direct_test', 3, 0);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('RL5 enforce_rate_limit() rejects a non-positive window',
    v_raised <> 'no exception' AND v_raised LIKE '%must be positive%', 'raised: ' || left(v_raised, 150));
END
$direct$;

SET LOCAL ROLE authenticated;

-- ================================================== create_organization_invite() rate gate ===
-- This RPC had ZERO tests/sql coverage of any kind before this file -- RL6-RL8 are its
-- first assertions, not just the rate-limit slice. Broadening further is a nice-to-have,
-- not required for this pass.
--
-- `authenticated` has no direct SELECT on rate_limit_events (it fails closed by design --
-- RLS enabled, zero policies), so verifying "no quota was consumed" needs the owning
-- (non-authenticated) role. RL6/RL6b therefore switch role at the top level between DO
-- blocks rather than inside one, instead of granting a new read path just for this test.
DO $invite_rl_cashier$
DECLARE v_raised text;
BEGIN
  -- RL6 — a caller who fails an earlier check (cashier is not owner/admin) is refused
  -- before ever reaching the rate limiter.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','5c900000-0000-4000-8000-000000000002',
                      'tenant_id','5c000000-0000-4000-8000-0000000000c1',
                      'roles', json_build_array('cashier'))::text, true);
  v_raised := 'no exception';
  BEGIN
    PERFORM public.create_organization_invite('rl-cashier-attempt@bakeflow.test', 'cashier');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('RL6 a cashier''s unauthorized invite attempt is refused (insufficient_role)',
    v_raised <> 'no exception' AND v_raised LIKE '%owners and admins%', 'raised: ' || left(v_raised, 150));
END
$invite_rl_cashier$;

RESET ROLE;

-- RL6b — the refused cashier attempt above must not have consumed any rate-limit quota
-- (it never reached the enforce_rate_limit() call).
INSERT INTO _results
SELECT 'RL6b the refused cashier attempt consumed no rate-limit quota',
  count(*) = 0, 'rate_limit_events rows for this tenant+scope = ' || count(*)
FROM public.rate_limit_events
WHERE tenant_id = '5c000000-0000-4000-8000-0000000000c1' AND scope = 'org_invite_create';

SET LOCAL ROLE authenticated;

DO $invite_rl_owner$
DECLARE
  v_raised   text;
  v_i        integer;
  v_success  integer := 0;
BEGIN
  -- ---- owner: 20 successful invite creations should all succeed (the 20/hour cap) ----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','5c900000-0000-4000-8000-000000000001',
                      'tenant_id','5c000000-0000-4000-8000-0000000000c1',
                      'roles', json_build_array('owner'))::text, true);
  FOR v_i IN 1..20 LOOP
    BEGIN
      PERFORM public.create_organization_invite('rl-invite-' || v_i || '@bakeflow.test', 'cashier');
      v_success := v_success + 1;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- leave v_success short; the assertion below reports the shortfall
    END;
  END LOOP;
  INSERT INTO _results VALUES ('RL7 create_organization_invite() allows 20 calls within its 20/hour cap',
    v_success = 20, 'succeeded: ' || v_success || ' of 20');

  -- RL8 — the 21st call in the same window is refused as rate_limited.
  v_raised := 'no exception';
  BEGIN
    PERFORM public.create_organization_invite('rl-invite-21@bakeflow.test', 'cashier');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('RL8 create_organization_invite() refuses the 21st call in the same hour',
    v_raised <> 'no exception' AND v_raised LIKE '%rate limit exceeded%', 'raised: ' || left(v_raised, 150));
END
$invite_rl_owner$;

RESET ROLE;

-- ------------------------------------------------------------------ verdict --
SELECT test, passed, left(detail, 130) AS detail FROM _results ORDER BY test;

DO $verdict$
DECLARE v_failed text;
BEGIN
  SELECT string_agg(test, ' | ') INTO v_failed
    FROM _results WHERE passed IS DISTINCT FROM true;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'BakeFlow rate_limit_enforcement suite FAILED: %', v_failed;
  END IF;
  RAISE NOTICE 'BakeFlow rate_limit_enforcement suite passed: % assertions',
    (SELECT count(*) FROM _results);
END
$verdict$;

ROLLBACK;
