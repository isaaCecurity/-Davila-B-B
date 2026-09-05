-- Part of the 2026-09-05 cross-tenant warehouse fix (see
-- 20260905090000_guard_stock_movement_warehouse_tenant.sql for the root-cause explanation).
-- This is the sync-dispatcher overload (p_tenant_id): the actual reachable call site,
-- invoked from apply_production_record_output with a client-supplied payload warehouse_id
-- and zero prior validation -- currently dead in practice because AD-022's
-- sync_operations_domain_operation_check rejects 'production.record_output' outright, but
-- this fix closes the gap now so it can't reopen the moment AD-022 is reversed.

CREATE OR REPLACE FUNCTION public.complete_production_batch(p_batch_id uuid, p_actual_quantity numeric, p_ingredient_actuals jsonb DEFAULT '[]'::jsonb, p_warehouse_id uuid DEFAULT NULL::uuid, p_tenant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant  uuid := coalesce(p_tenant_id, public.current_tenant_id());
  v_batch   public.production_batches;
  v_variant uuid;
  v_wh      uuid := p_warehouse_id;
  v_row     record;
  v_actual  numeric(18,4);
  v_waste   numeric(18,4);
  v_moves   jsonb := '[]'::jsonb;
  v_move    public.stock_movements;
begin
  if p_actual_quantity is null or p_actual_quantity <= 0 then
    raise exception 'actual_quantity must be greater than zero'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;
  select * into v_batch from public.production_batches
  where id = p_batch_id and tenant_id = v_tenant for update;
  if v_batch.id is null then
    raise exception 'batch not found'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;
  if v_batch.status <> 'in_progress' then
    raise exception 'invalid_transition: batch is %', v_batch.status
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition','from', v_batch.status, 'to', 'completed')::text;
  end if;
  select r.product_variant_id into v_variant from public.recipes r where r.id = v_batch.recipe_id;

  -- p_warehouse_id, when supplied, must belong to this same tenant and to the batch's own
  -- branch -- see the 4-arg overload's migration for the full explanation (this is the
  -- sync-dispatcher overload of the same function).
  if v_wh is not null then
    perform 1 from public.warehouses
    where id = v_wh and tenant_id = v_tenant and branch_id = v_batch.branch_id;

    if not found then
      raise exception 'warehouse not found at this branch'
        using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
    end if;
  else
    select id into v_wh from public.warehouses
    where tenant_id = v_tenant and branch_id = v_batch.branch_id and is_default limit 1;
  end if;
  if v_wh is null then
    raise exception 'no default warehouse for this branch; pass a warehouse explicitly'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;
  for v_row in
    select pbi.id, pbi.ingredient_id, pbi.planned_quantity
    from public.production_batch_ingredients pbi where pbi.batch_id = p_batch_id
  loop
    select coalesce((a ->> 'actual_quantity')::numeric, v_row.planned_quantity),
           coalesce((a ->> 'waste_quantity')::numeric, 0)
      into v_actual, v_waste
    from jsonb_array_elements(coalesce(p_ingredient_actuals, '[]'::jsonb)) a
    where (a ->> 'ingredient_id')::uuid = v_row.ingredient_id;
    v_actual := coalesce(v_actual, v_row.planned_quantity);
    v_waste  := coalesce(v_waste, 0);
    update public.production_batch_ingredients set actual_quantity = v_actual, waste_quantity = v_waste where id = v_row.id;
    if v_actual > 0 then
      insert into public.stock_movements
        (tenant_id, branch_id, warehouse_id, item_type, ingredient_id, quantity_delta, reason, reference_type, reference_id, created_by)
      values (v_tenant, v_batch.branch_id, v_wh, 'ingredient', v_row.ingredient_id, -v_actual, 'production_consume', 'production_batch', p_batch_id, auth.uid())
      returning * into v_move;
      v_moves := v_moves || to_jsonb(v_move);
    end if;
  end loop;
  insert into public.stock_movements
    (tenant_id, branch_id, warehouse_id, item_type, product_variant_id, quantity_delta, reason, reference_type, reference_id, created_by)
  values (v_tenant, v_batch.branch_id, v_wh, 'product', v_variant, p_actual_quantity, 'production_output', 'production_batch', p_batch_id, auth.uid())
  returning * into v_move;
  v_moves := v_moves || to_jsonb(v_move);
  perform set_config('bakeflow.production_batch_rpc', 'true', true);
  update public.production_batches set actual_quantity = p_actual_quantity, completed_at = now(), status = 'completed'
   where id = p_batch_id returning * into v_batch;
  return jsonb_build_object('batch', to_jsonb(v_batch), 'movements', v_moves);
end $function$;
