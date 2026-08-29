-- BakeFlow — P3.7 CUSTOMER vertical slice: customer.create / customer.update
--
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/p3_7_customer_sync.sql
--
-- EXECUTED 2026-08-29 against project tvfyxpafbpnkneujcnvr: 21/21 passed.
--
-- Scope: apply_customer_create(), apply_customer_update(), their dispatch wiring in
-- apply_sync_operation(), and their EXECUTE grants. Does NOT re-test
-- process_sync_batch_context_validated()'s generic idempotency/context/conflict machinery --
-- tests/sql/p3_7_protocol_correctness.sql and tests/sql/p3_7_sync_apply_and_pull.sql already
-- cover that end to end via the ticket handlers; this suite exercises the same generic gateway
-- through the new customer domain_operation values and adds customer-specific handler tests.
--
-- Live-schema findings that shaped this suite (full detail in IMPLEMENTATION_LOG.md 2026-08-29):
--   - public.customers is tenant-scoped only -- no branch_id column, no revision column, no
--     credit/balance column (credit is derived elsewhere from tickets/payments). The
--     domain_operation CHECK constraint on sync_operations already allowlisted 'customer.create'
--     and 'customer.update' (added by an earlier migration, unused until now) but NOT
--     'customer.soft_delete' -- confirming create/update, not delete, is the intended surface.
--   - customers_insert/customers_update RLS on the raw table (owner/admin/branch_manager/
--     cashier) does NOT include driver or supervisor. docs/ROLES-AND-PERMISSIONS.md's live
--     role_permissions grants (owner/admin/branch_manager/supervisor/cashier/driver for both
--     customers.create and customers.update) DO include them, and that document explicitly
--     states the live grants table -- not a hand-maintained RLS array -- "reflects current
--     intent" (citing an identical, already-accepted gap for tickets.create/driver). ADR-001
--     (Approved 2026-08-24) independently and explicitly describes driver-created customers
--     as a required product flow. This handler follows role_permissions; the RLS array is a
--     separate, pre-existing, out-of-scope staleness noted in BLOCKERS.md, not fixed here since
--     the sync handler is SECURITY DEFINER and does not depend on it.
--   - customer.update has no ownership/creator-scoping mechanism anywhere in the schema or in
--     ADR-001 (which documents driver customer *creation* but never driver *editing* of an
--     existing customer). role_permissions grants customers.update to driver unscoped. This
--     handler implements exactly that literal, unscoped grant -- it does not invent a
--     creator-only restriction the way ticket_item_update does for tickets.
--   - customer.update is a full-value replacement of full_name/phone/email/address_line/
--     notes/is_walk_in, not a field-level merge, per OFFLINE-SYNC-MODEL.md's stated
--     no-field-level-merge principle for this architecture.
--   - Revision tracking for customers lives entirely in sync_changes (keyed by entity_id),
--     the same generic mechanism the gateway already uses for conflict detection -- no revision
--     column was added to the customers table itself, since nothing else needs to read it there.
--
-- Covers:
--   C1 authorized driver creates a customer -> APPLIED, correct tenant, revision 1
--   C2 malformed payload (missing full_name) -> REJECTED, 22023 invalid_request
--   C3 full_name too long (201 chars) -> REJECTED, 22023 invalid_request
--   C4 unauthorized role (baker) cannot create -> REJECTED, 42501 insufficient_role
--   C5 cross-tenant create (actor not a member of the operation's org) -> rejected by the
--      existing generic gateway (is_member_of), before the handler ever runs
--   C6 branch_id belonging to a different organization than the operation's tenant ->
--      rejected by the existing generic gateway (is_authorized_for_branch); customers has no
--      branch column of its own, so there is no second branch inside the SAME tenant to test
--      genuine not-assigned-to-this-branch denial against -- this is the same gap the live
--      schema has for every other entity type in this project's single-tenant test fixtures.
--   R1 identical replay -> replayed=true, does not create a second customer
--   R2 same operation_id, modified payload -> rejected, altered immutable context (generic
--      gateway behaviour, re-verified through this new domain_operation)
--   S1 apply_customer_create is not directly executable by anon or authenticated via PostgREST
--   S2 apply_customer_update is not directly executable by anon or authenticated via PostgREST
--   U1 authorized update (driver) changes full_name/phone, revision becomes 2
--   U2 unauthorized role (accountant) cannot update -> REJECTED, 42501 insufficient_role
--   U3 stale base_revision on update -> sync_conflicts row, customer NOT overwritten
--   U4 identical update replay -> replayed=true, does not create a second sync_changes row
--   U5 customer_id in payload not matching operation entity_id -> REJECTED, 22023
--   U6 updating a customer_id that doesn't exist in this tenant -> REJECTED, P0001
--   T1 customer.create then a SEPARATE ticket.create referencing the returned customer_id ->
--      both APPLIED, ticket.customer_id correct -- the only currently-safe way to represent
--      "create a customer, then a ticket for them" is two sequential process_sync_batch calls
--      (client waits for the real customer_id before constructing the ticket payload).
--      BLOCKER-022 remains open and UNTESTED here on purpose: a single batch containing both
--      operations, queued fully offline before either is applied, cannot work today because
--      customer.create does not accept a client-supplied id (matching apply_ticket_create's
--      own precedent) and there is no depends_on_operation_id mechanism to defer the ticket
--      until the customer resolves. Documented, not invented around.
--   D1 domain_operation CHECK constraint definition unchanged (customer.create/update were
--      already present before this slice; regression guard against silent drift)

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
  'roles', array['driver']
)::text, true);

