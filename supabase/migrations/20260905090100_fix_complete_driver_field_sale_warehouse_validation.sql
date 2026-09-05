-- Part of the 2026-09-05 cross-tenant warehouse fix (see
-- 20260905090000_guard_stock_movement_warehouse_tenant.sql for the root-cause explanation).
-- p_warehouse_id was trusted blindly when a caller supplied it (only validated on the
-- COALESCE-to-default path). Adds explicit tenant+branch validation, matching
-- start_driver_trip()'s existing pattern for its own warehouse parameter.

CREATE OR REPLACE FUNCTION public.complete_driver_field_sale(p_ticket_id uuid, p_warehouse_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant  uuid := public.current_tenant_id();
  v_ticket  public.tickets;
  v_trip    public.driver_trips;
  v_wh      uuid;
  v_items   int;
  v_invoice public.invoices;
  v_item    record;
  v_moves   jsonb := '[]'::jsonb;
  v_move    public.stock_movements;
BEGIN
  SELECT * INTO v_ticket FROM public.tickets
  WHERE id = p_ticket_id AND tenant_id = v_tenant FOR UPDATE;

  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'ticket not found'
      USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'invalid_transition')::text;
  END IF;

  IF NOT public.has_branch_access(v_ticket.branch_id) THEN
    RAISE EXCEPTION 'insufficient_role: ticket is outside your branch scope'
      USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'insufficient_role')::text;
  END IF;

  IF v_ticket.status <> 'draft' THEN
    RAISE EXCEPTION 'invalid_transition: the field-sale shortcut only applies to a draft ticket, this one is %', v_ticket.status
      USING ERRCODE = 'P0001',
            DETAIL = json_build_object('code', 'invalid_transition', 'from', v_ticket.status, 'to', 'completed')::text;
  END IF;

  IF v_ticket.driver_trip_id IS NULL THEN
    RAISE EXCEPTION 'invalid_request: ticket is not linked to a driver trip'
      USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'invalid_request')::text;
  END IF;

  -- Preserves AD-019: deliveries stays the sole proof-of-delivery authority. A
  -- delivery-fulfilment ticket must still walk the normal ready -> delivered gate.
  IF v_ticket.fulfilment_type <> 'pickup' THEN
    RAISE EXCEPTION 'invalid_request: the field-sale shortcut is pickup-only; this ticket is fulfilment_type=%', v_ticket.fulfilment_type
      USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'invalid_request')::text;
  END IF;

  SELECT * INTO v_trip FROM public.driver_trips
  WHERE id = v_ticket.driver_trip_id AND tenant_id = v_tenant FOR UPDATE;

  IF v_trip.id IS NULL THEN
    RAISE EXCEPTION 'driver trip not found'
      USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'invalid_request')::text;
  END IF;

  IF v_trip.status <> 'in_transit' THEN
    RAISE EXCEPTION 'invalid_transition: driver trip is not in transit'
      USING ERRCODE = 'P0001',
            DETAIL = json_build_object('code', 'invalid_transition', 'from', v_trip.status)::text;
  END IF;

  -- Identity check beyond the trigger's generic role check, same two-layer pattern
  -- record_payment() already uses: holding 'driver' isn't enough, this must be the
  -- trip's own driver, unless the caller is a manager. guard_ticket_driver_trip_assignment()
  -- already guarantees trip.driver_id equals this ticket's created_by (Path B) or
  -- assigned_to (Path A) at link time, so this single check covers both paths.
  IF v_trip.driver_id <> auth.uid() AND NOT public.has_role(ARRAY['owner','admin','branch_manager']) THEN
    RAISE EXCEPTION 'insufficient_role: only the trip''s own driver or a manager may complete its field sales'
      USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'insufficient_role')::text;
  END IF;

  SELECT count(*) INTO v_items FROM public.ticket_items WHERE ticket_id = p_ticket_id;
  IF v_items = 0 THEN
    RAISE EXCEPTION 'a ticket needs at least one item before it can be completed'
      USING ERRCODE = 'P0001',
            DETAIL = json_build_object('code', 'invalid_transition', 'reason', 'no_items')::text;
  END IF;

  -- Recompute rather than trust: totals are the basis of the invoice. Same mechanism
  -- confirm_ticket() uses -- a separate UPDATE, since subtotal_amount is unfrozen while
  -- still 'draft'.
  UPDATE public.tickets
     SET subtotal_amount = COALESCE(
           (SELECT SUM(oi.line_total) FROM public.ticket_items oi WHERE oi.ticket_id = p_ticket_id), 0)
   WHERE id = p_ticket_id;

  -- Marks this transaction as an authorized RPC-driven completion, so the trigger above
  -- lets draft -> completed through. Transaction-scoped: never leaks to a later,
  -- unrelated request. Same technique BLOCKER-017 established for production_batches.
  PERFORM set_config('bakeflow.driver_field_sale_rpc', 'true', true);

  UPDATE public.tickets SET status = 'completed'
   WHERE id = p_ticket_id
  RETURNING * INTO v_ticket;

  -- Invoice: same insert-or-refresh-total shape as confirm_ticket().
  INSERT INTO public.invoices
    (tenant_id, branch_id, ticket_id, invoice_number, total_amount, due_at, created_by)
  VALUES
    (v_tenant, v_ticket.branch_id, v_ticket.id,
     public.next_document_number(v_tenant, 'invoice'),
     v_ticket.total_amount, v_ticket.due_at, auth.uid())
  ON CONFLICT (ticket_id) DO UPDATE SET total_amount = excluded.total_amount
  RETURNING * INTO v_invoice;

  -- One sale movement per line, out of the TRIP's own warehouse (the vehicle) by
  -- default -- not the branch's default warehouse as complete_ticket() would use. The
  -- goods being sold here were already moved into the vehicle's custody by
  -- verify_trip_loading(); deducting from the branch shelf instead would corrupt both
  -- warehouses' stock levels. apply_stock_movement() still refuses to go negative, so an
  -- oversold ticket rolls the whole completion back.
  --
  -- p_warehouse_id, when supplied, must belong to this same tenant and to the ticket's own
  -- branch -- otherwise a caller could redirect the sale movement onto another tenant's
  -- warehouse, corrupting that tenant's actual stock levels (ingredient_stock_levels/
  -- product_stock_levels are keyed by warehouse_id+item only, not tenant_id -- the
  -- stock_movements_guard_warehouse_tenant trigger is the backstop, this is the specific,
  -- friendly rejection before it).
  IF p_warehouse_id IS NOT NULL THEN
    SELECT id INTO v_wh FROM public.warehouses
    WHERE id = p_warehouse_id AND tenant_id = v_tenant AND branch_id = v_ticket.branch_id;

    IF v_wh IS NULL THEN
      RAISE EXCEPTION 'warehouse not found at this branch'
        USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'invalid_request')::text;
    END IF;
  ELSE
    v_wh := v_trip.warehouse_id;
  END IF;

  FOR v_item IN
    SELECT product_variant_id, SUM(quantity) AS qty
    FROM public.ticket_items WHERE ticket_id = p_ticket_id
    GROUP BY product_variant_id
  LOOP
    INSERT INTO public.stock_movements
      (tenant_id, branch_id, warehouse_id, item_type, product_variant_id,
       quantity_delta, reason, reference_type, reference_id, created_by)
    VALUES
      (v_tenant, v_ticket.branch_id, v_wh, 'product', v_item.product_variant_id,
       -v_item.qty, 'sale', 'order', p_ticket_id, auth.uid())
    RETURNING * INTO v_move;

    v_moves := v_moves || to_jsonb(v_move);
  END LOOP;

  RETURN jsonb_build_object('ticket', to_jsonb(v_ticket), 'invoice', to_jsonb(v_invoice), 'movements', v_moves);
END;
$function$;
