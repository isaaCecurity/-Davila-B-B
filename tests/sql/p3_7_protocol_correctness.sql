-- BakeFlow -- P3.7 protocol-correctness pass (I1..I5, P1..P4, A1..A4, S1..S5, C1..C6)
--
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/p3_7_protocol_correctness.sql
--
-- EXECUTED 2026-08-29 against project tvfyxpafbpnkneujcnvr: 17/17 passed. (Header previously
-- said 18/18 -- a miscount against the 17 actual `insert into _results` rows below, corrected
-- 2026-08-29 during the CUSTOMER-slice regression re-run that caught the discrepancy. Several
-- of the 24 named checks in the I1..C6 list below are asserted together in one combined row,
-- e.g. "I3/I4/P4 cross-tenant replay...", so 17 rows correctly covering 24 checks is expected,
-- not a missing assertion.)
--
-- This pass also found and fixed one security defect, incidental to the 8 planned items --
-- surfaced by a routine get_advisors() security check run as due diligence before declaring
-- the pass done. apply_ticket_create(sync_operations)/apply_ticket_item_update(sync_operations)
-- were left PUBLIC-executable (the former even by anon) since the migration that created
-- them never revoked the default grant; both re-derive authorization from whatever
-- actor_id/tenant_id the caller supplies in the row argument, so any caller reaching them
-- directly via PostgREST with a valid actor/tenant/role combination could have forged
-- tickets, bypassing every check in process_sync_batch. Fixed in
-- p3_7_revoke_public_execute_on_internal_sync_handlers; see the two "security:" assertions
-- near the end of this file.
--
-- This pass hardened process_sync_batch_context_validated() and sync_pull() without
-- touching authorization/idempotency/conflict-detection logic that already worked
-- (process_sync_batch(), sync_validate_device(), is_member_of(), is_authorized_for_branch(),
-- the CONFLICT/sync_conflicts path, and every P3.7 handler are all unmodified). One real,
-- previously-undiscovered bug was found and fixed while tracing the live behavior before
-- writing any of this: process_sync_batch_context_validated()'s client-facing response was
-- built from a LOCAL variable snapshotted BEFORE the INSERT that fires
-- sync_operations_dispatch (an AFTER INSERT trigger that applies the operation
-- synchronously). So the batch response reported PENDING/CONFLICT for every operation
-- regardless of what actually happened -- verified live: a ticket.create that provably
-- created a real ticket still came back to the caller as {"status":"PENDING"}. See
-- IMPLEMENTATION_LOG.md 2026-08-29 for the full trace and fix.
--
-- Covers the items in this pass NOT already covered by
-- tests/sql/p3_7_sync_apply_and_pull.sql (which stays the source of truth for
-- ticket.create/ticket.item_update/sync_conflicts/basic sync_pull behavior;
-- re-run clean by this pass, 11/11, zero regressions).
--
-- Item 1, tenant-bound idempotency (I1-I5):
--   I1 same op resubmitted by the same tenant -> replayed:true
--   I2 same op resubmitted after the first successful commit -> stored result echoed back
--   I3 same operation_id presented with a DIFFERENT tenant_id -> rejected 42501, no leak
--   I4 tenant mismatch even when payload is byte-identical -> still rejected (tenant is
--      checked independently, not merely as a side effect of a payload diff)
--   I5 retry after client failed to receive the original response -> full stored result
--      recoverable from the replay path alone, no separate pull needed
--   No schema/logic change was needed for tenant-bound idempotency itself: operation_id
--   lookup is global (sync_operations_operation_id_key), but the pre-existing tenant_id
--   mismatch check already raised 42501 and never returned another tenant's stored result.
--   That property is confirmed here, not rebuilt.
--
-- Item 2, payload-hash/immutability (P1-P4):
--   P1 identical replay -> accepted, same result, exactly one ticket
--   P2 modified payload replay -> rejected 42501, original ticket untouched, no 2nd ticket
--   P3 malformed (non-object) payload -> rejected 22023 invalid_request at the gateway,
--      never reaches a handler
--   P4 cross-tenant replay with an IDENTICAL payload -> still rejected (proves tenant_id
--      is compared as its own field, not derived from a payload hash)
--   Design choice, documented here rather than in a separate doc: no physical payload_hash
--   column was added. jsonb `=` is structural equality independent of key order (confirmed
--   live: jsonb canonicalizes key order in storage, unlike json), so comparing
--   v_existing.payload directly against the incoming payload is strictly correct and
--   simpler than hashing text -- a text-hash approach would risk false-mismatch rejections
--   only if key order weren't already canonicalized, which for jsonb it is. The immutable-
--   context comparison was also widened to branch_id, entity_type, domain_operation, and
--   base_revision, none of which were previously compared on replay -- see
--   IMPLEMENTATION_LOG.md for why each mattered.
--
-- Item 3, ALREADY_APPLIED semantics (A1-A4), verified from the RPC's OWN response, not by
-- re-querying the table -- this is what the pre-existing status-staleness bug actually broke:
--   A1 first request -> RPC response itself reports APPLIED with the real result
--   A2 retry -> RPC response reports replayed:true, same status/result, exactly one mutation
--   A3 unsupported domain_operation -> RPC response itself reports REJECTED/
--      unsupported_operation_type (previously reported PENDING even though the row was
--      already REJECTED by the time the call returned)
--   A4 stale base_revision -> RPC response itself reports CONFLICT (previously PENDING)
--   No new 'ALREADY_APPLIED' status enum value was added. status (APPLIED/REJECTED/
--   CONFLICT/PENDING) describes the operation's own lifecycle, a property of the operation;
--   replayed:true/false describes whether THIS call was a replay, a property of the
--   request. Conflating the two into one status value would let one operation carry two
--   different notions of truth. The combination already gives full 5-way distinguishability
--   (newly applied / already-applied / rejected / conflict / unsupported).
--
-- Item 4, client_sequence (S1-S5) -- proving it is diagnostic-only and never blocks:
--   S1 sequential values all accepted
--   S2 duplicate client_sequence across two distinct operations -> both APPLIED, not blocked
--   S3 out-of-order delivery (10 then 5) -> both APPLIED, not blocked
--   S4 replay with the same client_sequence -> ordinary idempotent replay, unaffected
--   S5 large gap (reconnect after offline period) -> accepted, not blocked
--   OFFLINE-SYNC-MODEL.md §16 defines client_sequence as diagnostic/local-ordering metadata
--   ONLY ("NOT a substitute for server revisions... do not treat a device sequence as
--   global truth") with no enforcement semantics specified anywhere. A new nullable column
--   was added (sync_operations.client_sequence) and is captured verbatim; it has no UNIQUE
--   constraint and is never read by any comparison or authorization decision. Inventing
--   gap-detection or ordering-rejection semantics would have violated this pass's own
--   guardrail ("must not cause legitimate offline operations... to become permanently
--   unusable merely because another operation arrived later or was retried").
--
-- Item 5, cursor-too-old / full-resync (C1-C6):
--   C1 valid cursor (0) -> incremental pull, full_resync_required:false
--   C2 latest/caught-up cursor -> empty page, full_resync_required:false (distinct from C6)
--   C3 negative cursor -> rejected 22023 invalid_request
--   C4 malformed handling: a huge but syntactically valid cursor is treated as "ahead of
--      server", not an error -- see C6
--   C5 empty result while genuinely caught up is NOT confused with full-resync (re-asserts
--      C2's distinction explicitly)
--   C6 cursor ahead of everything visible to the caller -> full_resync_required:true
--   Evidence checked live before implementing: sync_changes has no deleted_at/TTL/archival
--   column, and a repo-wide grep of supabase/migrations for purge/retention/archive/
--   tombstone/TTL touching sync_changes returns zero hits -- it is a true append-only
--   ledger today. True cursor-expiry-via-retention-purge therefore cannot currently occur
--   and is NOT implemented; only the well-defined "cursor ahead of server" and "negative
--   cursor" cases are. See BLOCKERS.md for the open item.
--
-- NOT tested here because NOT implemented in this pass (documented as open blockers in
-- BLOCKERS.md): true cursor-expiry-via-retention-purge (no retention/purge mechanism
-- exists for sync_changes at all), and depends_on_operation_id enforcement (existing
-- per-handler existence checks already give correct safety for the realistic cross-batch
-- case -- e.g. apply_ticket_item_update's product-variant existence check; within a single
-- batch, sequential single-transaction processing already gives correct ordering without
-- needing this field; blocking/queuing semantics for a not-yet-applied dependency are
-- unspecified by OFFLINE-SYNC-MODEL.md §49 and would need a fresh architecture decision).
--
-- Also NOT expanded in this pass, unchanged from P3.7's first slice: inventory.*,
-- production.*, payment.*/expense.*, customer.* remain allowlisted in domain_operation but
-- unimplemented -- an operation of that type is REJECTED/unsupported_operation_type (see A3),
-- never silently stuck, never partially mutates business data.
--
-- Fixtures reuse the single real profile (aa000000.../org ab000000.../branch ac000000...)
-- and the same device id (f8000000-...-000000000001) established by
-- tests/sql/p3_7_sync_apply_and_pull.sql.

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

-- =================== A1/I1/I2/I5/P1: first apply + identical replay ===================
do $$
declare
  v_opid uuid := gen_random_uuid();
  v_entity uuid := gen_random_uuid();
  v_payload jsonb := jsonb_build_object('fulfilment_type','pickup','sale_customer_type','ROADSIDE');
  v_res1 jsonb; v_res2 jsonb;
  v_ticket_count int;
begin
  v_res1 := public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_entity, 'entity_type', 'tickets',
      'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
      'device_created_at', now()::text, 'payload', v_payload
    )));

  insert into _results values ('A1/I2 first request: RPC response itself reports APPLIED with real result',
    (v_res1->'results'->0->>'status') = 'APPLIED'
      and (v_res1->'results'->0->'result'->>'ticket_id') is not null
      and (v_res1->'results'->0->>'replayed') = 'false',
    v_res1::text);

  select count(*) into v_ticket_count from public.tickets
   where id = (v_res1->'results'->0->'result'->>'ticket_id')::uuid;

  -- identical replay (same operation_id, same payload)
  v_res2 := public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_entity, 'entity_type', 'tickets',
      'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
      'device_created_at', now()::text, 'payload', v_payload
    )));

  insert into _results values ('I1/I5/A2/P1 identical replay: replayed:true, full result echoed, exactly one ticket',
    (v_res2->'results'->0->>'replayed') = 'true'
      and (v_res2->'results'->0->>'status') = 'APPLIED'
      and (v_res2->'results'->0->'result') = (v_res1->'results'->0->'result')
      and v_ticket_count = 1
      and (select count(*) from public.tickets where id = v_entity or
           id = (v_res1->'results'->0->'result'->>'ticket_id')::uuid) = 1,
    v_res1::text || ' | ' || v_res2::text);
