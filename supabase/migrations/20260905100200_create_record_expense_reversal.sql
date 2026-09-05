-- BLOCKER-028 resolution: the direct/online RPC for reversing an expense, mirroring
-- record_refund() line for line (role gate, amount/reason validation, cumulative cap,
-- branch check, audit log).

CREATE OR REPLACE FUNCTION public.record_expense_reversal(p_expense_id uuid, p_amount numeric, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_expense public.expenses;
  v_reversal public.expense_reversals;
  v_reversed numeric;
BEGIN
  IF NOT public.has_role(ARRAY['owner','admin','branch_manager']) THEN
    RAISE EXCEPTION 'insufficient_role'
      USING errcode = 'P0001', detail = json_build_object('code','insufficient_role')::text;
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'reversal amount must be greater than zero'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL OR length(p_reason) > 1000 THEN
    RAISE EXCEPTION 'reversal reason is required and must be <= 1000 characters'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;

  SELECT * INTO v_expense
  FROM public.expenses
  WHERE id = p_expense_id AND tenant_id = v_tenant
  FOR UPDATE;

  IF v_expense.id IS NULL THEN
    RAISE EXCEPTION 'expense not found'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;

  IF NOT public.has_branch_access(v_expense.branch_id) THEN
    RAISE EXCEPTION 'insufficient_role: expense is outside your branch scope'
      USING errcode = 'P0001', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  SELECT COALESCE(sum(amount),0) INTO v_reversed
  FROM public.expense_reversals
  WHERE expense_id = p_expense_id AND tenant_id = v_tenant;

  IF v_reversed + p_amount > v_expense.amount THEN
    RAISE EXCEPTION 'reversal exceeds reversible expense balance'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_transition',
        'expense_amount', v_expense.amount, 'already_reversed', v_reversed)::text;
  END IF;

  INSERT INTO public.expense_reversals
    (tenant_id, branch_id, expense_id, amount, reason, created_by)
  VALUES
    (v_tenant, v_expense.branch_id, v_expense.id, p_amount, btrim(p_reason), auth.uid())
  RETURNING * INTO v_reversal;

  PERFORM public.log_audit_event(
    v_tenant, 'expense_reversal', v_reversal.id, 'insert', NULL, to_jsonb(v_reversal)
  );

  RETURN jsonb_build_object('reversal', to_jsonb(v_reversal));
END;
$function$;

REVOKE ALL ON FUNCTION public.record_expense_reversal(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_expense_reversal(uuid, numeric, text) TO authenticated;
