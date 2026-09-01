-- BLOCKER-010(c): the catalog write-path test suite (tests/sql/catalog_write_rls.sql)
-- proved, live, that a direct PostgREST UPDATE can never set/clear `deleted_at` on
-- products/product_categories/product_variants for ANY role (Postgres requires the
-- post-UPDATE row to still satisfy the table's own SELECT policy, deleted_at IS NULL),
-- and that `authenticated` was never actually GRANTed DELETE on these tables either.
-- docs/SOFT-DELETE-AND-RETENTION.md §38 already specified restore_catalog_entity's
-- exact contract ("does not exist yet — must be built as part of P4.1b") but had not
-- identified the same problem on the archive/delete side. This migration builds both,
-- mirroring archive_ticket()'s established conventions (has_permission(), the
-- errcode/detail RAISE shape, log_audit_event()) rather than inventing new ones.
--
-- Scope: 'product' | 'product_category' | 'product_variant' only — NOT 'ingredient' or
-- 'recipe', deliberately. AD-022 (2026-09-01) fully revoked `authenticated`'s grants on
-- ingredients/recipes/recipe_ingredients; because these RPCs are SECURITY DEFINER they
-- would otherwise bypass that revocation and silently reopen archive/restore for a
-- deactivated MVP feature. §38's original 4-entity-type list included 'ingredient';
-- this migration narrows it to match AD-022, which postdates that doc.
--
-- Role gate: has_permission('products.manage', NULL) — the DB-backed permission
-- catalog (docs/ROLES-AND-PERMISSIONS.md), not the JWT-claim-based has_role() the
-- table RLS policies use. products.manage is held by owner/admin/branch_manager
-- (identical to the INSERT/UPDATE RLS role set), confirmed live before writing this.
--
-- Live-verified in a rolled-back transaction before this migration was applied:
-- archive then restore round-trips correctly (deleted_at/deleted_by set then cleared),
-- 'ingredient' is rejected (22023), and restoring an already-live row is rejected
-- (P0001, matching archive_ticket's "not found or already archived" pattern).

CREATE OR REPLACE FUNCTION public.archive_catalog_entity(p_entity_type text, p_entity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING errcode='28000', detail = json_build_object('code','session_expired')::text;
  END IF;
  IF NOT public.has_permission('products.manage', NULL) THEN
    RAISE EXCEPTION 'only Owner, Admin, or Branch Manager may archive catalog entities'
      USING errcode='42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;
  IF p_entity_type NOT IN ('product','product_category','product_variant') THEN
    RAISE EXCEPTION 'unsupported entity_type: % (ingredient/recipe entities are not archivable through this RPC)', p_entity_type
      USING errcode='22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  IF p_entity_type = 'product' THEN
    UPDATE public.products
       SET deleted_at = now(), deleted_by = auth.uid()
     WHERE id = p_entity_id AND tenant_id = public.current_tenant_id() AND deleted_at IS NULL
     RETURNING tenant_id, to_jsonb(products.*) INTO v_tenant_id, v_result;
  ELSIF p_entity_type = 'product_category' THEN
    UPDATE public.product_categories
       SET deleted_at = now(), deleted_by = auth.uid()
     WHERE id = p_entity_id AND tenant_id = public.current_tenant_id() AND deleted_at IS NULL
     RETURNING tenant_id, to_jsonb(product_categories.*) INTO v_tenant_id, v_result;
  ELSIF p_entity_type = 'product_variant' THEN
    UPDATE public.product_variants
       SET deleted_at = now(), deleted_by = auth.uid()
     WHERE id = p_entity_id AND tenant_id = public.current_tenant_id() AND deleted_at IS NULL
     RETURNING tenant_id, (to_jsonb(product_variants.*) || jsonb_build_object('unit_price', unit_price::text))
       INTO v_tenant_id, v_result;
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION '% not found or already archived', p_entity_type
      USING errcode='P0001', detail = json_build_object('code','invalid_transition')::text;
  END IF;

  PERFORM public.log_audit_event(
    v_tenant_id, p_entity_type, p_entity_id, 'update',
    jsonb_build_object('deleted_at', null),
    jsonb_build_object('deleted_at', v_result->>'deleted_at', 'deleted_by', v_result->>'deleted_by'));

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_catalog_entity(p_entity_type text, p_entity_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING errcode='28000', detail = json_build_object('code','session_expired')::text;
  END IF;
  IF NOT public.has_permission('products.manage', NULL) THEN
    RAISE EXCEPTION 'only Owner, Admin, or Branch Manager may restore catalog entities'
      USING errcode='42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;
  IF p_entity_type NOT IN ('product','product_category','product_variant') THEN
    RAISE EXCEPTION 'unsupported entity_type: % (ingredient/recipe entities are not restorable through this RPC)', p_entity_type
      USING errcode='22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  IF p_entity_type = 'product' THEN
    UPDATE public.products
       SET deleted_at = NULL, deleted_by = NULL
     WHERE id = p_entity_id AND tenant_id = public.current_tenant_id() AND deleted_at IS NOT NULL
     RETURNING tenant_id, to_jsonb(products.*) INTO v_tenant_id, v_result;
  ELSIF p_entity_type = 'product_category' THEN
    UPDATE public.product_categories
       SET deleted_at = NULL, deleted_by = NULL
     WHERE id = p_entity_id AND tenant_id = public.current_tenant_id() AND deleted_at IS NOT NULL
     RETURNING tenant_id, to_jsonb(product_categories.*) INTO v_tenant_id, v_result;
  ELSIF p_entity_type = 'product_variant' THEN
    UPDATE public.product_variants
       SET deleted_at = NULL, deleted_by = NULL
     WHERE id = p_entity_id AND tenant_id = public.current_tenant_id() AND deleted_at IS NOT NULL
     RETURNING tenant_id, (to_jsonb(product_variants.*) || jsonb_build_object('unit_price', unit_price::text))
       INTO v_tenant_id, v_result;
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION '% not found or not archived', p_entity_type
      USING errcode='P0001', detail = json_build_object('code','invalid_transition')::text;
  END IF;

  PERFORM public.log_audit_event(
    v_tenant_id, p_entity_type, p_entity_id, 'update',
    jsonb_build_object('deleted_at', 'was_deleted'),
    jsonb_build_object('deleted_at', null));

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.archive_catalog_entity(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.archive_catalog_entity(text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.restore_catalog_entity(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_catalog_entity(text, uuid) TO authenticated;