end $$;

-- =================== P2: modified-payload replay is rejected, original untouched ===================
do $$
declare
  v_opid uuid := gen_random_uuid();
  v_entity uuid := gen_random_uuid();
  v_res1 jsonb;
  v_ticket_id uuid;
  v_error_seen boolean := false;
  v_error_msg text;
  v_ticket_count_after int;
begin
  v_res1 := public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_entity, 'entity_type', 'tickets',
      'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
      'device_created_at', now()::text,
      'payload', jsonb_build_object('fulfilment_type','pickup')
    )));
  v_ticket_id := (v_res1->'results'->0->'result'->>'ticket_id')::uuid;

  begin
    perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
        'branch_id', 'ac000000-0000-4000-8000-00000000da01',
        'entity_id', v_entity, 'entity_type', 'tickets',
        'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
        'device_created_at', now()::text,
        'payload', jsonb_build_object('fulfilment_type','delivery')  -- DIFFERENT payload
      )));
  exception when others then
    v_error_seen := true;
    v_error_msg := sqlerrm;
  end;

  select count(*) into v_ticket_count_after from public.tickets where fulfilment_type is not null
    and created_by = 'aa000000-0000-4000-8000-00000000da01' and id = v_ticket_id;

  insert into _results values ('P2 modified-payload replay -> rejected, original ticket untouched',
    v_error_seen and v_error_msg like '%altered immutable context%' and v_ticket_count_after = 1
      and (select fulfilment_type from public.tickets where id = v_ticket_id) = 'pickup',
    'error_seen=' || v_error_seen || ' msg=' || coalesce(v_error_msg,'') );