-- =================== C1: authorized driver creates a customer ===================
do $$
declare
  v_opid uuid := gen_random_uuid();
  v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'customers',
      'operation_type', 'CREATE', 'domain_operation', 'customer.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('full_name','Mama T Bakery','phone','08012345678')
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('C1 driver customer.create -> APPLIED, tenant correct, revision 1',
    v_row.status = 'APPLIED' and (v_row.result->>'revision') = '1'
      and exists (select 1 from public.customers c where c.id = (v_row.result->>'customer_id')::uuid
                  and c.tenant_id = 'ab000000-0000-4000-8000-00000000da01' and c.full_name = 'Mama T Bakery'),
    v_row.status || ' ' || coalesce(v_row.error_message,'') || ' ' || v_row.result::text);
end $$;

-- =================== C2: missing full_name -> invalid_request ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'customers',
      'operation_type', 'CREATE', 'domain_operation', 'customer.create',
      'device_created_at', now()::text, 'payload', jsonb_build_object('phone','08000000000')
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('C2 missing full_name -> REJECTED 22023 invalid_request',
    v_row.status = 'REJECTED' and v_row.error_code = '22023',
    v_row.status || ' ' || coalesce(v_row.error_code,'') || ' ' || coalesce(v_row.error_message,''));
end $$;

-- =================== C3: full_name too long -> invalid_request ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'customers',
      'operation_type', 'CREATE', 'domain_operation', 'customer.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('full_name', repeat('x', 201))
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('C3 full_name too long -> REJECTED 22023 invalid_request',
    v_row.status = 'REJECTED' and v_row.error_code = '22023',
    v_row.status || ' ' || coalesce(v_row.error_code,''));
end $$;

-- =================== C4: unauthorized role (baker) cannot create ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  reset role;
  delete from public.user_roles where profile_id='aa000000-0000-4000-8000-00000000da01'
    and tenant_id='ab000000-0000-4000-8000-00000000da01';
  insert into public.user_roles (tenant_id, profile_id, role_id)
  select 'ab000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', id
  from public.roles where key = 'baker';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object(
    'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
    'roles', array['baker']
  )::text, true);

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'customers',
      'operation_type', 'CREATE', 'domain_operation', 'customer.create',
      'device_created_at', now()::text, 'payload', jsonb_build_object('full_name','Should Fail')
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;

  reset role;
  delete from public.user_roles where profile_id='aa000000-0000-4000-8000-00000000da01'
    and tenant_id='ab000000-0000-4000-8000-00000000da01';
  insert into public.user_roles (tenant_id, profile_id, role_id)
  select 'ab000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', id
  from public.roles where key in ('driver','branch_manager');
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object(
    'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
    'roles', array['driver']
  )::text, true);

  insert into _results values ('C4 baker role -> REJECTED 42501 insufficient_role',
    v_row.status = 'REJECTED' and v_row.error_code = '42501',
    v_row.status || ' ' || coalesce(v_row.error_code,''));
