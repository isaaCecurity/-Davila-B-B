-- AD-022: Deactivate raw-ingredient/production stock tracking for MVP.
--
-- Product decision: MVP tracks finished-product stock only ("how many loaves are left
-- to sell"). Raw-ingredient tracking (flour, sugar, recipes/BOMs, production batches
-- consuming ingredients) is deferred to v2. Nothing is dropped -- ingredients, recipes,
-- production_batches, and their RPCs stay in the schema, tested, for v2 to re-enable by
-- reversing this migration.
--
-- Full blast-radius audit (session of 2026-09-01, live-verified, not assumed):
--   - ingredients/recipes/recipe_ingredients/production_batches/production_batch_ingredients
--     all had direct INSERT/SELECT/UPDATE grants to `authenticated` (PostgREST write path),
--     confirmed via information_schema.role_table_grants.
--   - adjust_stock() and the sync handlers apply_inventory_adjust()/apply_inventory_waste()
--     are SECURITY DEFINER and branch on item_type IN ('ingredient','product') -- revoking
--     table grants alone would not stop them adjusting an *existing* ingredient's stock,
--     since SECURITY DEFINER bypasses the caller's own grants. Each narrowed explicitly.
--   - apply_production_start/.cancel/.record_output/.record_waste are 100% production-batch
--     logic with no product-only branch to preserve, already unreachable directly by
--     `authenticated` (confirmed via has_function_privilege) -- only reachable via
--     process_sync_batch()'s dispatcher, gated by the domain_operation CHECK constraint.
--     Removed from that allowlist, same pattern already used for inventory.receive/.consume/
--     .transfer and production.complete (BLOCKER-026/027). Confirmed zero live sync_operations/
--     sync_changes rows use these four values, so the stricter CHECK needs no NOT VALID.
--   - complete_production_batch()/fail_production_batch() (4-arg, authenticated-facing
--     overload) revoked directly for defense in depth, now that production_batches can't be
--     created anyway. The 5-arg internal variant was already REVOKE'd from everyone.
--   - Deliberately NOT touched: return_driver_trip()/verify_trip_loading() also accept
--     item_type IN ('ingredient','product'), but that's the driver-trip loading feature
--     (P9.3, live-tested), not the ingredient-tracking feature being deactivated here -- a
--     driver has no legitimate reason to load raw ingredients, and no ingredient is any
--     longer creatable/visible to reach that code path in practice. Left as-is rather than
--     touching a green, unrelated, already-tested feature.
--   - apply_stock_movement() (the AFTER INSERT trigger maintaining *_stock_levels) is
--     generic infrastructure, not a decision point -- its ingredient branch simply stops
--     firing once nothing inserts an ingredient-type stock_movements row. Left untouched.

-- ---------------------------------------------------------------------------------------
-- 1. Cut off direct table access to the ingredient/production-tracking tables.
-- ---------------------------------------------------------------------------------------
revoke all on table public.ingredients, public.recipes, public.recipe_ingredients,
  public.production_batches, public.production_batch_ingredients, public.ingredient_stock_levels
  from authenticated;