end $$;

-- =================== P3: malformed (non-object) payload -> rejected at the gateway ===================
do $$
declare
  v_error_seen boolean := false;
  v_error_msg text;
  v_error_state text;
begin
  begin
    perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'operation_id', gen_random_uuid(), 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
        'branch_id', 'ac000000-0000-4000-8000-00000000da01',
        'entity_id', gen_random_uuid(), 'entity_type', 'tickets',
        'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
        'device_created_at', now()::text,
        'payload', to_jsonb('not-an-object'::text)
      )));
  exception when others then
    v_error_seen := true;
    v_error_msg := sqlerrm;
    get stacked diagnostics v_error_state = returned_sqlstate;
  end;
  insert into _results values ('P3 malformed (non-object) payload -> 22023 invalid_request at the gateway',
    v_error_seen and v_error_state = '22023' and v_error_msg like '%JSON object%',
    'error_seen=' || v_error_seen || ' state=' || coalesce(v_error_state,'') || ' msg=' || coalesce(v_error_msg,''));
end $$;

-- =================== I3/I4/P4: cross-tenant replay, with and without matching payload ===================
do $$
declare
  v_opid uuid := gen_random_uuid();
  v_entity uuid := gen_random_uuid();
  v_payload jsonb := jsonb_build_object('fulfilment_type','pickup');
  v_error_seen boolean := false;
  v_error_msg text;
  v_error_state text;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_entity, 'entity_type', 'tickets',
      'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
      'device_created_at', now()::text, 'payload', v_payload
    )));

  -- same operation_id, SAME payload, but a different tenant_id -- proves tenant is checked
  -- as its own immutable field, not merely inferred from a payload mismatch (P4), and that
  -- the idempotency lookup fails closed on tenant mismatch rather than leaking/reusing the
  -- other tenant's stored result (I3/I4).
  begin
    perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
      jsonb_build_array(jsonb_build_object(
        'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000ffff',
        'branch_id', 'ac000000-0000-4000-8000-00000000da01',
        'entity_id', v_entity, 'entity_type', 'tickets',
        'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
        'device_created_at', now()::text, 'payload', v_payload
      )));
  exception when others then
    v_error_seen := true;
    v_error_msg := sqlerrm;
    get stacked diagnostics v_error_state = returned_sqlstate;
  end;

  insert into _results values ('I3/I4/P4 cross-tenant replay (even with identical payload) -> rejected, fails closed',
    v_error_seen and v_error_state = '42501' and v_error_msg like '%altered immutable context%',
    'error_seen=' || v_error_seen || ' state=' || coalesce(v_error_state,'') || ' msg=' || coalesce(v_error_msg,''));
