-- BakeFlow — P3.7 PRODUCTION vertical slice, continued: production.record_output /
-- production.record_waste, plus the allowlist tightening this pass required.
--
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/p3_7_production_output_waste_sync.sql
--
-- EXECUTED 2026-08-31 against project tvfyxpafbpnkneujcnvr: all assertions below passed live
-- (run as several iterative dry-run batches inside BEGIN...ROLLBACK, zero rows left behind;
-- consolidated into this single file afterward). S3-S6 added and independently re-verified
-- live the same day, after a self-review caught a real vulnerability this pass introduced and
-- then fixed -- see the note above S3/S4 below and IMPLEMENTATION_LOG.md 2026-08-31 "SECURITY
-- FIX" entry.
--
-- Resolves BLOCKER-027 (production.complete/.record_output/.record_waste) and finishes off
-- BLOCKER-026 (inventory.receive/.transfer/.consume) per explicit product decisions this pass
-- (see IMPLEMENTATION_LOG.md 2026-08-31 for the full decision trail):
--   - inventory.receive/.transfer/.consume: out of MVP scope entirely (no stock purchasing/
--     receiving, no generic manual warehouse transfer, no standalone consume beyond what
--     inventory.adjust/.waste already cover) -- removed from the domain_operation allowlist,
--     not left "allowlisted but unbuilt".
--   - production.complete/.record_output/.record_waste: confirmed live that
--     complete_production_batch()/fail_production_batch() already take per-ingredient actual/
--     waste quantities in ONE call, and production_batches has only a single actual_quantity/
--     completed_at column -- no schema support anywhere for multiple partial output/waste
--     events per batch. So .record_output/.record_waste ARE complete_production_batch()/
--     fail_production_batch(), just the sync-facing names -- production.complete is
--     redundant and removed from the allowlist.
--
-- Migrations this pass:
--   1. p3_7_allowlist_tighten_receive_transfer_consume_complete -- drops inventory.receive,
--      inventory.transfer, inventory.consume, production.complete from both
--      sync_operations_domain_operation_check and sync_changes_domain_operation_check. Verified
--      live, pre-migration, that zero existing rows used any of the four dropped values, so
--      nothing was orphaned.
--   2. p3_7_production_record_output_waste_handlers --
--      (a) AD-006 fix: complete_production_batch()/fail_production_batch() previously resolved
--          their own tenant via current_tenant_id() (the session's *active* org). For a
--          genuinely cross-org sync operation this doesn't cause a false-accept (the row's own
--          tenant_id still gates guard_production_batch_transition()'s role check, and the
--          batch lookup itself is tenant-filtered) -- it causes a false NEGATIVE: the lookup
--          "WHERE tenant_id = v_tenant" silently uses the wrong org and returns "batch not
--          found" for a legitimately authorized cross-org actor. Added an additive,
--          backward-compatible p_tenant_id uuid DEFAULT NULL parameter to both RPCs; existing
--          non-sync callers are completely unaffected (default still resolves via
--          current_tenant_id()).
--      (b) apply_production_record_output()/apply_production_record_waste(): thin sync
--          wrappers. Each validates payload shape, looks up the batch (tenant-scoped),
--          confirms the batch's own branch_id matches the operation's authorized branch (the
--          same consistency-guard shape apply_production_start/.cancel/apply_inventory_adjust
--          already use), checks has_role_in(actor, tenant, ['owner','admin','branch_manager',
--          'baker']) -- mirroring guard_production_batch_transition()'s own 'completed'/
--          'failed' actors verbatim, which are identical to each other and to 'in_progress' --
--          then delegates entirely to complete_production_batch()/fail_production_batch()
--          (passing p_operation.tenant_id explicitly) rather than duplicating their
--          ingredient-consume/output-movement logic. Revision tracking follows the same
--          shared-entity-id sync_changes ledger convention as production.start/.cancel
--          (create=1, subsequent events increment).
--      (c) apply_sync_operation() dispatcher gets two new ELSIF branches. EXECUTE revoked from
--          PUBLIC/anon/authenticated on both new handlers, matching every other handler.
--
-- Known, deliberate behavior change from removing values from the domain_operation CHECK
-- (rather than leaving them allowlisted-but-dispatcher-rejected, which is what the PRIOR
-- production/inventory slices did for their own deliberately-unbuilt operations): submitting
-- one of the four now-dropped values raises a raw 23514 check_violation at the
-- INSERT INTO sync_operations statement inside process_sync_batch_context_validated() itself,
-- which has no per-operation exception handler around that INSERT (unlike apply_sync_operation,
-- which does wrap handler execution) -- so it aborts the ENTIRE batch call, not just that one
-- operation, unlike the graceful per-op REJECTED/unsupported_operation_type these values used
-- to produce. This is an accepted consequence of the explicit product decision to treat these
-- four operations as genuinely out of scope rather than "not yet built" -- confirmed live
-- (tests D1-D4 below) and documented here so it isn't mistaken for a regression later. No
-- client has ever queued any of these four values (verified live, zero existing rows), so there
-- is no real-world batch this could break today.
--
-- Live-schema findings that shaped this suite:
--   - production_batches_copy_ingredients (AFTER INSERT trigger) auto-populates
--     production_batch_ingredients from the recipe -- test fixtures must NOT insert that table
--     manually or they collide with the trigger's own rows (production_batch_ingredients_
--     batch_ingredient_key).
--   - complete_production_batch() records a waste_quantity per ingredient (from
--     p_ingredient_actuals) but only ever inserts ONE stock_movements row per ingredient
--     (reason='production_consume', quantity = the ACTUAL amount used, not the waste amount) --
--     waste is metadata on production_batch_ingredients, not a separate ledger entry, on the
--     completion path. fail_production_batch() defaults waste_quantity to the full actual
--     amount and, like complete, records it via the same production_consume movement; it
--     deliberately writes NO output movement.
--
-- Covers:
--   O1  branch_manager production.start then production.record_output on the shared fixture
--       batch (b3000000...da01) -> APPLIED, batch status completed, revision 2 (shared-entity
--       ledger with production.start's revision 1), exactly 3 stock_movements rows (2 x
--       production_consume + 1 x production_output)
--   O2  driver-only cannot record_output -> REJECTED 42501
--   O3  missing batch_id -> REJECTED 22023
--   O4  missing actual_quantity -> REJECTED 22023
--   O5  nonexistent batch_id -> REJECTED P0001
--   O6  branch mismatch (batch's real branch != operation's authorized branch) -> REJECTED
--       22023 (skips gracefully if no second branch fixture exists in this project)
--   W1  branch_manager production.record_waste on a fresh in_progress batch -> APPLIED, batch
--       status failed, failure_reason recorded, 0 output movements, 2 consume movements
--   W2  driver-only cannot record_waste -> REJECTED 42501
--   W3  missing reason -> REJECTED 22023
--   REPLAY  identical replay of a record_output operation_id -> replayed=true, exactly one
--       sync_changes row for that entity (no double-apply)
--   CROSS-TENANT  actor with no membership in the operation's org -> gateway raises 42501
--       before either handler ever runs (existing is_member_of() mechanism, unchanged)
--   D1  production.complete (dropped from allowlist) -> whole-batch 23514 check_violation
--   D2  inventory.transfer (dropped) -> whole-batch 23514 check_violation
--   D3  inventory.consume (dropped) -> whole-batch 23514 check_violation
--   D4  inventory.receive (dropped) -> whole-batch 23514 check_violation
--   S1  apply_production_record_output not directly executable by anon/authenticated
--   S2  apply_production_record_waste not directly executable by anon/authenticated
--   S3  complete_production_batch/5 (the p_tenant_id overload) not directly executable by
--       anon/authenticated -- regression guard for a real vulnerability found same-day, see
--       the note directly above the S3/S4 test block below
--   S4  fail_production_batch/5 (the p_tenant_id overload) not directly executable by
--       anon/authenticated -- same regression guard
--   S5  complete_production_batch/4 (the original, pre-existing online-flow RPC) is still
--       executable by authenticated, confirming the fix did not regress the live UI's
--       "complete this batch" button
--   S6  fail_production_batch/4 (the original, pre-existing online-flow RPC) is still
--       executable by authenticated, same confirmation
--
-- Regression (re-run live, not included as inline assertions here): the full P1-P10/S1-S2
-- slice of tests/sql/p3_7_production_sync.sql (production.start/.cancel) re-passed unchanged
-- after the dispatcher rewrite and RPC signature changes; a standalone customer.create smoke
-- test confirmed the dispatcher's untouched branches still route correctly. NOTE: that file's
-- own P11 assertion ("production.complete -> REJECTED unsupported_operation_type") is now
-- STALE -- production.complete no longer reaches the dispatcher at all, it is rejected earlier
-- by the CHECK constraint (see D1 above) -- and has been corrected in place in that file rather
-- than re-asserted here.

