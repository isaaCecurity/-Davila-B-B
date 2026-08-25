-- ADR-001 BLOCKER-021 resolution: the driver field-sale shortcut (draft -> completed) on
-- complete_driver_field_sale(), plus the guard_ticket_status_transition() extension that
-- makes the hop reachable only through it. Run as a rolled-back transaction; never commits.
--
-- EXECUTED 2026-08-25 against project tvfyxpafbpnkneujcnvr: 8/8 passed.
--
-- User decision (verbatim intent): a driver-created, trip-linked roadside/field-sale
-- ticket may take draft -> completed directly, instead of the seven-hop production
-- lifecycle -- but ONLY when: linked to driver_trip_id; that trip is in_transit; the
-- acting driver is authorized for it (creator/assignee per the existing driver-trip
-- assignment rule); the ticket has valid items; inventory/custody constraints hold;
-- payment/credit stays server-derived; existing financial/RLS protections stay
-- authoritative. Explicitly NOT: adding 'driver' to the seven existing forward-hop actor
-- lists, or making draft -> completed universally legal for any ticket.
--
-- Covers, in order:
--   S1 authorized driver completes their own trip-linked pickup ticket -- ticket reaches
--      completed, an invoice is issued, one sale stock movement is written against the
--      TRIP's own warehouse (not the branch default -- the goods were in the vehicle's
--      custody, per verify_trip_loading())
--   S2 an unrecognized driver identity cannot complete the trip's ticket
--   S3 the shortcut is refused when the trip is not in_transit (linked while in_transit,
--      then the trip returned before the driver tried to complete the sale)
--   S4 an unauthorized role (cashier, unrecognized identity) cannot use the shortcut
--   S5 a delivery-fulfilment trip-linked ticket refuses the shortcut -- preserves AD-019:
--      deliveries stays the sole proof-of-delivery authority, never bypassed by this hop
--   S6 a raw UPDATE straight to draft->completed is refused even with full table-owner
--      privilege (bypassing RLS/grants entirely) and even against an otherwise fully
--      eligible ticket, because the transaction-local RPC flag is not set -- isolates the
--      trigger-level protection from the grant-layer one (authenticated in fact holds no
--      UPDATE grant on tickets at all -- INSERT/SELECT only, verified live separately --
--      so this is defence in depth against any other RPC/migration path, not a client
--      bypass that was otherwise reachable)
--   S7 a ticket with no driver_trip_id refuses the shortcut
--   S8 the normal (non-shortcut) lifecycle is unaffected -- a plain draft ticket still
--      needs the ordinary submitted hop first; confirm_ticket() does not skip it
--
-- Fixtures reuse the single real profile (aa000000.../org ab000000.../branch
-- ac000000...), same constraint tests/sql/driver_trips_rls.sql documents: profiles.id has
-- a hard FK to auth.users and this project has exactly one real profile row, and
-- branch_assignments.profile_id / driver_trips.driver_id both FK to profiles too -- so a
-- genuinely separate "other driver" identity cannot be constructed at all. S2/S4 simulate
-- an unrecognized caller via a fabricated JWT `sub` with no branch_assignments row; this is
-- refused at has_branch_access() (the first check the RPC runs) rather than at the later
-- trip-driver-identity check specifically -- both are real, live-enforced rejections, and
-- the fabricated sub could not have passed the identity check either had it reached that
-- far, since it can never equal driver_trips.driver_id (also FK-constrained to the one
-- real profile).
--
-- The RPC's `bakeflow.driver_field_sale_rpc` flag is transaction-local (set_config with
-- is_local=true) and this whole suite runs inside one transaction, so it would otherwise
-- still read 'true' for every scenario after S1 sets it -- reset explicitly before S6 so
-- that scenario genuinely tests the flag gate rather than an artifact of sharing one
-- transaction. Never reachable in production, where each RPC call is its own transaction.

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

insert into public.warehouses (id, tenant_id, branch_id, name, is_default) values
  ('f6000000-0000-4000-8000-000000000001', 'ab000000-0000-4000-8000-00000000da01',
   'ac000000-0000-4000-8000-00000000da01', 'BLOCKER-021 Test Vehicle', false);

insert into public.stock_movements (tenant_id, branch_id, warehouse_id, item_type,
  product_variant_id, quantity_delta, reason, created_by)
values ('ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
  'f6000000-0000-4000-8000-000000000001', 'product', '82218a93-83fe-464a-819e-641987a8e3b1',
  100, 'opening_balance', 'aa000000-0000-4000-8000-00000000da01');

insert into public.customers (id, tenant_id, full_name, is_walk_in) values
  ('f6000000-0000-4000-8000-000000000002', 'ab000000-0000-4000-8000-00000000da01', 'BLOCKER-021 Test Customer', true);