end $$;

-- =================== A3: unsupported domain_operation -> RPC response itself says REJECTED ===================
do $$
declare v_res jsonb;
begin
  v_res := public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', gen_random_uuid(), 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'inventory',
      'operation_type', 'EVENT', 'domain_operation', 'inventory.adjust',
      'device_created_at', now()::text, 'payload', '{}'::jsonb
    )));
  insert into _results values ('A3 unsupported domain_operation -> RPC response reports REJECTED directly (not stale PENDING)',
    (v_res->'results'->0->>'status') = 'REJECTED'
      and (v_res->'results'->0->>'error_code') = 'unsupported_operation_type',
    v_res::text);
end $$;

-- =================== A4: stale base_revision -> RPC response itself says CONFLICT ===================
do $$
declare
  v_create_opid uuid := gen_random_uuid();
  v_bump_opid   uuid := gen_random_uuid();
  v_ticket_id   uuid;
  v_res         jsonb;
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

  v_res := public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', gen_random_uuid(), 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_ticket_id, 'entity_type', 'tickets',
      'operation_type', 'UPDATE', 'domain_operation', 'ticket.item_update',
      'base_revision', 1, 'device_created_at', now()::text,
      'payload', jsonb_build_object('ticket_id', v_ticket_id, 'items', jsonb_build_array(
        jsonb_build_object('product_variant_id','82218a93-83fe-464a-819e-641987a8e3b1','quantity',1)
      ))
    )));

  insert into _results values ('A4 stale base_revision -> RPC response reports CONFLICT directly (not stale PENDING)',
    (v_res->'results'->0->>'status') = 'CONFLICT'
      and (v_res->'results'->0->>'error_code') = 'stale_revision',
    v_res::text);
