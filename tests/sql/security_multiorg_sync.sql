-- BakeFlow — multi-organization / offline-sync security suite (S1..S13)
--
-- Proves the security boundaries locked in the multi-organization directive:
-- an operation's organization is immutable and authoritative, a device belongs to
-- a user rather than an organization, and no user can reach another user's data.
--
-- Run against a BRANCH database, never production:
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/security_multiorg_sync.sql
--
-- The whole suite runs inside one transaction and ROLLS BACK, so no fixture
-- survives. It fails loudly: any failing assertion raises and aborts.

\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------- fixtures --
-- U1 is a Driver in Bakery A (Branch A1) and Bakery B (Branch B2).
-- U2 is a Driver in Bakery A (Branch A1) only.
-- Branch A2 exists in Bakery A but neither driver is assigned to it.

INSERT INTO auth.users (id, email) VALUES
  ('11111111-0000-4000-8000-000000000001','u1.multiorg@bakeflow.test'),
  ('22222222-0000-4000-8000-000000000002','u2.orgaonly@bakeflow.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id, name, slug) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001','Test Bakery A','test-bakery-a'),
  ('bbbbbbbb-0000-4000-8000-000000000001','Test Bakery B','test-bakery-b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.branches (id, tenant_id, name, code) VALUES
  ('aaaaaaaa-0000-4000-8000-0000000000a1','aaaaaaaa-0000-4000-8000-000000000001','Branch A1','A1'),
  ('aaaaaaaa-0000-4000-8000-0000000000a2','aaaaaaaa-0000-4000-8000-000000000001','Branch A2','A2'),
  ('bbbbbbbb-0000-4000-8000-0000000000b2','bbbbbbbb-0000-4000-8000-000000000001','Branch B2','B2')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, full_name, status, tenant_id, active_tenant_id) VALUES
  ('11111111-0000-4000-8000-000000000001','U1 MultiOrg','active',
   'aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001'),
  ('22222222-0000-4000-8000-000000000002','U2 OrgAOnly','active',
   'aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001')
ON CONFLICT (id) DO UPDATE
  SET status = 'active', deleted_at = NULL,
      tenant_id = EXCLUDED.tenant_id, active_tenant_id = EXCLUDED.active_tenant_id;

-- Two memberships for one profile: impossible before guard_user_role_integrity()
-- stopped requiring user_roles.tenant_id = profiles.tenant_id.
INSERT INTO public.user_roles (tenant_id, profile_id, role_id, branch_id) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000007','aaaaaaaa-0000-4000-8000-0000000000a1'),
  ('bbbbbbbb-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000007','bbbbbbbb-0000-4000-8000-0000000000b2'),
  ('aaaaaaaa-0000-4000-8000-000000000001','22222222-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000007','aaaaaaaa-0000-4000-8000-0000000000a1')
ON CONFLICT DO NOTHING;

INSERT INTO public.branch_assignments (tenant_id, profile_id, branch_id, is_default) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-0000000000a1',true),
  ('bbbbbbbb-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-0000000000b2',true),
  ('aaaaaaaa-0000-4000-8000-000000000001','22222222-0000-4000-8000-000000000002',
   'aaaaaaaa-0000-4000-8000-0000000000a1',true)
ON CONFLICT (tenant_id, profile_id, branch_id) DO NOTHING;

INSERT INTO public.sync_devices (id, user_id, platform) VALUES
  ('dddddddd-0000-4000-8000-000000000001','11111111-0000-4000-8000-000000000001','android'),
  ('dddddddd-0000-4000-8000-000000000002','22222222-0000-4000-8000-000000000002','android')
ON CONFLICT (id) DO UPDATE SET revoked_at = NULL;

CREATE TEMP TABLE _results(test text, passed boolean, detail text) ON COMMIT DROP;

