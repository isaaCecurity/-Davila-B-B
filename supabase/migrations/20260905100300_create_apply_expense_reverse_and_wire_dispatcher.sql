-- BLOCKER-028 resolution: the sync-dispatcher handler for reversing an expense, mirroring
-- apply_payment_reverse() line for line (not delegating to record_expense_reversal() --
-- same relationship apply_payment_reverse()/record_refund() already has: independent,
-- parallel implementations sharing a target table, each suited to its own caller
-- context). Wires 'expense.reverse' into apply_sync_operation()'s dispatch CASE --
-- allowlisted in the domain_operation CHECK since AD-021, but previously REJECTED
-- unsupported_operation_type since no handler existed.

CREATE OR REPLACE FUNCTION public.apply_expense_reverse(p_operation sync_operations)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payload   jsonb := p_operation.payload;
  v_expense_id uuid := nullif(v_payload ->> 'expense_id', '')::uuid;
  v_amount    numeric := nullif(v_payload ->> 'amount', '')::numeric;
  v_reason    text := nullif(btrim(v_payload ->> 'reason'), '');
  v_expense   public.expenses;
  v_reversed  numeric;
  v_reversal  public.expense_reversals;
  v_new_rev   bigint;
BEGIN
  IF v_expense_id IS NULL THEN
    RAISE EXCEPTION 'expense.reverse payload requires expense_id'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'expense.reverse payload requires amount greater than zero'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_reason IS NULL OR length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'expense.reverse payload requires reason (1-1000 characters)'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  -- Role eligibility mirrors record_expense_reversal()'s own actor list verbatim
  -- (owner/admin/branch_manager); tenant-scoped per AD-006.
  IF NOT public.has_role_in(p_operation.actor_id, p_operation.tenant_id,
       ARRAY['owner','admin','branch_manager']) THEN
    RAISE EXCEPTION 'insufficient_role: actor may not reverse expenses in this organization'
      USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  SELECT * INTO v_expense FROM public.expenses
   WHERE id = v_expense_id AND tenant_id = p_operation.tenant_id
   FOR UPDATE;
  IF v_expense.id IS NULL THEN
    RAISE EXCEPTION 'expense not found in this organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_expense.branch_id IS DISTINCT FROM p_operation.branch_id THEN
    RAISE EXCEPTION 'expense does not belong to the operation branch'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  SELECT coalesce(sum(amount),0) INTO v_reversed FROM public.expense_reversals
   WHERE expense_id = v_expense_id AND tenant_id = p_operation.tenant_id;
  IF v_reversed + v_amount > v_expense.amount THEN
    RAISE EXCEPTION 'invalid_transition: reversal of % exceeds the % remaining on this expense',
      v_amount, v_expense.amount - v_reversed
      USING errcode = 'P0001', detail = json_build_object('code','invalid_transition',
        'expense_amount', v_expense.amount, 'already_reversed', v_reversed)::text;
  END IF;

  INSERT INTO public.expense_reversals (tenant_id, branch_id, expense_id, amount, reason, created_by)
  VALUES (p_operation.tenant_id, v_expense.branch_id, v_expense.id, v_amount, v_reason, p_operation.actor_id)
  RETURNING * INTO v_reversal;

  SELECT coalesce(max(revision),0)+1 INTO v_new_rev FROM public.sync_changes WHERE entity_id = v_expense.id;

  INSERT INTO public.sync_changes (tenant_id, branch_id, entity_type, entity_id,
    operation_type, domain_operation, revision, changed_by, payload)
  VALUES (v_expense.tenant_id, v_expense.branch_id, 'expenses', v_expense.id,
    'EVENT', 'expense.reverse', v_new_rev, p_operation.actor_id, to_jsonb(v_reversal));

  RETURN jsonb_build_object('reversal_id', v_reversal.id, 'expense_id', v_expense.id,
    'amount', v_reversal.amount, 'revision', v_new_rev);
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_expense_reverse(sync_operations) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_expense_reverse(sync_operations) TO service_role;

