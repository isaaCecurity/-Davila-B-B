-- BakeFlow — per-supervisor permission override suite (PO1..PO14) — BLOCKER-025
--
-- Proves set_supervisor_permission_override() and the override-aware rewrite of
-- has_permission(): a Branch Manager can raise or lower an individual Supervisor's
-- access to a fixed, safe allowlist of permission keys, an override is isolated to the
-- one profile it targets, clearing an override (p_granted := NULL) reverts to the role
-- default, and every guardrail from the owner's design decisions is enforced server-side
-- rather than left to client discipline:
--   - only Branch Manager may call the RPC (not Owner, not Admin, not the target
--     themselves) — a literal, deliberately narrow decision, see BLOCKERS.md BLOCKER-025
--   - the target profile must currently hold the 'supervisor' role in the caller's tenant
--   - only a fixed allowlist of Supervisor-relevant keys is overridable — in particular
--     tickets.update/tickets.cancel are excluded even though they'd otherwise match a
--     loose "tickets.*" reading, because docs/ROLES-AND-PERMISSIONS.md says those two must
--     never be granted to ANY role, by any mechanism (PO11 is the regression guard)
--
-- STATUS: EXECUTED live against project tvfyxpafbpnkneujcnvr (rolled-back transaction).
--
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/supervisor_permission_overrides.sql
--
-- Same conventions as sales_write_rls.sql: BEGIN...ROLLBACK, every assertion recorded into
-- a temp table rather than raising, verdict block at the end.

BEGIN;