end $$;

-- =================== C5: cross-tenant create (actor not a member) ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_error_seen boolean := false; v_state text;
begin
  begin
    perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da03',
        'branch_id', null,
        'entity_id', gen_random_uuid(), 'entity_type', 'customers',
        'operation_type', 'CREATE', 'domain_operation', 'customer.create',
        'device_created_at', now()::text, 'payload', jsonb_build_object('full_name','Cross Tenant')
      )));
  exception when others then
    v_error_seen := true;
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  insert into _results values ('C5 cross-tenant create (not a member of org C) -> rejected',
    v_error_seen and v_state = '42501',
    'error_seen=' || v_error_seen || ' state=' || coalesce(v_state,''));
end $$;

-- =================== C6: branch belongs to a different org than the operation tenant =====
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da02',
      'entity_id', gen_random_uuid(), 'entity_type', 'customers',
      'operation_type', 'CREATE', 'domain_operation', 'customer.create',
      'device_created_at', now()::text, 'payload', jsonb_build_object('full_name','Wrong Branch Org')
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('C6 branch from a different org -> REJECTED 42501 (generic gateway)',
    v_row.status = 'REJECTED' and v_row.error_code = '42501',
    v_row.status || ' ' || coalesce(v_row.error_code,''));
end $$;

-- =================== R1: identical replay does not duplicate ===================
do $$
declare
  v_opid uuid := gen_random_uuid();
  v_entity uuid := gen_random_uuid();
  v_res1 jsonb; v_res2 jsonb;
  v_cust_id uuid;
  v_count int;
begin
  v_res1 := public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_entity, 'entity_type', 'customers',
      'operation_type', 'CREATE', 'domain_operation', 'customer.create',
      'device_created_at', now()::text, 'payload', jsonb_build_object('full_name','Replay Customer')
    )));
  v_cust_id := (v_res1->'results'->0->'result'->>'customer_id')::uuid;

  v_res2 := public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_entity, 'entity_type', 'customers',
      'operation_type', 'CREATE', 'domain_operation', 'customer.create',
      'device_created_at', now()::text, 'payload', jsonb_build_object('full_name','Replay Customer')
    )));

  select count(*) into v_count from public.customers where full_name = 'Replay Customer';

  insert into _results values ('R1 identical replay -> replayed=true, exactly one customer',
    (v_res2->'results'->0->>'replayed')::boolean = true and v_count = 1 and v_cust_id is not null,
    v_res1::text || ' | ' || v_res2::text || ' | count=' || v_count);
end $$;

-- =================== R2: same operation_id, modified payload -> rejected =====
do $$
declare
  v_opid uuid := gen_random_uuid();
  v_entity uuid := gen_random_uuid();
  v_error_seen boolean := false; v_state text; v_msg text;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_entity, 'entity_type', 'customers',
      'operation_type', 'CREATE', 'domain_operation', 'customer.create',
      'device_created_at', now()::text, 'payload', jsonb_build_object('full_name','Original Payload')
    )));
  begin
    perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
        'branch_id', 'ac000000-0000-4000-8000-00000000da01',
        'entity_id', v_entity, 'entity_type', 'customers',
        'operation_type', 'CREATE', 'domain_operation', 'customer.create',
        'device_created_at', now()::text, 'payload', jsonb_build_object('full_name','Modified Payload')
      )));
  exception when others then
    v_error_seen := true; v_msg := sqlerrm;
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  insert into _results values ('R2 same operation_id, modified payload -> rejected, altered immutable context',
    v_error_seen and v_state = '42501' and v_msg like '%altered immutable context%'
      and not exists (select 1 from public.customers where full_name = 'Modified Payload'),
    'error_seen=' || v_error_seen || ' state=' || coalesce(v_state,'') || ' msg=' || coalesce(v_msg,''));
end $$;

