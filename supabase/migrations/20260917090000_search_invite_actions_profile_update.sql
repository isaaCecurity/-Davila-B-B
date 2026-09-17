-- BACKEND_ROADMAP P9.9 Q6 + Q7 + Q8.
--
-- Q6 search_workspace(): one search across customers, orders and products for the prototype's
--    `search` screen. SECURITY INVOKER, so every row still passes the caller's own RLS (tenant, and
--    branch for tickets) — the function adds matching and ranking, never visibility. Case-insensitive
--    substring match (ILIKE, wildcards in the query escaped); a query with 5+ digits also matches phone
--    numbers ignoring spaces and a 0 / 234 prefix. Starts-with matches rank first. At least 2
--    characters; at most 20 rows per group. No trigram index or extension: bakery-sized tables, see
--    TECHNICAL_DEBT.md for when to add pg_trgm.
--
-- Q7 revoke_organization_invite() / resend_organization_invite(): the prototype's per-invite actions.
--    Who may act on an invite is who may create it (AD-026): owner — any; admin — roles below admin;
--    branch manager — cashier/baker/driver/supervisor invites for a branch they manage.
--    • Revoke: pending or expired → revoked. Nothing is deleted; the link stops working.
--    • Resend: pending or expired → pending with a NEW token and a fresh expiry; the old link stops
--      working (only a hash is stored, so a lost link cannot be shown again — resend replaces it).
--      Accepted and revoked invites cannot be resent. Counts against the org_invite_create rate limit.
--    Both audited (status_change / update).
--
-- Q8 update_my_profile(): the signed-in person edits their own name and contact phone. Name is
--    trimmed, 1–120 characters; phone is E.164 or empty (the contact number shown to the team, not the
--    sign-in phone, which only SMS verification changes). Audited when an organization is known. The
--    existing profiles_update_self policy is left as is (see TECHNICAL_DEBT.md: its tenant check
--    refuses people whose home organization is not the active one).