end $$;

-- =================== S1/S5: sequential + large-gap client_sequence, both accepted ===================
do $$
declare v_res1 jsonb; v_res2 jsonb;
begin
  v_res1 := public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', gen_random_uuid(), 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'tickets',
      'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
      'client_sequence', 1, 'device_created_at', now()::text,
      'payload', jsonb_build_object('fulfilment_type','pickup')
    )));
  -- large gap, simulating "reconnect after an offline period" -- must not be blocked
  v_res2 := public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', gen_random_uuid(), 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'tickets',
      'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
      'client_sequence', 500, 'device_created_at', now()::text,
      'payload', jsonb_build_object('fulfilment_type','pickup')
    )));
  insert into _results values ('S1/S5 sequential and large-gap client_sequence both accepted',
    (v_res1->'results'->0->>'status') = 'APPLIED' and (v_res2->'results'->0->>'status') = 'APPLIED',
    v_res1::text || ' | ' || v_res2::text);
end $$;

-- =================== S2: duplicate client_sequence across two distinct operations ===================
do $$
declare v_res1 jsonb; v_res2 jsonb;
begin
  v_res1 := public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', gen_random_uuid(), 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'tickets',
      'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
      'client_sequence', 42, 'device_created_at', now()::text,
      'payload', jsonb_build_object('fulfilment_type','pickup')
    )));
  v_res2 := public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', gen_random_uuid(), 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'tickets',
      'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
      'client_sequence', 42, 'device_created_at', now()::text,
      'payload', jsonb_build_object('fulfilment_type','delivery')
    )));
  insert into _results values ('S2 duplicate client_sequence across distinct operations -> both APPLIED, not blocked',
    (v_res1->'results'->0->>'status') = 'APPLIED' and (v_res2->'results'->0->>'status') = 'APPLIED'
      and (v_res1->'results'->0->'result'->>'ticket_id') <> (v_res2->'results'->0->'result'->>'ticket_id'),
    v_res1::text || ' | ' || v_res2::text);
end $$;

-- =================== S3: out-of-order delivery (10 then 5) -> both accepted ===================
do $$
declare v_res_high jsonb; v_res_low jsonb;
begin
  v_res_high := public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', gen_random_uuid(), 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'tickets',
      'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
      'client_sequence', 10, 'device_created_at', now()::text,
      'payload', jsonb_build_object('fulfilment_type','pickup')
    )));
  v_res_low := public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', gen_random_uuid(), 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'tickets',
      'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
      'client_sequence', 5, 'device_created_at', now()::text,
      'payload', jsonb_build_object('fulfilment_type','pickup')
    )));
  insert into _results values ('S3 out-of-order client_sequence delivery (10 then 5) -> both APPLIED, not blocked',
    (v_res_high->'results'->0->>'status') = 'APPLIED' and (v_res_low->'results'->0->>'status') = 'APPLIED',
    v_res_high::text || ' | ' || v_res_low::text);