-- ---------------------------------------------------------------------------------------
-- 2. Narrow adjust_stock() to product-only.
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjust_stock(p_warehouse_id uuid, p_item_type text, p_item_id uuid, p_new_quantity numeric, p_reason text DEFAULT 'adjustment'::text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_wh public.warehouses;
  v_current numeric(18,4);
  v_delta numeric(18,4);
  v_movement public.stock_movements;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING errcode = 'P0001', detail = json_build_object('code', 'session_expired')::text;
  END IF;

  -- Ingredient tracking is deactivated for MVP (AD-022): only finished-product stock is
  -- adjustable through this RPC. The 'ingredient' branch below is left intact, not
  -- deleted, so v2 can re-enable it by reverting this one check.
  IF p_item_type <> 'product' THEN
    RAISE EXCEPTION 'invalid item_type: % (ingredient tracking is not available in this version)',p_item_type
      USING errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  END IF;

  IF p_reason NOT IN ('adjustment','waste','opening_balance') THEN
    RAISE EXCEPTION 'invalid stock adjustment reason'
      USING errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  END IF;

  IF p_new_quantity < 0 THEN
    RAISE EXCEPTION 'target quantity cannot be negative'
      USING errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  END IF;

  IF p_reason IN ('adjustment','opening_balance')
     AND NOT public.has_role(ARRAY['owner','admin','branch_manager']) THEN
    RAISE EXCEPTION 'insufficient_role: management approval is required for this stock adjustment'
      USING errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  END IF;

  IF p_reason = 'waste'
     AND NOT public.has_role(ARRAY['owner','admin','branch_manager','baker']) THEN
    RAISE EXCEPTION 'insufficient_role: only production staff or management may record waste'
      USING errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  END IF;

  SELECT * INTO v_wh
  FROM public.warehouses
  WHERE id=p_warehouse_id AND tenant_id=v_tenant;

  IF v_wh.id IS NULL OR NOT public.has_branch_access(v_wh.branch_id) THEN
    RAISE EXCEPTION 'warehouse not found or branch access denied'
      USING errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  END IF;

  IF p_item_type='ingredient' THEN
    SELECT quantity_on_hand INTO v_current
    FROM public.ingredient_stock_levels
    WHERE warehouse_id=p_warehouse_id AND ingredient_id=p_item_id
    FOR UPDATE;
  ELSE
    SELECT quantity_on_hand INTO v_current
    FROM public.product_stock_levels
    WHERE warehouse_id=p_warehouse_id AND product_variant_id=p_item_id
    FOR UPDATE;
  END IF;

  v_current := coalesce(v_current,0);
  v_delta := p_new_quantity-v_current;

  IF v_delta=0 THEN
    RETURN jsonb_build_object('movement',NULL,'quantity_on_hand',v_current,'unchanged',true);
  END IF;

  IF p_reason='waste' AND v_delta>0 THEN
    RAISE EXCEPTION 'an increase cannot be recorded as waste'
      USING errcode = 'P0001', detail = json_build_object('code', 'invalid_request')::text;
  END IF;

  INSERT INTO public.stock_movements(
    tenant_id,branch_id,warehouse_id,item_type,ingredient_id,product_variant_id,
    quantity_delta,reason,reference_type,reference_id,note,created_by
  ) VALUES (
    v_tenant,v_wh.branch_id,p_warehouse_id,p_item_type,
    CASE WHEN p_item_type='ingredient' THEN p_item_id END,
    CASE WHEN p_item_type='product' THEN p_item_id END,
    v_delta,p_reason,'manual',p_warehouse_id,p_note,auth.uid()
  ) RETURNING * INTO v_movement;

  PERFORM public.log_audit_event(
    v_tenant,'stock_movement',v_movement.id,'insert',NULL,
    jsonb_build_object('reason',p_reason,'delta',v_delta,'from',v_current,'to',p_new_quantity)
  );

  RETURN jsonb_build_object(
    'movement',to_jsonb(v_movement),
    'quantity_on_hand',p_new_quantity,
    'previous',v_current
  );
END;
$function$;

-- ---------------------------------------------------------------------------------------
-- 3. Narrow the two generic sync handlers the same way.
-- ---------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_inventory_adjust(p_operation sync_operations)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payload        jsonb := p_operation.payload;
  v_warehouse_id   uuid  := nullif(v_payload ->> 'warehouse_id', '')::uuid;
  v_item_type      text  := nullif(v_payload ->> 'item_type', '');
  v_item_id        uuid  := nullif(v_payload ->> 'item_id', '')::uuid;
  v_quantity_delta numeric(18,4);
  v_note           text  := nullif(v_payload ->> 'note', '');
  v_warehouse      public.warehouses;
  v_current        numeric(18,4);
  v_new            numeric(18,4);
  v_movement       public.stock_movements;
BEGIN
  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'inventory.adjust payload requires warehouse_id'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  -- Ingredient tracking is deactivated for MVP (AD-022). Left as a value check, not
  -- removed, so v2 can re-enable ingredient support with a one-line revert.
  IF v_item_type IS NULL OR v_item_type <> 'product' THEN
    RAISE EXCEPTION 'inventory.adjust payload item_type must be product (ingredient tracking is not available in this version)'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'inventory.adjust payload requires item_id'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF NOT (v_payload ? 'quantity_delta') THEN
    RAISE EXCEPTION 'inventory.adjust payload requires quantity_delta'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  BEGIN
    v_quantity_delta := (v_payload ->> 'quantity_delta')::numeric(18,4);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'inventory.adjust payload quantity_delta must be numeric'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END;
  IF v_quantity_delta = 0 THEN
    RAISE EXCEPTION 'inventory.adjust payload quantity_delta must not be zero'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 2000 THEN
    RAISE EXCEPTION 'inventory.adjust payload note must be 2000 characters or fewer'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  -- Role eligibility mirrors the live adjust_stock() RPC's own gate for reason='adjustment'
  -- verbatim (owner/admin/branch_manager) -- the existing, human-approved rule for this exact
  -- class of write, not invented for this handler. See IMPLEMENTATION_LOG.md 2026-08-30.
  IF NOT public.has_role_in(p_operation.actor_id, p_operation.tenant_id,
       ARRAY['owner','admin','branch_manager']) THEN
    RAISE EXCEPTION 'insufficient_role: management approval is required for this stock adjustment'
      USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  SELECT * INTO v_warehouse FROM public.warehouses
   WHERE id = v_warehouse_id AND tenant_id = p_operation.tenant_id;
  IF v_warehouse.id IS NULL THEN
    RAISE EXCEPTION 'warehouse not found in this organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;
  -- The operation's branch was already authorized by the gateway (is_authorized_for_branch,
  -- in process_sync_batch_context_validated); this confirms the payload's own warehouse
  -- actually belongs to that authorized branch, not a different branch the actor also
  -- happens to see -- same consistency-guard shape as apply_customer_update's customer_id
  -- check.
  IF v_warehouse.branch_id IS DISTINCT FROM p_operation.branch_id THEN
    RAISE EXCEPTION 'warehouse does not belong to the operation branch'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = v_item_id AND tenant_id = p_operation.tenant_id) THEN
    RAISE EXCEPTION 'product variant not found in this organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;
  SELECT quantity_on_hand INTO v_current FROM public.product_stock_levels
   WHERE warehouse_id = v_warehouse_id AND product_variant_id = v_item_id;

  v_current := coalesce(v_current, 0);
  v_new := v_current + v_quantity_delta;

  -- AD-021: inventory operations are append-only; concurrent legitimate adjustments both
  -- apply. Only a server-side rule violation -- resulting negative stock -- is rejected.
  IF v_new < 0 THEN
    RAISE EXCEPTION 'adjustment would leave % on hand, which is negative', v_new
      USING errcode = 'P0001', detail = json_build_object('code','negative_stock_rejected')::text;
  END IF;

  INSERT INTO public.stock_movements (
    tenant_id, branch_id, warehouse_id, item_type, ingredient_id, product_variant_id,
    quantity_delta, reason, reference_type, reference_id, note, created_by
  ) VALUES (
    p_operation.tenant_id, v_warehouse.branch_id, v_warehouse_id, v_item_type,
    NULL,
    v_item_id,
    v_quantity_delta, 'adjustment', 'manual', v_warehouse_id, v_note, p_operation.actor_id
  ) RETURNING * INTO v_movement;

  INSERT INTO public.sync_changes (tenant_id, branch_id, entity_type, entity_id,
    operation_type, domain_operation, revision, changed_by, payload)
  VALUES (v_movement.tenant_id, v_movement.branch_id, 'stock_movements', v_movement.id,
    'EVENT', 'inventory.adjust', 1, p_operation.actor_id, to_jsonb(v_movement));

  RETURN jsonb_build_object('movement_id', v_movement.id, 'quantity_on_hand', v_new,
    'previous', v_current, 'revision', 1);
