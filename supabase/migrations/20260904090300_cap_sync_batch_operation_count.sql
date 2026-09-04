-- process_sync_batch_context_validated() checked p_operations was a JSON array, but never
-- capped how many elements it could contain. A single authenticated call could therefore
-- drive an unbounded amount of server-side work in one request/transaction (each element
-- dispatched through apply_expense_create/apply_payment_create/etc., each doing multiple
-- sub-queries) -- a call-frequency limiter (enforce_rate_limit) is the wrong tool here
-- since the attacker needs only one oversized call, not many.
--
-- Cap set to 500, matching EB-017's own "Inventory Updates" batch-size guidance
-- (docs/engineering-bible/EB-017-Backend-API-Specification.md, "Batch Size Limits" table)
-- as the higher of its two operation categories relevant to a mixed-domain sync batch
-- (tickets/customers/inventory/payments/expenses) -- generous enough for a realistic
-- offline catch-up batch, still bounded. Verified live 2026-09-04: a 501-operation batch
-- is rejected with batch_too_large before any operation inside it is processed (zero
-- partial side effects); a 500-operation batch passes the cap and proceeds to per-operation
-- validation as before.
CREATE OR REPLACE FUNCTION public.process_sync_batch_context_validated(p_device_id uuid, p_operations jsonb, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  op            jsonb;
  v_opid        uuid;
  v_tenant      uuid;
  v_branch      uuid;
  v_entity      uuid;
  v_entity_type text;
  v_op_type     text;
  v_domain_op   text;
  v_base_rev    bigint;
  v_created     timestamptz;
  v_client_seq  bigint;
  v_payload     jsonb;
  v_current_rev bigint;
  v_status      text;
  v_err_code    text;
  v_existing    public.sync_operations;
  v_final_status text;
  v_final_err    text;
  v_final_result jsonb;
  v_results     jsonb := '[]'::jsonb;
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING errcode = '28000', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  IF jsonb_typeof(p_operations) <> 'array' THEN
    RAISE EXCEPTION 'p_operations must be a JSON array'
      USING errcode = '22023', detail = json_build_object('code','invalid_transition')::text;
  END IF;

  IF jsonb_array_length(p_operations) > 500 THEN
    RAISE EXCEPTION 'batch exceeds the maximum of 500 operations per call (got %)', jsonb_array_length(p_operations)
      USING errcode = '22023', detail = json_build_object('code','batch_too_large','max_operations',500)::text;
  END IF;

  FOR op IN SELECT value FROM jsonb_array_elements(p_operations) LOOP
    -- Immutable context, taken verbatim from the operation (§8).
    v_opid        := nullif(op ->> 'operation_id','')::uuid;
    v_tenant      := nullif(op ->> 'tenant_id','')::uuid;
    v_branch      := nullif(op ->> 'branch_id','')::uuid;
    v_entity      := nullif(op ->> 'entity_id','')::uuid;
    v_entity_type := nullif(op ->> 'entity_type','');
    v_op_type     := nullif(op ->> 'operation_type','');
    v_domain_op   := nullif(op ->> 'domain_operation','');
    v_base_rev    := nullif(op ->> 'base_revision','')::bigint;
    v_created     := nullif(op ->> 'device_created_at','')::timestamptz;
    -- Diagnostic-only (OFFLINE-SYNC-MODEL.md §16): captured, never enforced on.
    v_client_seq  := nullif(op ->> 'client_sequence','')::bigint;
    v_payload     := coalesce(op -> 'payload', '{}'::jsonb);
    -- NOTE: op->>'actor_id' and op->>'received_at' are read by nothing. The actor
    -- comes from the authenticated device relationship (§10) and received_at is
    -- server-assigned (§17); a client-supplied value for either is ignored.

    IF v_opid IS NULL OR v_tenant IS NULL OR v_entity IS NULL
       OR v_entity_type IS NULL OR v_op_type IS NULL OR v_created IS NULL THEN
      RAISE EXCEPTION 'operation context is incomplete'
        USING errcode = '22023', detail = json_build_object('code','invalid_transition')::text;
    END IF;

    -- P3.7 item 2/malformed-payload: the payload must be a JSON object (or
    -- absent, defaulting to {}). A non-object payload is a client bug and is
    -- refused at the gateway boundary, matching the other structural checks
    -- above, rather than surfacing as an opaque failure deep inside a handler.
    IF jsonb_typeof(v_payload) <> 'object' THEN
      RAISE EXCEPTION 'operation payload must be a JSON object'
        USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
    END IF;

    -- IDEMPOTENCY (§15). operation_id is the key. A replay never applies twice and
    -- never mutates the stored row; a replay whose immutable context differs is an
    -- attempt to re-point an existing operation and is refused.
    --
    -- P3.7 hardening: the immutable-context comparison now covers every field the
    -- operation record treats as immutable, not just a subset -- see migration
    -- comment above for what was missing and why it mattered.
    SELECT * INTO v_existing
      FROM public.sync_operations so
     WHERE so.operation_id = v_opid;

    IF FOUND THEN
      IF v_existing.tenant_id         IS DISTINCT FROM v_tenant
         OR v_existing.actor_id       IS DISTINCT FROM p_actor
         OR v_existing.device_id      IS DISTINCT FROM p_device_id
         OR v_existing.entity_id      IS DISTINCT FROM v_entity
         OR v_existing.entity_type    IS DISTINCT FROM v_entity_type
         OR v_existing.operation_type IS DISTINCT FROM v_op_type
         OR v_existing.domain_operation IS DISTINCT FROM v_domain_op
         OR v_existing.branch_id      IS DISTINCT FROM v_branch
         OR v_existing.base_revision  IS DISTINCT FROM v_base_rev
         OR v_existing.payload        IS DISTINCT FROM v_payload THEN
        RAISE EXCEPTION 'operation replay with altered immutable context'
          USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
      END IF;

      -- Genuine replay (ALREADY_APPLIED, P3.7 item 3): the mutation ran exactly
      -- once, on the first call. `status` reports what actually happened and
      -- `replayed:true` distinguishes this call from that one. No separate
      -- 'ALREADY_APPLIED' status value is introduced -- conflating "was this
      -- call a replay" (a property of the request) into the operation's own
      -- lifecycle status (a property of the operation) would let one operation
      -- carry two different notions of truth.
      v_results := v_results || jsonb_build_object(
        'operation_id', v_opid,
        'tenant_id',    v_existing.tenant_id,
        'status',       v_existing.status,
        'error_code',   v_existing.error_code,
        'result',       v_existing.result,
        'replayed',     true);
      CONTINUE;
    END IF;

    -- FULL-CONTEXT AUTHORIZATION (§5), against the OPERATION's organization.
    IF NOT public.is_member_of(p_actor, v_tenant) THEN
      RAISE EXCEPTION 'actor has no live membership in the operation organization'
        USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
    END IF;

    IF NOT public.is_authorized_for_branch(p_actor, v_tenant, v_branch) THEN
      RAISE EXCEPTION 'actor is not authorized for the operation branch'
        USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
    END IF;

    -- REVISION / CONCURRENCY (§16). A stale base revision is recorded as a
    -- CONFLICT and preserved; the server's authoritative state is never
    -- overwritten, and the operation is never silently discarded.
    SELECT max(sc.revision) INTO v_current_rev
      FROM public.sync_changes sc
     WHERE sc.entity_id = v_entity;

    IF v_base_rev IS NOT NULL AND v_current_rev IS NOT NULL AND v_base_rev < v_current_rev THEN
      v_status   := 'CONFLICT';
      v_err_code := 'stale_revision';
    ELSE
      v_status   := 'PENDING';
      v_err_code := NULL;
    END IF;

    INSERT INTO public.sync_operations (
      operation_id, tenant_id, branch_id, device_id, actor_id,
      entity_type, entity_id, operation_type, domain_operation, base_revision,
      client_sequence, device_created_at, received_at, status, error_code, payload, result)
    VALUES (
      v_opid,
      v_tenant,        -- destination: from the operation, never recomputed (§7)
      v_branch,
      p_device_id,
      p_actor,         -- from the authenticated device relationship (§10)
      v_entity_type, v_entity, v_op_type, v_domain_op, v_base_rev,
      v_client_seq,
      v_created,       -- device event time, client-controlled (§17)
      now(),           -- server receipt time, server-controlled (§17)
      v_status, v_err_code,
      v_payload,
      '{}'::jsonb);

    -- P3.7 fix (item 3): re-read the row after INSERT, because
    -- sync_operations_dispatch (AFTER INSERT ... WHEN status IN
    -- ('PENDING','CONFLICT')) has already run synchronously by this point and
    -- may have moved status to APPLIED/REJECTED. v_status/v_err_code are
    -- pre-dispatch snapshots and must not be used for the response.
    SELECT status, error_code, result INTO v_final_status, v_final_err, v_final_result
      FROM public.sync_operations WHERE operation_id = v_opid;

    v_results := v_results || jsonb_build_object(
      'operation_id',     v_opid,
      'tenant_id',        v_tenant,
      'status',           v_final_status,
      'error_code',       v_final_err,
      'result',           v_final_result,
      'server_revision',  v_current_rev,
      'replayed',         false);
  END LOOP;

  RETURN jsonb_build_object('results', v_results);
END;
$function$;