-- ------------------------------------------------------------ S1..S13 core --
DO $suite$
DECLARE
  U1    uuid := '11111111-0000-4000-8000-000000000001';
  U2    uuid := '22222222-0000-4000-8000-000000000002';
  ORG_A uuid := 'aaaaaaaa-0000-4000-8000-000000000001';
  ORG_B uuid := 'bbbbbbbb-0000-4000-8000-000000000001';
  A1    uuid := 'aaaaaaaa-0000-4000-8000-0000000000a1';
  A2    uuid := 'aaaaaaaa-0000-4000-8000-0000000000a2';
  B2    uuid := 'bbbbbbbb-0000-4000-8000-0000000000b2';
  D1    uuid := 'dddddddd-0000-4000-8000-000000000001';
  D2    uuid := 'dddddddd-0000-4000-8000-000000000002';
  v_res jsonb;
  v_op  uuid;
  v_stored uuid;
  ev    jsonb;
  r     jsonb;
BEGIN
  -- act as U2 (Bakery A only)
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub',U2,'tenant_id',ORG_A,'roles',json_build_array('driver'))::text, true);

  -- S1 -- cross-organization injection
  BEGIN
    v_res := public.process_sync_batch(D2, jsonb_build_array(jsonb_build_object(
      'operation_id', gen_random_uuid(), 'tenant_id', ORG_B, 'branch_id', B2,
      'entity_id', gen_random_uuid(), 'entity_type','tickets','operation_type','CREATE',
      'device_created_at', now()::text, 'payload','{}'::jsonb)));
    INSERT INTO _results VALUES ('S1 cross-org injection blocked', false, 'accepted - MUST NOT HAPPEN');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _results VALUES ('S1 cross-org injection blocked', SQLERRM LIKE '%membership%', SQLERRM);
  END;

  -- S2 -- unauthorized branch inside the actor's own organization
  BEGIN
    v_res := public.process_sync_batch(D2, jsonb_build_array(jsonb_build_object(
      'operation_id', gen_random_uuid(), 'tenant_id', ORG_A, 'branch_id', A2,
      'entity_id', gen_random_uuid(), 'entity_type','tickets','operation_type','CREATE',
      'device_created_at', now()::text, 'payload','{}'::jsonb)));
    INSERT INTO _results VALUES ('S2 unauthorized branch blocked', false, 'accepted - MUST NOT HAPPEN');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _results VALUES ('S2 unauthorized branch blocked', SQLERRM LIKE '%branch%', SQLERRM);
  END;

  -- S3 -- one batch spanning two organizations
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub',U1,'tenant_id',ORG_A,'roles',json_build_array('driver'))::text, true);
  BEGIN
    v_res := public.process_sync_batch(D1, jsonb_build_array(
      jsonb_build_object('operation_id', gen_random_uuid(), 'tenant_id', ORG_A, 'branch_id', A1,
        'entity_id', gen_random_uuid(), 'entity_type','tickets','operation_type','CREATE',
        'device_created_at', now()::text, 'payload','{}'::jsonb),
      jsonb_build_object('operation_id', gen_random_uuid(), 'tenant_id', ORG_B, 'branch_id', B2,
        'entity_id', gen_random_uuid(), 'entity_type','tickets','operation_type','CREATE',
        'device_created_at', now()::text, 'payload','{}'::jsonb)));
    INSERT INTO _results VALUES ('S3 multi-org batch accepted',
      (SELECT count(DISTINCT tenant_id) FROM public.sync_operations WHERE actor_id = U1) = 2,
      v_res::text);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _results VALUES ('S3 multi-org batch accepted', false, SQLERRM);
  END;

  -- S4 -- switching the active organization must not reroute a queued operation
  v_op := gen_random_uuid();
  BEGIN
    v_res := public.process_sync_batch(D1, jsonb_build_array(jsonb_build_object(
      'operation_id', v_op, 'tenant_id', ORG_A, 'branch_id', A1,
      'entity_id', gen_random_uuid(), 'entity_type','tickets','operation_type','CREATE',
      'device_created_at', now()::text, 'payload','{}'::jsonb)));
    PERFORM public.set_active_organization(ORG_B);
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub',U1,'tenant_id',ORG_B,'roles',json_build_array('driver'))::text, true);
    INSERT INTO _results VALUES ('S4 active-org switch does not reroute',
      (SELECT tenant_id FROM public.sync_operations WHERE operation_id = v_op) = ORG_A,
      'stored tenant=' || (SELECT tenant_id FROM public.sync_operations WHERE operation_id = v_op)::text);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _results VALUES ('S4 active-org switch does not reroute', false, SQLERRM);
  END;

  -- S12 -- client-supplied actor_id / received_at must be ignored
  v_op := gen_random_uuid();
  BEGIN
    v_res := public.process_sync_batch(D1, jsonb_build_array(jsonb_build_object(
      'operation_id', v_op, 'tenant_id', ORG_B, 'branch_id', B2,
      'actor_id', U2, 'received_at', '1999-01-01T00:00:00Z',
      'entity_id', gen_random_uuid(), 'entity_type','tickets','operation_type','CREATE',
      'device_created_at', now()::text, 'payload','{}'::jsonb)));
    SELECT actor_id INTO v_stored FROM public.sync_operations WHERE operation_id = v_op;
    INSERT INTO _results VALUES ('S12 actor spoofing ignored', v_stored = U1,
      'stored actor=' || coalesce(v_stored::text,'null'));
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _results VALUES ('S12 actor spoofing ignored', false, SQLERRM);
  END;

  -- S9 -- replay with altered immutable context
  BEGIN
    v_res := public.process_sync_batch(D1, jsonb_build_array(jsonb_build_object(
      'operation_id', v_op, 'tenant_id', ORG_A, 'branch_id', A1,
      'entity_id', gen_random_uuid(), 'entity_type','tickets','operation_type','CREATE',
      'device_created_at', now()::text, 'payload','{}'::jsonb)));
    INSERT INTO _results VALUES ('S9 replay with altered context refused', false, 'accepted - MUST NOT HAPPEN');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _results VALUES ('S9 replay with altered context refused',
      SQLERRM LIKE '%altered immutable context%'
        AND (SELECT tenant_id FROM public.sync_operations WHERE operation_id = v_op) = ORG_B,
      SQLERRM);
  END;

  -- S6 -- revoked device
  UPDATE public.sync_devices SET revoked_at = now() WHERE id = D1;
  BEGIN
    v_res := public.process_sync_batch(D1, jsonb_build_array(jsonb_build_object(
      'operation_id', gen_random_uuid(), 'tenant_id', ORG_B, 'branch_id', B2,
      'entity_id', gen_random_uuid(), 'entity_type','tickets','operation_type','CREATE',
      'device_created_at', now()::text, 'payload','{}'::jsonb)));
    INSERT INTO _results VALUES ('S6 revoked device blocked', false, 'accepted - MUST NOT HAPPEN');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _results VALUES ('S6 revoked device blocked', SQLERRM LIKE '%revoked%', SQLERRM);
  END;
  UPDATE public.sync_devices SET revoked_at = NULL WHERE id = D1;

  -- S11a -- another user's device
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub',U2,'tenant_id',ORG_A,'roles',json_build_array('driver'))::text, true);
  BEGIN
    v_res := public.process_sync_batch(D1, jsonb_build_array(jsonb_build_object(
      'operation_id', gen_random_uuid(), 'tenant_id', ORG_A, 'branch_id', A1,
      'entity_id', gen_random_uuid(), 'entity_type','tickets','operation_type','CREATE',
      'device_created_at', now()::text, 'payload','{}'::jsonb)));
    INSERT INTO _results VALUES ('S11a foreign device rejected', false, 'accepted - MUST NOT HAPPEN');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _results VALUES ('S11a foreign device rejected', SQLERRM LIKE '%not owned%', SQLERRM);
  END;

  -- S5 -- revoking membership in B must not disturb A
  UPDATE public.user_roles SET deleted_at = now() WHERE profile_id = U1 AND tenant_id = ORG_B;
  UPDATE public.profiles SET active_tenant_id = ORG_A WHERE id = U1;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub',U1,'tenant_id',ORG_A,'roles',json_build_array('driver'))::text, true);
  BEGIN
    v_res := public.process_sync_batch(D1, jsonb_build_array(jsonb_build_object(
      'operation_id', gen_random_uuid(), 'tenant_id', ORG_B, 'branch_id', B2,
      'entity_id', gen_random_uuid(), 'entity_type','tickets','operation_type','CREATE',
      'device_created_at', now()::text, 'payload','{}'::jsonb)));
    INSERT INTO _results VALUES ('S5a revoked membership blocks that org', false, 'accepted - MUST NOT HAPPEN');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _results VALUES ('S5a revoked membership blocks that org', SQLERRM LIKE '%membership%', SQLERRM);
  END;

  BEGIN
    v_res := public.process_sync_batch(D1, jsonb_build_array(jsonb_build_object(
      'operation_id', gen_random_uuid(), 'tenant_id', ORG_A, 'branch_id', A1,
      'entity_id', gen_random_uuid(), 'entity_type','tickets','operation_type','CREATE',
      'device_created_at', now()::text, 'payload','{}'::jsonb)));
    INSERT INTO _results VALUES ('S5b surviving org still authorized', true, 'accepted for A');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _results VALUES ('S5b surviving org still authorized', false, SQLERRM);
  END;

  ev := jsonb_build_object('user_id', U1, 'claims', jsonb_build_object('sub', U1));
  r  := public.custom_access_token_hook(ev);
  INSERT INTO _results VALUES ('S5c JWT keeps the still-valid active org A',
    (r -> 'claims' ->> 'tenant_id')::uuid = ORG_A, (r -> 'claims')::text);
  INSERT INTO _results VALUES ('S5c2 JWT roles are active-org only (no union)',
    jsonb_array_length(r -> 'claims' -> 'roles') = 1, (r -> 'claims' -> 'roles')::text);

  -- S5d -- when the ACTIVE organization itself is revoked, mint nothing for it.
  -- Regression guard: jsonb_set() is STRICT, so a NULL tenant once made the whole
  -- hook return NULL instead of a claims object.
  UPDATE public.profiles SET active_tenant_id = ORG_B WHERE id = U1;
  r := public.custom_access_token_hook(ev);
  INSERT INTO _results VALUES ('S5d revoked active org -> null tenant, event still returned',
    r IS NOT NULL
      AND (r -> 'claims' ->> 'tenant_id') IS NULL
      AND jsonb_array_length(r -> 'claims' -> 'roles') = 0,
    coalesce((r -> 'claims')::text, 'HOOK RETURNED NULL'));

  UPDATE public.profiles SET active_tenant_id = ORG_A WHERE id = U1;
  UPDATE public.user_roles SET deleted_at = NULL WHERE profile_id = U1 AND tenant_id = ORG_B;

  -- S10 -- structural guarantees
  INSERT INTO _results VALUES ('S10a sync_devices carries no organization binding',
    NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='sync_devices'
                   AND column_name IN ('tenant_id','branch_id')), 'checked');

  INSERT INTO _results VALUES ('S10b sync path never calls current_tenant_id()',
    NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname='public'
                   AND p.proname IN ('process_sync_batch','process_sync_batch_context_validated',
                                     'sync_validate_device','is_member_of','is_authorized_for_branch')
                   AND pg_get_functiondef(p.oid) ILIKE '%current_tenant_id%'), 'checked');

  -- S11b -- internal helpers must not be client callable
  INSERT INTO _results VALUES ('S11b internal helpers not client executable',
    NOT (has_function_privilege('authenticated','public.is_member_of(uuid,uuid)','EXECUTE')
      OR has_function_privilege('authenticated','public.is_authorized_for_branch(uuid,uuid,uuid)','EXECUTE')
      OR has_function_privilege('anon','public.is_member_of(uuid,uuid)','EXECUTE')
      OR has_function_privilege('authenticated',
           'public.process_sync_batch_context_validated(uuid,jsonb,uuid)','EXECUTE')),
    'authenticated/anon EXECUTE checked');

  -- S13 -- schema invariants
  BEGIN
    PERFORM public.assert_schema_invariants();
    INSERT INTO _results VALUES ('S13 schema invariants clean', true, 'no violations');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _results VALUES ('S13 schema invariants clean', false, SQLERRM);
  END;
