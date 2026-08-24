-- ADR-001 driver_trips domain -- schema (Phase 2) + RPC/security layer (Phase 3)
-- regression suite. Run as a rolled-back transaction; never commits.
--
-- EXECUTED 2026-08-24 against project tvfyxpafbpnkneujcnvr: 20/20 passed. Building and
-- running this suite is also what surfaced a real live defect, found and fixed the same
-- pass: CREATE OR REPLACE FUNCTION record_payment(...) with a 6th parameter
-- (p_driver_trip_id) added did NOT replace the existing 5-parameter function -- Postgres
-- only replaces a function with an identical signature, so it silently created a second
-- overload instead. Any 5-positional-arg call became ambiguous
-- (record_payment(unknown,numeric,unknown,unknown,uuid) is not unique), which would have
-- broken every existing caller, including tests/sql/financial_write_rls.sql's own calls,
-- the moment anything actually invoked it that way. Fixed by dropping the stale 5-arg
-- overload explicitly; financial_write_rls.sql re-run clean at 28/28 afterward to confirm.
--
-- Covers, in order:
--   D1  driver_trips: reconciled/completed status requires cash figures + reconciler
--   D2  driver_trips: nonzero cash_variance requires a variance note
--   D3  driver_trips: one active (non-completed) trip per driver
--   D4  payments: a cash payment needs a custody context (till session or driver trip)
--   D5  payments: a payment cannot reference both custody contexts at once
--   D6  stock_movements: reference_type accepts 'driver_trip'
--   D7  RLS: authenticated cannot INSERT/UPDATE/DELETE driver_trips directly (RPC-only)
--   D8  RLS: a driver can SELECT their own trip
--   D9  start_driver_trip: driver-only, creates status='created'
--   D10 start_driver_trip: a second call while one trip is still active is refused
--   D11 verify_trip_loading: management-verified load writes paired transfer_out/in
--       movements and advances created -> ready_to_depart in one atomic call
--   D12 depart_driver_trip: ready_to_depart -> in_transit, driver-only
--   D13 a driver may create a ticket linked to their own in_transit trip
--   D14 guard_ticket_driver_trip_assignment: a ticket cannot link to a trip that is not
--       in_transit (status-guard branch of the new trigger)
--   D15 record_payment: a driver-trip-scoped cash payment needs no till session and is
--       tagged driver_trip_id, not cash_session_id
--   D16 return_driver_trip: in_transit -> returning, writes the reverse transfer pair
--   D17 reconcile_driver_trip: nonzero variance without a note is refused
--   D18 reconcile_driver_trip: matching physical cash reconciles cleanly
--   D19 complete_driver_trip: reconciled -> completed, settlement session recorded
--   D20 close_cash_session: a completed trip's physical_cash is folded into the
--       branch session's expected_amount (AD-018's actual settlement mechanism)
--
-- Fixtures reuse real live rows (org ab000000.../branch ac000000.../warehouse
-- b0000000.../profile aa000000...) because profiles.id has a hard FK to auth.users and
-- this project has exactly one real profile row -- fabricated profile ids are rejected
-- by the FK, same lesson learned building financial_write_rls.sql. The single real
-- profile is reused across the driver and branch_manager personas by toggling only the
-- JWT `roles` claim between phases; has_role() reads only that claim, never the
-- database, so this is a faithful permission test despite the unrealistic combination.

begin;

create temp table _results (test text, passed boolean, detail text);
create temp table _ctx (trip_id uuid, ticket_id uuid, session_id uuid);
insert into _ctx default values;
grant all on _results to authenticated;
grant all on _ctx to authenticated;

insert into public.user_roles (tenant_id, profile_id, role_id)
select 'ab000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', id
from public.roles where key in ('driver','branch_manager')
on conflict do nothing;

insert into public.branch_assignments (tenant_id, profile_id, branch_id)
values ('ab000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01')
on conflict do nothing;

insert into public.warehouses (id, tenant_id, branch_id, name, is_default) values
  ('e5000000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-00000000da01',
   'ac000000-0000-4000-8000-00000000da01', 'Suite Vehicle', false);

insert into public.stock_movements (tenant_id, branch_id, warehouse_id, item_type,
  product_variant_id, quantity_delta, reason, created_by)
values ('ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
  'b0000000-0000-4000-8000-00000000da01', 'product', '82218a93-83fe-464a-819e-641987a8e3b1',
  100, 'opening_balance', 'aa000000-0000-4000-8000-00000000da01');

insert into public.customers (id, tenant_id, full_name, is_walk_in) values
  ('e5000000-0000-4000-8000-000000000002', 'ab000000-0000-4000-8000-00000000da01', 'Suite Customer', true);

-- ============================ D1-D6: schema constraints ============================