begin;

create temp table _r (test text, passed boolean, detail text);
grant all on _r to authenticated;

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

-- =================== O1: start then record_output the shared fixture batch ===================
do $$
declare v_opid1 uuid := gen_random_uuid(); v_opid2 uuid := gen_random_uuid(); v_row public.sync_operations; v_moves int;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid1, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'production_batches',
      'operation_type', 'EVENT', 'domain_operation', 'production.start',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('batch_id','b3000000-0000-4000-8000-00000000da01')
    )));

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid2, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', 'b3000000-0000-4000-8000-00000000da01', 'entity_type', 'production_batches',
      'operation_type', 'EVENT', 'domain_operation', 'production.record_output',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('batch_id','b3000000-0000-4000-8000-00000000da01','actual_quantity', 24)
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid2;
  select count(*) into v_moves from public.stock_movements where reference_id='b3000000-0000-4000-8000-00000000da01' and reference_type='production_batch';
  insert into _r values ('O1 record_output on started fixture -> APPLIED, batch completed, revision 2, 3 stock movements',
    v_row.status='APPLIED' and (v_row.result->'result'->'batch'->>'status')='completed'
      and (v_row.result->>'revision')='2' and v_moves=3,
    v_row.status||' '||coalesce(v_row.error_code,'')||' rev='||coalesce(v_row.result->>'revision','?')||' moves='||v_moves);
