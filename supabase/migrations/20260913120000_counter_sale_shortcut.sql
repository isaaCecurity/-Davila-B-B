-- AD-024 (resolves BLOCKER-030): the counter sale — a walk-in or named customer buying what is
-- already on the shelf, paid in full, in one atomic action. Mirrors AD-020's driver shortcut.
--
-- 1. guard_ticket_status_transition(): `draft -> completed` stays refused everywhere except inside
--    one of two RPCs, each marked by its own transaction-local flag:
--      bakeflow.driver_field_sale_rpc  (AD-020, unchanged rules: pickup, trip-linked, driver/manager)
--      bakeflow.counter_sale_rpc       (AD-024: pickup, NOT trip-linked, owner/admin/manager/cashier)
-- 2. complete_counter_sale(): creates the ticket and its lines, completes it, issues the invoice,
--    writes the sale stock movements from the branch stockroom, and records the full payment —
--    all in one transaction, so a refused payment (e.g. cash with no open till) or an oversold line
--    rolls the whole sale back.

CREATE OR REPLACE FUNCTION public.guard_ticket_status_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  allowed           text[];
  actors            text[];
  v_refund          numeric(19,4);
  v_delivery_status text;
  v_true_subtotal   numeric(19,4);
  v_field_sale      boolean := COALESCE(current_setting('bakeflow.driver_field_sale_rpc', true), 'false') = 'true';
  v_counter_sale    boolean := COALESCE(current_setting('bakeflow.counter_sale_rpc', true), 'false') = 'true';
