-- Part of the 2026-09-05 cross-tenant warehouse fix (see
-- 20260905090000_guard_stock_movement_warehouse_tenant.sql for the root-cause explanation).
-- p_warehouse_id was trusted blindly when a caller supplied it (only validated on the
-- IS NULL default-lookup path).

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

  -- p_warehouse_id, when supplied, must belong to this same tenant and to the ticket's own
  -- branch -- otherwise a caller could redirect the sale movement onto another tenant's
  -- warehouse, corrupting that tenant's actual stock levels (ingredient_stock_levels/
  -- product_stock_levels are keyed by warehouse_id+item only, not tenant_id -- the
  -- stock_movements_guard_warehouse_tenant trigger is the backstop, this is the specific,
  -- friendly rejection before it).
  if v_wh is not null then
    perform 1 from public.warehouses
    where id = v_wh and tenant_id = v_tenant and branch_id = v_order.branch_id;

    if not found then
      raise exception 'warehouse not found at this branch'
        using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
    end if;
  else
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