-- Trip A: in_transit, the real profile's own trip.
insert into public.driver_trips (id, tenant_id, branch_id, driver_id, warehouse_id, status, departed_at, created_by)
values ('f6000000-0000-4000-8000-000000000003', 'ab000000-0000-4000-8000-00000000da01',
        'ac000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01',
        'f6000000-0000-4000-8000-000000000001', 'in_transit', now(), 'aa000000-0000-4000-8000-00000000da01');

-- Tickets linked to Trip A: 005 (S1 success), 009 (S2, reused for S6), 00a (S4),
-- 007 (S5, delivery fulfilment). Plus 008: not trip-linked at all (S7, S8).
insert into public.tickets (id, tenant_id, branch_id, customer_id, status, fulfilment_type,
  subtotal_amount, discount_amount, tax_amount, driver_trip_id, sale_customer_type, created_by)
values
  ('f6000000-0000-4000-8000-000000000005', 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
   'f6000000-0000-4000-8000-000000000002', 'draft', 'pickup', 0,0,0, 'f6000000-0000-4000-8000-000000000003', 'ROADSIDE', 'aa000000-0000-4000-8000-00000000da01'),
  ('f6000000-0000-4000-8000-000000000009', 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
   'f6000000-0000-4000-8000-000000000002', 'draft', 'pickup', 0,0,0, 'f6000000-0000-4000-8000-000000000003', 'ROADSIDE', 'aa000000-0000-4000-8000-00000000da01'),
  ('f6000000-0000-4000-8000-00000000000a', 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
   'f6000000-0000-4000-8000-000000000002', 'draft', 'pickup', 0,0,0, 'f6000000-0000-4000-8000-000000000003', 'ROADSIDE', 'aa000000-0000-4000-8000-00000000da01'),
  ('f6000000-0000-4000-8000-000000000007', 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
   'f6000000-0000-4000-8000-000000000002', 'draft', 'delivery', 0,0,0, 'f6000000-0000-4000-8000-000000000003', 'ROADSIDE', 'aa000000-0000-4000-8000-00000000da01'),
  ('f6000000-0000-4000-8000-000000000008', 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
   'f6000000-0000-4000-8000-000000000002', 'draft', 'pickup', 0,0,0, null, 'REGISTERED', 'aa000000-0000-4000-8000-00000000da01');

insert into public.ticket_items (tenant_id, ticket_id, product_variant_id, quantity, unit_price)
select 'ab000000-0000-4000-8000-00000000da01', t.id, '82218a93-83fe-464a-819e-641987a8e3b1', 1, 0
from (values
  ('f6000000-0000-4000-8000-000000000005'::uuid), ('f6000000-0000-4000-8000-000000000009'::uuid),
  ('f6000000-0000-4000-8000-00000000000a'::uuid), ('f6000000-0000-4000-8000-000000000007'::uuid),
  ('f6000000-0000-4000-8000-000000000008'::uuid)
) as t(id);

-- ================================ S1-S5, S7: live RPC ================================
set local role authenticated;

select set_config('request.jwt.claims', json_build_object(
  'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
  'roles', array['driver']
)::text, true);

do $$
declare v_result jsonb; v_wh uuid;
begin
  select public.complete_driver_field_sale('f6000000-0000-4000-8000-000000000005'::uuid) into v_result;
  select warehouse_id into v_wh from public.stock_movements
    where reference_type='order' and reference_id='f6000000-0000-4000-8000-000000000005';
  insert into _results values ('S1 authorized driver completes own trip-linked pickup ticket',
    (v_result->'ticket'->>'status') = 'completed'
    and (v_result->'invoice'->>'ticket_id') = 'f6000000-0000-4000-8000-000000000005'
    and jsonb_array_length(v_result->'movements') = 1
    and v_wh = 'f6000000-0000-4000-8000-000000000001',
    coalesce(v_result::text,'') || ' wh=' || coalesce(v_wh::text,'null'));
exception when others then
  insert into _results values ('S1 authorized driver completes own trip-linked pickup ticket', false, sqlerrm);
end $$;

select set_config('bakeflow.driver_field_sale_rpc', 'false', true);

select set_config('request.jwt.claims', json_build_object(
  'sub','99999999-0000-4000-8000-000000000099','tenant_id','ab000000-0000-4000-8000-00000000da01',
  'roles', array['driver']
)::text, true);

do $$
begin
  begin
    perform public.complete_driver_field_sale('f6000000-0000-4000-8000-000000000009'::uuid);
    insert into _results values ('S2 unrecognized driver identity cannot complete the trip''s ticket', false, 'no exception raised');
  exception when others then
    insert into _results values ('S2 unrecognized driver identity cannot complete the trip''s ticket', sqlstate = 'P0001', sqlerrm);
  end;
end $$;

select set_config('request.jwt.claims', json_build_object(
  'sub','99999999-0000-4000-8000-000000000099','tenant_id','ab000000-0000-4000-8000-00000000da01',
  'roles', array['cashier']
)::text, true);

