-- BakeFlow — P3.7 INVENTORY vertical slice: inventory.adjust / inventory.waste
--
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/p3_7_inventory_sync.sql
--
-- EXECUTED 2026-08-30 against project tvfyxpafbpnkneujcnvr: 12/12 passed.
--
-- Scope: apply_inventory_adjust(), apply_inventory_waste(), their dispatch wiring in
-- apply_sync_operation(), and their EXECUTE grants. Does NOT re-test
-- process_sync_batch_context_validated()'s generic idempotency/context/conflict machinery --
-- tests/sql/p3_7_protocol_correctness.sql and tests/sql/p3_7_sync_apply_and_pull.sql already
-- cover that end to end; this suite exercises the same generic gateway through the two new
-- inventory domain_operation values and adds inventory-specific handler tests.
--
-- Live-schema findings that shaped this suite (full detail in IMPLEMENTATION_LOG.md 2026-08-30):
--   - AD-021 already locked inventory's conflict strategy: append-only domain operations
--     (inventory.adjust/.receive/.consume/.waste/.transfer), never a synchronized absolute
--     quantity; concurrent legitimate adjustments both apply; only a server-side rule
--     violation (resulting negative stock) becomes a rejection. This suite builds exactly
--     two of those five -- adjust and waste -- and stops there; see below.
--   - The live online RPC adjust_stock(p_warehouse_id, p_item_type, p_item_id, p_new_quantity,
--     p_reason, p_note) is the only existing precedent for a management/production stock
--     write. It only accepts reason IN ('adjustment','waste','opening_balance'), gates
--     'adjustment'/'opening_balance' to owner/admin/branch_manager and 'waste' to
--     owner/admin/branch_manager/baker, and forbids a positive delta under reason='waste'.
--     apply_inventory_adjust/apply_inventory_waste mirror this exactly for their two reasons
--     ('adjustment', 'waste') -- an existing, human-approved rule, not invented for this
--     handler. 'opening_balance' has no domain_operation allowlist entry at all (not in
--     AD-021's five inventory operations) and is therefore deliberately NOT reachable through
--     sync -- a one-time setup activity with no offline-sync precedent, left alone rather than
--     guessed into scope.
--   - adjust_stock() takes an absolute p_new_quantity and computes the delta itself against a
--     FOR UPDATE-locked read of current on-hand -- workable online, but an offline-queued
--     operation cannot reliably know "current" while offline. Both new handlers instead take
--     an explicit quantity_delta directly in the payload (matching AD-021's own "append-only,
--     never a synchronized absolute quantity" framing much more directly than the online RPC's
--     own shape does) and reject only if applying it would drive on-hand negative -- AD-021's
--     literal example of the one thing that becomes a rejection.
--   - inventory.receive, inventory.consume, and inventory.transfer are NOT built in this pass.
--     Investigated live and found each has no clean existing precedent to mirror, unlike
--     adjust/waste: no RPC anywhere writes reason='purchase' (ties directly into the
--     already-documented BLOCKER-018 gap -- stock_movements.unit_cost is 100% NULL and nothing
--     captures a purchase-cost event at all); reason='transfer_in'/'transfer_out' is written
--     exclusively by the driver-trip lifecycle (verify_trip_loading/return_driver_trip),
--     always in linked in/out pairs against a specific trip and always with
--     reference_type='driver_trip' -- there is no generic warehouse-to-warehouse manual
--     transfer RPC anywhere to mirror, and inventing one would be a real, undecided
--     authorization/business-rule question (who may move stock between two warehouses with no
--     trip involved?); reason='production_consume' is written exclusively inside
--     complete_production_batch()/fail_production_batch(), tied to a real production batch --
--     a standalone "consume" operation with no batch link has no defined meaning and would
--     overlap unclearly with adjust/waste. Opened as new, non-blocking **BLOCKER-026**
--     (BLOCKERS.md) rather than guessed at; domain_operation's CHECK constraint already
--     allowlists all five inventory.* values (added by an earlier migration per AD-021), so an
--     operation of any of these three types is recorded then correctly REJECTED
--     unsupported_operation_type by the existing dispatcher fallback (see I10 below) --  never
--     silently left PENDING.
--   - The operation's branch is already authorized by the generic gateway
--     (is_authorized_for_branch, inside process_sync_batch_context_validated) before any
--     sync_operations row exists. Both handlers additionally verify the payload's own
--     warehouse_id actually belongs to that already-authorized branch (not merely the same
--     tenant) -- the same consistency-guard shape apply_customer_update uses for its
--     customer_id/entity_id check -- so an actor authorized for branch A cannot point a
--     warehouse_id from branch B at that authorization.
--   - sync_changes.operation_type='EVENT' (not 'CREATE') is used for both handlers -- 'EVENT'
--     is a valid value on the live CHECK constraint and is the precedented fit AD-021's own
--     text already uses ("tickets: event/state-machine ... inventory: append-only") for a
--     fact that happened rather than a mutable entity that was created. Revision is always 1
--     (each stock_movements row is its own immutable event, never revised), matching
--     'customers'/'tickets' entity_id being the movement's own id, not a pre-existing entity.
--
-- Covers:
--   I1  branch_manager inventory.adjust +10 on an ingredient -> APPLIED, on-hand +10, revision 1
--   I2  missing warehouse_id -> REJECTED, 22023 invalid_request
--   I3  quantity_delta = 0 -> REJECTED, 22023 invalid_request
--   I4  driver-only (not owner/admin/branch_manager) cannot adjust -> REJECTED, 42501
--   I5  adjustment that would drive on-hand negative -> REJECTED, P0001 negative_stock_rejected
--       (AD-021's own named example of what becomes a rejection)
--   I6  cross-tenant (actor not a member of the operation's org) -> rejected by the existing
--       generic gateway (is_member_of), before the handler ever runs
--   I7  warehouse_id that does not exist in this tenant -> REJECTED, P0001 (not found)
--   I9  identical replay (same operation_id) -> second call replayed=true, does not create a
--       second stock_movements row
--   I10 inventory.consume (allowlisted, deliberately unbuilt -- BLOCKER-026) -> REJECTED,
--       unsupported_operation_type, exactly like any other not-yet-built entity
--   W1  baker inventory.waste -2 on an ingredient -> APPLIED, on-hand -2
--   W3  driver-only (not owner/admin/branch_manager/baker) cannot record waste -> REJECTED, 42501
--   W4  inventory.waste with a positive quantity_delta -> REJECTED, 22023 (waste must be a
--       negative delta -- the one place adjust and waste deliberately diverge)
--   S1  apply_inventory_adjust is not directly executable by anon or authenticated via PostgREST
--   S2  apply_inventory_waste is not directly executable by anon or authenticated via PostgREST

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

-- =================== I6: cross-tenant (org C, not a member) ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_ok boolean := false; v_msg text;
begin
  begin
    perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da03',
        'branch_id', 'ac000000-0000-4000-8000-00000000da01',
        'entity_id', gen_random_uuid(), 'entity_type', 'stock_movements',
        'operation_type', 'EVENT', 'domain_operation', 'inventory.adjust',
        'device_created_at', now()::text,
        'payload', jsonb_build_object('warehouse_id','b0000000-0000-4000-8000-00000000da01',
          'item_type','ingredient','item_id','b1000000-0000-4000-8000-00000000da01','quantity_delta',5)
      )));
  exception when others then
    v_ok := true; v_msg := sqlerrm;
  end;
  insert into _results values ('I6 cross-tenant (org C not member) -> rejected', v_ok, coalesce(v_msg,'no exception raised'));