-- =================== S1/S2: internal handlers not directly callable ===================
insert into _results values ('S1 apply_customer_create not directly executable by anon/authenticated',
  not has_function_privilege('anon', 'public.apply_customer_create(public.sync_operations)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.apply_customer_create(public.sync_operations)', 'EXECUTE'),
  'anon_exec=' || has_function_privilege('anon', 'public.apply_customer_create(public.sync_operations)', 'EXECUTE')
    || ' authenticated_exec=' || has_function_privilege('authenticated', 'public.apply_customer_create(public.sync_operations)', 'EXECUTE'));

insert into _results values ('S2 apply_customer_update not directly executable by anon/authenticated',
  not has_function_privilege('anon', 'public.apply_customer_update(public.sync_operations)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.apply_customer_update(public.sync_operations)', 'EXECUTE'),
  'anon_exec=' || has_function_privilege('anon', 'public.apply_customer_update(public.sync_operations)', 'EXECUTE')
    || ' authenticated_exec=' || has_function_privilege('authenticated', 'public.apply_customer_update(public.sync_operations)', 'EXECUTE'));

-- =================== U1: authorized update changes fields, revision 2 ===================
do $$
declare
  v_create_opid uuid := gen_random_uuid();
  v_update_opid uuid := gen_random_uuid();
  v_cust_id uuid;
  v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_create_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'customers',
      'operation_type', 'CREATE', 'domain_operation', 'customer.create',
      'device_created_at', now()::text, 'payload', jsonb_build_object('full_name','Before Update')
    )));
  select (result->>'customer_id')::uuid into v_cust_id from public.sync_operations where operation_id = v_create_opid;

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_update_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_cust_id, 'entity_type', 'customers',
      'operation_type', 'UPDATE', 'domain_operation', 'customer.update',
      'base_revision', 1, 'device_created_at', now()::text,
      'payload', jsonb_build_object('customer_id', v_cust_id, 'full_name','After Update','phone','08011112222')
    )));
  select * into v_row from public.sync_operations where operation_id = v_update_opid;
  insert into _results values ('U1 authorized update -> APPLIED, revision 2, fields changed',
    v_row.status = 'APPLIED' and (v_row.result->>'revision') = '2'
      and (select full_name from public.customers where id = v_cust_id) = 'After Update'
      and (select phone from public.customers where id = v_cust_id) = '08011112222',
    v_row.status || ' ' || v_row.result::text);
end $$;

-- =================== U2: unauthorized role (accountant) cannot update ===================
do $$
declare
  v_create_opid uuid := gen_random_uuid();
  v_update_opid uuid := gen_random_uuid();
  v_cust_id uuid;
  v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_create_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'customers',
      'operation_type', 'CREATE', 'domain_operation', 'customer.create',
      'device_created_at', now()::text, 'payload', jsonb_build_object('full_name','Accountant Target')
    )));
  select (result->>'customer_id')::uuid into v_cust_id from public.sync_operations where operation_id = v_create_opid;

  reset role;
  delete from public.user_roles where profile_id='aa000000-0000-4000-8000-00000000da01'
    and tenant_id='ab000000-0000-4000-8000-00000000da01';
  insert into public.user_roles (tenant_id, profile_id, role_id)
  select 'ab000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', id
  from public.roles where key = 'accountant';
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object(
    'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
    'roles', array['accountant']
  )::text, true);

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_update_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_cust_id, 'entity_type', 'customers',
      'operation_type', 'UPDATE', 'domain_operation', 'customer.update',
      'base_revision', 1, 'device_created_at', now()::text,
      'payload', jsonb_build_object('customer_id', v_cust_id, 'full_name','Should Not Apply')
    )));
  select * into v_row from public.sync_operations where operation_id = v_update_opid;

  reset role;
  delete from public.user_roles where profile_id='aa000000-0000-4000-8000-00000000da01'
    and tenant_id='ab000000-0000-4000-8000-00000000da01';
  insert into public.user_roles (tenant_id, profile_id, role_id)
  select 'ab000000-0000-4000-8000-00000000da01', 'aa000000-0000-4000-8000-00000000da01', id
  from public.roles where key in ('driver','branch_manager');
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object(
    'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
    'roles', array['driver']
  )::text, true);

  insert into _results values ('U2 accountant role -> REJECTED 42501, customer unchanged',
    v_row.status = 'REJECTED' and v_row.error_code = '42501'
      and (select full_name from public.customers where id = v_cust_id) = 'Accountant Target',
    v_row.status || ' ' || coalesce(v_row.error_code,''));