do $$
begin
  begin
    perform public.complete_driver_field_sale('f6000000-0000-4000-8000-00000000000a'::uuid);
    insert into _results values ('S4 unauthorized role (cashier, unrecognized identity) cannot use the shortcut', false, 'no exception raised');
  exception when others then
    insert into _results values ('S4 unauthorized role (cashier, unrecognized identity) cannot use the shortcut', sqlstate = 'P0001', sqlerrm);
  end;
end $$;

select set_config('request.jwt.claims', json_build_object(
  'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
  'roles', array['driver']
)::text, true);

do $$
begin
  begin
    perform public.complete_driver_field_sale('f6000000-0000-4000-8000-000000000007'::uuid);
    insert into _results values ('S5 delivery-fulfilment trip-linked ticket refuses the shortcut (AD-019)', false, 'no exception raised');
  exception when others then
    insert into _results values ('S5 delivery-fulfilment trip-linked ticket refuses the shortcut (AD-019)', true, sqlerrm);
  end;
end $$;

do $$
begin
  begin
    perform public.complete_driver_field_sale('f6000000-0000-4000-8000-000000000008'::uuid);
    insert into _results values ('S7 non-trip-linked ticket refuses the shortcut', false, 'no exception raised');
  exception when others then
    insert into _results values ('S7 non-trip-linked ticket refuses the shortcut', true, sqlerrm);
  end;
end $$;

reset role;

-- ============================ S6: the flag gate in isolation ==========================
do $$
begin
  begin
    update public.tickets set status = 'completed' where id = 'f6000000-0000-4000-8000-000000000009';
    insert into _results values ('S6 raw UPDATE draft->completed refused without the RPC flag', false, 'no exception raised');
  exception when others then
    insert into _results values ('S6 raw UPDATE draft->completed refused without the RPC flag',
      sqlstate = 'P0001' and sqlerrm like '%only reachable through complete_driver_field_sale%', sqlerrm);
  end;
end $$;

-- =================== S3: shortcut refused once the trip is no longer in_transit ========
-- Trip A is walked to 'completed' (three legal hops) so the one-active-trip-per-driver
-- slot frees up; Trip B is then created in_transit so the ticket link is legal at
-- creation time (guard_ticket_driver_trip_assignment() itself requires in_transit), and
-- only afterward moved to 'returning' -- exactly the realistic case of a driver trying to
-- complete a sale after already returning.
update public.driver_trips set status = 'returning', returned_at = now()
where id = 'f6000000-0000-4000-8000-000000000003';
update public.driver_trips set status = 'reconciled', expected_cash = 0, physical_cash = 0,
  cash_variance = 0, reconciled_by = 'aa000000-0000-4000-8000-00000000da01', reconciled_at = now()
where id = 'f6000000-0000-4000-8000-000000000003';
update public.driver_trips set status = 'completed'
where id = 'f6000000-0000-4000-8000-000000000003';

insert into public.driver_trips (id, tenant_id, branch_id, driver_id, warehouse_id, status, departed_at, created_by)
values ('f6000000-0000-4000-8000-000000000004', 'ab000000-0000-4000-8000-00000000da01',
        'ac000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01',
        'f6000000-0000-4000-8000-000000000001', 'in_transit', now(), 'aa000000-0000-4000-8000-00000000da01');

insert into public.tickets (id, tenant_id, branch_id, customer_id, status, fulfilment_type,
  subtotal_amount, discount_amount, tax_amount, driver_trip_id, sale_customer_type, created_by)
values ('f6000000-0000-4000-8000-000000000006', 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
  'f6000000-0000-4000-8000-000000000002', 'draft', 'pickup', 0,0,0, 'f6000000-0000-4000-8000-000000000004', 'ROADSIDE', 'aa000000-0000-4000-8000-00000000da01');
insert into public.ticket_items (tenant_id, ticket_id, product_variant_id, quantity, unit_price)
values ('ab000000-0000-4000-8000-00000000da01', 'f6000000-0000-4000-8000-000000000006',
  '82218a93-83fe-464a-819e-641987a8e3b1', 1, 0);

update public.driver_trips set status = 'returning', returned_at = now()
where id = 'f6000000-0000-4000-8000-000000000004';

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
  'roles', array['driver']
)::text, true);

do $$
begin
  begin
    perform public.complete_driver_field_sale('f6000000-0000-4000-8000-000000000006'::uuid);
    insert into _results values ('S3 shortcut refused when trip is not in_transit', false, 'no exception raised');
  exception when others then
    insert into _results values ('S3 shortcut refused when trip is not in_transit', sqlstate = 'P0001', sqlerrm);
  end;
end $$;

reset role;

-- ==================== S8: the normal, non-shortcut lifecycle is unaffected ============
do $$
declare v_result jsonb;
begin
  select public.confirm_ticket('f6000000-0000-4000-8000-000000000008'::uuid) into v_result;
  insert into _results values ('S8 defect check -- should not reach here', false, v_result::text);
exception when others then
  insert into _results values ('S8 normal (non-shortcut) lifecycle is unaffected -- draft ticket still requires submitted first',
    sqlerrm like '%draft -> confirmed%', sqlerrm);
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