end $$;

-- =================== O2: driver-only cannot record_output ===================
do $$
declare v_id uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  insert into public.production_batches (id, tenant_id, branch_id, recipe_id, planned_quantity, status, started_at, created_by)
  values (v_id, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
    'b2000000-0000-4000-8000-00000000da01', 5, 'in_progress', now(), 'aa000000-0000-4000-8000-00000000da01');

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
      'entity_id', v_id, 'entity_type', 'production_batches',
      'operation_type', 'EVENT', 'domain_operation', 'production.record_output',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('batch_id', v_id, 'actual_quantity', 5)
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

  insert into _r values ('O2 driver-only record_output -> REJECTED 42501',
    v_row.status='REJECTED' and v_row.error_code='42501', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== O3: missing batch_id ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'production_batches',
      'operation_type', 'EVENT', 'domain_operation', 'production.record_output',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('actual_quantity', 5)
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _r values ('O3 missing batch_id -> REJECTED 22023',
    v_row.status='REJECTED' and v_row.error_code='22023', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== O4: missing actual_quantity ===================
do $$
declare v_id uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  insert into public.production_batches (id, tenant_id, branch_id, recipe_id, planned_quantity, status, started_at, created_by)
  values (v_id, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
    'b2000000-0000-4000-8000-00000000da01', 5, 'in_progress', now(), 'aa000000-0000-4000-8000-00000000da01');

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_id, 'entity_type', 'production_batches',
      'operation_type', 'EVENT', 'domain_operation', 'production.record_output',
      'device_created_at', now()::text,
      'payload', jsonb_build_object()
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _r values ('O4 missing actual_quantity -> REJECTED 22023',
    v_row.status='REJECTED' and v_row.error_code='22023', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== O5: nonexistent batch_id ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'production_batches',
      'operation_type', 'EVENT', 'domain_operation', 'production.record_output',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('batch_id','00000000-0000-4000-8000-000000000000','actual_quantity',5)
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _r values ('O5 nonexistent batch_id -> REJECTED P0001',
    v_row.status='REJECTED' and v_row.error_code='P0001', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== O6: branch mismatch ===================
do $$
declare v_id uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_row public.sync_operations; v_other_branch uuid;
begin
  select id into v_other_branch from public.branches where tenant_id='ab000000-0000-4000-8000-00000000da01' and id <> 'ac000000-0000-4000-8000-00000000da01' limit 1;
  if v_other_branch is null then
    insert into _r values ('O6 branch mismatch -> SKIPPED (no second branch fixture)', true, 'skipped');
  else
    insert into public.production_batches (id, tenant_id, branch_id, recipe_id, planned_quantity, status, started_at, created_by)
    values (v_id, 'ab000000-0000-4000-8000-00000000da01', v_other_branch,
      'b2000000-0000-4000-8000-00000000da01', 5, 'in_progress', now(), 'aa000000-0000-4000-8000-00000000da01');

    perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
        'branch_id', 'ac000000-0000-4000-8000-00000000da01',
        'entity_id', v_id, 'entity_type', 'production_batches',
        'operation_type', 'EVENT', 'domain_operation', 'production.record_output',
        'device_created_at', now()::text,
        'payload', jsonb_build_object('batch_id', v_id, 'actual_quantity', 5)
      )));
    select * into v_row from public.sync_operations where operation_id = v_opid;
    insert into _r values ('O6 branch mismatch -> REJECTED 22023',
      v_row.status='REJECTED' and v_row.error_code='22023', v_row.status||' '||coalesce(v_row.error_code,''));
  end if;
end $$;

-- =================== W1: record_waste happy path ===================
do $$
declare v_id uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_row public.sync_operations; v_out int; v_consume int;
begin
  insert into public.production_batches (id, tenant_id, branch_id, recipe_id, planned_quantity, status, started_at, created_by)
  values (v_id, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
    'b2000000-0000-4000-8000-00000000da01', 25, 'in_progress', now(), 'aa000000-0000-4000-8000-00000000da01');

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_id, 'entity_type', 'production_batches',
      'operation_type', 'EVENT', 'domain_operation', 'production.record_waste',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('batch_id', v_id, 'reason', 'oven malfunction')
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  select count(*) into v_out from public.stock_movements where reference_id=v_id and reference_type='production_batch' and reason='production_output';
  select count(*) into v_consume from public.stock_movements where reference_id=v_id and reference_type='production_batch' and reason='production_consume';
  insert into _r values ('W1 record_waste happy path -> APPLIED, failed, 0 output, 2 consume',
    v_row.status='APPLIED' and (v_row.result->'result'->'batch'->>'status')='failed'
      and (v_row.result->'result'->'batch'->>'failure_reason')='oven malfunction' and v_out=0 and v_consume=2,
    v_row.status||' out='||v_out||' consume='||v_consume);
end $$;

-- =================== W2: driver-only cannot record_waste ===================
do $$
declare v_id uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  insert into public.production_batches (id, tenant_id, branch_id, recipe_id, planned_quantity, status, started_at, created_by)
  values (v_id, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
    'b2000000-0000-4000-8000-00000000da01', 5, 'in_progress', now(), 'aa000000-0000-4000-8000-00000000da01');

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
      'entity_id', v_id, 'entity_type', 'production_batches',
      'operation_type', 'EVENT', 'domain_operation', 'production.record_waste',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('batch_id', v_id, 'reason', 'test')
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

  insert into _r values ('W2 driver-only record_waste -> REJECTED 42501',
    v_row.status='REJECTED' and v_row.error_code='42501', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== W3: missing reason ===================
do $$
declare v_id uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  insert into public.production_batches (id, tenant_id, branch_id, recipe_id, planned_quantity, status, started_at, created_by)
  values (v_id, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
    'b2000000-0000-4000-8000-00000000da01', 5, 'in_progress', now(), 'aa000000-0000-4000-8000-00000000da01');

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_id, 'entity_type', 'production_batches',
      'operation_type', 'EVENT', 'domain_operation', 'production.record_waste',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('batch_id', v_id)
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _r values ('W3 missing reason -> REJECTED 22023',
    v_row.status='REJECTED' and v_row.error_code='22023', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== REPLAY: identical replay does not double-apply ===================
do $$
declare v_id uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_row1 public.sync_operations; v_row2 jsonb; v_count int;
begin
  insert into public.production_batches (id, tenant_id, branch_id, recipe_id, planned_quantity, status, started_at, created_by)
  values (v_id, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
    'b2000000-0000-4000-8000-00000000da01', 5, 'in_progress', now(), 'aa000000-0000-4000-8000-00000000da01');

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_id, 'entity_type', 'production_batches',
      'operation_type', 'EVENT', 'domain_operation', 'production.record_output',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('batch_id', v_id, 'actual_quantity', 5)
    )));
  select * into v_row1 from public.sync_operations where operation_id = v_opid;

  select (public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_id, 'entity_type', 'production_batches',
      'operation_type', 'EVENT', 'domain_operation', 'production.record_output',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('batch_id', v_id, 'actual_quantity', 5)
    ))) -> 'results' -> 0) into v_row2;

  select count(*) into v_count from public.sync_changes where entity_id = v_id;

  insert into _r values ('REPLAY identical record_output replay -> replayed=true, 1 sync_changes row',
    v_row1.status='APPLIED' and (v_row2->>'replayed')='true' and v_count=1,
    v_row1.status||' replay2.replayed='||(v_row2->>'replayed')||' rows='||v_count);