end $$;

-- =================== S4: replay with the same client_sequence -> ordinary idempotent replay ===================
do $$
declare
  v_opid uuid := gen_random_uuid();
  v_entity uuid := gen_random_uuid();
  v_res1 jsonb; v_res2 jsonb;
begin
  v_res1 := public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_entity, 'entity_type', 'tickets',
      'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
      'client_sequence', 7, 'device_created_at', now()::text,
      'payload', jsonb_build_object('fulfilment_type','pickup')
    )));
  v_res2 := public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', v_opid, 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', v_entity, 'entity_type', 'tickets',
      'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
      'client_sequence', 7, 'device_created_at', now()::text,
      'payload', jsonb_build_object('fulfilment_type','pickup')
    )));
  insert into _results values ('S4 replay with same client_sequence -> ordinary idempotent replay, unaffected',
    (v_res2->'results'->0->>'replayed') = 'true' and (v_res2->'results'->0->>'status') = 'APPLIED',
    v_res1::text || ' | ' || v_res2::text);
end $$;

-- =================== C1/C2/C5: valid cursor, caught-up cursor (not confused with full-resync) ===================
do $$
declare
  v_pull_from_zero jsonb;
  v_max_cursor bigint;
  v_pull_caught_up jsonb;
begin
  perform public.process_sync_batch('f8000000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'operation_id', gen_random_uuid(), 'tenant_id', 'ab000000-0000-4000-8000-00000000da01',
      'branch_id', 'ac000000-0000-4000-8000-00000000da01',
      'entity_id', gen_random_uuid(), 'entity_type', 'tickets',
      'operation_type', 'CREATE', 'domain_operation', 'ticket.create',
      'device_created_at', now()::text, 'payload', jsonb_build_object('fulfilment_type','pickup')
    )));

  v_pull_from_zero := public.sync_pull('f8000000-0000-4000-8000-000000000001', 0, 500);
  v_max_cursor := (v_pull_from_zero->>'next_cursor')::bigint;
  v_pull_caught_up := public.sync_pull('f8000000-0000-4000-8000-000000000001', v_max_cursor, 500);

  insert into _results values ('C1/C2/C5 valid cursor incremental pull, then caught-up cursor -> empty page, not full-resync',
    (v_pull_from_zero->>'full_resync_required') = 'false'
      and jsonb_array_length(v_pull_from_zero->'changes') >= 1
      and (v_pull_caught_up->>'full_resync_required') = 'false'
      and jsonb_array_length(v_pull_caught_up->'changes') = 0
      and (v_pull_caught_up->>'has_more') = 'false',
    v_pull_from_zero::text || ' | caught_up=' || v_pull_caught_up::text);
end $$;

-- =================== C3: negative cursor -> rejected ===================
do $$
declare v_error_seen boolean := false; v_error_state text;
begin
  begin
    perform public.sync_pull('f8000000-0000-4000-8000-000000000001', -1, 200);
  exception when others then
    v_error_seen := true;
    get stacked diagnostics v_error_state = returned_sqlstate;
  end;
  insert into _results values ('C3 negative cursor -> rejected 22023 invalid_request',
    v_error_seen and v_error_state = '22023',
    'error_seen=' || v_error_seen || ' state=' || coalesce(v_error_state,''));
end $$;

-- =================== C4/C6: cursor far ahead of everything visible -> full_resync_required ===================
do $$
declare v_pull jsonb;
begin
  v_pull := public.sync_pull('f8000000-0000-4000-8000-000000000001', 999999999, 200);
  insert into _results values ('C4/C6 cursor ahead of server -> full_resync_required:true, no fabricated diff',
    (v_pull->>'full_resync_required') = 'true' and jsonb_array_length(v_pull->'changes') = 0,
    v_pull::text);
