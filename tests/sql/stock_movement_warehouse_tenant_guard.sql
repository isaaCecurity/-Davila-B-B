-- Cross-tenant warehouse guard for stock_movements. Found during the 2026-09-05 SECURITY
-- DEFINER body-review follow-up (BLOCKERS.md/TECHNICAL_DEBT.md Item H, scoped 2026-09-04).
--
-- THE BUG: ingredient_stock_levels/product_stock_levels are uniquely keyed by
-- (warehouse_id, item_id) only -- NOT tenant_id -- and apply_stock_movement() maintains
-- them via `INSERT ... ON CONFLICT (warehouse_id, item_id) DO UPDATE`. So any function
-- that inserts into stock_movements with an unvalidated warehouse_id can silently mutate
-- ANOTHER tenant's actual stock levels: the stock_movements row itself still carries the
-- correct (calling) tenant_id, but the live quantity_on_hand it updates does not care
-- whose warehouse that is.
--
-- Five RPCs accepted an optional warehouse-id override, validated it only when the
-- caller left it out (falling back to a properly tenant/branch-scoped default-warehouse
-- lookup), but trusted it blindly whenever a caller actually supplied one:
-- complete_driver_field_sale, verify_trip_loading, complete_ticket,
-- complete_production_batch (both overloads), fail_production_batch (both overloads).
-- adjust_stock, apply_inventory_adjust, apply_inventory_waste and return_driver_trip
-- already validated correctly and needed no change.
--
-- THE FIX, two layers:
--   1. Root cause: stock_movements_guard_warehouse_tenant, a new BEFORE INSERT trigger on
--      stock_movements itself, rejects any row whose warehouse_id does not belong to its
--      own tenant_id. This is the actual security boundary -- it covers all five RPCs
--      above plus any future caller, in one place, matching how apply_stock_movement()'s
--      own negative-stock check already works as a backstop for that table.
--   2. UX: each of the five RPCs also gained its own explicit, friendly validation
--      (matching the pattern adjust_stock/apply_inventory_adjust already used), so a bad
--      request fails with a clear "warehouse not found at this branch" error instead of
--      the trigger's generic one.
--
-- Covers, in order:
--   T1 the trigger rejects a raw INSERT whose warehouse belongs to a different tenant
--   T2 the trigger allows a raw INSERT whose warehouse matches its own tenant (no regression)
--   T3 complete_driver_field_sale: an explicit cross-tenant p_warehouse_id is refused,
--      zero stock_movements written, ticket left untouched (still draft)
--   T4 verify_trip_loading: an explicit cross-tenant p_source_warehouse_id is refused,
--      zero stock_movements written, trip left untouched (still created)
--   T5 complete_ticket: an explicit cross-tenant p_warehouse_id is refused, zero
--      stock_movements written, ticket left untouched
--   T6 complete_production_batch: an explicit cross-tenant p_warehouse_id is refused,
--      zero stock_movements written, batch left untouched (still in_progress)
--   T7 fail_production_batch, reusing T6's still-untouched batch: an explicit
--      cross-tenant p_warehouse_id is refused there too, zero stock_movements written,
--      batch still in_progress (proves T6 truly left it unmodified)
--
-- Depends on tests/sql/fixtures.sql already being applied (org A ab...da01/branch A1
-- ac...da01/warehouse b0000000...da01/profile aa...da01/recipe b2000000...da01, matching
-- CI's own ordering). Adds one foreign warehouse under fixtures' existing org B
-- (ab...da02/branch B1 ac...da02) as the cross-tenant target every assertion below uses.

begin;

create temp table _results (test text, passed boolean, detail text);
grant all on _results to authenticated;

insert into public.user_roles (tenant_id, profile_id, role_id)
select 'ab000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', id
from public.roles where key in ('driver','owner','branch_manager','baker')
on conflict do nothing;

insert into public.branch_assignments (tenant_id, profile_id, branch_id)
values ('ab000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01')
on conflict do nothing;

-- The cross-tenant target: a real warehouse belonging to org B, not org A.
insert into public.warehouses (id, tenant_id, branch_id, name, is_default) values
  ('f7000000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-00000000da02',
   'ac000000-0000-4000-8000-00000000da02', 'Cross-tenant Test Warehouse B', false)
on conflict (id) do nothing;

-- ============================ T1/T2: the trigger itself, directly ==========================
do $$
begin
  begin
    insert into public.stock_movements
      (tenant_id, branch_id, warehouse_id, item_type, product_variant_id,
       quantity_delta, reason, created_by)
    values
      ('ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
       'f7000000-0000-4000-8000-000000000001', 'product', 'af000000-0000-4000-8000-00000000da01',
       1, 'adjustment', 'aa000000-0000-4000-8000-00000000da01');
    insert into _results values ('T1 trigger rejects a warehouse belonging to a different tenant', false, 'no exception raised');
  exception when others then
    insert into _results values ('T1 trigger rejects a warehouse belonging to a different tenant',
      sqlstate = 'P0001' and sqlerrm like '%does not belong to tenant%', sqlerrm);
  end;
end $$;

do $$
begin
  begin
    insert into public.stock_movements
      (tenant_id, branch_id, warehouse_id, item_type, product_variant_id,
       quantity_delta, reason, created_by)
    values
      ('ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
       'b0000000-0000-4000-8000-00000000da01', 'product', 'af000000-0000-4000-8000-00000000da01',
       1, 'adjustment', 'aa000000-0000-4000-8000-00000000da01');
    insert into _results values ('T2 trigger allows a same-tenant warehouse (no regression)', true, 'inserted ok');
  exception when others then
    insert into _results values ('T2 trigger allows a same-tenant warehouse (no regression)', false, sqlerrm);
  end;
end $$;

-- ==================================== T3: driver field sale ================================
insert into public.customers (id, tenant_id, full_name, is_walk_in) values
  ('f7000000-0000-4000-8000-000000000010', 'ab000000-0000-4000-8000-00000000da01', 'WH-Guard Test Customer', true);

insert into public.driver_trips (id, tenant_id, branch_id, driver_id, warehouse_id, status, departed_at, created_by)
values ('f7000000-0000-4000-8000-000000000011', 'ab000000-0000-4000-8000-00000000da01',
        'ac000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01',
        'b0000000-0000-4000-8000-00000000da01', 'in_transit', now(), 'aa000000-0000-4000-8000-00000000da01');

insert into public.tickets (id, tenant_id, branch_id, customer_id, status, fulfilment_type,
  subtotal_amount, discount_amount, tax_amount, driver_trip_id, sale_customer_type, created_by)
values ('f7000000-0000-4000-8000-000000000012', 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
  'f7000000-0000-4000-8000-000000000010', 'draft', 'pickup', 0,0,0, 'f7000000-0000-4000-8000-000000000011', 'ROADSIDE', 'aa000000-0000-4000-8000-00000000da01');
insert into public.ticket_items (tenant_id, ticket_id, product_variant_id, quantity, unit_price)
values ('ab000000-0000-4000-8000-00000000da01', 'f7000000-0000-4000-8000-000000000012',
  '82218a93-83fe-464a-819e-641987a8e3b1', 1, 0);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
  'roles', array['driver']
)::text, true);

