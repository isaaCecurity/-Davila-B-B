-- BakeFlow — P3.7 FINANCIAL vertical slice: payment.create / payment.reverse / expense.create
--
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/p3_7_financial_sync.sql
--
-- EXECUTED 2026-08-30 against project tvfyxpafbpnkneujcnvr: 27/27 passed.
--
-- Scope: apply_payment_create(), apply_payment_reverse(), apply_expense_create(), their dispatch
-- wiring in apply_sync_operation(), and their EXECUTE grants. Does NOT re-test
-- process_sync_batch_context_validated()'s generic idempotency/context/conflict machinery --
-- tests/sql/p3_7_protocol_correctness.sql already covers that end to end.
--
-- Live-schema findings that shaped this suite (full detail in IMPLEMENTATION_LOG.md 2026-08-30):
--   - record_payment() and record_refund() are the live, human-approved precedent RPCs for
--     payment.create/.reverse. Both use has_role()/has_branch_access() (session-active-org)
--     rather than has_role_in()/is_authorized_for_branch() (tenant-scoped) -- the same
--     AD-006 active-org-assumption gap already found and fixed elsewhere this session
--     (guard_production_batch_transition(), guard_driver_created_order_assignment()). The two
--     new handlers mirror record_payment()/record_refund()'s business logic and role lists
--     verbatim, but perform their own authorization via has_role_in(actor, tenant, roles) and
--     is_authorized_for_branch()-equivalent consistency checks against p_operation.tenant_id/
--     branch_id, never the session's active org.
--   - payment.create mirrors record_payment() in full, including the driver-trip custody branch
--     (AD-018: a driver trip's cash custody is distinct from branch till custody) and the
--     cash-session branch. guard_payment_relationships() and apply_payment_to_ticket() --
--     existing BEFORE/AFTER INSERT triggers on payments, both already tenant-correct since they
--     key off NEW.tenant_id, not session state -- do the branch/overpayment/invoice/session
--     consistency re-validation and the ticket.amount_paid/invoice.status derivation
--     automatically; the new handler does not duplicate that logic.
--   - payment.reverse mirrors record_refund() in full. guard_refund_total() (existing BEFORE
--     INSERT trigger on refunds) re-validates the over-refund guard as a second line of defense.
--     payments/refunds both carry prevent_financial_mutation() (BEFORE UPDATE/DELETE), so both
--     tables are genuinely append-only at the database level -- 'EVENT' is the correct
--     operation_type for both payment.create and payment.reverse, matching the inventory
--     movement convention, not 'CREATE'.
--   - There is no financial.payment.* key in the role_permissions catalog
--     (docs/ROLES-AND-PERMISSIONS.md only covers financial.expense.* and financial.audit.*) --
--     record_payment()/record_refund()'s own has_role() arrays are the only live rule for
--     payment.create/.reverse to mirror, unlike customer.create where the catalog superseded a
--     stale RLS array.
--   - expense.create has no RPC precedent at all -- expenses are inserted directly by clients,
--     gated by the expenses_insert RLS policy (owner/admin/branch_manager/cashier/accountant).
--     That RLS array conflicts with the role_permissions catalog's financial.expense.create
--     grants (owner/admin/branch_manager/supervisor/accountant -- no cashier) on BOTH cashier
--     and supervisor. Unlike the customer.create precedent (an outdated EB-013 doc vs. a
--     current, deployed role_permissions catalog), this is two independently live, deployed
--     mechanisms disagreeing with each other -- not a stale-doc-vs-database case with a
--     documented resolution. This handler mirrors the RLS array, since that is what actually
--     gates expense creation today for direct client inserts; the discrepancy is logged here,
--     not resolved. expenses has no immutability trigger and its own expenses_update RLS policy
--     permits direct edits, so 'CREATE' (new mutable entity) is the correct operation_type,
--     unlike payments' 'EVENT'.
--   - expense.reverse is NOT built this pass. AD-021 calls for "append-only + explicit
--     reversal" for expenses at the sync layer, but no reversal RPC, no reversal/correction
--     table, and no correcting-entry trigger exist for expenses anywhere in the live schema --
--     and the live expenses_update RLS policy's direct-edit path actively contradicts the
--     append-only assumption AD-021 wants here. Opened non-blocking **BLOCKER-028** rather than
--     guessed at the semantics.
--   - Revision tracking for a payment's lifecycle (create, then any reversals) lives entirely in
--     sync_changes keyed by the ORIGINAL payment's entity_id -- payment.create writes revision
--     1, each payment.reverse against that payment writes coalesce(max(revision),0)+1 -- mirroring
--     the production.start/production.cancel convention for a shared-entity-id lifecycle ledger.
--     expense.create's own sync_changes row is entity_id = the new expense's own id, revision 1
--     (a fresh mutable entity, matching customer.create's convention).
--
-- Covers:
--   F1  branch_manager payment.create (card) -> APPLIED, revision 1, ticket.amount_paid updated
--   F2  missing ticket_id -> REJECTED, 22023 invalid_request
--   F3  amount <= 0 -> REJECTED, 22023 invalid_request
--   F4  invalid method -> REJECTED, 22023 invalid_request
--   F5  nonexistent ticket -> REJECTED, P0001 (not found)
--   F6  cancelled ticket -> REJECTED, P0001 invalid_transition
--   F7  overpayment (amount > outstanding total) -> REJECTED, P0001 (guard_payment_relationships)
--   F8  cash method, no open till session at the branch -> REJECTED, P0001
--   F9  cash method with an explicit open cash_session_id -> APPLIED
--   F10 baker (not owner/admin/branch_manager/cashier/driver) cannot create -> REJECTED, 42501
--   F11 driver-trip payment, actor is the trip's own driver -> APPLIED (AD-018 custody path)
--   F13 cross-tenant (actor not a member of the operation's org) -> rejected by the existing
--       generic gateway (is_member_of), before the handler ever runs
--   F14 identical replay (same operation_id) -> replayed=true, does not create a second
--       sync_changes row
--   R1  branch_manager payment.reverse (partial refund) -> APPLIED, revision 2 (same payment
--       entity_id lifecycle ledger)
--   R2  missing payment_id -> REJECTED, 22023 invalid_request
--   R3  refund amount exceeds remaining payment balance -> REJECTED, P0001 invalid_transition
--   R4  cashier (not owner/admin/branch_manager) cannot reverse -> REJECTED, 42501
--   R5  nonexistent payment_id -> REJECTED, P0001 (not found)
--   E1  cashier expense.create -> APPLIED, revision 1
--   E2  invalid category -> REJECTED, 22023 invalid_request
--   E3  cash paid_method without cash_session_id -> REJECTED, 22023 invalid_request
--   E4  cash paid_method with a valid cash_session_id at the operation branch -> APPLIED
--   E5  baker (not owner/admin/branch_manager/cashier/accountant) cannot create -> REJECTED, 42501
--   E6  expense.reverse (allowlisted, deliberately unbuilt -- BLOCKER-028) -> REJECTED,
--       unsupported_operation_type, exactly like any other not-yet-built entity
--   S1  apply_payment_create is not directly executable by anon or authenticated via PostgREST
--   S2  apply_payment_reverse is not directly executable by anon or authenticated via PostgREST
--   S3  apply_expense_create is not directly executable by anon or authenticated via PostgREST
--
-- F12 (a driver attempting a driver-trip payment for a trip that is not their own, and who is
-- not owner/admin/branch_manager) was scoped out of this pass: it requires a second live
-- profile row in the organization (driver_trips.driver_id carries a not-null FK to profiles,
-- and no second profile fixture exists in this project's test tenant), which is fixture
-- complexity orthogonal to what this suite tests. The code path itself is a single
-- has_role_in() check, already exercised for the same mechanism by F10, R4, and E5 -- not
-- independently verified live here, and not claimed as tested.

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

-- =================== F1: branch_manager records a card payment ===================
do $$
declare v_t uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  insert into public.tickets (id, tenant_id, branch_id, fulfilment_type, subtotal_amount)
  values (v_t, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01', 'pickup', 1000);

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'payments',
      'operation_type', 'EVENT', 'domain_operation', 'payment.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('ticket_id', v_t, 'amount', 400, 'method', 'card')
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('F1 branch_manager payment.create (card) -> APPLIED, revision 1',
    v_row.status='APPLIED' and (v_row.result->>'revision')='1'
      and (select amount_paid from public.tickets where id=v_t) = 400,
    v_row.status || ' ' || v_row.result::text);
end $$;

-- =================== F2: missing ticket_id ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'payments',
      'operation_type', 'EVENT', 'domain_operation', 'payment.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('amount', 100, 'method', 'card')
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('F2 missing ticket_id -> REJECTED 22023',
    v_row.status='REJECTED' and v_row.error_code='22023', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== F3: amount <= 0 ===================
do $$
declare v_t uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  insert into public.tickets (id, tenant_id, branch_id, fulfilment_type, subtotal_amount)
  values (v_t, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01', 'pickup', 1000);
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'payments',
      'operation_type', 'EVENT', 'domain_operation', 'payment.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('ticket_id', v_t, 'amount', 0, 'method', 'card')
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('F3 amount<=0 -> REJECTED 22023',
    v_row.status='REJECTED' and v_row.error_code='22023', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== F4: invalid method ===================
do $$
declare v_t uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  insert into public.tickets (id, tenant_id, branch_id, fulfilment_type, subtotal_amount)
  values (v_t, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01', 'pickup', 1000);
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'payments',
      'operation_type', 'EVENT', 'domain_operation', 'payment.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('ticket_id', v_t, 'amount', 100, 'method', 'bitcoin')
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('F4 invalid method -> REJECTED 22023',
    v_row.status='REJECTED' and v_row.error_code='22023', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== F5: nonexistent ticket ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'payments',
      'operation_type', 'EVENT', 'domain_operation', 'payment.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('ticket_id', '00000000-0000-4000-8000-000000000000', 'amount', 100, 'method', 'card')
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('F5 nonexistent ticket -> REJECTED P0001',
    v_row.status='REJECTED' and v_row.error_code='P0001', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== F6: cancelled ticket ===================
do $$
declare v_t uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  insert into public.tickets (id, tenant_id, branch_id, fulfilment_type, subtotal_amount)
  values (v_t, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01', 'pickup', 1000);
  reset role;
  update public.tickets set status='cancelled', cancelled_reason='test fixture' where id=v_t;
  set local role authenticated;

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'payments',
      'operation_type', 'EVENT', 'domain_operation', 'payment.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('ticket_id', v_t, 'amount', 100, 'method', 'card')
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('F6 cancelled ticket -> REJECTED P0001',
    v_row.status='REJECTED' and v_row.error_code='P0001', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== F7: overpayment ===================
do $$
declare v_t uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  insert into public.tickets (id, tenant_id, branch_id, fulfilment_type, subtotal_amount)
  values (v_t, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01', 'pickup', 500);
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'payments',
      'operation_type', 'EVENT', 'domain_operation', 'payment.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('ticket_id', v_t, 'amount', 600, 'method', 'card')
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('F7 overpayment -> REJECTED P0001',
    v_row.status='REJECTED' and v_row.error_code='P0001', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== F8: cash payment, no open session ===================
do $$
declare v_t uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  insert into public.tickets (id, tenant_id, branch_id, fulfilment_type, subtotal_amount)
  values (v_t, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01', 'pickup', 500);
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'payments',
      'operation_type', 'EVENT', 'domain_operation', 'payment.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('ticket_id', v_t, 'amount', 100, 'method', 'cash')
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('F8 cash payment no open session -> REJECTED P0001',
    v_row.status='REJECTED' and v_row.error_code='P0001', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== F9: cash payment with explicit open session ===================
do $$
declare v_t uuid := gen_random_uuid(); v_session uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  insert into public.tickets (id, tenant_id, branch_id, fulfilment_type, subtotal_amount)
  values (v_t, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01', 'pickup', 500);
  reset role;
  insert into public.cash_sessions (id, tenant_id, branch_id, opened_by, opening_float)
  values (v_session, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', 1000);
  set local role authenticated;

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'payments',
      'operation_type', 'EVENT', 'domain_operation', 'payment.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('ticket_id', v_t, 'amount', 100, 'method', 'cash', 'cash_session_id', v_session)
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('F9 cash payment with open session -> APPLIED',
    v_row.status='APPLIED', v_row.status||' '||v_row.result::text);

  reset role;
  update public.cash_sessions
     set status = 'closed', closed_by = 'aa000000-0000-4000-8000-00000000da01', closed_at = now(),
         expected_amount = opening_float, counted_amount = opening_float
   where id = v_session;
  set local role authenticated;
end $$;

-- =================== F10: baker cannot create a payment ===================
do $$
declare v_t uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  insert into public.tickets (id, tenant_id, branch_id, fulfilment_type, subtotal_amount)
  values (v_t, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01', 'pickup', 500);

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
      'entity_id', gen_random_uuid(), 'entity_type', 'payments',
      'operation_type', 'EVENT', 'domain_operation', 'payment.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('ticket_id', v_t, 'amount', 100, 'method', 'card')
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

  insert into _results values ('F10 baker payment.create -> REJECTED 42501',
    v_row.status='REJECTED' and v_row.error_code='42501', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== F11: driver trip payment, own driver ===================
do $$
declare v_t uuid := gen_random_uuid(); v_trip uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  reset role;
  insert into public.driver_trips (id, tenant_id, branch_id, driver_id, warehouse_id, status)
  values (v_trip, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01',
    'aa000000-0000-4000-8000-00000000da01', 'b0000000-0000-4000-8000-00000000da01', 'in_transit');
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object(
    'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
    'roles', array['driver','branch_manager']
  )::text, true);

  insert into public.tickets (id, tenant_id, branch_id, fulfilment_type, subtotal_amount, driver_trip_id)
  values (v_t, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01', 'delivery', 500, v_trip);

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'payments',
      'operation_type', 'EVENT', 'domain_operation', 'payment.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('ticket_id', v_t, 'amount', 500, 'method', 'cash', 'driver_trip_id', v_trip)
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('F11 driver-trip payment (own driver) -> APPLIED',
    v_row.status='APPLIED', v_row.status||' '||v_row.result::text);
end $$;

-- =================== F13: cross-tenant ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_ok boolean := false; v_msg text;
begin
  begin
    perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da03',
        'branch_id', 'ac000000-0000-4000-8000-00000000da01',
        'entity_id', gen_random_uuid(), 'entity_type', 'payments',
        'operation_type', 'EVENT', 'domain_operation', 'payment.create',
        'device_created_at', now()::text,
        'payload', jsonb_build_object('ticket_id', gen_random_uuid(), 'amount', 100, 'method', 'card')
      )));
  exception when others then
    v_ok := true; v_msg := sqlerrm;
  end;
  insert into _results values ('F13 cross-tenant (org C not member) -> rejected', v_ok, coalesce(v_msg,'no exception raised'));
end $$;

-- =================== F14: identical replay ===================
do $$
declare
  v_t uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_entity uuid := gen_random_uuid();
  v_op jsonb; v_res1 jsonb; v_res2 jsonb; v_count int;
begin
  insert into public.tickets (id, tenant_id, branch_id, fulfilment_type, subtotal_amount)
  values (v_t, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01', 'pickup', 500);

  v_op := jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_entity, 'entity_type', 'payments',
      'operation_type', 'EVENT', 'domain_operation', 'payment.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('ticket_id', v_t, 'amount', 100, 'method', 'card'));

  v_res1 := public.process_sync_batch('f8000000-0000-4000-8000-000000000001', jsonb_build_array(v_op));
  v_res2 := public.process_sync_batch('f8000000-0000-4000-8000-000000000001', jsonb_build_array(v_op));
  select count(*) into v_count from public.sync_changes where domain_operation='payment.create'
    and payload->>'ticket_id' = v_t::text;
  insert into _results values ('F14 replay same operation_id -> replayed=true, one sync_changes row',
    (v_res2->'results'->0->>'replayed')='true' and v_count=1, format('%s | count=%s', v_res2, v_count));
end $$;

-- =================== R1: branch_manager reverses a payment ===================
do $$
declare
  v_t uuid := gen_random_uuid(); v_opid1 uuid := gen_random_uuid(); v_opid2 uuid := gen_random_uuid();
  v_row1 public.sync_operations; v_row2 public.sync_operations; v_payment_id uuid;
begin
  insert into public.tickets (id, tenant_id, branch_id, fulfilment_type, subtotal_amount)
  values (v_t, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01', 'pickup', 1000);

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid1, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'payments',
      'operation_type', 'EVENT', 'domain_operation', 'payment.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('ticket_id', v_t, 'amount', 1000, 'method', 'card')
    )));
  select * into v_row1 from public.sync_operations where operation_id = v_opid1;
  v_payment_id := (v_row1.result->>'payment_id')::uuid;

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid2, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'payments',
      'operation_type', 'EVENT', 'domain_operation', 'payment.reverse',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('payment_id', v_payment_id, 'amount', 400, 'reason', 'customer complaint')
    )));
  select * into v_row2 from public.sync_operations where operation_id = v_opid2;
  insert into _results values ('R1 branch_manager payment.reverse -> APPLIED, revision 2',
    v_row2.status='APPLIED' and (v_row2.result->>'revision')='2',
    v_row2.status || ' ' || v_row2.result::text);
end $$;

-- =================== R2: missing payment_id ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'payments',
      'operation_type', 'EVENT', 'domain_operation', 'payment.reverse',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('amount', 100, 'reason', 'x')
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('R2 missing payment_id -> REJECTED 22023',
    v_row.status='REJECTED' and v_row.error_code='22023', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== R3: refund exceeds remaining balance ===================
do $$
declare
  v_t uuid := gen_random_uuid(); v_opid1 uuid := gen_random_uuid(); v_opid2 uuid := gen_random_uuid();
  v_row1 public.sync_operations; v_row2 public.sync_operations; v_payment_id uuid;
begin
  insert into public.tickets (id, tenant_id, branch_id, fulfilment_type, subtotal_amount)
  values (v_t, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01', 'pickup', 500);

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid1, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'payments',
      'operation_type', 'EVENT', 'domain_operation', 'payment.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('ticket_id', v_t, 'amount', 500, 'method', 'card')
    )));
  select * into v_row1 from public.sync_operations where operation_id = v_opid1;
  v_payment_id := (v_row1.result->>'payment_id')::uuid;

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid2, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'payments',
      'operation_type', 'EVENT', 'domain_operation', 'payment.reverse',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('payment_id', v_payment_id, 'amount', 600, 'reason', 'too much')
    )));
  select * into v_row2 from public.sync_operations where operation_id = v_opid2;
  insert into _results values ('R3 refund exceeds balance -> REJECTED P0001',
    v_row2.status='REJECTED' and v_row2.error_code='P0001', v_row2.status||' '||coalesce(v_row2.error_code,''));
end $$;

-- =================== R4: cashier cannot reverse ===================
do $$
declare
  v_t uuid := gen_random_uuid(); v_opid1 uuid := gen_random_uuid(); v_opid2 uuid := gen_random_uuid();
  v_row1 public.sync_operations; v_row2 public.sync_operations; v_payment_id uuid;
begin
  insert into public.tickets (id, tenant_id, branch_id, fulfilment_type, subtotal_amount)
  values (v_t, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01', 'pickup', 500);

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid1, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'payments',
      'operation_type', 'EVENT', 'domain_operation', 'payment.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('ticket_id', v_t, 'amount', 500, 'method', 'card')
    )));
  select * into v_row1 from public.sync_operations where operation_id = v_opid1;
  v_payment_id := (v_row1.result->>'payment_id')::uuid;

  reset role;
  delete from public.user_roles where tenant_id='ab000000-0000-4000-8000-00000000da01' and profile_id='aa000000-0000-4000-8000-00000000da01';
  insert into public.user_roles (tenant_id, profile_id, role_id)
  select 'ab000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', id from public.roles where key='cashier';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object(
    'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
    'roles', array['cashier']
  )::text, true);

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid2, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'payments',
      'operation_type', 'EVENT', 'domain_operation', 'payment.reverse',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('payment_id', v_payment_id, 'amount', 100, 'reason', 'x')
    )));
  select * into v_row2 from public.sync_operations where operation_id = v_opid2;

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

  insert into _results values ('R4 cashier payment.reverse -> REJECTED 42501',
    v_row2.status='REJECTED' and v_row2.error_code='42501', v_row2.status||' '||coalesce(v_row2.error_code,''));
end $$;

-- =================== R5: nonexistent payment ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'payments',
      'operation_type', 'EVENT', 'domain_operation', 'payment.reverse',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('payment_id', '00000000-0000-4000-8000-000000000000', 'amount', 100, 'reason', 'x')
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('R5 nonexistent payment -> REJECTED P0001',
    v_row.status='REJECTED' and v_row.error_code='P0001', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== E1: cashier creates an expense ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  reset role;
  delete from public.user_roles where tenant_id='ab000000-0000-4000-8000-00000000da01' and profile_id='aa000000-0000-4000-8000-00000000da01';
  insert into public.user_roles (tenant_id, profile_id, role_id)
  select 'ab000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', id from public.roles where key='cashier';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object(
    'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
    'roles', array['cashier']
  )::text, true);

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'expenses',
      'operation_type', 'CREATE', 'domain_operation', 'expense.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('category', 'ingredients', 'amount', 250, 'paid_method', 'transfer')
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

  insert into _results values ('E1 cashier expense.create -> APPLIED, revision 1',
    v_row.status='APPLIED' and (v_row.result->>'revision')='1', v_row.status||' '||v_row.result::text);

  -- E1b — 2026-09-04 weak-link remediation (Item E): apply_expense_create() itself never
  -- called log_audit_event -- expenses had no audit trail at all until the new
  -- expenses_audit_trail AFTER trigger was added. Proves the trigger-based fix covers the
  -- sync/RPC write path (financial_write_rls.sql's F25-F27 cover the direct-write path).
  -- audit_log_select is owner/admin/accountant-only, so this needs its own role switch --
  -- restored to the driver/branch_manager context E2 expects immediately after.
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object(
    'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
    'roles', array['owner']
  )::text, true);
  insert into _results
  select 'E1b apply_expense_create() leaves an audit_log row via the expenses_audit_trail trigger',
    count(*) = 1, 'audit_log rows for this expense = ' || count(*)
  from public.audit_log
  where entity_type = 'expense' and entity_id = (v_row.result->>'expense_id')::uuid and action = 'insert';

  perform set_config('request.jwt.claims', json_build_object(
    'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
    'roles', array['driver','branch_manager']
  )::text, true);
end $$;

-- =================== E2: invalid category ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'expenses',
      'operation_type', 'CREATE', 'domain_operation', 'expense.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('category', 'marketing', 'amount', 100)
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('E2 invalid category -> REJECTED 22023',
    v_row.status='REJECTED' and v_row.error_code='22023', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== E3: cash expense without cash_session_id ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'expenses',
      'operation_type', 'CREATE', 'domain_operation', 'expense.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('category', 'transport', 'amount', 100, 'paid_method', 'cash')
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('E3 cash expense without cash_session_id -> REJECTED 22023',
    v_row.status='REJECTED' and v_row.error_code='22023', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== E4: cash expense with valid cash_session_id ===================
do $$
declare v_session uuid := gen_random_uuid(); v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  reset role;
  insert into public.cash_sessions (id, tenant_id, branch_id, opened_by, opening_float)
  values (v_session, 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', 1000);
  set local role authenticated;

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'expenses',
      'operation_type', 'CREATE', 'domain_operation', 'expense.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('category', 'transport', 'amount', 100, 'paid_method', 'cash', 'cash_session_id', v_session)
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('E4 cash expense with valid cash_session_id -> APPLIED',
    v_row.status='APPLIED', v_row.status||' '||v_row.result::text);
end $$;

-- =================== E5: baker cannot create an expense ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
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
      'entity_id', gen_random_uuid(), 'entity_type', 'expenses',
      'operation_type', 'CREATE', 'domain_operation', 'expense.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('category', 'ingredients', 'amount', 100)
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

  insert into _results values ('E5 baker expense.create -> REJECTED 42501',
    v_row.status='REJECTED' and v_row.error_code='42501', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== E6: expense.reverse (allowlisted, deliberately unbuilt) ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'expenses',
      'operation_type', 'EVENT', 'domain_operation', 'expense.reverse',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('expense_id', gen_random_uuid())
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('E6 expense.reverse (unbuilt) -> REJECTED unsupported_operation_type',
    v_row.status='REJECTED' and v_row.error_code='unsupported_operation_type', v_row.status||' '||coalesce(v_row.error_code,''));
end $$;

-- =================== S1/S2/S3: internal handlers not directly executable ===================
do $$
begin
  insert into _results values ('S1 apply_payment_create not directly executable by anon/authenticated',
    not has_function_privilege('authenticated', 'public.apply_payment_create(public.sync_operations)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.apply_payment_create(public.sync_operations)', 'EXECUTE'), '');
  insert into _results values ('S2 apply_payment_reverse not directly executable by anon/authenticated',
    not has_function_privilege('authenticated', 'public.apply_payment_reverse(public.sync_operations)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.apply_payment_reverse(public.sync_operations)', 'EXECUTE'), '');
  insert into _results values ('S3 apply_expense_create not directly executable by anon/authenticated',
    not has_function_privilege('authenticated', 'public.apply_expense_create(public.sync_operations)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.apply_expense_create(public.sync_operations)', 'EXECUTE'), '');
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
