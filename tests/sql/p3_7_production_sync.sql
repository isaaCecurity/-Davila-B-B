-- BakeFlow — P3.7 PRODUCTION vertical slice: production.start / production.cancel
--
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/p3_7_production_sync.sql
--
-- EXECUTED 2026-08-30 against project tvfyxpafbpnkneujcnvr: 13/13 passed.
--
-- Scope: apply_production_start(), apply_production_cancel(), their dispatch wiring in
-- apply_sync_operation(), their EXECUTE grants, and the guard_production_batch_transition()
-- fix this slice required as a prerequisite (see below). Does NOT re-test
-- process_sync_batch_context_validated()'s generic idempotency/context/conflict machinery --
-- tests/sql/p3_7_protocol_correctness.sql already covers that end to end.
--
-- Live-schema findings that shaped this suite (full detail in IMPLEMENTATION_LOG.md 2026-08-30):
--   - production_batches has a real 5-state machine (scheduled/in_progress/completed/failed/
--     cancelled) enforced by guard_production_batch_transition(), a BEFORE UPDATE trigger.
--     Allowed forward hops: scheduled -> {in_progress, cancelled}; in_progress -> {completed,
--     failed}. completed/failed additionally require a `bakeflow.production_batch_rpc`
--     transaction-local flag (BLOCKER-017's own technique) set only by
--     complete_production_batch()/fail_production_batch() -- a direct UPDATE to either can
--     never succeed, by design, so this slice does not touch those two statuses at all.
--   - A REAL, PRE-EXISTING DEFECT was found and fixed as a prerequisite, live-reproduced
--     before fixing: guard_production_batch_transition()'s own role check used
--     has_role(actors) -- the session JWT's role claim, reflecting the session's *active*
--     organization -- not the row's own tenant_id. Live-reproduced: a session active in org
--     B, holding branch_manager there, could flip an org A batch's status with zero role in
--     org A. This is the exact active-org-assumption bug class AD-006 already fixed for
--     is_authorized_for_branch()/has_role_in() elsewhere; this trigger had never been
--     touched by that fix, and was dormant only because no prior write path could ever
--     produce a mismatched tenant_id -- until this sync slice's explicit-tenant model made
--     it reachable. Fixed by changing the check to
--     has_role_in(auth.uid(), new.tenant_id, actors) -- tenant-correct, and confirmed
--     identical behavior on the existing same-org online path (complete_production_batch()
--     re-tested end to end after the fix, live, unaffected). Migration
--     fix_guard_production_batch_transition_tenant_scoped_role_check.
--   - Both new handlers do their own explicit has_role_in(actor, tenant, roles) check before
--     attempting the UPDATE (defense in depth, and correct regardless of the calling
--     session's active org) -- mirroring guard_production_batch_transition()'s own actors
--     lists verbatim for 'in_progress' (owner/admin/branch_manager/baker) and 'cancelled'
--     (owner/admin/branch_manager, no baker) -- the existing, human-approved rule, not
--     invented for this handler.
--   - production.complete/.record_output/.record_waste are NOT built this pass. AD-021 names
--     all five production.* operations in one line but never specifies record_output/
--     record_waste's payload or relationship to the existing complete_production_batch()/
--     fail_production_batch() RPCs (which combine a status flip with ingredient-consume and
--     product-output stock movements in one call, and themselves use current_tenant_id() --
--     the session's active org -- internally, the same cross-org gap class just fixed in the
--     trigger, but touching a bigger, currently config-untested surface). Building any of the
--     three would mean guessing that relationship rather than reading it from an existing
--     decision. Opened non-blocking **BLOCKER-027** rather than guessed at.
--   - Revision tracking lives entirely in sync_changes (keyed by entity_id), the same generic
--     mechanism customer.update already uses -- no revision column exists on
--     production_batches itself.
--
-- Covers:
--   P1  branch_manager production.start -> APPLIED, status in_progress, revision 1
--   P2  double-start (already in_progress) -> REJECTED, P0001 invalid_transition
--   P3  driver-only (not owner/admin/branch_manager/baker) cannot cancel -> REJECTED, 42501
--   P4  missing batch_id -> REJECTED, 22023 invalid_request
--   P5  nonexistent batch_id -> REJECTED, P0001 (not found)
--   P6  branch_manager production.cancel -> APPLIED, status cancelled
--   P7  baker cannot cancel (cancel's actors exclude baker, unlike start) -> REJECTED, 42501
--   P8  baker CAN start a batch (start's actors include baker) -> APPLIED
--   P9  cross-tenant (actor not a member of the operation's org) -> rejected by the existing
--       generic gateway (is_member_of), before the handler ever runs
--   P10 identical replay (same operation_id) -> replayed=true, does not create a second
--       sync_changes row
--   P11 production.complete (allowlisted, deliberately unbuilt -- BLOCKER-027) -> REJECTED,
--       unsupported_operation_type, exactly like any other not-yet-built entity
--   S1  apply_production_start is not directly executable by anon or authenticated via PostgREST
--   S2  apply_production_cancel is not directly executable by anon or authenticated via PostgREST

begin;

create temp table _results (test text, passed boolean, detail text);
grant all on _results to authenticated;

insert into public.user_roles (tenant_id, profile_id, role_id)
select 'ab000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', id
from public.roles where key in ('driver','branch_manager')
on conflict do nothing;

insert into public.branch_assignments (tenant_id, profile_id, branch_id)
values ('ab000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01')
on conflict do nothing;

insert into public.sync_devices (id, user_id, platform)
values ('f8000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-00000000da01', 'android')
on conflict (id) do update set revoked_at = null;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
  'roles', array['driver','branch_manager']
)::text, true);

-- =================== P1: branch_manager starts the fixture batch ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'production_batches',
      'operation_type', 'EVENT', 'domain_operation', 'production.start',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('batch_id','b3000000-0000-4000-8000-00000000da01')
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('P1 branch_manager production.start -> APPLIED, in_progress, revision 1',
    v_row.status='APPLIED' and (v_row.result->>'status')='in_progress' and (v_row.result->>'revision')='1',
    v_row.status || ' ' || v_row.result::text);
end $$;

-- =================== P2: double-start ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'production_batches',
      'operation_type', 'EVENT', 'domain_operation', 'production.start',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('batch_id','b3000000-0000-4000-8000-00000000da01')
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('P2 double-start (already in_progress) -> REJECTED P0001',
    v_row.status='REJECTED' and v_row.error_code='P0001', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== P4: missing batch_id ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'production_batches',
      'operation_type', 'EVENT', 'domain_operation', 'production.start',
      'device_created_at', now()::text,
      'payload', jsonb_build_object()
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('P4 missing batch_id -> REJECTED 22023',
    v_row.status='REJECTED' and v_row.error_code='22023', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== P5: nonexistent batch_id ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'production_batches',
      'operation_type', 'EVENT', 'domain_operation', 'production.start',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('batch_id','00000000-0000-4000-8000-000000000000')
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('P5 nonexistent batch_id -> REJECTED P0001',
    v_row.status='REJECTED' and v_row.error_code='P0001', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== P6: branch_manager cancels a fresh scheduled batch ===================
do $$
declare v_id uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  insert into public.production_batches (id, tenant_id, branch_id, recipe_id, planned_quantity, status, created_by)
  values (v_id, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
    'b2000000-0000-4000-8000-00000000da01', 5, 'scheduled', 'aa000000-0000-4000-8000-00000000da01');

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'production_batches',
      'operation_type', 'EVENT', 'domain_operation', 'production.cancel',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('batch_id', v_id)
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('P6 branch_manager production.cancel -> APPLIED, cancelled',
    v_row.status='APPLIED' and (v_row.result->>'status')='cancelled', v_row.status||' '||v_row.result::text);
end $$;

-- =================== P3: driver-only cannot cancel ===================
do $$
declare v_id uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  insert into public.production_batches (id, tenant_id, branch_id, recipe_id, planned_quantity, status, created_by)
  values (v_id, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
    'b2000000-0000-4000-8000-00000000da01', 5, 'scheduled', 'aa000000-0000-4000-8000-00000000da01');

  reset role;
  delete from public.user_roles where tenant_id='ab000000-0000-4000-8000-00000000da01' and profile_id='aa000000-0000-4000-8000-00000000da01';
  insert into public.user_roles (tenant_id, profile_id, role_id)
  select 'ab000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', id from public.roles where key='driver';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object(
    'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
    'roles', array['driver']
  )::text, true);

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'production_batches',
      'operation_type', 'EVENT', 'domain_operation', 'production.cancel',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('batch_id', v_id)
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;

  reset role;
  delete from public.user_roles where tenant_id='ab000000-0000-4000-8000-00000000da01' and profile_id='aa000000-0000-4000-8000-00000000da01';
  insert into public.user_roles (tenant_id, profile_id, role_id)
  select 'ab000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', id
  from public.roles where key in ('driver','branch_manager');
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object(
    'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
    'roles', array['driver','branch_manager']
  )::text, true);

  insert into _results values ('P3 driver-only production.cancel -> REJECTED 42501',
    v_row.status='REJECTED' and v_row.error_code='42501', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== P7: baker cannot cancel ===================
do $$
declare v_id uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  insert into public.production_batches (id, tenant_id, branch_id, recipe_id, planned_quantity, status, created_by)
  values (v_id, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
    'b2000000-0000-4000-8000-00000000da01', 5, 'scheduled', 'aa000000-0000-4000-8000-00000000da01');

  reset role;
  delete from public.user_roles where tenant_id='ab000000-0000-4000-8000-00000000da01' and profile_id='aa000000-0000-4000-8000-00000000da01';
  insert into public.user_roles (tenant_id, profile_id, role_id)
  select 'ab000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', id from public.roles where key='baker';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object(
    'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
    'roles', array['baker']
  )::text, true);

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'production_batches',
      'operation_type', 'EVENT', 'domain_operation', 'production.cancel',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('batch_id', v_id)
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;

  reset role;
  delete from public.user_roles where tenant_id='ab000000-0000-4000-8000-00000000da01' and profile_id='aa000000-0000-4000-8000-00000000da01';
  insert into public.user_roles (tenant_id, profile_id, role_id)
  select 'ab000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', id
  from public.roles where key in ('driver','branch_manager');
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object(
    'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
    'roles', array['driver','branch_manager']
  )::text, true);

  insert into _results values ('P7 baker cannot cancel -> REJECTED 42501',
    v_row.status='REJECTED' and v_row.error_code='42501', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== P8: baker CAN start ===================
do $$
declare v_id uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  insert into public.production_batches (id, tenant_id, branch_id, recipe_id, planned_quantity, status, created_by)
  values (v_id, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
    'b2000000-0000-4000-8000-00000000da01', 5, 'scheduled', 'aa000000-0000-4000-8000-00000000da01');

  reset role;
  delete from public.user_roles where tenant_id='ab000000-0000-4000-8000-00000000da01' and profile_id='aa000000-0000-4000-8000-00000000da01';
  insert into public.user_roles (tenant_id, profile_id, role_id)
  select 'ab000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', id from public.roles where key='baker';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object(
    'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
    'roles', array['baker']
  )::text, true);

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'production_batches',
      'operation_type', 'EVENT', 'domain_operation', 'production.start',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('batch_id', v_id)
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;

  reset role;
  delete from public.user_roles where tenant_id='ab000000-0000-4000-8000-00000000da01' and profile_id='aa000000-0000-4000-8000-00000000da01';
  insert into public.user_roles (tenant_id, profile_id, role_id)
  select 'ab000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', id
  from public.roles where key in ('driver','branch_manager');
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object(
    'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
    'roles', array['driver','branch_manager']
  )::text, true);

  insert into _results values ('P8 baker production.start -> APPLIED', v_row.status='APPLIED', v_row.status);
end $$;

-- =================== P9: cross-tenant ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_ok boolean := false; v_msg text;
begin
  begin
    perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da03',
        'branch_id', 'ac000000-0000-4000-8000-00000000da01',
        'entity_id', gen_random_uuid(), 'entity_type', 'production_batches',
        'operation_type', 'EVENT', 'domain_operation', 'production.start',
        'device_created_at', now()::text,
        'payload', jsonb_build_object('batch_id','b3000000-0000-4000-8000-00000000da01')
      )));
  exception when others then
    v_ok := true; v_msg := sqlerrm;
  end;
  insert into _results values ('P9 cross-tenant (org C not member) -> rejected', v_ok, coalesce(v_msg,'no exception raised'));