end $$;

-- =================== CROSS-TENANT: non-member of the operation org ===================
do $$
declare v_sqlstate text;
begin
  begin
    perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'operation_id', gen_random_uuid(), 'tenant_id', 'ab000000-0000-4000-8000-00000000da03',
        'branch_id', 'ac000000-0000-4000-8000-00000000da01',
        'entity_id', gen_random_uuid(), 'entity_type', 'production_batches',
        'operation_type', 'EVENT', 'domain_operation', 'production.record_output',
        'device_created_at', now()::text,
        'payload', jsonb_build_object('batch_id', gen_random_uuid(), 'actual_quantity', 5)
      )));
    v_sqlstate := 'NO ERROR RAISED';
  exception when others then
    v_sqlstate := sqlstate;
  end;
  insert into _r values ('CROSS-TENANT non-member org C -> gateway raises 42501',
    v_sqlstate='42501', v_sqlstate);
end $$;

-- =================== D1-D4: dropped allowlist values ===================
do $$
declare v_sqlstate text;
begin
  begin
    perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'operation_id', gen_random_uuid(), 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
        'branch_id', 'ac000000-0000-4000-8000-00000000da01',
        'entity_id', gen_random_uuid(), 'entity_type', 'production_batches',
        'operation_type', 'EVENT', 'domain_operation', 'production.complete',
        'device_created_at', now()::text, 'payload', jsonb_build_object()
      )));
    v_sqlstate := 'NO ERROR RAISED';
  exception when others then
    v_sqlstate := sqlstate;
  end;
  insert into _r values ('D1 production.complete (dropped) -> whole-batch CHECK violation 23514', v_sqlstate='23514', v_sqlstate);

  begin
    perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'operation_id', gen_random_uuid(), 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
        'branch_id', 'ac000000-0000-4000-8000-00000000da01',
        'entity_id', gen_random_uuid(), 'entity_type', 'stock_movements',
        'operation_type', 'CREATE', 'domain_operation', 'inventory.transfer',
        'device_created_at', now()::text, 'payload', jsonb_build_object()
      )));
    v_sqlstate := 'NO ERROR RAISED';
  exception when others then
    v_sqlstate := sqlstate;
  end;
  insert into _r values ('D2 inventory.transfer (dropped) -> whole-batch CHECK violation 23514', v_sqlstate='23514', v_sqlstate);

  begin
    perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'operation_id', gen_random_uuid(), 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
        'branch_id', 'ac000000-0000-4000-8000-00000000da01',
        'entity_id', gen_random_uuid(), 'entity_type', 'stock_movements',
        'operation_type', 'CREATE', 'domain_operation', 'inventory.consume',
        'device_created_at', now()::text, 'payload', jsonb_build_object()
      )));
    v_sqlstate := 'NO ERROR RAISED';
  exception when others then
    v_sqlstate := sqlstate;
  end;
  insert into _r values ('D3 inventory.consume (dropped) -> whole-batch CHECK violation 23514', v_sqlstate='23514', v_sqlstate);

  begin
    perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'operation_id', gen_random_uuid(), 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
        'branch_id', 'ac000000-0000-4000-8000-00000000da01',
        'entity_id', gen_random_uuid(), 'entity_type', 'stock_movements',
        'operation_type', 'CREATE', 'domain_operation', 'inventory.receive',
        'device_created_at', now()::text, 'payload', jsonb_build_object()
      )));
    v_sqlstate := 'NO ERROR RAISED';
  exception when others then
    v_sqlstate := sqlstate;
  end;
  insert into _r values ('D4 inventory.receive (dropped) -> whole-batch CHECK violation 23514', v_sqlstate='23514', v_sqlstate);