-- ---------------------------------------------------------------- fixtures --
INSERT INTO auth.users (id, email) VALUES
  ('25900000-0000-4000-8000-000000000001','po.owner@bakeflow.test'),
  ('25900000-0000-4000-8000-000000000002','po.manager@bakeflow.test'),
  ('25900000-0000-4000-8000-000000000003','po.supervisor1@bakeflow.test'),
  ('25900000-0000-4000-8000-000000000004','po.supervisor2@bakeflow.test'),
  ('25900000-0000-4000-8000-000000000005','po.cashier@bakeflow.test'),
  ('25900000-0000-4000-8000-000000000006','po.supervisor.orgb@bakeflow.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id, name, slug) VALUES
  ('25000000-0000-4000-8000-0000000000a1','Permission Override Test Bakery A','perm-override-test-a'),
  ('25000000-0000-4000-8000-0000000000b1','Permission Override Test Bakery B','perm-override-test-b');

INSERT INTO public.branches (id, tenant_id, name, code) VALUES
  ('25100000-0000-4000-8000-0000000000a1','25000000-0000-4000-8000-0000000000a1','PO Branch A1','POA1');

INSERT INTO public.profiles (id, full_name, status, tenant_id, active_tenant_id) VALUES
  ('25900000-0000-4000-8000-000000000001','PO Owner','active','25000000-0000-4000-8000-0000000000a1','25000000-0000-4000-8000-0000000000a1'),
  ('25900000-0000-4000-8000-000000000002','PO Manager','active','25000000-0000-4000-8000-0000000000a1','25000000-0000-4000-8000-0000000000a1'),
  ('25900000-0000-4000-8000-000000000003','PO Supervisor1','active','25000000-0000-4000-8000-0000000000a1','25000000-0000-4000-8000-0000000000a1'),
  ('25900000-0000-4000-8000-000000000004','PO Supervisor2','active','25000000-0000-4000-8000-0000000000a1','25000000-0000-4000-8000-0000000000a1'),
  ('25900000-0000-4000-8000-000000000005','PO Cashier','active','25000000-0000-4000-8000-0000000000a1','25000000-0000-4000-8000-0000000000a1'),
  ('25900000-0000-4000-8000-000000000006','PO Supervisor OrgB','active','25000000-0000-4000-8000-0000000000b1','25000000-0000-4000-8000-0000000000b1')
ON CONFLICT (id) DO UPDATE SET status='active', deleted_at=NULL;

INSERT INTO public.user_roles (tenant_id, profile_id, role_id) VALUES
  ('25000000-0000-4000-8000-0000000000a1','25900000-0000-4000-8000-000000000001',(select id from public.roles where key='owner')),
  ('25000000-0000-4000-8000-0000000000a1','25900000-0000-4000-8000-000000000002',(select id from public.roles where key='branch_manager')),
  ('25000000-0000-4000-8000-0000000000a1','25900000-0000-4000-8000-000000000003',(select id from public.roles where key='supervisor')),
  ('25000000-0000-4000-8000-0000000000a1','25900000-0000-4000-8000-000000000004',(select id from public.roles where key='supervisor')),
  ('25000000-0000-4000-8000-0000000000a1','25900000-0000-4000-8000-000000000005',(select id from public.roles where key='cashier')),
  ('25000000-0000-4000-8000-0000000000b1','25900000-0000-4000-8000-000000000006',(select id from public.roles where key='supervisor'))
ON CONFLICT DO NOTHING;

INSERT INTO public.branch_assignments (tenant_id, profile_id, branch_id, is_default) VALUES
  ('25000000-0000-4000-8000-0000000000a1','25900000-0000-4000-8000-000000000003','25100000-0000-4000-8000-0000000000a1',true)
ON CONFLICT DO NOTHING;

CREATE TEMP TABLE _results(test text, passed boolean, detail text);
GRANT ALL ON _results TO authenticated;

-- has_permission() is an internal helper, normally only invoked from inside another
-- SECURITY DEFINER function (which runs with elevated privileges) -- it is never granted
-- to `authenticated` directly in production (verified live: only service_role/postgres
-- hold EXECUTE). This suite calls it directly to assert the override logic in isolation,
-- so it needs a test-scoped grant; rolled back with everything else at the end.
GRANT EXECUTE ON FUNCTION public.has_permission(text, uuid) TO authenticated;

SET LOCAL ROLE authenticated;

-- ---- structural: no direct write grant, writes only via the RPC ----
SELECT set_config('request.jwt.claims',
  json_build_object('sub','25900000-0000-4000-8000-000000000001',
                    'tenant_id','25000000-0000-4000-8000-0000000000a1',
                    'roles', json_build_array('owner'))::text, true);

INSERT INTO _results
SELECT 'PO1 authenticated has no INSERT/UPDATE/DELETE grant on user_permission_overrides',
       count(*) = 0,
       'write grants found = ' || count(*)
FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='user_permission_overrides' AND grantee='authenticated'
  AND privilege_type IN ('INSERT','UPDATE','DELETE');

-- ================================================== main override walk ======
DO $main$
DECLARE
  v_result jsonb;
  v_raised text;
  v_before boolean;
  v_after  boolean;
BEGIN
  -- ---- PO2: supervisor1 has customers.update by role default before any override ----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','25900000-0000-4000-8000-000000000003',
                      'tenant_id','25000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('supervisor'))::text, true);
  SELECT public.has_permission('customers.update', NULL) INTO v_before;
  INSERT INTO _results VALUES ('PO2 supervisor1 has customers.update by role default (baseline)',
    v_before = true, 'has_permission=' || v_before);

  -- ---- branch_manager lowers customers.update for supervisor1 ----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','25900000-0000-4000-8000-000000000002',
                      'tenant_id','25000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('branch_manager'))::text, true);
  v_raised := 'no exception';
  BEGIN
    v_result := public.set_supervisor_permission_override(
      '25900000-0000-4000-8000-000000000003', 'customers.update', false);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('PO3 branch_manager can lower customers.update for supervisor1',
    v_raised = 'no exception', 'raised: ' || left(v_raised, 150));

  -- ---- PO4: supervisor1's effective permission is now false ----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','25900000-0000-4000-8000-000000000003',
                      'tenant_id','25000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('supervisor'))::text, true);
  SELECT public.has_permission('customers.update', NULL) INTO v_after;
  INSERT INTO _results VALUES ('PO4 supervisor1 customers.update is now false after the override',
    v_after = false, 'has_permission=' || v_after);

  -- ---- PO5: supervisor2 (no override) is unaffected — isolation ----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','25900000-0000-4000-8000-000000000004',
                      'tenant_id','25000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('supervisor'))::text, true);
  SELECT public.has_permission('customers.update', NULL) INTO v_after;
  INSERT INTO _results VALUES ('PO5 supervisor2 still has customers.update (override does not leak)',
    v_after = true, 'has_permission=' || v_after);

  -- ---- branch_manager raises financial.audit.confirm for supervisor1 (not a role default) ----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','25900000-0000-4000-8000-000000000002',
                      'tenant_id','25000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('branch_manager'))::text, true);
  v_raised := 'no exception';
  BEGIN
    v_result := public.set_supervisor_permission_override(
      '25900000-0000-4000-8000-000000000003', 'financial.audit.confirm', true);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('PO6 branch_manager can raise financial.audit.confirm for supervisor1',
    v_raised = 'no exception', 'raised: ' || left(v_raised, 150));

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','25900000-0000-4000-8000-000000000003',
                      'tenant_id','25000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('supervisor'))::text, true);
  SELECT public.has_permission('financial.audit.confirm', NULL) INTO v_after;
  INSERT INTO _results VALUES ('PO6b supervisor1 now has financial.audit.confirm (no role grants it by default)',
    v_after = true, 'has_permission=' || v_after);

  -- ---- PO7: clearing the customers.update override reverts to role default ----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','25900000-0000-4000-8000-000000000002',
                      'tenant_id','25000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('branch_manager'))::text, true);
  v_result := public.set_supervisor_permission_override(
    '25900000-0000-4000-8000-000000000003', 'customers.update', NULL);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','25900000-0000-4000-8000-000000000003',
                      'tenant_id','25000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('supervisor'))::text, true);
  SELECT public.has_permission('customers.update', NULL) INTO v_after;
  INSERT INTO _results VALUES ('PO7 clearing the override reverts supervisor1 to the role default (true)',
    v_after = true, 'has_permission=' || v_after);

  -- ---- PO8: a non-branch_manager (cashier) cannot call the RPC at all ----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','25900000-0000-4000-8000-000000000005',
                      'tenant_id','25000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('cashier'))::text, true);
  v_raised := 'no exception';
  BEGIN
    v_result := public.set_supervisor_permission_override(
      '25900000-0000-4000-8000-000000000003', 'customers.update', true);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('PO8 a cashier cannot call set_supervisor_permission_override',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));

  -- ---- PO8b: even the Owner cannot call it — Branch-Manager-only is literal, per decision ----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','25900000-0000-4000-8000-000000000001',
                      'tenant_id','25000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('owner'))::text, true);
  v_raised := 'no exception';
  BEGIN
    v_result := public.set_supervisor_permission_override(
      '25900000-0000-4000-8000-000000000003', 'customers.update', true);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('PO8b even the Owner cannot call set_supervisor_permission_override (Branch-Manager-only, literal)',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));

  -- ---- PO9: target profile must currently hold the supervisor role ----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','25900000-0000-4000-8000-000000000002',
                      'tenant_id','25000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('branch_manager'))::text, true);
  v_raised := 'no exception';
  BEGIN
    v_result := public.set_supervisor_permission_override(
      '25900000-0000-4000-8000-000000000005', 'customers.update', true);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('PO9 refuses a target that does not hold the supervisor role (targeting the cashier)',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));

  -- ---- PO10: permission key outside the allowlist is refused ----
  v_raised := 'no exception';
  BEGIN
    v_result := public.set_supervisor_permission_override(
      '25900000-0000-4000-8000-000000000003', 'staff.manage', true);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('PO10 refuses staff.manage (not in the Supervisor-relevant allowlist)',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));

  -- ---- PO11: tickets.update is refused even though it looks like it should match
  -- "tickets.*" — docs/ROLES-AND-PERMISSIONS.md says this key must never be granted to
  -- ANY role, by any mechanism. This is the specific regression guard for that rule. ----
  v_raised := 'no exception';
  BEGIN
    v_result := public.set_supervisor_permission_override(
      '25900000-0000-4000-8000-000000000003', 'tickets.update', true);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('PO11 refuses tickets.update (never grantable to any role, by design)',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));

  -- ---- PO12: a supervisor in a different tenant is refused, fails closed ----
  v_raised := 'no exception';
  BEGIN
    v_result := public.set_supervisor_permission_override(
      '25900000-0000-4000-8000-000000000006', 'customers.update', true);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('PO12 refuses a cross-tenant target profile (fails closed, not leaked)',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));

  -- ---- PO13: the successful override write produced an audit_log row. audit_log's own
  -- RLS restricts SELECT to owner/admin/accountant (verified live) -- branch_manager, the
  -- actor for every prior step, cannot see it, so switch context first or this silently
  -- reads back zero rows via RLS rather than because nothing was written. ----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','25900000-0000-4000-8000-000000000001',
                      'tenant_id','25000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('owner'))::text, true);
  INSERT INTO _results
  SELECT 'PO13 setting an override writes an audit_log row',
         count(*) >= 1,
         'audit_log rows for user_permission_override in this tenant = ' || count(*)
  FROM public.audit_log
  WHERE tenant_id = '25000000-0000-4000-8000-0000000000a1' AND entity_type = 'user_permission_override';

  -- ---- PO14: has_permission()'s branch check still applies on top of an override —
  -- a target_branch_id supervisor1 is NOT assigned to still fails, even with an active
  -- override granting the permission key itself. ----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','25900000-0000-4000-8000-000000000002',
                      'tenant_id','25000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('branch_manager'))::text, true);
  v_result := public.set_supervisor_permission_override(
    '25900000-0000-4000-8000-000000000003', 'branch.view', true);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','25900000-0000-4000-8000-000000000003',
                      'tenant_id','25000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('supervisor'))::text, true);
  SELECT public.has_permission('branch.view', '25100000-0000-4000-8000-0000000000a1') INTO v_after;
  INSERT INTO _results VALUES ('PO14a override-granted branch.view still passes for supervisor1''s own assigned branch',
    v_after = true, 'has_permission=' || v_after);

  SELECT public.has_permission('branch.view', gen_random_uuid()) INTO v_after;
  INSERT INTO _results VALUES ('PO14b override does not bypass the branch-access check for an unassigned branch',
    v_after = false, 'has_permission=' || v_after);
END
$main$;

RESET ROLE;

-- ------------------------------------------------------------------ verdict --
SELECT test, passed, left(detail, 130) AS detail FROM _results ORDER BY test;

DO $verdict$
DECLARE v_failed text;
BEGIN
  SELECT string_agg(test, ' | ') INTO v_failed
    FROM _results WHERE passed IS DISTINCT FROM true;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'BakeFlow supervisor permission override suite FAILED: %', v_failed;
  END IF;
  RAISE NOTICE 'BakeFlow supervisor permission override suite passed: % assertions',
    (SELECT count(*) FROM _results);
END
$verdict$;

ROLLBACK;