do $$
declare v_moves int;
begin
  begin
    perform public.complete_driver_field_sale(
      'f7000000-0000-4000-8000-000000000012'::uuid, 'f7000000-0000-4000-8000-000000000001'::uuid);
    insert into _results values ('T3 complete_driver_field_sale refuses a cross-tenant p_warehouse_id', false, 'no exception raised');
  exception when others then
    select count(*) into v_moves from public.stock_movements where reference_id = 'f7000000-0000-4000-8000-000000000012';
    insert into _results values ('T3 complete_driver_field_sale refuses a cross-tenant p_warehouse_id',
      sqlstate = 'P0001' and sqlerrm like '%warehouse not found%' and v_moves = 0, sqlerrm || ' moves=' || v_moves);
  end;
end $$;

reset role;

do $$
declare v_status text;
begin
  select status into v_status from public.tickets where id = 'f7000000-0000-4000-8000-000000000012';
  insert into _results values ('T3b ticket left untouched (still draft) after the refused call',
    v_status = 'draft', 'status=' || coalesce(v_status,'<null>'));
end $$;

-- ==================================== T4: verify_trip_loading ================================
-- T3's trip must be walked to 'completed' first -- driver_trips_one_active_per_driver allows
-- only one non-completed trip per driver at a time, same constraint driver_field_sale_rls.sql
-- documents and works around identically.
update public.driver_trips set status = 'returning', returned_at = now()
where id = 'f7000000-0000-4000-8000-000000000011';
update public.driver_trips set status = 'reconciled', expected_cash = 0, physical_cash = 0,
  cash_variance = 0, reconciled_by = 'aa000000-0000-4000-8000-00000000da01', reconciled_at = now()