END
$suite$;

-- ------------------------------------------------- S7 / S8: RLS visibility --
-- These must run as `authenticated`; as a BYPASSRLS role the policies never apply.
SET LOCAL ROLE authenticated;

SELECT set_config('request.jwt.claims',
  json_build_object('sub','11111111-0000-4000-8000-000000000001',
                    'tenant_id','aaaaaaaa-0000-4000-8000-000000000001',
                    'roles', json_build_array('driver'))::text, true);

INSERT INTO _results
SELECT 'S8 own operations visible across authorized orgs',
       count(DISTINCT tenant_id) = 2
         AND count(*) FILTER (WHERE actor_id <> '11111111-0000-4000-8000-000000000001') = 0,
       'rows=' || count(*) || ' distinct_orgs=' || count(DISTINCT tenant_id)
FROM public.sync_operations;

SELECT set_config('request.jwt.claims',
  json_build_object('sub','22222222-0000-4000-8000-000000000002',
                    'tenant_id','aaaaaaaa-0000-4000-8000-000000000001',
                    'roles', json_build_array('driver'))::text, true);

INSERT INTO _results
SELECT 'S7 cannot read another user''s operations',
       count(*) FILTER (WHERE actor_id = '11111111-0000-4000-8000-000000000001') = 0,
       'visible_rows=' || count(*)
