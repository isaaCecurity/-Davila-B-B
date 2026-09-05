-- Root-cause fix for the cross-tenant stock-level corruption gap found in the 2026-09-05
-- SECURITY DEFINER body-review follow-up (Item H, scoped 2026-09-04).
--
-- ingredient_stock_levels/product_stock_levels are uniquely keyed by (warehouse_id, item_id)
-- only -- NOT tenant_id -- and apply_stock_movement() maintains them via
-- `INSERT ... ON CONFLICT (warehouse_id, item_id) DO UPDATE`. So any function that inserts
-- into stock_movements with an unvalidated warehouse_id can silently mutate ANOTHER tenant's
-- actual stock levels: the stock_movements row itself still carries the correct (calling)
-- tenant_id, but the live quantity_on_hand it updates does not care whose warehouse that is.
--
-- This BEFORE INSERT trigger closes that gap at the actual choke point -- the append-only
-- ledger itself -- covering every current and future caller in one place, matching how
-- apply_stock_movement()'s own negative-stock check already works as a backstop for this
-- table.

CREATE OR REPLACE FUNCTION public.guard_stock_movement_warehouse_tenant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.warehouses w
    WHERE w.id = NEW.warehouse_id AND w.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'stock movement warehouse_id % does not belong to tenant %', NEW.warehouse_id, NEW.tenant_id
      USING ERRCODE = 'P0001',
            DETAIL = json_build_object('code', 'invalid_request', 'reason', 'warehouse_tenant_mismatch')::text;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_stock_movement_warehouse_tenant() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_stock_movement_warehouse_tenant() TO service_role;

CREATE TRIGGER stock_movements_guard_warehouse_tenant
  BEFORE INSERT ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.guard_stock_movement_warehouse_tenant();