where id = 'f7000000-0000-4000-8000-000000000011';
update public.driver_trips set status = 'completed'
where id = 'f7000000-0000-4000-8000-000000000011';

insert into public.driver_trips (id, tenant_id, branch_id, driver_id, warehouse_id, status, created_by)
values ('f7000000-0000-4000-8000-000000000013', 'ab000000-0000-4000-8000-00000000da01',
        'ac000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01',
        'b0000000-0000-4000-8000-00000000da01', 'created', 'aa000000-0000-4000-8000-00000000da01');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
  'roles', array['branch_manager']
)::text, true);

do $$
declare v_moves int;
begin
  begin
    perform public.verify_trip_loading('f7000000-0000-4000-8000-000000000013'::uuid,
      jsonb_build_array(jsonb_build_object('item_type','product','item_id','82218a93-83fe-464a-819e-641987a8e3b1','quantity',5)),
      'f7000000-0000-4000-8000-000000000001'::uuid);
    insert into _results values ('T4 verify_trip_loading refuses a cross-tenant p_source_warehouse_id', false, 'no exception raised');
  exception when others then
    select count(*) into v_moves from public.stock_movements where reference_id = 'f7000000-0000-4000-8000-000000000013';
    insert into _results values ('T4 verify_trip_loading refuses a cross-tenant p_source_warehouse_id',
      sqlstate = 'P0001' and sqlerrm like '%warehouse not found%' and v_moves = 0, sqlerrm || ' moves=' || v_moves);
  end;
end $$;

reset role;

do $$
declare v_status text;
begin
  select status into v_status from public.driver_trips where id = 'f7000000-0000-4000-8000-000000000013';
  insert into _results values ('T4b trip left untouched (still created) after the refused call',
    v_status = 'created', 'status=' || coalesce(v_status,'<null>'));
end $$;

-- ==================================== T5: complete_ticket =====================================
-- complete_ticket() only rejects an already-'completed' ticket, so 'draft' is fine here (and
-- avoids guard_ticket_item_mutation()'s order_locked guard, which fires once a ticket is past
-- draft) -- matches T3's own ticket status for the same reason.
insert into public.tickets (id, tenant_id, branch_id, customer_id, status, fulfilment_type,
  subtotal_amount, discount_amount, tax_amount, sale_customer_type, created_by)
values ('f7000000-0000-4000-8000-000000000014', 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
  'f7000000-0000-4000-8000-000000000010', 'draft', 'pickup', 0,0,0, 'REGISTERED', 'aa000000-0000-4000-8000-00000000da01');
insert into public.ticket_items (tenant_id, ticket_id, product_variant_id, quantity, unit_price)
values ('ab000000-0000-4000-8000-00000000da01', 'f7000000-0000-4000-8000-000000000014',
  '82218a93-83fe-464a-819e-641987a8e3b1', 1, 0);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
  'roles', array['owner']
)::text, true);

do $$
declare v_moves int;
begin
  begin
    perform public.complete_ticket('f7000000-0000-4000-8000-000000000014'::uuid, 'f7000000-0000-4000-8000-000000000001'::uuid);
    insert into _results values ('T5 complete_ticket refuses a cross-tenant p_warehouse_id', false, 'no exception raised');
  exception when others then
    select count(*) into v_moves from public.stock_movements where reference_id = 'f7000000-0000-4000-8000-000000000014';
    insert into _results values ('T5 complete_ticket refuses a cross-tenant p_warehouse_id',
      sqlstate = 'P0001' and sqlerrm like '%warehouse not found%' and v_moves = 0, sqlerrm || ' moves=' || v_moves);
  end;
end $$;

reset role;