end $$;

-- =================== security regression guard: internal handlers not client-executable ===================
-- Not one of the original 8 items -- found via a routine get_advisors() security check run
-- as due diligence before declaring this pass done. apply_ticket_create(sync_operations)
-- and apply_ticket_item_update(sync_operations) were left PUBLIC-executable (apply_ticket_
-- create even by anon) since the migration that created them never revoked the default
-- grant. Both re-derive authorization from whatever actor_id/tenant_id the caller supplies
-- in the row argument -- correct when called only via trg_dispatch_sync_operation() from an
-- already-authorized row, but exploitable directly via PostgREST: any caller who supplies an
-- actor_id/tenant_id pair holding an appropriate role could have created real tickets,
-- bypassing process_sync_batch's auth.uid()/is_member_of()/is_authorized_for_branch()/
-- idempotency/conflict-detection checks entirely. Fixed in
-- p3_7_revoke_public_execute_on_internal_sync_handlers, matching this repo's own precedent
-- (migration 20260813234856_revoke_anon_execute_on_internal_functions) and the same
-- convention security_multiorg_sync.sql's S11b already checks for is_member_of()/
-- is_authorized_for_branch(). apply_sync_operation(uuid), trg_dispatch_sync_operation(), and
-- bump_ticket_revision() were fixed the same way for defense in depth (lower severity: the
-- first only acts on an already-existing row, the latter two are trigger functions that
-- error outside trigger context). sync_pull() keeps its `authenticated` grant (a legitimate
-- entry point) but loses its stray `anon` grant.
do $$
begin
  insert into _results values ('security: internal sync handlers are not PUBLIC/anon/authenticated executable',
    NOT (
      has_function_privilege('anon', 'public.apply_ticket_create(public.sync_operations)', 'EXECUTE')
      OR has_function_privilege('authenticated', 'public.apply_ticket_create(public.sync_operations)', 'EXECUTE')
      OR has_function_privilege('anon', 'public.apply_ticket_item_update(public.sync_operations)', 'EXECUTE')
      OR has_function_privilege('authenticated', 'public.apply_ticket_item_update(public.sync_operations)', 'EXECUTE')
      OR has_function_privilege('anon', 'public.apply_sync_operation(uuid)', 'EXECUTE')
      OR has_function_privilege('authenticated', 'public.apply_sync_operation(uuid)', 'EXECUTE')
      OR has_function_privilege('anon', 'public.has_role_in(uuid,uuid,text[])', 'EXECUTE')
      OR has_function_privilege('authenticated', 'public.has_role_in(uuid,uuid,text[])', 'EXECUTE')
      OR has_function_privilege('anon', 'public.sync_pull(uuid,bigint,integer)', 'EXECUTE')
    ),
    'anon/authenticated EXECUTE checked on apply_ticket_create/apply_ticket_item_update/apply_sync_operation/has_role_in, anon EXECUTE checked on sync_pull');

  insert into _results values ('security: sync_pull remains callable by authenticated (legitimate entry point, unaffected)',
    has_function_privilege('authenticated', 'public.sync_pull(uuid,bigint,integer)', 'EXECUTE'),
    'checked');
end $$;

-- =================== item 7 regression guard: operation_type allowlist unchanged ===================
do $$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint where conname = 'sync_operations_operation_type_check';
  insert into _results values ('item7 sync_operations.operation_type CHECK constraint unchanged (coarse categories only)',
    v_def = $qq$CHECK ((operation_type = ANY (ARRAY['CREATE'::text, 'UPDATE'::text, 'SOFT_DELETE'::text, 'EVENT'::text, 'COMMAND'::text, 'CORRECTION'::text])))$qq$,
    coalesce(v_def, 'NULL'));
end $$;

reset role;

select test, passed, left(detail, 300) as detail from _results order by test;

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