-- Inserted directly at 'returning' -- guard_driver_trip_transition() only fires on
-- UPDATE OF status, not INSERT, so this is the fixture-only way to reach a
-- mid-lifecycle status without walking every legal transition first.
insert into public.driver_trips (id, tenant_id, branch_id, driver_id, warehouse_id, status, created_by)
values ('e5000000-0000-4000-8000-000000000003', 'ab000000-0000-4000-8000-00000000da01',
        'ac000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01',
        'e5000000-0000-4000-8000-000000000001', 'returning', 'aa000000-0000-4000-8000-00000000da01');

do $$
begin
  begin
    update public.driver_trips set status = 'reconciled' where id = 'e5000000-0000-4000-8000-000000000003';
    insert into _results values ('D1 reconciled needs cash figures', false, 'no exception raised');
  exception when others then
    insert into _results values ('D1 reconciled needs cash figures', sqlstate = '23514', sqlerrm);
  end;
end $$;

update public.driver_trips
set status = 'reconciled', expected_cash = 5000, physical_cash = 5200, cash_variance = 200,
    reconciled_by = 'aa000000-0000-4000-8000-00000000da01', reconciled_at = now(),
    cash_variance_note = 'test note'
where id = 'e5000000-0000-4000-8000-000000000003';

do $$
begin
  begin
    update public.driver_trips set cash_variance_note = null where id = 'e5000000-0000-4000-8000-000000000003';
    insert into _results values ('D2 nonzero variance needs a note', false, 'no exception raised');
  exception when others then
    insert into _results values ('D2 nonzero variance needs a note', sqlstate = '23514', sqlerrm);
  end;
end $$;

do $$
begin
  begin
    insert into public.driver_trips (tenant_id, branch_id, driver_id, warehouse_id, status)
    values ('ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
            'aa000000-0000-4000-8000-00000000da01', 'e5000000-0000-4000-8000-000000000001', 'created');
    insert into _results values ('D3 one active trip per driver', false, 'no exception raised');
  exception when others then
    insert into _results values ('D3 one active trip per driver', sqlstate = '23505', sqlerrm);
  end;
end $$;

insert into public.tickets (id, tenant_id, branch_id, customer_id, status, fulfilment_type,
  subtotal_amount, discount_amount, tax_amount, sale_customer_type, created_by)
values ('e5000000-0000-4000-8000-000000000004', 'ab000000-0000-4000-8000-00000000da01',
  'ac000000-0000-4000-8000-00000000da01', 'e5000000-0000-4000-8000-000000000002', 'draft', 'pickup',
  1000, 0, 0, 'ROADSIDE', 'aa000000-0000-4000-8000-00000000da01');

do $$
begin
  begin
    insert into public.payments (tenant_id, branch_id, ticket_id, amount, method, created_by)
    values ('ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
            'e5000000-0000-4000-8000-000000000004', 500, 'cash', 'aa000000-0000-4000-8000-00000000da01');
    insert into _results values ('D4 cash payment needs a custody context', false, 'no exception raised');
  exception when others then
    insert into _results values ('D4 cash payment needs a custody context', sqlstate = '23514', sqlerrm);
  end;
end $$;

do $$
declare v_session uuid;
begin
  insert into public.cash_sessions (tenant_id, branch_id, opened_by, opening_float)
  values ('ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
          'aa000000-0000-4000-8000-00000000da01', 0)
  returning id into v_session;
  begin
    insert into public.payments (tenant_id, branch_id, ticket_id, cash_session_id, driver_trip_id, amount, method, created_by)
    values ('ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
            'e5000000-0000-4000-8000-000000000004', v_session, 'e5000000-0000-4000-8000-000000000003',
            500, 'cash', 'aa000000-0000-4000-8000-00000000da01');
    insert into _results values ('D5 payment cannot have both custody contexts', false, 'no exception raised');
  exception when others then
    insert into _results values ('D5 payment cannot have both custody contexts', sqlstate = '23514', sqlerrm);
  end;
end $$;

insert into public.stock_movements (tenant_id, branch_id, warehouse_id, item_type, product_variant_id,
  quantity_delta, reason, reference_type, reference_id, created_by)
select 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
  'e5000000-0000-4000-8000-000000000001', 'product', id, 5, 'transfer_in', 'driver_trip',
  'e5000000-0000-4000-8000-000000000003', 'aa000000-0000-4000-8000-00000000da01'
from public.product_variants where id = '82218a93-83fe-464a-819e-641987a8e3b1';
insert into _results values ('D6 stock_movements accepts driver_trip reference_type',
  (select count(*) > 0 from public.stock_movements where reference_type = 'driver_trip'
   and reference_id = 'e5000000-0000-4000-8000-000000000003'), 'ok');