end $$;

-- =================== P10: identical replay ===================
do $$
declare
  v_id uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_entity uuid := gen_random_uuid();
  v_op jsonb; v_res1 jsonb; v_res2 jsonb; v_count int;
begin
  insert into public.production_batches (id, tenant_id, branch_id, recipe_id, planned_quantity, status, created_by)
  values (v_id, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
    'b2000000-0000-4000-8000-00000000da01', 5, 'scheduled', 'aa000000-0000-4000-8000-00000000da01');

  v_op := jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_entity, 'entity_type', 'production_batches',
      'operation_type', 'EVENT', 'domain_operation', 'production.start',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('batch_id', v_id));

  v_res1 := public.process_sync_batch('f8000000-0000-4000-8000-000000000001', jsonb_build_array(v_op));
  v_res2 := public.process_sync_batch('f8000000-0000-4000-8000-000000000001', jsonb_build_array(v_op));
  select count(*) into v_count from public.sync_changes where entity_id=v_id and domain_operation='production.start';
  insert into _results values ('P10 replay same operation_id -> replayed=true, one sync_changes row',
    (v_res2->'results'->0->>'replayed')='true' and v_count=1, format('%s | count=%s', v_res2, v_count));
end $$;

-- =================== P11: production.complete (allowlisted, deliberately unbuilt) ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'production_batches',
      'operation_type', 'EVENT', 'domain_operation', 'production.complete',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('batch_id','b3000000-0000-4000-8000-00000000da01')
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('P11 production.complete (unbuilt) -> REJECTED unsupported_operation_type',
    v_row.status='REJECTED' and v_row.error_code='unsupported_operation_type', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== S1/S2: internal handlers not directly executable ===================
do $$
begin
  insert into _results values ('S1 apply_production_start not directly executable by anon/authenticated',
    not has_function_privilege('authenticated', 'public.apply_production_start(public.sync_operations)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.apply_production_start(public.sync_operations)', 'EXECUTE'), '');
  insert into _results values ('S2 apply_production_cancel not directly executable by anon/authenticated',
    not has_function_privilege('authenticated', 'public.apply_production_cancel(public.sync_operations)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.apply_production_cancel(public.sync_operations)', 'EXECUTE'), '');
end $$;

reset role;

select test, passed, left(detail, 250) as detail from _results order by test;

do $verdict$
declare v_failures integer;
begin
  select count(*) into v_failures from _results where passed is distinct from true;
  if v_failures > 0 then
    raise exception '% assertion(s) failed -- see the row-by-row output above', v_failures;
  end if;
end
$verdict$;

rollback;
