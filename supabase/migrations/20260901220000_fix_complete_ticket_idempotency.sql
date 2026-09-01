-- Found while building the P4.4 ticket write-path test suite: complete_ticket() had no
-- guard against being called twice on an already-'completed' ticket. Its final
-- `UPDATE ... SET status = 'completed'` is a silent no-op on a second call (NEW.status =
-- OLD.status short-circuits guard_ticket_status_transition() before it can reject
-- anything), so nothing ever raised -- but the stock-movement loop above it runs
-- unconditionally every call, with no idempotency key of its own. Verified live in a
-- rolled-back transaction: two calls on the same ticket sold the same 3 units twice,
-- silently taking on-hand from 50 to 44 instead of the correct 47. A client retry after
-- a timeout, or a double-tap, would silently oversell/under-record stock in production.
--
-- Fix: reject outright if the ticket is already 'completed', mirroring this project's
-- existing pattern for this exact class of check (archive_catalog_entity's "already
-- archived", restore_catalog_entity's "not archived"). Every other invalid starting
-- status was already safe -- the trigger's invalid_transition exception aborts the
-- whole call, including any stock movements inserted earlier in the same statement, so
-- only the same-status (no-op) case needed a dedicated check.

CREATE OR REPLACE FUNCTION public.complete_ticket(p_order_id uuid, p_warehouse_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_order  public.tickets;
  v_wh     uuid := p_warehouse_id;
  v_item   record;
  v_moves  jsonb := '[]'::jsonb;
  v_move   public.stock_movements;
begin
  select * into v_order from public.tickets
  where id = p_order_id and tenant_id = v_tenant for update;

  if v_order.id is null then
    raise exception 'order not found'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  if v_order.status = 'completed' then
    raise exception 'order is already completed'
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition', 'reason', 'already_completed')::text;
  end if;

  if v_wh is null then
    select id into v_wh from public.warehouses
    where tenant_id = v_tenant and branch_id = v_order.branch_id and is_default
    limit 1;
  end if;

  if v_wh is null then
    raise exception 'no default warehouse for this branch; pass a warehouse explicitly'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  for v_item in
    select product_variant_id, sum(quantity) as qty
    from public.ticket_items where ticket_id = p_order_id
    group by product_variant_id
  loop
    insert into public.stock_movements
      (tenant_id, branch_id, warehouse_id, item_type, product_variant_id,
       quantity_delta, reason, reference_type, reference_id, created_by)
    values
      (v_tenant, v_order.branch_id, v_wh, 'product', v_item.product_variant_id,
       -v_item.qty, 'sale', 'order', p_order_id, auth.uid())
    returning * into v_move;

    v_moves := v_moves || to_jsonb(v_move);
  end loop;

  update public.tickets set status = 'completed' where id = p_order_id
  returning * into v_order;

  return jsonb_build_object('ticket', to_jsonb(v_order), 'movements', v_moves);
end $function$;
