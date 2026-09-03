-- audit-findings/SECURITY-AUDIT-2026-09-02.md, "Low: live database lint warnings".
-- All three are behavior-preserving hardening, not defects -- verified live before fixing:
-- (1)/(2) an untyped '{}' string literal assigned to a typed array variable already works
-- correctly today (Postgres infers the array type from the variable/coalesce context at
-- runtime), but `supabase db lint`'s static analysis can't fully verify that, so it warns.
-- Made unambiguous with ARRAY[]::type[] instead. (3) v_actor in sync_pull is genuinely dead
-- -- sync_validate_device() is called for its validation side effect (raises on an
-- invalid/revoked device); the returned user_id was never used, since sync_pull is
-- SECURITY INVOKER and RLS does the row-filtering. Removed the variable entirely rather
-- than just renaming it, since it truly serves no purpose.
--
-- Re-ran `supabase db lint --linked --schema public --fail-on none` live after applying:
-- "No schema errors found".

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  claims    jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  v_user    uuid  := (event ->> 'user_id')::uuid;
  v_active  uuid;
  v_status  text;
  v_deleted timestamptz;
  v_roles   text[] := ARRAY[]::text[];
BEGIN
  SELECT p.active_tenant_id, p.status, p.deleted_at
    INTO v_active, v_status, v_deleted
    FROM public.profiles p
   WHERE p.id = v_user;

  IF v_status IS DISTINCT FROM 'active' OR v_deleted IS NOT NULL THEN
    v_active := NULL;
  ELSIF v_active IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.user_roles ur
     WHERE ur.profile_id = v_user
       AND ur.tenant_id  = v_active
       AND ur.deleted_at IS NULL
  ) THEN
    v_active := NULL;
  END IF;

  IF v_active IS NOT NULL THEN
    SELECT coalesce(array_agg(DISTINCT r.key), ARRAY[]::text[])
      INTO v_roles
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
     WHERE ur.profile_id = v_user
       AND ur.tenant_id  = v_active
       AND ur.deleted_at IS NULL
       AND r.deleted_at  IS NULL;
  END IF;

  claims := jsonb_set(claims, '{tenant_id}',
                      coalesce(to_jsonb(v_active), 'null'::jsonb), true);
  claims := jsonb_set(claims, '{roles}',
                      coalesce(to_jsonb(v_roles), '[]'::jsonb), true);

  RETURN jsonb_set(event, '{claims}', claims, true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_ticket_item_update(p_operation sync_operations)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_payload   jsonb := p_operation.payload;
  v_ticket_id uuid  := nullif(v_payload ->> 'ticket_id','')::uuid;
  v_ticket    public.tickets;
  v_item      jsonb;
  v_variant   uuid;
  v_qty       numeric;
  v_price     numeric;
  v_item_ids  uuid[] := ARRAY[]::uuid[];
  v_new_item  public.ticket_items;
BEGIN
  IF v_ticket_id IS NULL OR jsonb_typeof(v_payload -> 'items') <> 'array'
     OR jsonb_array_length(v_payload -> 'items') = 0 THEN
    RAISE EXCEPTION 'ticket.item_update payload requires ticket_id and a non-empty items array'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  SELECT * INTO v_ticket FROM public.tickets
   WHERE id = v_ticket_id AND tenant_id = p_operation.tenant_id AND deleted_at IS NULL;
  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'ticket not found in this organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF NOT (
    public.has_role_in(p_operation.actor_id, p_operation.tenant_id, ARRAY['owner','admin','branch_manager','cashier'])
    OR (public.has_role_in(p_operation.actor_id, p_operation.tenant_id, ARRAY['driver'])
        AND (v_ticket.created_by = p_operation.actor_id OR v_ticket.assigned_to = p_operation.actor_id))
  ) THEN
    RAISE EXCEPTION 'insufficient_role: actor may not add items to this ticket'
      USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_payload -> 'items') LOOP
    v_variant := nullif(v_item ->> 'product_variant_id','')::uuid;
    v_qty     := nullif(v_item ->> 'quantity','')::numeric;
    IF v_variant IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'each item requires product_variant_id and a positive quantity'
        USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
    END IF;
    SELECT pv.unit_price INTO v_price FROM public.product_variants pv
     WHERE pv.id = v_variant AND pv.tenant_id = p_operation.tenant_id;
    IF v_price IS NULL THEN
      RAISE EXCEPTION 'product variant not found in this organization'
        USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
    END IF;
    INSERT INTO public.ticket_items (tenant_id, ticket_id, product_variant_id, quantity, unit_price, created_by)
    VALUES (p_operation.tenant_id, v_ticket_id, v_variant, v_qty, v_price, p_operation.actor_id)
    RETURNING * INTO v_new_item;
    v_item_ids := v_item_ids || v_new_item.id;
  END LOOP;
  SELECT * INTO v_ticket FROM public.tickets WHERE id = v_ticket_id;
  INSERT INTO public.sync_changes (tenant_id, branch_id, entity_type, entity_id,
    operation_type, domain_operation, revision, changed_by, payload)
  VALUES (v_ticket.tenant_id, v_ticket.branch_id, 'tickets', v_ticket.id,
    'UPDATE', 'ticket.item_update', v_ticket.revision, p_operation.actor_id,
    jsonb_build_object('item_ids', to_jsonb(v_item_ids), 'subtotal_amount', v_ticket.subtotal_amount));
  RETURN jsonb_build_object('ticket_id', v_ticket.id, 'item_ids', to_jsonb(v_item_ids),
    'subtotal_amount', v_ticket.subtotal_amount, 'revision', v_ticket.revision);
END; $function$;

CREATE OR REPLACE FUNCTION public.sync_pull(p_device_id uuid, p_cursor bigint DEFAULT 0, p_page_size integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_page_size   int := LEAST(GREATEST(coalesce(p_page_size, 200), 1), 500);
  v_changes     jsonb;
  v_next_cursor bigint;
  v_has_more    boolean;
  v_max_visible bigint;
BEGIN
  PERFORM public.sync_validate_device(p_device_id);

  IF p_cursor IS NOT NULL AND p_cursor < 0 THEN
    RAISE EXCEPTION 'cursor must not be negative'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  -- RLS on sync_changes (tenant-scoped, forced) determines what is "visible"
  -- here; this function is SECURITY INVOKER so the caller's own row
  -- visibility applies to both this max() and the page query below.
  SELECT max(sequence_id) INTO v_max_visible FROM public.sync_changes;

  IF coalesce(p_cursor, 0) > coalesce(v_max_visible, 0) THEN
    RETURN jsonb_build_object(
      'changes', '[]'::jsonb,
      'next_cursor', coalesce(v_max_visible, 0),
      'has_more', false,
      'full_resync_required', true
    );
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.sequence_id), '[]'::jsonb),
         max(page.sequence_id)
    INTO v_changes, v_next_cursor
  FROM (
    SELECT * FROM public.sync_changes
     WHERE sequence_id > coalesce(p_cursor, 0)
     ORDER BY sequence_id ASC
     LIMIT v_page_size
  ) page;

  SELECT EXISTS (
    SELECT 1 FROM public.sync_changes WHERE sequence_id > coalesce(v_next_cursor, p_cursor, 0)
  ) INTO v_has_more;

  RETURN jsonb_build_object(
    'changes', v_changes,
    'next_cursor', coalesce(v_next_cursor, p_cursor, 0),
    'has_more', coalesce(v_has_more, false),
    'full_resync_required', false
  );
END;
$function$;
