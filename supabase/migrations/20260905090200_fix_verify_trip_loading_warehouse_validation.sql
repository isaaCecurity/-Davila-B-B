-- Part of the 2026-09-05 cross-tenant warehouse fix (see
-- 20260905090000_guard_stock_movement_warehouse_tenant.sql for the root-cause explanation).
-- p_source_warehouse_id was trusted blindly when a caller supplied it (only validated on the
-- IS NULL default-lookup path).

CREATE OR REPLACE FUNCTION public.verify_trip_loading(p_trip_id uuid, p_items jsonb, p_source_warehouse_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.current_tenant_id();
  v_trip public.driver_trips;
  v_source uuid := p_source_warehouse_id;
  v_item jsonb;
  v_item_type text;
  v_item_id uuid;
  v_qty numeric(18,4);
  v_moves jsonb := '[]'::jsonb;
  v_move public.stock_movements;
begin
  if not public.has_role(array['owner','admin','branch_manager','supervisor','baker']) then
    raise exception 'insufficient_role: loading must be verified by a supervisor, manager, or baker'
      using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  select * into v_trip from public.driver_trips
  where id = p_trip_id and tenant_id = v_tenant for update;

  if v_trip.id is null then
    raise exception 'trip not found'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  if not public.has_branch_access(v_trip.branch_id) then
    raise exception 'insufficient_role: trip is outside your branch scope'
      using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  if v_trip.status <> 'created' then
    raise exception 'invalid_transition: loading can only be verified on a newly created trip'
      using errcode = 'P0001',
            detail = json_build_object('code', 'invalid_transition', 'from', v_trip.status)::text;
  end if;

  -- p_source_warehouse_id, when supplied, must belong to this same tenant and branch --
  -- otherwise a caller could pull the transfer_out movement from another tenant's
  -- warehouse, corrupting that tenant's actual stock levels (ingredient_stock_levels/
  -- product_stock_levels are keyed by warehouse_id+item only, not tenant_id -- the
  -- stock_movements_guard_warehouse_tenant trigger is the backstop, this is the specific,
  -- friendly rejection before it).
  if v_source is not null then
    perform 1 from public.warehouses
    where id = v_source and tenant_id = v_tenant and branch_id = v_trip.branch_id;

    if not found then
      raise exception 'warehouse not found at this branch'
        using errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
    end if;
  else
    select id into v_source from public.warehouses
    where tenant_id = v_tenant and branch_id = v_trip.branch_id and is_default limit 1;
  end if;

  if v_source is null then
    raise exception 'no default warehouse for this branch; pass a source explicitly'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'at least one item must be loaded'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  end if;

  update public.driver_trips set status = 'loading' where id = p_trip_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_item_type := v_item ->> 'item_type';
    v_item_id := (v_item ->> 'item_id')::uuid;
    v_qty := (v_item ->> 'quantity')::numeric(18,4);

    if v_item_type not in ('ingredient','product') or v_qty is null or v_qty <= 0 then
      raise exception 'invalid load item: %', v_item
        using errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
    end if;

    insert into public.stock_movements
      (tenant_id, branch_id, warehouse_id, item_type, ingredient_id, product_variant_id,
       quantity_delta, reason, reference_type, reference_id, created_by)
    values
      (v_tenant, v_trip.branch_id, v_source, v_item_type,
       case when v_item_type = 'ingredient' then v_item_id end,
       case when v_item_type = 'product' then v_item_id end,
       -v_qty, 'transfer_out', 'driver_trip', p_trip_id, auth.uid())
    returning * into v_move;
    v_moves := v_moves || to_jsonb(v_move);

    insert into public.stock_movements
      (tenant_id, branch_id, warehouse_id, item_type, ingredient_id, product_variant_id,
       quantity_delta, reason, reference_type, reference_id, created_by)
    values
      (v_tenant, v_trip.branch_id, v_trip.warehouse_id, v_item_type,
       case when v_item_type = 'ingredient' then v_item_id end,
       case when v_item_type = 'product' then v_item_id end,
       v_qty, 'transfer_in', 'driver_trip', p_trip_id, auth.uid())
    returning * into v_move;
    v_moves := v_moves || to_jsonb(v_move);
  end loop;

  update public.driver_trips
     set status = 'ready_to_depart', loading_verified_by = auth.uid(), loading_verified_at = now()
   where id = p_trip_id
  returning * into v_trip;

  return jsonb_build_object('trip', to_jsonb(v_trip), 'movements', v_moves);
end
$function$;
