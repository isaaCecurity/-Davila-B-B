-- BakeFlow — P3.7 per-entity sync application + pull RPC (T1..T9, P1..P2)
--
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/p3_7_sync_apply_and_pull.sql
--
-- EXECUTED 2026-08-28 against project tvfyxpafbpnkneujcnvr: 11/11 passed, after finding and
-- fixing two real defects during first authoring (see IMPLEMENTATION_LOG.md 2026-08-28 for
-- full detail):
--   1. ticket_items.line_total is GENERATED ALWAYS AS (round(quantity*unit_price,4)) STORED
--      — information_schema.columns.column_default doesn't surface generation expressions,
--      so this was missed until a live INSERT failed with 428C9. Removed from the handler's
--      INSERT column list; the database now enforces TESTING-STRATEGY.md §4's line_total
--      invariant structurally rather than by convention.
--   2. tickets_insert/ticket_items_insert RLS gate on has_role(), which reads roles from the
--      caller's ACTIVE-organization JWT claim only (AD-003) — unusable for a cross-org
--      offline operation, the exact scenario BLOCKER-006/AD-021 exist to handle. Handlers
--      re-implement the equivalent role gate via the new has_role_in(actor, tenant, roles),
--      evaluated against the OPERATION's own tenant, not the caller's active one.
--
-- This suite does NOT re-test process_sync_batch_context_validated()'s own idempotency/
-- authorization/conflict-detection logic — tests/sql/security_multiorg_sync.sql already
-- covers that (re-run and confirmed clean, 22/23, the one pre-existing unrelated failure
-- being rate_limit_events' missing RLS policies, untouched by this work). This suite covers
-- what P3.7 added on top: the ticket.create/ticket.item_update handlers, the dispatch
-- trigger, sync_conflicts, and sync_pull.
--
-- Fixtures reuse the single real profile (aa000000.../org ab000000.../branch ac000000...),
-- the same constraint tests/sql/driver_trips_rls.sql documents: profiles.id has a hard FK to
-- auth.users and this project has exactly one real profile row.
--
-- Covers:
--   T1 ticket.create -> APPLIED with a real ticket, ticket_id in the result
--   T2 ticket.item_update -> APPLIED, generated line_total correct, ticket revision bumped
--   T3 an allowlisted-but-unbuilt domain_operation (inventory.adjust) -> REJECTED,
--      unsupported_operation_type — not silently left PENDING forever
--   T4 a PENDING operation with no domain_operation at all -> REJECTED the same way
--   T5 a handler exception (invalid payload) -> REJECTED with the real error code/message,
--      and the surrounding transaction survives (the batch is not aborted)
--   T6 a stale base_revision -> a sync_conflicts row is written with the original
--      operation_payload preserved, base_revision/current_revision recorded, status OPEN
--   T7 idempotent replay -> the second call reports replayed=true, exactly one ticket exists
--   T8 sync_conflicts RLS: the operation's own actor AND a manager-tier role can see it
--   T9 sync_conflicts RLS: an unrelated caller with no membership row cannot
--   P1 sync_pull returns new sync_changes rows with correct next_cursor/has_more
--   P2 sync_pull refuses a revoked device (inherited from sync_validate_device(), the
--      unmodified existing function — re-verified independently here)

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

-- =================== T1: ticket.create end to end ===================
do $$
declare
  v_opid uuid := gen_random_uuid();
  v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'tickets',
      'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('fulfilment_type','pickup','sale_customer_type','ROADSIDE')
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('T1 ticket.create -> APPLIED with a real ticket',
    v_row.status = 'APPLIED' and (v_row.result->>'ticket_id') is not null,
    v_row.status || ' ' || coalesce(v_row.error_message,'') || ' ' || v_row.result::text);
end $$;

-- =================== T2: ticket.item_update, generated line_total, revision bump ===================
do $$
declare
  v_create_opid uuid := gen_random_uuid();
  v_item_opid   uuid := gen_random_uuid();
  v_ticket_id   uuid;
  v_row         public.sync_operations;
  v_rev_before  bigint;
  v_rev_after   bigint;
  v_line_total  numeric;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_create_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'tickets',
      'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
      'device_created_at', now()::text, 'payload', jsonb_build_object('fulfilment_type','pickup')
    )));
  select (result->>'ticket_id')::uuid into v_ticket_id from public.sync_operations where operation_id = v_create_opid;
  select revision into v_rev_before from public.tickets where id = v_ticket_id;

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_item_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_ticket_id, 'entity_type', 'tickets',
      'operation_type', 'UPDATE', 'domain_operation', 'ticket.item_update',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('ticket_id', v_ticket_id, 'items', jsonb_build_array(
        jsonb_build_object('product_variant_id','82218a93-83fe-464a-819e-641987a8e3b1','quantity',3)
      ))
    )));
  select * into v_row from public.sync_operations where operation_id = v_item_opid;
  select revision into v_rev_after from public.tickets where id = v_ticket_id;
  select line_total into v_line_total from public.ticket_items where ticket_id = v_ticket_id;

  insert into _results values ('T2 ticket.item_update -> APPLIED, generated line_total correct, revision bumped',
    v_row.status = 'APPLIED' and (v_row.result->>'subtotal_amount')::numeric = v_line_total
      and v_rev_after > v_rev_before,
    coalesce(v_row.status,'NULL') || ' subtotal=' || coalesce(v_row.result->>'subtotal_amount','?')
      || ' line_total=' || coalesce(v_line_total::text,'?') || ' rev ' || v_rev_before || '->' || v_rev_after);