END; $function$;

CREATE OR REPLACE FUNCTION public.apply_inventory_waste(p_operation sync_operations)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payload        jsonb := p_operation.payload;
  v_warehouse_id   uuid  := nullif(v_payload ->> 'warehouse_id', '')::uuid;
  v_item_type      text  := nullif(v_payload ->> 'item_type', '');
  v_item_id        uuid  := nullif(v_payload ->> 'item_id', '')::uuid;
  v_quantity_delta numeric(18,4);
  v_note           text  := nullif(v_payload ->> 'note', '');
  v_warehouse      public.warehouses;
  v_current        numeric(18,4);
  v_new            numeric(18,4);
  v_movement       public.stock_movements;
BEGIN
  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'inventory.waste payload requires warehouse_id'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  -- Ingredient tracking is deactivated for MVP (AD-022). Left as a value check, not
  -- removed, so v2 can re-enable ingredient support with a one-line revert.
  IF v_item_type IS NULL OR v_item_type <> 'product' THEN
    RAISE EXCEPTION 'inventory.waste payload item_type must be product (ingredient tracking is not available in this version)'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_item_id IS NULL THEN
    RAISE EXCEPTION 'inventory.waste payload requires item_id'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF NOT (v_payload ? 'quantity_delta') THEN
    RAISE EXCEPTION 'inventory.waste payload requires quantity_delta'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  BEGIN
    v_quantity_delta := (v_payload ->> 'quantity_delta')::numeric(18,4);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'inventory.waste payload quantity_delta must be numeric'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END;
  IF v_quantity_delta >= 0 THEN
    RAISE EXCEPTION 'inventory.waste payload quantity_delta must be negative'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 2000 THEN
    RAISE EXCEPTION 'inventory.waste payload note must be 2000 characters or fewer'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  -- Role eligibility mirrors the live adjust_stock() RPC's own gate for reason='waste'
  -- verbatim (owner/admin/branch_manager/baker).
  IF NOT public.has_role_in(p_operation.actor_id, p_operation.tenant_id,
       ARRAY['owner','admin','branch_manager','baker']) THEN
    RAISE EXCEPTION 'insufficient_role: only production staff or management may record waste'
      USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  SELECT * INTO v_warehouse FROM public.warehouses
   WHERE id = v_warehouse_id AND tenant_id = p_operation.tenant_id;
  IF v_warehouse.id IS NULL THEN
    RAISE EXCEPTION 'warehouse not found in this organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_warehouse.branch_id IS DISTINCT FROM p_operation.branch_id THEN
    RAISE EXCEPTION 'warehouse does not belong to the operation branch'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.product_variants WHERE id = v_item_id AND tenant_id = p_operation.tenant_id) THEN
    RAISE EXCEPTION 'product variant not found in this organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;
  SELECT quantity_on_hand INTO v_current FROM public.product_stock_levels
   WHERE warehouse_id = v_warehouse_id AND product_variant_id = v_item_id;

  v_current := coalesce(v_current, 0);
  v_new := v_current + v_quantity_delta;

  IF v_new < 0 THEN
    RAISE EXCEPTION 'waste would leave % on hand, which is negative', v_new
      USING errcode = 'P0001', detail = json_build_object('code','negative_stock_rejected')::text;
  END IF;

  INSERT INTO public.stock_movements (
    tenant_id, branch_id, warehouse_id, item_type, ingredient_id, product_variant_id,
    quantity_delta, reason, reference_type, reference_id, note, created_by
  ) VALUES (
    p_operation.tenant_id, v_warehouse.branch_id, v_warehouse_id, v_item_type,
    NULL,
    v_item_id,
    v_quantity_delta, 'waste', 'manual', v_warehouse_id, v_note, p_operation.actor_id
  ) RETURNING * INTO v_movement;

  INSERT INTO public.sync_changes (tenant_id, branch_id, entity_type, entity_id,
    operation_type, domain_operation, revision, changed_by, payload)
  VALUES (v_movement.tenant_id, v_movement.branch_id, 'stock_movements', v_movement.id,
    'EVENT', 'inventory.waste', 1, p_operation.actor_id, to_jsonb(v_movement));

  RETURN jsonb_build_object('movement_id', v_movement.id, 'quantity_on_hand', v_new,
    'previous', v_current, 'revision', 1);