CREATE OR REPLACE FUNCTION public.apply_sync_operation(p_operation_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_op        public.sync_operations;
  v_result    jsonb;
  v_cur_rev   bigint;
BEGIN
  SELECT * INTO v_op FROM public.sync_operations WHERE operation_id = p_operation_id;
  IF v_op.operation_id IS NULL THEN RETURN; END IF;

  IF v_op.status = 'CONFLICT' THEN
    SELECT max(revision) INTO v_cur_rev FROM public.sync_changes WHERE entity_id = v_op.entity_id;
    INSERT INTO public.sync_conflicts (
      tenant_id, branch_id, entity_type, entity_id, operation_id, actor_id, device_id,
      operation_type, operation_payload, base_revision, current_revision, conflict_code
    ) VALUES (
      v_op.tenant_id, v_op.branch_id, v_op.entity_type, v_op.entity_id, v_op.operation_id,
      v_op.actor_id, v_op.device_id, coalesce(v_op.domain_operation, v_op.operation_type),
      v_op.payload, v_op.base_revision, v_cur_rev, coalesce(v_op.error_code, 'stale_revision')
    )
    ON CONFLICT (operation_id) DO NOTHING;
    RETURN;
  END IF;

  IF v_op.status <> 'PENDING' THEN
    RETURN;
  END IF;

  BEGIN
    IF v_op.domain_operation = 'ticket.create' THEN
      v_result := public.apply_ticket_create(v_op);
    ELSIF v_op.domain_operation = 'ticket.item_update' THEN
      v_result := public.apply_ticket_item_update(v_op);
    ELSIF v_op.domain_operation = 'customer.create' THEN
      v_result := public.apply_customer_create(v_op);
    ELSIF v_op.domain_operation = 'customer.update' THEN
      v_result := public.apply_customer_update(v_op);
    ELSIF v_op.domain_operation = 'inventory.adjust' THEN
      v_result := public.apply_inventory_adjust(v_op);
    ELSIF v_op.domain_operation = 'inventory.waste' THEN
      v_result := public.apply_inventory_waste(v_op);
    ELSIF v_op.domain_operation = 'production.start' THEN
      v_result := public.apply_production_start(v_op);
    ELSIF v_op.domain_operation = 'production.cancel' THEN
      v_result := public.apply_production_cancel(v_op);
    ELSIF v_op.domain_operation = 'production.record_output' THEN
      v_result := public.apply_production_record_output(v_op);
    ELSIF v_op.domain_operation = 'production.record_waste' THEN
      v_result := public.apply_production_record_waste(v_op);
    ELSIF v_op.domain_operation = 'payment.create' THEN
      v_result := public.apply_payment_create(v_op);
    ELSIF v_op.domain_operation = 'payment.reverse' THEN
      v_result := public.apply_payment_reverse(v_op);
    ELSIF v_op.domain_operation = 'expense.create' THEN
      v_result := public.apply_expense_create(v_op);
    ELSIF v_op.domain_operation = 'expense.reverse' THEN
      v_result := public.apply_expense_reverse(v_op);
    ELSE
      UPDATE public.sync_operations
         SET status = 'REJECTED', error_code = 'unsupported_operation_type',
             result = jsonb_build_object('message',
               coalesce(v_op.domain_operation, '(none)') || ' has no handler yet')
       WHERE operation_id = p_operation_id;
      RETURN;
    END IF;

    UPDATE public.sync_operations
       SET status = 'APPLIED', result = v_result, applied_at = now(),
           applied_sequence_id = (SELECT sequence_id FROM public.sync_changes
                                    WHERE entity_id = v_op.entity_id
                                    ORDER BY sequence_id DESC LIMIT 1)
     WHERE operation_id = p_operation_id;

  EXCEPTION WHEN OTHERS THEN
    UPDATE public.sync_operations
       SET status = 'REJECTED', error_code = SQLSTATE,
           error_message = SQLERRM, result = '{}'::jsonb
     WHERE operation_id = p_operation_id;
  END;
END;
$function$;