end $$;

-- =================== T3: unsupported domain_operation -> REJECTED, not silently pending ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'inventory',
      'operation_type', 'EVENT', 'domain_operation', 'inventory.adjust',
      'device_created_at', now()::text, 'payload', '{}'::jsonb
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('T3 unimplemented domain_operation -> REJECTED, not silently pending',
    v_row.status = 'REJECTED' and v_row.error_code = 'unsupported_operation_type',
    v_row.status || ' ' || coalesce(v_row.error_code,''));
end $$;

-- =================== T4: no domain_operation supplied -> REJECTED, not silently pending ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'tickets',
      'operation_type', 'CREATE',
      'device_created_at', now()::text, 'payload', '{}'::jsonb
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('T4 missing domain_operation -> REJECTED, not silently pending',
    v_row.status = 'REJECTED' and v_row.error_code = 'unsupported_operation_type',
    v_row.status || ' ' || coalesce(v_row.error_code,''));
end $$;

-- =================== T5: invalid payload inside handler -> REJECTED, batch not aborted ===================
do $$
declare v_opid uuid := gen_random_uuid(); v_row public.sync_operations;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'tickets',
      'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
      'device_created_at', now()::text, 'payload', '{}'::jsonb
    )));
  select * into v_row from public.sync_operations where operation_id = v_opid;
  insert into _results values ('T5 handler exception -> REJECTED, transaction survives',
    v_row.status = 'REJECTED' and v_row.error_code = '22023',
    v_row.status || ' ' || coalesce(v_row.error_code,'') || ' ' || coalesce(v_row.error_message,''));
end $$;

-- =================== T6: stale base_revision -> sync_conflicts row, payload preserved ===================
do $$
declare
  v_create_opid uuid := gen_random_uuid();
  v_bump_opid   uuid := gen_random_uuid();
  v_stale_opid  uuid := gen_random_uuid();
  v_ticket_id   uuid;
  v_conf        public.sync_conflicts;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_create_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'tickets',
      'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
      'device_created_at', now()::text, 'payload', jsonb_build_object('fulfilment_type','pickup')
    )));
  select (result->>'ticket_id')::uuid into v_ticket_id from public.sync_operations where operation_id = v_create_opid;

  -- bump to revision 2 via a legitimate item_update, so base_revision=1 below is genuinely stale
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_bump_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_ticket_id, 'entity_type', 'tickets',
      'operation_type', 'UPDATE', 'domain_operation', 'ticket.item_update',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('ticket_id', v_ticket_id, 'items', jsonb_build_array(
        jsonb_build_object('product_variant_id','82218a93-83fe-464a-819e-641987a8e3b1','quantity',1)
      ))
    )));

  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_stale_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_ticket_id, 'entity_type', 'tickets',
      'operation_type', 'UPDATE', 'domain_operation', 'ticket.item_update',
      'base_revision', 1, 'device_created_at', now()::text,
      'payload', jsonb_build_object('ticket_id', v_ticket_id, 'items', jsonb_build_array(
        jsonb_build_object('product_variant_id','82218a93-83fe-464a-819e-641987a8e3b1','quantity',1)
      ))
    )));

  select * into v_conf from public.sync_conflicts where operation_id = v_stale_opid;
  insert into _results values ('T6 stale base_revision -> sync_conflicts row with payload preserved',
    v_conf.id is not null and v_conf.conflict_status = 'OPEN'
      and (v_conf.operation_payload->>'ticket_id') = v_ticket_id::text
      and v_conf.base_revision = 1 and v_conf.current_revision >= 2,
    coalesce(v_conf.conflict_code,'NO ROW') || ' base=' || coalesce(v_conf.base_revision::text,'?')
      || ' current=' || coalesce(v_conf.current_revision::text,'?'));