END; $function$;

-- ---------------------------------------------------------------------------------------
-- 4. Remove the four production.* domain operations from the sync allowlist -- same
-- pattern already used for inventory.receive/.consume/.transfer and production.complete
-- (BLOCKER-026/027). Confirmed zero existing rows use these values (see header).
-- ---------------------------------------------------------------------------------------
ALTER TABLE public.sync_operations DROP CONSTRAINT sync_operations_domain_operation_check;
ALTER TABLE public.sync_operations ADD CONSTRAINT sync_operations_domain_operation_check
  CHECK ((domain_operation IS NULL) OR (domain_operation = ANY (ARRAY[
    'ticket.create'::text, 'ticket.transition'::text, 'ticket.item_update'::text,
    'inventory.adjust'::text, 'inventory.waste'::text,
    'payment.create'::text, 'payment.reverse'::text,
    'expense.create'::text, 'expense.reverse'::text,
    'customer.create'::text, 'customer.update'::text
  ])));

ALTER TABLE public.sync_changes DROP CONSTRAINT sync_changes_domain_operation_check;
ALTER TABLE public.sync_changes ADD CONSTRAINT sync_changes_domain_operation_check
  CHECK ((domain_operation IS NULL) OR (domain_operation = ANY (ARRAY[
    'ticket.create'::text, 'ticket.transition'::text, 'ticket.item_update'::text,
    'inventory.adjust'::text, 'inventory.waste'::text,
    'payment.create'::text, 'payment.reverse'::text,
    'expense.create'::text, 'expense.reverse'::text,
    'customer.create'::text, 'customer.update'::text
  ])));

-- ---------------------------------------------------------------------------------------
-- 5. Defense in depth: the direct-RPC production-batch completion path becomes
-- unreachable in practice once production_batches can't be created (step 1), but revoke
-- EXECUTE explicitly too, matching this project's "no function callable without a live
-- call path" convention. The 5-arg internal variant was already REVOKE'd from everyone.
-- ---------------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.complete_production_batch(uuid, numeric, jsonb, uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.fail_production_batch(uuid, text, jsonb, uuid) FROM authenticated;