end $$;

-- =================== S1/S2: internal handlers not directly executable ===================
do $$
begin
  insert into _r values ('S1 apply_production_record_output not directly executable by anon/authenticated',
    not has_function_privilege('authenticated', 'public.apply_production_record_output(public.sync_operations)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.apply_production_record_output(public.sync_operations)', 'EXECUTE'), '');
  insert into _r values ('S2 apply_production_record_waste not directly executable by anon/authenticated',
    not has_function_privilege('authenticated', 'public.apply_production_record_waste(public.sync_operations)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.apply_production_record_waste(public.sync_operations)', 'EXECUTE'), '');
end $$;

-- =================== S3/S4: the 5-arg (p_tenant_id) RPC overloads are NOT publicly callable ===================
-- Regression guard for a real vulnerability found and fixed the same day this file was written
-- (see the header note above and IMPLEMENTATION_LOG.md 2026-08-31 "SECURITY FIX" entry):
-- CREATE OR REPLACE on complete_production_batch()/fail_production_batch() with an added
-- p_tenant_id parameter creates a NEW overload (Postgres dispatches by argument list, not just
-- name) rather than replacing the original 4-arg RPC -- so the new overload got Postgres/
-- Supabase's default PUBLIC EXECUTE grant, including `anon`, since nothing in that migration
-- explicitly revoked it. Combined with guard_production_batch_transition()'s role check being
-- unconditionally skipped when auth.uid() IS NULL (by design, for legitimate service-role
-- contexts), this meant a fully unauthenticated caller could complete/fail ANY tenant's
-- production batch by supplying an arbitrary p_tenant_id. Fixed same-day, before any evidence
-- of exploitation (verified live: zero production_batches/stock_movements rows touched in the
-- vulnerability's entire window) via migration
-- p3_7_security_fix_revoke_public_exec_on_tenant_scoped_production_rpcs. These two assertions
-- exist so this exact class of mistake -- adding a client-reachable parameter to a publicly
-- GRANTed RPC without an explicit REVOKE in the same migration -- cannot silently regress.
do $$
begin
  insert into _r values ('S3 complete_production_batch/5 (p_tenant_id overload) not directly executable by anon/authenticated',
    not has_function_privilege('authenticated', 'public.complete_production_batch(uuid, numeric, jsonb, uuid, uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.complete_production_batch(uuid, numeric, jsonb, uuid, uuid)', 'EXECUTE'), '');
  insert into _r values ('S4 fail_production_batch/5 (p_tenant_id overload) not directly executable by anon/authenticated',
    not has_function_privilege('authenticated', 'public.fail_production_batch(uuid, text, jsonb, uuid, uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.fail_production_batch(uuid, text, jsonb, uuid, uuid)', 'EXECUTE'), '');
  insert into _r values ('S5 complete_production_batch/4 (original, online-flow RPC) still executable by authenticated, unaffected',
    has_function_privilege('authenticated', 'public.complete_production_batch(uuid, numeric, jsonb, uuid)', 'EXECUTE'), '');
  insert into _r values ('S6 fail_production_batch/4 (original, online-flow RPC) still executable by authenticated, unaffected',
    has_function_privilege('authenticated', 'public.fail_production_batch(uuid, text, jsonb, uuid)', 'EXECUTE'), '');
end $$;

reset role;

select test, passed, left(detail, 250) as detail from _r order by test;

do $verdict$
declare v_failures integer;
begin
  select count(*) into v_failures from _r where passed is distinct from true;
  if v_failures > 0 then
    raise exception '% assertion(s) failed -- see the row-by-row output above', v_failures;
  end if;
end
$verdict$;

rollback;