end $$;

-- =================== I7: nonexistent warehouse_id ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'stock_movements',
      'operation_type', 'EVENT', 'domain_operation', 'inventory.adjust',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('warehouse_id','00000000-0000-4000-8000-000000000000',
        'item_type','ingredient','item_id','b1000000-0000-4000-8000-00000000da01','quantity_delta',5)
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('I7 nonexistent warehouse_id -> REJECTED P0001',
    v_row.status='REJECTED' and v_row.error_code='P0001', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== I1: branch_manager adjusts flour +10 ===================
do $$
declare
  v_opid uuid := gen_random_uuid();
  v_row public.sync_operations;
  v_before numeric; v_after numeric;
begin
  select coalesce(quantity_on_hand,0) into v_before from public.ingredient_stock_levels
   where warehouse_id='b0000000-0000-4000-8000-00000000da01' and ingredient_id='b1000000-0000-4000-8000-00000000da01';

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'stock_movements',
      'operation_type', 'EVENT', 'domain_operation', 'inventory.adjust',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('warehouse_id','b0000000-0000-4000-8000-00000000da01',
        'item_type','ingredient','item_id','b1000000-0000-4000-8000-00000000da01','quantity_delta',10)
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  select quantity_on_hand into v_after from public.ingredient_stock_levels
   where warehouse_id='b0000000-0000-4000-8000-00000000da01' and ingredient_id='b1000000-0000-4000-8000-00000000da01';

  insert into _results values ('I1 branch_manager inventory.adjust +10 -> APPLIED, level +10, revision 1',
    v_row.status = 'APPLIED' and (v_row.result->>'revision')='1' and v_after = v_before + 10,
    format('status=%s before=%s after=%s result=%s', v_row.status, v_before, v_after, v_row.result::text));
end $$;

-- =================== I2: missing warehouse_id ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'stock_movements',
      'operation_type', 'EVENT', 'domain_operation', 'inventory.adjust',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('item_type','ingredient','item_id','b1000000-0000-4000-8000-00000000da01','quantity_delta',5)
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('I2 missing warehouse_id -> REJECTED 22023',
    v_row.status='REJECTED' and v_row.error_code='22023', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== I3: quantity_delta = 0 ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'stock_movements',
      'operation_type', 'EVENT', 'domain_operation', 'inventory.adjust',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('warehouse_id','b0000000-0000-4000-8000-00000000da01',
        'item_type','ingredient','item_id','b1000000-0000-4000-8000-00000000da01','quantity_delta',0)
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('I3 quantity_delta=0 -> REJECTED 22023',
    v_row.status='REJECTED' and v_row.error_code='22023', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== I5: adjustment that would drive on-hand negative ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'stock_movements',
      'operation_type', 'EVENT', 'domain_operation', 'inventory.adjust',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('warehouse_id','b0000000-0000-4000-8000-00000000da01',
        'item_type','ingredient','item_id','b1000000-0000-4000-8000-00000000da01','quantity_delta',-999999999)
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('I5 adjust to negative -> REJECTED P0001/negative_stock_rejected',
    v_row.status='REJECTED' and v_row.error_code='P0001', v_row.status||' '||coalesce(v_row.error_code,'')||' '||coalesce(v_row.error_message,''));
end $$;

-- =================== I9: identical replay ===================
do $$
declare
  v_opid uuid := gen_random_uuid();
  v_op jsonb;
  v_res1 jsonb; v_res2 jsonb;
  v_count int;
begin
  v_op := jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'stock_movements',
      'operation_type', 'EVENT', 'domain_operation', 'inventory.adjust',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('warehouse_id','b0000000-0000-4000-8000-00000000da01',
        'item_type','ingredient','item_id','b1000000-0000-4000-8000-00000000da02','quantity_delta',3));
  v_res1 := public.process_sync_batch('f8000000-0000-4000-8000-000000000001', jsonb_build_array(v_op));
  v_res2 := public.process_sync_batch('f8000000-0000-4000-8000-000000000001', jsonb_build_array(v_op));
  select count(*) into v_count from public.stock_movements where reference_id='b0000000-0000-4000-8000-00000000da01'
    and ingredient_id='b1000000-0000-4000-8000-00000000da02' and quantity_delta=3;
  insert into _results values ('I9 replay same operation_id -> second call replayed=true, one movement',
    (v_res2->'results'->0->>'replayed')='true' and v_count=1,
    format('res1=%s res2=%s count=%s', v_res1, v_res2, v_count));
end $$;

-- =================== I10: unsupported domain_operation -> REJECTED, not silently pending ===================
-- Was inventory.consume ("allowlisted, deliberately unbuilt") -- found stale 2026-09-01, first
-- real GitHub Actions run of the sql-tests job: inventory.consume/.receive/.transfer were removed
-- from the domain_operation allowlist entirely (BLOCKER-026), so the insert below now fails the
-- sync_operations_domain_operation_check CHECK constraint at INSERT time instead of reaching the
-- dispatcher's unsupported_operation_type fallback this test means to exercise. Switched to
-- expense.reverse, the one domain_operation still allowlisted but genuinely unhandled
-- (BLOCKER-028, deliberately deferred) -- same fix already applied to p3_7_protocol_correctness.sql
-- A3 and p3_7_sync_apply_and_pull.sql T3 the same pass.
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'stock_movements',
      'operation_type', 'EVENT', 'domain_operation', 'expense.reverse',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('warehouse_id','b0000000-0000-4000-8000-00000000da01',
        'item_type','ingredient','item_id','b1000000-0000-4000-8000-00000000da01','quantity_delta',-1)
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('I10 unsupported domain_operation -> REJECTED unsupported_operation_type',
    v_row.status='REJECTED' and v_row.error_code='unsupported_operation_type', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- Swap to driver-only (no branch_manager/baker) for I4/W3
reset role;
delete from public.user_roles where tenant_id='ab000000-0000-4000-8000-00000000da01' and profile_id='aa000000-0000-4000-8000-00000000da01';
insert into public.user_roles (tenant_id, profile_id, role_id)
select 'ab000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', id from public.roles where key='driver';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
  'roles', array['driver']
)::text, true);

-- =================== I4: driver-only cannot adjust ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'stock_movements',
      'operation_type', 'EVENT', 'domain_operation', 'inventory.adjust',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('warehouse_id','b0000000-0000-4000-8000-00000000da01',
        'item_type','ingredient','item_id','b1000000-0000-4000-8000-00000000da01','quantity_delta',5)
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('I4 driver-only inventory.adjust -> REJECTED 42501',
    v_row.status='REJECTED' and v_row.error_code='42501', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== W3: driver-only cannot record waste ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'stock_movements',
      'operation_type', 'EVENT', 'domain_operation', 'inventory.waste',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('warehouse_id','b0000000-0000-4000-8000-00000000da01',
        'item_type','ingredient','item_id','b1000000-0000-4000-8000-00000000da01','quantity_delta',-1)
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('W3 driver-only inventory.waste -> REJECTED 42501',
    v_row.status='REJECTED' and v_row.error_code='42501', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- Swap to baker-only for W1/W4
reset role;
delete from public.user_roles where tenant_id='ab000000-0000-4000-8000-00000000da01' and profile_id='aa000000-0000-4000-8000-00000000da01';
insert into public.user_roles (tenant_id, profile_id, role_id)
select 'ab000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', id from public.roles where key='baker';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
  'roles', array['baker']
)::text, true);

-- =================== W1: baker records waste -2 ===================
do $$
declare
  v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
  v_before numeric; v_after numeric;
begin
  select coalesce(quantity_on_hand,0) into v_before from public.ingredient_stock_levels
   where warehouse_id='b0000000-0000-4000-8000-00000000da01' and ingredient_id='b1000000-0000-4000-8000-00000000da03';

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'stock_movements',
      'operation_type', 'EVENT', 'domain_operation', 'inventory.waste',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('warehouse_id','b0000000-0000-4000-8000-00000000da01',
        'item_type','ingredient','item_id','b1000000-0000-4000-8000-00000000da03','quantity_delta',-2)
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  select quantity_on_hand into v_after from public.ingredient_stock_levels
   where warehouse_id='b0000000-0000-4000-8000-00000000da01' and ingredient_id='b1000000-0000-4000-8000-00000000da03';
  insert into _results values ('W1 baker inventory.waste -2 -> APPLIED, level -2',
    v_row.status='APPLIED' and v_after = v_before - 2, format('status=%s before=%s after=%s',v_row.status,v_before,v_after));
end $$;

-- =================== W4: positive quantity_delta rejected for waste ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'stock_movements',
      'operation_type', 'EVENT', 'domain_operation', 'inventory.waste',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('warehouse_id','b0000000-0000-4000-8000-00000000da01',
        'item_type','ingredient','item_id','b1000000-0000-4000-8000-00000000da01','quantity_delta',2)
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('W4 waste with positive quantity_delta -> REJECTED 22023',
    v_row.status='REJECTED' and v_row.error_code='22023', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- restore driver+branch_manager
reset role;
delete from public.user_roles where tenant_id='ab000000-0000-4000-8000-00000000da01' and profile_id='aa000000-0000-4000-8000-00000000da01';
insert into public.user_roles (tenant_id, profile_id, role_id)
select 'ab000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', id
from public.roles where key in ('driver','branch_manager');

-- =================== S1/S2: internal handlers not directly executable ===================
do $$
begin
  insert into _results values ('S1 apply_inventory_adjust not directly executable by anon/authenticated',
    not has_function_privilege('authenticated', 'public.apply_inventory_adjust(public.sync_operations)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.apply_inventory_adjust(public.sync_operations)', 'EXECUTE'), '');
  insert into _results values ('S2 apply_inventory_waste not directly executable by anon/authenticated',
    not has_function_privilege('authenticated', 'public.apply_inventory_waste(public.sync_operations)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.apply_inventory_waste(public.sync_operations)', 'EXECUTE'), '');
end $$;

select * from _results order by test;

do $verdict$
begin
  if exists (select 1 from _results where not passed) then
    raise exception 'p3_7_inventory_sync.sql: % of % assertions FAILED -- see rows above',
      (select count(*) from _results where not passed), (select count(*) from _results);
  end if;
  raise notice 'p3_7_inventory_sync.sql: all % assertions passed', (select count(*) from _results);
end $verdict$;

rollback;