-- D5's fixture opened a raw cash_sessions row directly at this branch and never closed
-- it; cash_sessions_one_open_per_branch would otherwise block D9-D20's own
-- open_cash_session() call later in this same suite.
update public.cash_sessions set status = 'closed', closed_at = now(),
  closed_by = 'aa000000-0000-4000-8000-00000000da01', counted_amount = opening_float,
  expected_amount = opening_float
where branch_id = 'ac000000-0000-4000-8000-00000000da01' and status = 'open';

-- =========================== D7-D8: RLS on driver_trips ============================

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
  'roles', array['driver']
)::text, true);

do $$
begin
  begin
    insert into public.driver_trips (tenant_id, branch_id, driver_id, warehouse_id)
    values ('ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
            'aa000000-0000-4000-8000-00000000da01', 'e5000000-0000-4000-8000-000000000001');
    insert into _results values ('D7 authenticated cannot write driver_trips directly', false, 'INSERT succeeded');
  exception when others then
    insert into _results values ('D7 authenticated cannot write driver_trips directly', sqlstate = '42501', sqlerrm);
  end;
end $$;

insert into _results values ('D8 driver can select own trip via RLS',
  (select count(*) = 1 from public.driver_trips where id = 'e5000000-0000-4000-8000-000000000003'), 'ok');

reset role;

-- delete the D1-D8 fixture trip/ticket so D9's one-active-trip constraint starts clean
delete from public.payments where ticket_id = 'e5000000-0000-4000-8000-000000000004';
update public.driver_trips set status = 'completed',
  settlement_cash_session_id = (select id from public.cash_sessions
    where branch_id = 'ac000000-0000-4000-8000-00000000da01' and opened_by = 'aa000000-0000-4000-8000-00000000da01' limit 1)
where id = 'e5000000-0000-4000-8000-000000000003';

-- ======================= D9-D20: full RPC lifecycle, live =========================

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
  'roles', array['driver']
)::text, true);

do $$
declare v_result jsonb;
begin
  select public.start_driver_trip('ac000000-0000-4000-8000-00000000da01', 'e5000000-0000-4000-8000-000000000001') into v_result;
  update _ctx set trip_id = (v_result->'trip'->>'id')::uuid;
  insert into _results values ('D9 start_driver_trip', (v_result->'trip'->>'status') = 'created', v_result::text);
exception when others then
  insert into _results values ('D9 start_driver_trip', false, sqlerrm);
end $$;

do $$
begin
  begin
    perform public.start_driver_trip('ac000000-0000-4000-8000-00000000da01', 'e5000000-0000-4000-8000-000000000001');
    insert into _results values ('D10 second active trip blocked', false, 'no exception raised');
  exception when others then
    insert into _results values ('D10 second active trip blocked', true, sqlerrm);
  end;
end $$;

select set_config('request.jwt.claims', json_build_object(
  'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
  'roles', array['branch_manager']
)::text, true);

do $$
declare v_trip uuid; v_result jsonb;
begin
  select trip_id into v_trip from _ctx;
  select public.verify_trip_loading(v_trip,
    jsonb_build_array(jsonb_build_object('item_type','product','item_id','82218a93-83fe-464a-819e-641987a8e3b1','quantity',15))
  ) into v_result;
  insert into _results values ('D11 verify_trip_loading writes transfer pair, advances to ready_to_depart',
    (v_result->'trip'->>'status') = 'ready_to_depart' and jsonb_array_length(v_result->'movements') = 2,
    v_result::text);
exception when others then
  insert into _results values ('D11 verify_trip_loading writes transfer pair, advances to ready_to_depart', false, sqlerrm);
end $$;

do $$
declare v_result jsonb;
begin
  select public.open_cash_session('ac000000-0000-4000-8000-00000000da01', 0) into v_result;
  update _ctx set session_id = (v_result->'session'->>'id')::uuid;
exception when others then
  insert into _results values ('D-setup open branch cash session', false, sqlerrm);
end $$;

select set_config('request.jwt.claims', json_build_object(
  'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
  'roles', array['driver']
)::text, true);

do $$
declare v_trip uuid; v_result jsonb;
begin
  select trip_id into v_trip from _ctx;
  select public.depart_driver_trip(v_trip) into v_result;
  insert into _results values ('D12 depart_driver_trip', (v_result->'trip'->>'status') = 'in_transit', v_result::text);
exception when others then
  insert into _results values ('D12 depart_driver_trip', false, sqlerrm);
end $$;