FROM public.sync_operations;

-- §3 escalation guard: a client must not be able to write active_tenant_id.
DO $guard$
DECLARE v_after uuid; v_blocked boolean := false; v_rpc_blocked boolean := false;
BEGIN
  BEGIN
    UPDATE public.profiles SET active_tenant_id = 'bbbbbbbb-0000-4000-8000-000000000001'
     WHERE id = '22222222-0000-4000-8000-000000000002';
    SELECT active_tenant_id INTO v_after FROM public.profiles
     WHERE id = '22222222-0000-4000-8000-000000000002';
    v_blocked := v_after IS DISTINCT FROM 'bbbbbbbb-0000-4000-8000-000000000001'::uuid;
  EXCEPTION WHEN OTHERS THEN v_blocked := true;
  END;

  BEGIN
    PERFORM public.set_active_organization('bbbbbbbb-0000-4000-8000-000000000001');
  EXCEPTION WHEN OTHERS THEN v_rpc_blocked := true;
  END;

  INSERT INTO _results VALUES
    ('G1 direct active_tenant_id write blocked', v_blocked, 'pinned by profiles_update_self'),
    ('G2 set_active_organization rejects non-member org', v_rpc_blocked, 'membership validated');
END
$guard$;

RESET ROLE;

-- ------------------------------------------------------------------ verdict --
SELECT test, passed, left(detail, 100) AS detail FROM _results ORDER BY test;

DO $verdict$
DECLARE v_failed int;
BEGIN
  SELECT count(*) INTO v_failed FROM _results WHERE passed IS DISTINCT FROM true;
  IF v_failed > 0 THEN
    RAISE EXCEPTION 'BakeFlow security suite FAILED: % assertion(s) did not pass', v_failed;
  END IF;
  RAISE NOTICE 'BakeFlow security suite passed: % assertions', (SELECT count(*) FROM _results);
END
$verdict$;

ROLLBACK;