end $$;

-- =================== U3: stale base_revision -> conflict, no overwrite ===================
do $$
declare
  v_create_opid uuid := gen_random_uuid();
  v_bump_opid   uuid := gen_random_uuid();
  v_stale_opid  uuid := gen_random_uuid();
  v_cust_id     uuid;
  v_conf        public.sync_conflicts;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_create_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'customers',
      'operation_type', 'CREATE', 'domain_operation', 'customer.create',
      'device_created_at', now()::text, 'payload', jsonb_build_object('full_name','Conflict Target')
    )));
  select (result->>'customer_id')::uuid into v_cust_id from public.sync_operations where operation_id = v_create_opid;

  -- bump to revision 2 via a legitimate update, so base_revision=1 below is genuinely stale
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_bump_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_cust_id, 'entity_type', 'customers',
      'operation_type', 'UPDATE', 'domain_operation', 'customer.update',
      'base_revision', 1, 'device_created_at', now()::text,
      'payload', jsonb_build_object('customer_id', v_cust_id, 'full_name','Legit Revision 2')
    )));

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_stale_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_cust_id, 'entity_type', 'customers',
      'operation_type', 'UPDATE', 'domain_operation', 'customer.update',
      'base_revision', 1, 'device_created_at', now()::text,
      'payload', jsonb_build_object('customer_id', v_cust_id, 'full_name','Stale Attempt')
    )));

  select * into v_conf from public.sync_conflicts where operation_id = v_stale_opid;
  insert into _results values ('U3 stale base_revision -> sync_conflicts row, customer not overwritten',
    v_conf.id is not null and v_conf.conflict_status = 'OPEN'
      and v_conf.base_revision = 1 and v_conf.current_revision >= 2
      and (select full_name from public.customers where id = v_cust_id) = 'Legit Revision 2',
    coalesce(v_conf.conflict_code,'NO ROW') || ' base=' || coalesce(v_conf.base_revision::text,'?')
      || ' current=' || coalesce(v_conf.current_revision::text,'?'));
end $$;

-- =================== U4: identical update replay does not duplicate sync_changes ===================
do $$
declare
  v_create_opid uuid := gen_random_uuid();
  v_update_opid uuid := gen_random_uuid();
  v_cust_id uuid;
  v_res1 jsonb; v_res2 jsonb;
  v_change_count int;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_create_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'customers',
      'operation_type', 'CREATE', 'domain_operation', 'customer.create',
      'device_created_at', now()::text, 'payload', jsonb_build_object('full_name','Replay Update Target')
    )));
  select (result->>'customer_id')::uuid into v_cust_id from public.sync_operations where operation_id = v_create_opid;

  v_res1 := public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_update_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_cust_id, 'entity_type', 'customers',
      'operation_type', 'UPDATE', 'domain_operation', 'customer.update',
      'base_revision', 1, 'device_created_at', now()::text,
      'payload', jsonb_build_object('customer_id', v_cust_id, 'full_name','Replayed Update')
    )));
  v_res2 := public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_update_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_cust_id, 'entity_type', 'customers',
      'operation_type', 'UPDATE', 'domain_operation', 'customer.update',
      'base_revision', 1, 'device_created_at', now()::text,
      'payload', jsonb_build_object('customer_id', v_cust_id, 'full_name','Replayed Update')
    )));
  select count(*) into v_change_count from public.sync_changes
   where entity_id = v_cust_id and domain_operation = 'customer.update';

  insert into _results values ('U4 identical update replay -> replayed=true, one sync_changes row',
    (v_res2->'results'->0->>'replayed')::boolean = true and v_change_count = 1,
    v_res1::text || ' | ' || v_res2::text || ' | changes=' || v_change_count);