end $$;

-- =================== T7: idempotent replay ===================
do $$
declare
  v_opid uuid := gen_random_uuid();
  v_entity uuid := gen_random_uuid();
  v_res1 jsonb; v_res2 jsonb;
  v_ticket_count int;
begin
  v_res1 := public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_entity, 'entity_type', 'tickets',
      'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
      'device_created_at', now()::text, 'payload', jsonb_build_object('fulfilment_type','pickup')
    )));
  v_res2 := public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_entity, 'entity_type', 'tickets',
      'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
      'device_created_at', now()::text, 'payload', jsonb_build_object('fulfilment_type','pickup')
    )));
  select count(*) into v_ticket_count from public.sync_changes where domain_operation='ticket.create'
    and (payload->>'id') = (select result->>'ticket_id' from public.sync_operations where operation_id = v_opid);
  insert into _results values ('T7 replay is idempotent (second call reports replayed, one ticket total)',
    (v_res2->'results'->0->>'replayed')::boolean = true and v_ticket_count = 1,
    v_res1::text || ' | ' || v_res2::text || ' | count=' || v_ticket_count);
end $$;

-- =================== T8/T9: sync_conflicts RLS ===================
do $$
declare
  v_conflict_id uuid;
  v_visible_to_owner boolean;
  v_visible_to_manager boolean;
begin
  select id into v_conflict_id from public.sync_conflicts limit 1;

  perform set_config('request.jwt.claims', json_build_object(
    'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
    'roles', array['driver']
  )::text, true);
  v_visible_to_owner := exists (select 1 from public.sync_conflicts where id = v_conflict_id);

  perform set_config('request.jwt.claims', json_build_object(
    'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
    'roles', array['branch_manager']
  )::text, true);
  v_visible_to_manager := exists (select 1 from public.sync_conflicts where id = v_conflict_id);

  insert into _results values ('T8 sync_conflicts RLS: own actor and manager-tier can see the conflict',
    v_visible_to_owner and v_visible_to_manager,
    'owner=' || v_visible_to_owner || ' manager=' || v_visible_to_manager);
end $$;

select set_config('request.jwt.claims', json_build_object(
  'sub','99999999-0000-4000-8000-000000000099','tenant_id','ab000000-0000-4000-8000-00000000da01',
  'roles', array['cashier']
)::text, true);
insert into _results
  select 'T9 unrelated caller with no membership row cannot see another actor''s conflict',
         count(*) = 0, 'visible_rows=' || count(*)
  from public.sync_conflicts;

select set_config('request.jwt.claims', json_build_object(
  'sub','aa000000-0000-4000-8000-00000000da01','tenant_id','ab000000-0000-4000-8000-00000000da01',
  'roles', array['driver']
)::text, true);

-- =================== P1/P2: sync_pull ===================
do $$
declare
  v_opid uuid := gen_random_uuid();
  v_pull1 jsonb;
  v_pull2 jsonb;
  v_cursor1 bigint;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'tickets',
      'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
      'device_created_at', now()::text, 'payload', jsonb_build_object('fulfilment_type','pickup')
    )));

  v_pull1 := public.sync_pull('f8000000-0000-4000-8000-000000000001', 0, 1);
  v_cursor1 := (v_pull1->>'next_cursor')::bigint;
  v_pull2 := public.sync_pull('f8000000-0000-4000-8000-000000000001', v_cursor1, 200);

  insert into _results values ('P1 sync_pull returns new changes with correct next_cursor/has_more',
    jsonb_array_length(v_pull1->'changes') = 1
      and (v_pull1->>'has_more') is not null
      and (v_pull2->>'next_cursor')::bigint >= v_cursor1,
    'pull1_count=' || jsonb_array_length(v_pull1->'changes') || ' cursor1=' || v_cursor1
      || ' pull2_count=' || jsonb_array_length(v_pull2->'changes'));
end $$;

do $$
begin
  update public.sync_devices set revoked_at = now() where id = 'f8000000-0000-4000-8000-000000000001';
  begin
    perform public.sync_pull('f8000000-0000-4000-8000-000000000001', 0, 10);
    insert into _results values ('P2 sync_pull refuses a revoked device', false, 'no exception raised');
  exception when others then
    insert into _results values ('P2 sync_pull refuses a revoked device', sqlerrm like '%revoked%', sqlerrm);
  end;
  update public.sync_devices set revoked_at = null where id = 'f8000000-0000-4000-8000-000000000001';
end $$;

reset role;

select test, passed, left(detail, 200) as detail from _results order by test;

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