-- Q6 ───────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_workspace(
  p_query          text,
  p_limit          integer DEFAULT 6,
  p_only_my_orders boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_q      text := btrim(coalesce(p_query, ''));
  v_esc    text;
  v_like   text;
  v_prefix text;
  v_digits text;
  v_local  text;
  v_limit  integer := least(greatest(coalesce(p_limit, 6), 1), 20);
  v_tenant uuid := current_tenant_id();
  v_customers jsonb;
  v_orders    jsonb;
  v_products  jsonb;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'no active organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;

  IF char_length(v_q) < 2 THEN
    RETURN jsonb_build_object('query', v_q, 'customers', '[]'::jsonb, 'orders', '[]'::jsonb, 'products', '[]'::jsonb);
  END IF;

  v_q      := left(v_q, 80);
  v_esc    := replace(replace(replace(v_q, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_');
  v_like   := '%' || v_esc || '%';
  v_prefix := v_esc || '%';
  v_digits := regexp_replace(v_q, '[^0-9]', '', 'g');
  -- 0803… and 234803… are the same Nigerian number; match on the part after either prefix.
  v_local  := CASE
                WHEN v_digits LIKE '234%' AND char_length(v_digits) > 3 THEN substr(v_digits, 4)
                WHEN v_digits LIKE '0%' THEN substr(v_digits, 2)
                ELSE v_digits
              END;
  IF char_length(v_digits) < 5 THEN
    v_local := NULL;
  END IF;

  SELECT coalesce(jsonb_agg(x.item ORDER BY x.rank, x.sort), '[]'::jsonb) INTO v_customers FROM (
    SELECT jsonb_build_object('id', c.id, 'full_name', c.full_name, 'phone', c.phone) AS item,
           CASE WHEN c.full_name ILIKE v_prefix THEN 0 ELSE 1 END AS rank,
           lower(c.full_name) AS sort
      FROM customers c
     WHERE c.tenant_id = v_tenant AND c.deleted_at IS NULL AND NOT c.is_walk_in
       AND (c.full_name ILIKE v_like
            OR (v_local IS NOT NULL AND regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') LIKE '%' || v_local || '%'))
     ORDER BY 2, 3
     LIMIT v_limit
  ) x;

  SELECT coalesce(jsonb_agg(x.item ORDER BY x.rank, x.created_at DESC), '[]'::jsonb) INTO v_orders FROM (
    SELECT jsonb_build_object(
             'id', t.id,
             'ticket_number', t.ticket_number,
             'status', t.status,
             'total_amount', t.total_amount::numeric(19,4)::text,
             'created_at', t.created_at,
             'customer_name', c.full_name) AS item,
           CASE WHEN t.ticket_number ILIKE v_prefix THEN 0 ELSE 1 END AS rank,
           t.created_at
      FROM tickets t
      LEFT JOIN customers c ON c.id = t.customer_id AND c.tenant_id = t.tenant_id
     WHERE t.tenant_id = v_tenant AND t.deleted_at IS NULL
       AND (NOT coalesce(p_only_my_orders, false) OR t.created_by = auth.uid())
       AND (t.ticket_number ILIKE v_like OR c.full_name ILIKE v_like)
     ORDER BY 2, 3 DESC
     LIMIT v_limit
  ) x;

  SELECT coalesce(jsonb_agg(x.item ORDER BY x.rank, x.sort), '[]'::jsonb) INTO v_products FROM (
    SELECT jsonb_build_object(
             'id', p.id,
             'name', p.name,
             'variant_count', count(v.id),
             'price_from', min(v.unit_price)::numeric(19,4)::text) AS item,
           CASE WHEN p.name ILIKE v_prefix THEN 0 ELSE 1 END AS rank,
           lower(p.name) AS sort
      FROM products p
      LEFT JOIN product_variants v
        ON v.product_id = p.id AND v.tenant_id = p.tenant_id AND v.deleted_at IS NULL AND v.is_active
     WHERE p.tenant_id = v_tenant AND p.deleted_at IS NULL
       AND (p.name ILIKE v_like
            OR EXISTS (SELECT 1 FROM product_variants sv
                        WHERE sv.product_id = p.id AND sv.tenant_id = p.tenant_id AND sv.deleted_at IS NULL
                          AND (sv.name ILIKE v_like OR coalesce(sv.sku, '') ILIKE v_like)))
     GROUP BY p.id, p.name
     ORDER BY 2, 3
     LIMIT v_limit
  ) x;

  RETURN jsonb_build_object('query', v_q, 'customers', v_customers, 'orders', v_orders, 'products', v_products);
END;
$function$;

REVOKE ALL ON FUNCTION public.search_workspace(text, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.search_workspace(text, integer, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_workspace(text, integer, boolean) TO authenticated, service_role;

-- Q7 ───────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.can_manage_invite(p_invite public.organization_invites)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p_invite.tenant_id = public.current_tenant_id()
     AND CASE
           WHEN public.has_role(ARRAY['owner','admin']) THEN private.can_manage_target_role(p_invite.role_id)
           WHEN public.has_role(ARRAY['branch_manager']) THEN
             EXISTS (SELECT 1 FROM public.roles r
                      WHERE r.id = p_invite.role_id AND r.key IN ('cashier','baker','driver','supervisor'))
             AND private.manages_branch(p_invite.branch_id)
           ELSE false
         END;
$function$;

REVOKE ALL ON FUNCTION private.can_manage_invite(public.organization_invites) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.can_manage_invite(public.organization_invites) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.revoke_organization_invite(p_invite_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_invite public.organization_invites;
BEGIN
  SELECT * INTO v_invite FROM public.organization_invites
   WHERE id = p_invite_id AND deleted_at IS NULL
   FOR UPDATE;

  IF v_invite.id IS NULL OR NOT private.can_manage_invite(v_invite) THEN
    -- One answer for "no such invite" and "not yours", so ids cannot be probed.
    RAISE EXCEPTION 'you cannot revoke this invite'
      USING errcode = 'P0001', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  IF v_invite.status NOT IN ('pending','expired') THEN
    RAISE EXCEPTION 'invite is already %', v_invite.status
      USING errcode = 'P0001', detail = json_build_object('code','invalid_transition','status',v_invite.status)::text;
  END IF;

  UPDATE public.organization_invites SET status = 'revoked' WHERE id = v_invite.id;

  PERFORM public.log_audit_event(
    v_invite.tenant_id, 'organization_invite', v_invite.id, 'status_change',
    jsonb_build_object('status', v_invite.status),
    jsonb_build_object('status', 'revoked'));

  SELECT * INTO v_invite FROM public.organization_invites WHERE id = p_invite_id;
  RETURN jsonb_build_object('invite', to_jsonb(v_invite) - 'token_hash');
END;
$function$;

REVOKE ALL ON FUNCTION public.revoke_organization_invite(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_organization_invite(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_organization_invite(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resend_organization_invite(p_invite_id uuid, p_valid_days integer DEFAULT 7)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_invite public.organization_invites;
  v_before text;
  v_raw    text;
BEGIN
  SELECT * INTO v_invite FROM public.organization_invites
   WHERE id = p_invite_id AND deleted_at IS NULL
   FOR UPDATE;

  IF v_invite.id IS NULL OR NOT private.can_manage_invite(v_invite) THEN
    RAISE EXCEPTION 'you cannot resend this invite'
      USING errcode = 'P0001', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  IF v_invite.status NOT IN ('pending','expired') THEN
    RAISE EXCEPTION 'invite is already %', v_invite.status
      USING errcode = 'P0001', detail = json_build_object('code','invalid_transition','status',v_invite.status)::text;
  END IF;

  PERFORM public.enforce_rate_limit(v_invite.tenant_id, auth.uid(), 'org_invite_create', 20, 60);

  v_before := v_invite.status;
  v_raw := encode(extensions.gen_random_bytes(32), 'hex');

  UPDATE public.organization_invites
     SET status     = 'pending',
         token_hash = encode(extensions.digest(v_raw, 'sha256'), 'hex'),
         expires_at = now() + make_interval(days => greatest(coalesce(p_valid_days, 7), 1))
   WHERE id = v_invite.id
  RETURNING * INTO v_invite;

  PERFORM public.log_audit_event(
    v_invite.tenant_id, 'organization_invite', v_invite.id, 'update',
    jsonb_build_object('status', v_before),
    jsonb_build_object('status', 'pending', 'resent', true, 'expires_at', v_invite.expires_at));

  RETURN jsonb_build_object('invite', to_jsonb(v_invite) - 'token_hash', 'raw_token', v_raw);
END;
$function$;

REVOKE ALL ON FUNCTION public.resend_organization_invite(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resend_organization_invite(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.resend_organization_invite(uuid, integer) TO authenticated, service_role;

-- Q8 ───────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_my_profile(p_full_name text, p_phone text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user   uuid := auth.uid();
  v_name   text := btrim(coalesce(p_full_name, ''));
  v_phone  text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_before public.profiles;
  v_after  public.profiles;
  v_tenant uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING errcode = 'P0001', detail = json_build_object('code','insufficient_role')::text;
  END IF;
  IF char_length(v_name) < 1 OR char_length(v_name) > 120 THEN
    RAISE EXCEPTION 'name must be 1 to 120 characters'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request','reason','invalid_name')::text;
  END IF;
  IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'phone must be in international format, e.g. +2348031234567'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request','reason','invalid_phone')::text;
  END IF;

  SELECT * INTO v_before FROM public.profiles WHERE id = v_user AND deleted_at IS NULL FOR UPDATE;
  IF v_before.id IS NULL THEN
    RAISE EXCEPTION 'profile not found'
      USING errcode = 'P0001', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  UPDATE public.profiles SET full_name = v_name, phone = v_phone WHERE id = v_user
  RETURNING * INTO v_after;

  v_tenant := coalesce(public.current_tenant_id(), v_after.tenant_id);
  IF v_tenant IS NOT NULL
     AND (v_before.full_name IS DISTINCT FROM v_after.full_name OR v_before.phone IS DISTINCT FROM v_after.phone) THEN
    PERFORM public.log_audit_event(
      v_tenant, 'profile', v_user, 'update',
      jsonb_build_object('full_name', v_before.full_name, 'phone', v_before.phone),
      jsonb_build_object('full_name', v_after.full_name, 'phone', v_after.phone));
  END IF;

  RETURN jsonb_build_object('id', v_after.id, 'full_name', v_after.full_name, 'phone', v_after.phone,
                            'avatar_url', v_after.avatar_url);
END;
$function$;

REVOKE ALL ON FUNCTION public.update_my_profile(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_my_profile(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_my_profile(text, text) TO authenticated, service_role;