-- =========================== T6/T7: production batch (completion, then failure) ===============
-- Neither overload of complete_production_batch/fail_production_batch is granted EXECUTE to
-- authenticated/anon at all -- confirmed live, matches p3_7_production_output_waste_sync.sql
-- S3-S6. The real (only) caller is apply_production_record_output/
-- apply_production_record_waste, which pull warehouse_id straight out of a client-supplied
-- sync payload with no validation and pass it into the 5-arg overload -- that is the actual
-- vulnerable call site this fix closes. But per that same suite's O0a/O0b, the
-- 'production.record_output'/'production.record_waste' domain_operations are themselves
-- currently rejected outright by sync_operations_domain_operation_check (AD-022: ingredient
-- tracking, and with it production-batch completion via sync, is descoped for MVP) -- so this
-- whole path is dead/unreachable today. This fix is forward-looking defense in depth, not a
-- currently-live hole: it closes the gap now so it can't reopen the moment AD-022 is reversed
-- and this path comes back to life. Tested here the same way
-- apply_production_record_output/waste would call it internally -- directly, at the
-- connecting role's own privilege (already holds EXECUTE), not via authenticated.
insert into public.production_batches (id, tenant_id, branch_id, recipe_id, planned_quantity, status)
values ('f7000000-0000-4000-8000-000000000015', 'ab000000-0000-4000-8000-00000000da01',
        'ac000000-0000-4000-8000-00000000da01', 'b2000000-0000-4000-8000-00000000da01', 5, 'in_progress');

insert into public.production_batch_ingredients (tenant_id, batch_id, ingredient_id, planned_quantity)
values
  ('ab000000-0000-4000-8000-00000000da01', 'f7000000-0000-4000-8000-000000000015', 'b1000000-0000-4000-8000-00000000da01', 1.25),
  ('ab000000-0000-4000-8000-00000000da01', 'f7000000-0000-4000-8000-000000000015', 'b1000000-0000-4000-8000-00000000da02', 0.375)
on conflict do nothing;

do $$
declare v_moves int;
begin
  begin
    -- Named args incl. p_tenant_id disambiguates from the 4-arg overload -- a plain
    -- 4-positional-arg call is ambiguous between the two (both match via defaults),
    -- confirmed live. Called at the connecting role's own privilege (no authenticated
    -- grant exists on either overload), mirroring how apply_production_record_output
    -- would call it internally.
    perform public.complete_production_batch(p_batch_id := 'f7000000-0000-4000-8000-000000000015'::uuid,
      p_actual_quantity := 5, p_ingredient_actuals := '[]'::jsonb,
      p_warehouse_id := 'f7000000-0000-4000-8000-000000000001'::uuid,
      p_tenant_id := 'ab000000-0000-4000-8000-00000000da01'::uuid);
    insert into _results values ('T6 complete_production_batch refuses a cross-tenant p_warehouse_id', false, 'no exception raised');
  exception when others then
    select count(*) into v_moves from public.stock_movements where reference_id = 'f7000000-0000-4000-8000-000000000015';
    insert into _results values ('T6 complete_production_batch refuses a cross-tenant p_warehouse_id',
      sqlstate = 'P0001' and sqlerrm like '%warehouse not found%' and v_moves = 0, sqlerrm || ' moves=' || v_moves);
  end;
end $$;

do $$
declare v_moves int;
begin
  begin
    -- Reuses the SAME batch T6 just tried on: only valid if T6 truly left it untouched
    -- (still in_progress) -- an implicit double-check of T6's own "zero side effects" claim.
    perform public.fail_production_batch(p_batch_id := 'f7000000-0000-4000-8000-000000000015'::uuid,
      p_reason := 'wh-guard test', p_ingredient_actuals := '[]'::jsonb,
      p_warehouse_id := 'f7000000-0000-4000-8000-000000000001'::uuid,
      p_tenant_id := 'ab000000-0000-4000-8000-00000000da01'::uuid);
    insert into _results values ('T7 fail_production_batch refuses a cross-tenant p_warehouse_id', false, 'no exception raised');
  exception when others then
    select count(*) into v_moves from public.stock_movements where reference_id = 'f7000000-0000-4000-8000-000000000015';
    insert into _results values ('T7 fail_production_batch refuses a cross-tenant p_warehouse_id',
      sqlstate = 'P0001' and sqlerrm like '%warehouse not found%' and v_moves = 0, sqlerrm || ' moves=' || v_moves);
  end;
end $$;

do $$
declare v_status text;
begin
  select status into v_status from public.production_batches where id = 'f7000000-0000-4000-8000-000000000015';
  insert into _results values ('T7b batch still in_progress after both refused calls (proves T6 left it untouched)',
    v_status = 'in_progress', 'status=' || coalesce(v_status,'<null>'));
end $$;

select * from _results order by test;

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