end $$;

-- =================== U5: payload customer_id must match operation entity_id ===================
do $$
declare
  v_create_opid uuid := gen_random_uuid();
  v_update_opid uuid := gen_random_uuid();
  v_cust_id uuid;
  v_other_id uuid := gen_random_uuid();
  v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_create_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'customers',
      'operation_type', 'CREATE', 'domain_operation', 'customer.create',
      'device_created_at', now()::text, 'payload', jsonb_build_object('full_name','Mismatch Target')
    )));
  select (result->>'customer_id')::uuid into v_cust_id from public.sync_operations where operation_id = v_create_opid;

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_update_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_other_id, 'entity_type', 'customers',
      'operation_type', 'UPDATE', 'domain_operation', 'customer.update',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('customer_id', v_cust_id, 'full_name','Should Not Apply')
    )));
  select * into v_row from public.sync_operations where operation_id = v_update_opid;
  insert into _results values ('U5 payload customer_id != entity_id -> REJECTED 22023',
    v_row.status = 'REJECTED' and v_row.error_code = '22023'
      and (select full_name from public.customers where id = v_cust_id) = 'Mismatch Target',
    v_row.status || ' ' || coalesce(v_row.error_code,''));
end $$;

-- =================== U6: customer_id not found in this tenant ===================
do $$
declare
  v_opid uuid := gen_random_uuid();
  v_missing_id uuid := gen_random_uuid();
  v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_missing_id, 'entity_type', 'customers',
      'operation_type', 'UPDATE', 'domain_operation', 'customer.update',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('customer_id', v_missing_id, 'full_name','Nobody')
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('U6 nonexistent customer_id -> REJECTED P0001',
    v_row.status = 'REJECTED' and v_row.error_code = 'P0001',
    v_row.status || ' ' || coalesce(v_row.error_code,''));
end $$;

-- =========== T1: customer.create then a SEPARATE ticket.create referencing it ===========
do $$
declare
  v_cust_opid   uuid := gen_random_uuid();
  v_ticket_opid uuid := gen_random_uuid();
  v_cust_id     uuid;
  v_ticket_row  public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_cust_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'customers',
      'operation_type', 'CREATE', 'domain_operation', 'customer.create',
      'device_created_at', now()::text, 'payload', jsonb_build_object('full_name','Route Customer')
    )));
  select (result->>'customer_id')::uuid into v_cust_id from public.sync_operations where operation_id = v_cust_opid;

  -- A separate process_sync_batch call, as a real client would make once it has the real
  -- customer_id back -- NOT the same batch/array as the create (see file header, BLOCKER-022).
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_ticket_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'tickets',
      'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('fulfilment_type','pickup','customer_id', v_cust_id)
    )));
  select * into v_ticket_row from public.sync_operations where operation_id = v_ticket_opid;

  insert into _results values ('T1 customer.create then separate ticket.create -> both APPLIED, linked',
    v_ticket_row.status = 'APPLIED'
      and (select customer_id from public.tickets where id = (v_ticket_row.result->>'ticket_id')::uuid) = v_cust_id,
    v_ticket_row.status || ' ' || v_ticket_row.result::text);
end $$;

-- =================== D1: domain_operation CHECK constraint unchanged ===================
insert into _results
  select 'D1 domain_operation CHECK constraint definition unchanged',
    pg_get_constraintdef(oid) = 'CHECK (((domain_operation IS NULL) OR (domain_operation = ANY (ARRAY[''ticket.create''::text, ''ticket.transition''::text, ''ticket.item_update''::text, ''inventory.adjust''::text, ''inventory.receive''::text, ''inventory.consume''::text, ''inventory.waste''::text, ''inventory.transfer''::text, ''production.start''::text, ''production.complete''::text, ''production.cancel''::text, ''production.record_output''::text, ''production.record_waste''::text, ''payment.create''::text, ''payment.reverse''::text, ''expense.create''::text, ''expense.reverse''::text, ''customer.create''::text, ''customer.update''::text]))))',
    pg_get_constraintdef(oid)
  from pg_constraint where conname = 'sync_operations_domain_operation_check';

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