BEGIN
  -- ── Money freeze ────────────────────────────────────────────────────────────
  IF OLD.status <> 'draft'
     AND NEW.subtotal_amount IS DISTINCT FROM OLD.subtotal_amount THEN
    SELECT COALESCE(SUM(line_total), 0) INTO v_true_subtotal
    FROM public.ticket_items WHERE ticket_id = NEW.id;

    IF NEW.subtotal_amount IS DISTINCT FROM v_true_subtotal THEN
      RAISE EXCEPTION 'subtotal_amount is frozen once a ticket leaves draft'
        USING ERRCODE = '42501',
              DETAIL  = json_build_object(
                'code', 'immutable_field',
                'field', 'subtotal_amount',
                'current_status', OLD.status
              )::text;
    END IF;
  END IF;

  -- ── Status unchanged — nothing more to do ───────────────────────────────────
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- ── Allowed transitions ─────────────────────────────────────────────────────
  -- 'completed' is a draft target only for the two shortcuts gated immediately below
  -- (AD-020 driver field sale, AD-024 counter sale); this array alone does not make it reachable.
  allowed := CASE OLD.status
    WHEN 'draft'         THEN ARRAY['submitted', 'cancelled', 'completed']
    WHEN 'submitted'     THEN ARRAY['confirmed', 'cancelled']
    WHEN 'confirmed'     THEN ARRAY['scheduled', 'cancelled']
    WHEN 'scheduled'     THEN ARRAY['in_production', 'cancelled']
    WHEN 'in_production' THEN ARRAY['ready', 'cancelled']
    WHEN 'ready'         THEN ARRAY['delivered', 'cancelled']
    WHEN 'delivered'     THEN ARRAY['completed', 'cancelled']
    WHEN 'cancelled'     THEN ARRAY['archived']
    ELSE ARRAY[]::text[]
  END;

  IF NOT (NEW.status = ANY(allowed)) THEN
    RAISE EXCEPTION 'invalid_transition: order % -> %', OLD.status, NEW.status
      USING ERRCODE = 'P0001',
            DETAIL  = json_build_object(
              'code', 'invalid_transition',
              'from', OLD.status,
              'to',   NEW.status
            )::text;
  END IF;

  -- ── draft -> completed: only through complete_driver_field_sale() or complete_counter_sale() ──
  IF OLD.status = 'draft' AND NEW.status = 'completed' THEN
    IF NOT v_field_sale AND NOT v_counter_sale THEN
      RAISE EXCEPTION 'invalid_transition: draft -> completed is only reachable through complete_driver_field_sale() or complete_counter_sale()'
        USING ERRCODE = 'P0001',
              DETAIL  = json_build_object(
                'code', 'invalid_transition',
                'from', 'draft',
                'to',   'completed'
              )::text;
    END IF;

    IF NEW.fulfilment_type <> 'pickup' THEN
      RAISE EXCEPTION 'invalid_transition: the draft -> completed shortcut is pickup-only'
        USING ERRCODE = 'P0001',
              DETAIL  = json_build_object(
                'code', 'invalid_transition',
                'reason', 'not_pickup'
              )::text;
    END IF;

    IF v_field_sale AND NEW.driver_trip_id IS NULL THEN
      RAISE EXCEPTION 'invalid_transition: the driver field-sale shortcut requires driver_trip_id'
        USING ERRCODE = 'P0001',
              DETAIL  = json_build_object(
                'code', 'invalid_transition',
                'reason', 'no_trip'
              )::text;
    END IF;

    IF v_counter_sale AND NEW.driver_trip_id IS NOT NULL THEN
      RAISE EXCEPTION 'invalid_transition: a counter sale cannot be linked to a driver trip'
        USING ERRCODE = 'P0001',
              DETAIL  = json_build_object(
                'code', 'invalid_transition',
                'reason', 'trip_linked'
              )::text;
    END IF;
  END IF;

  -- ── Role check ──────────────────────────────────────────────────────────────
  actors := CASE NEW.status
    WHEN 'submitted'     THEN ARRAY['owner', 'admin', 'branch_manager', 'cashier']
    WHEN 'confirmed'     THEN ARRAY['owner', 'admin', 'branch_manager', 'cashier']
    WHEN 'scheduled'     THEN ARRAY['owner', 'admin', 'branch_manager', 'cashier']
    WHEN 'in_production' THEN ARRAY['owner', 'admin', 'branch_manager', 'baker']
    WHEN 'ready'         THEN ARRAY['owner', 'admin', 'branch_manager', 'baker']
    WHEN 'delivered'     THEN ARRAY['owner', 'admin', 'branch_manager', 'cashier']
    WHEN 'completed'     THEN CASE
                                WHEN OLD.status = 'draft' AND v_counter_sale
                                  THEN ARRAY['owner', 'admin', 'branch_manager', 'cashier']
                                WHEN OLD.status = 'draft'
                                  THEN ARRAY['owner', 'admin', 'branch_manager', 'driver']
                                ELSE ARRAY['owner', 'admin', 'branch_manager', 'cashier']
                              END
    WHEN 'cancelled'     THEN ARRAY['owner', 'admin', 'branch_manager']
    WHEN 'archived'      THEN ARRAY['owner', 'admin', 'branch_manager']
  END;

  IF auth.uid() IS NOT NULL AND NOT public.has_role(actors) THEN
    RAISE EXCEPTION 'insufficient_role: % requires one of %', NEW.status, actors
      USING ERRCODE = 'P0001',
            DETAIL  = json_build_object(
              'code',     'insufficient_role',
              'required', actors
            )::text;
  END IF;

  -- ── Delivery gate ────────────────────────────────────────────────────────────
  IF NEW.status = 'delivered' AND NEW.fulfilment_type = 'delivery' THEN
    SELECT d.status INTO v_delivery_status
    FROM   public.deliveries d
    WHERE  d.ticket_id = NEW.id;

    IF v_delivery_status IS DISTINCT FROM 'delivered' THEN
      RAISE EXCEPTION 'delivery_not_complete: order requires linked delivery to be delivered first'
        USING ERRCODE = 'P0001',
              DETAIL  = json_build_object(
                'code',            'delivery_not_complete',
                'delivery_status', v_delivery_status
              )::text;
    END IF;
  END IF;

  -- ── Cancellation rules ───────────────────────────────────────────────────────
  IF NEW.status = 'cancelled' THEN
    IF COALESCE(BTRIM(NEW.cancelled_reason), '') = '' THEN
      RAISE EXCEPTION 'cancellation requires a reason'
        USING ERRCODE = 'P0001',
              DETAIL  = json_build_object(
                'code',   'invalid_transition',
                'reason', 'cancelled_reason_required'
              )::text;
    END IF;

    IF NEW.amount_paid > 0 THEN
      SELECT COALESCE(SUM(r.amount), 0) INTO v_refund
      FROM   public.refunds r
      JOIN   public.payments p ON p.id = r.payment_id
      WHERE  p.ticket_id = NEW.id;

      IF v_refund < NEW.amount_paid THEN
        RAISE EXCEPTION 'refund_required: % paid, only % refunded', NEW.amount_paid, v_refund
          USING ERRCODE = 'P0001',
                DETAIL  = json_build_object(
                  'code',      'refund_required',
                  'paid',      NEW.amount_paid,
                  'refunded',  v_refund
                )::text;
      END IF;
    END IF;
  END IF;

  -- ── Revenue-recognition timestamp ───────────────────────────────────────────
  -- Single choke point: every entry path into 'completed' (delivered -> completed and both
  -- draft -> completed shortcuts) passes through here.
  IF NEW.status = 'completed' THEN
    NEW.completed_at := now();
  END IF;

  -- ── Audit ────────────────────────────────────────────────────────────────────
  PERFORM public.log_audit_event(
    NEW.tenant_id, 'ticket', NEW.id, 'status_change',
    jsonb_build_object('status', OLD.status),
    jsonb_build_object('status', NEW.status)
  );

  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.complete_counter_sale(
  p_branch_id      uuid,
  p_items          jsonb,
  p_payment_method text,
  p_customer_id    uuid DEFAULT NULL,
  p_warehouse_id   uuid DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant   uuid := public.current_tenant_id();
  v_ticket   public.tickets;
  v_invoice  public.invoices;
  v_wh       uuid;
  v_session  uuid;
  v_line     jsonb;
  v_variant  uuid;
  v_qty      numeric;
  v_item     record;
  v_payment  jsonb;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'invalid_request: no active organization'
      USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'invalid_request')::text;
  END IF;

  IF NOT public.has_role(ARRAY['owner', 'admin', 'branch_manager', 'cashier']) THEN
    RAISE EXCEPTION 'insufficient_role: counter sales require owner, admin, branch manager or cashier'
      USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'insufficient_role')::text;
  END IF;

  PERFORM 1 FROM public.branches
   WHERE id = p_branch_id AND tenant_id = v_tenant AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_request: branch not found'
      USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'invalid_request')::text;
  END IF;

  IF NOT public.has_branch_access(p_branch_id) THEN
    RAISE EXCEPTION 'insufficient_role: branch is outside your scope'
      USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'insufficient_role')::text;
  END IF;

  IF p_payment_method IS NULL OR p_payment_method NOT IN ('cash', 'transfer', 'pos', 'card') THEN
    RAISE EXCEPTION 'invalid_request: payment method must be cash, transfer, pos or card'
      USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'invalid_request', 'reason', 'payment_method')::text;
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'invalid_request: a sale needs at least one item'
      USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'invalid_request', 'reason', 'no_items')::text;
  END IF;

  IF jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'invalid_request: too many lines in one sale'
      USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'invalid_request', 'reason', 'too_many_items')::text;
  END IF;

  IF p_customer_id IS NOT NULL THEN
    PERFORM 1 FROM public.customers
     WHERE id = p_customer_id AND tenant_id = v_tenant AND deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_request: customer not found'
        USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'invalid_request', 'reason', 'customer')::text;
    END IF;
  END IF;

  -- Stock leaves the branch's shelf: an explicit stockroom must belong to this tenant and
  -- branch (same validation as complete_ticket()); otherwise the branch default.
  IF p_warehouse_id IS NOT NULL THEN
    SELECT id INTO v_wh FROM public.warehouses
     WHERE id = p_warehouse_id AND tenant_id = v_tenant AND branch_id = p_branch_id AND deleted_at IS NULL;
  ELSE
    SELECT id INTO v_wh FROM public.warehouses
     WHERE tenant_id = v_tenant AND branch_id = p_branch_id AND is_default AND deleted_at IS NULL
     LIMIT 1;
  END IF;
  IF v_wh IS NULL THEN
    RAISE EXCEPTION 'invalid_request: no stockroom at this branch to sell from'
      USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'invalid_request', 'reason', 'warehouse')::text;
  END IF;

  -- A friendly, coded refusal before any row is written. record_payment() re-checks it.
  IF p_payment_method = 'cash' THEN
    SELECT id INTO v_session FROM public.cash_sessions
     WHERE tenant_id = v_tenant AND branch_id = p_branch_id AND status = 'open' AND deleted_at IS NULL
     LIMIT 1;
    IF v_session IS NULL THEN
      RAISE EXCEPTION 'no_open_till: cash sales need an open till session at this branch'
        USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'invalid_transition', 'reason', 'no_open_till')::text;
    END IF;
  END IF;

  INSERT INTO public.tickets
    (tenant_id, branch_id, customer_id, fulfilment_type, sale_customer_type, driver_trip_id)
  VALUES
    (v_tenant, p_branch_id, p_customer_id, 'pickup',
     CASE WHEN p_customer_id IS NULL THEN 'ROADSIDE' ELSE 'REGISTERED' END, NULL)
  RETURNING * INTO v_ticket;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    BEGIN
      v_variant := (v_line ->> 'product_variant_id')::uuid;
      v_qty     := (v_line ->> 'quantity')::numeric;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid_request: each item needs a product_variant_id and a quantity'
        USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'invalid_request', 'reason', 'item_shape')::text;
    END;

    IF v_variant IS NULL OR v_qty IS NULL OR v_qty <= 0 OR v_qty <> round(v_qty, 4) THEN
      RAISE EXCEPTION 'invalid_request: quantities must be greater than zero with at most 4 decimal places'
        USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'invalid_request', 'reason', 'quantity')::text;
    END IF;

    PERFORM 1 FROM public.product_variants
     WHERE id = v_variant AND tenant_id = v_tenant AND deleted_at IS NULL AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_request: a product in this sale is not available'
        USING ERRCODE = 'P0001', DETAIL = json_build_object('code', 'invalid_request', 'reason', 'variant_unavailable')::text;
    END IF;

    -- unit_price is overwritten from the catalogue by guard_order_item_price().
    INSERT INTO public.ticket_items (tenant_id, ticket_id, product_variant_id, quantity, unit_price)
    VALUES (v_tenant, v_ticket.id, v_variant, v_qty, 0);
  END LOOP;

  -- Recompute rather than trust (same mechanism as confirm_ticket()); still 'draft', so unfrozen.
  UPDATE public.tickets
     SET subtotal_amount = COALESCE(
           (SELECT SUM(ti.line_total) FROM public.ticket_items ti WHERE ti.ticket_id = v_ticket.id), 0)
   WHERE id = v_ticket.id;

  PERFORM set_config('bakeflow.counter_sale_rpc', 'true', true);
  UPDATE public.tickets SET status = 'completed'
   WHERE id = v_ticket.id
  RETURNING * INTO v_ticket;
  PERFORM set_config('bakeflow.counter_sale_rpc', 'false', true);

  INSERT INTO public.invoices
    (tenant_id, branch_id, ticket_id, invoice_number, total_amount, due_at, created_by)
  VALUES
    (v_tenant, v_ticket.branch_id, v_ticket.id,
     public.next_document_number(v_tenant, 'invoice'),
     v_ticket.total_amount, v_ticket.due_at, auth.uid())
  ON CONFLICT (ticket_id) DO UPDATE SET total_amount = excluded.total_amount
  RETURNING * INTO v_invoice;

  -- One sale movement per variant; apply_stock_movement() refuses to oversell, rolling back the sale.
  FOR v_item IN
    SELECT product_variant_id, SUM(quantity) AS qty
      FROM public.ticket_items WHERE ticket_id = v_ticket.id
     GROUP BY product_variant_id
  LOOP
    INSERT INTO public.stock_movements
      (tenant_id, branch_id, warehouse_id, item_type, product_variant_id,
       quantity_delta, reason, reference_type, reference_id, created_by)
    VALUES
      (v_tenant, v_ticket.branch_id, v_wh, 'product', v_item.product_variant_id,
       -v_item.qty, 'sale', 'order', v_ticket.id, auth.uid());
  END LOOP;

  -- Paid in full, as the prototype's counter sale is. A zero-total sale records no payment.
  IF v_ticket.total_amount > 0 THEN
    v_payment := public.record_payment(v_ticket.id, v_ticket.total_amount, p_payment_method, NULL, NULL, NULL);
  END IF;

  SELECT * INTO v_ticket FROM public.tickets WHERE id = v_ticket.id;

  -- Money is returned as text: to_jsonb of numeric would lose its scale on the wire (TD-012).
  RETURN jsonb_build_object(
    'ticket_id',      v_ticket.id,
    'ticket_number',  v_ticket.ticket_number,
    'invoice_id',     v_invoice.id,
    'total_amount',   v_ticket.total_amount::text,
    'amount_paid',    v_ticket.amount_paid::text,
    'payment_id',     v_payment -> 'payment' ->> 'id',
    'payment_method', p_payment_method
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_counter_sale(uuid, jsonb, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_counter_sale(uuid, jsonb, text, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_counter_sale(uuid, jsonb, text, uuid, uuid) TO authenticated, service_role;