do $$
declare v_trip uuid; v_ticket uuid;
begin
  select trip_id into v_trip from _ctx;
  insert into public.tickets (id, tenant_id, branch_id, customer_id, status, fulfilment_type,
    subtotal_amount, discount_amount, tax_amount, driver_trip_id, sale_customer_type, created_by)
  values (gen_random_uuid(), 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
    'e5000000-0000-4000-8000-000000000002', 'draft', 'pickup', 1500, 0, 0, v_trip, 'ROADSIDE', auth.uid())
  returning id into v_ticket;
  update _ctx set ticket_id = v_ticket;
  insert into _results values ('D13 driver creates ticket linked to own in_transit trip', true, v_ticket::text);
exception when others then
  insert into _results values ('D13 driver creates ticket linked to own in_transit trip', false, sqlerrm);
end $$;

do $$
declare v_trip uuid;
begin
  select trip_id into v_trip from _ctx;
  begin
    insert into public.tickets (id, tenant_id, branch_id, customer_id, status, fulfilment_type,
      subtotal_amount, discount_amount, tax_amount, driver_trip_id, sale_customer_type, created_by)
    values (gen_random_uuid(), 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
      'e5000000-0000-4000-8000-000000000002', 'draft', 'pickup', 1000, 0, 0,
      'e5000000-0000-4000-8000-000000000003', 'ROADSIDE', auth.uid());
    insert into _results values ('D14 ticket cannot link to a non-in_transit trip', false, 'no exception raised');
  exception when others then
    insert into _results values ('D14 ticket cannot link to a non-in_transit trip', true, sqlerrm);
  end;
end $$;

do $$
declare v_trip uuid; v_ticket uuid; v_result jsonb;
begin
  select trip_id, ticket_id into v_trip, v_ticket from _ctx;
  select public.record_payment(v_ticket, 1500, 'cash', null, null, v_trip) into v_result;
  insert into _results values ('D15 trip-scoped cash payment needs no till session',
    (v_result->'payment'->>'driver_trip_id') = v_trip::text and (v_result->'payment'->>'cash_session_id') is null,
    v_result::text);
exception when others then
  insert into _results values ('D15 trip-scoped cash payment needs no till session', false, sqlerrm);
end $$;

do $$
declare v_trip uuid; v_result jsonb;
begin
  select trip_id into v_trip from _ctx;
  select public.return_driver_trip(v_trip,
    jsonb_build_array(jsonb_build_object('item_type','product','item_id','82218a93-83fe-464a-819e-641987a8e3b1','quantity',15))
  ) into v_result;
  insert into _results values ('D16 return_driver_trip writes reverse transfer pair',
    (v_result->'trip'->>'status') = 'returning' and jsonb_array_length(v_result->'movements') = 2,
    v_result::text);
exception when others then
  insert into _results values ('D16 return_driver_trip writes reverse transfer pair', false, sqlerrm);
end $$;

select set_config('request.jwt.claims', json_build_object(
  'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
  'roles', array['branch_manager']
)::text, true);

do $$
declare v_trip uuid;
begin
  select trip_id into v_trip from _ctx;
  begin
    perform public.reconcile_driver_trip(v_trip, 1200, null);
    insert into _results values ('D17 reconcile without note when variance != 0 refused', false, 'no exception raised');
  exception when others then
    insert into _results values ('D17 reconcile without note when variance != 0 refused', true, sqlerrm);
  end;
end $$;

do $$
declare v_trip uuid; v_result jsonb;
begin
  select trip_id into v_trip from _ctx;
  select public.reconcile_driver_trip(v_trip, 1500, null) into v_result;
  insert into _results values ('D18 reconcile_driver_trip matching cash',
    (v_result->'trip'->>'status') = 'reconciled' and (v_result->>'variance')::numeric = 0, v_result::text);
exception when others then
  insert into _results values ('D18 reconcile_driver_trip matching cash', false, sqlerrm);
end $$;

do $$
declare v_trip uuid; v_session uuid; v_result jsonb;
begin
  select trip_id, session_id into v_trip, v_session from _ctx;
  select public.complete_driver_trip(v_trip, v_session) into v_result;
  insert into _results values ('D19 complete_driver_trip settles into the session',
    (v_result->'trip'->>'status') = 'completed'
    and (v_result->'trip'->>'settlement_cash_session_id') = v_session::text,
    v_result::text);
exception when others then
  insert into _results values ('D19 complete_driver_trip settles into the session', false, sqlerrm);
end $$;

do $$
declare v_session uuid; v_result jsonb;
begin
  select session_id into v_session from _ctx;
  select public.close_cash_session(v_session, 1500, null) into v_result;
  insert into _results values ('D20 close_cash_session absorbs reconciled trip cash',
    (v_result->>'trip_cash')::numeric = 1500 and (v_result->>'variance')::numeric = 0, v_result::text);
exception when others then
  insert into _results values ('D20 close_cash_session absorbs reconciled trip cash', false, sqlerrm);
end $$;

reset role;

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
