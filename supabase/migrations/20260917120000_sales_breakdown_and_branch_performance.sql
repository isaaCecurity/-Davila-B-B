-- BACKEND_ROADMAP P9.9 Q3 + Q4. Owner decisions 2026-09-17:
--   Q3 branch performance — owner/admin compare every branch; a branch manager sees only the branches
--      they manage; nobody else.
--   Q4 sales by staff and payment method — owner, admin and a branch manager (for a branch they manage)
--      see every staff member's sales and the method split; supervisors (and accountants) see the method
--      split and totals but not per-person figures; cashiers and drivers see only their own.
--
-- Figures follow get_revenue_report() (REPORTING-MODEL.md): sales = tickets.total_amount by completed_at;
-- collections = payments.amount by received_at; refunds by refunded_at, attributed to the refunded
-- payment's method; organization-local days, half-open ranges; money as numeric(19,4)::text; every sum
-- and share computed here.
--
-- 1. private.report_period(period, start, end): the period → dates → UTC bounds logic of
--    private.resolve_report_window(), without its role check, so each report applies its own rules.
-- 2. get_sales_breakdown(branch, period): scope 'full' | 'branch' | 'own' decided from the caller's roles;
--    totals, by_method (all five methods), by_staff (null unless full; only the caller's row when own),
--    recent (≤ 30 completed sales with methods). Default period: today.
-- 3. get_branch_performance(period): per visible branch — revenue, refunds, collections, orders, staff,
--    share of net revenue, and a 7-day net-revenue trend ending at the period end. Default period: today.

-- 1 ───────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.report_period(
  p_tenant_id uuid,
  p_period    text,
  p_start     date,
  p_end       date,
  OUT timezone   text,
  OUT start_date date,
  OUT end_date   date,
  OUT from_ts    timestamptz,
  OUT to_ts      timestamptz
)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_today date;
BEGIN
  SELECT o.timezone INTO timezone FROM public.organizations o WHERE o.id = p_tenant_id;
  IF timezone IS NULL THEN
    RAISE EXCEPTION 'no active organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;
  v_today := (now() AT TIME ZONE timezone)::date;

  IF p_period IS NOT NULL THEN
    IF p_start IS NOT NULL OR p_end IS NOT NULL THEN
      RAISE EXCEPTION 'give a period or explicit dates, not both'
        USING errcode = 'P0001', detail = json_build_object('code','invalid_request','reason','invalid_range')::text;
    END IF;
    CASE p_period
      WHEN 'today'      THEN start_date := v_today;                            end_date := v_today;
      WHEN '7d'         THEN start_date := v_today - 6;                        end_date := v_today;
      WHEN '30d'        THEN start_date := v_today - 29;                       end_date := v_today;
      WHEN '90d'        THEN start_date := v_today - 89;                       end_date := v_today;
      WHEN 'month'      THEN start_date := date_trunc('month', v_today)::date; end_date := v_today;
      WHEN 'last_month' THEN start_date := (date_trunc('month', v_today) - interval '1 month')::date;
                             end_date   := (date_trunc('month', v_today) - interval '1 day')::date;
      ELSE
        RAISE EXCEPTION 'unknown period %', p_period
          USING errcode = 'P0001', detail = json_build_object('code','invalid_request','reason','invalid_period')::text;
    END CASE;
  ELSE
    end_date   := coalesce(p_end, v_today);
    start_date := coalesce(p_start, end_date);
  END IF;

  IF start_date > end_date THEN
    RAISE EXCEPTION 'the start date is after the end date'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request','reason','invalid_range')::text;
  END IF;
  IF end_date - start_date + 1 > 366 THEN
    RAISE EXCEPTION 'reports cover at most 366 days'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request','reason','range_too_long')::text;
  END IF;

  from_ts := (start_date::timestamp) AT TIME ZONE timezone;
  to_ts   := ((end_date + 1)::timestamp) AT TIME ZONE timezone;
END;
$function$;

REVOKE ALL ON FUNCTION private.report_period(uuid, text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.report_period(uuid, text, date, date) FROM anon, authenticated;

-- 2 ───────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_sales_breakdown(
  p_branch_id uuid,
  p_period    text DEFAULT 'today',
  p_start     date DEFAULT NULL,
  p_end       date DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := current_tenant_id();
  v_user   uuid := auth.uid();
  v_scope  text;
  v_period text := CASE WHEN p_start IS NULL AND p_end IS NULL THEN coalesce(p_period, 'today') ELSE NULL END;
  w record;
  v_totals jsonb;
  v_methods jsonb;
  v_staff jsonb;
  v_recent jsonb;
BEGIN
  IF v_tenant IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'no active organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF p_branch_id IS NULL OR NOT has_branch_access(p_branch_id)
     OR NOT EXISTS (SELECT 1 FROM branches b WHERE b.id = p_branch_id AND b.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'insufficient_role: no access to this branch'
      USING errcode = 'P0001', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  -- Q4 decision: the widest scope the caller's roles allow at this branch.
  v_scope := CASE
    WHEN has_role(ARRAY['owner','admin']) THEN 'full'
    WHEN has_role(ARRAY['branch_manager']) AND private.manages_branch(p_branch_id) THEN 'full'
    WHEN has_role(ARRAY['supervisor','accountant']) THEN 'branch'
    WHEN has_role(ARRAY['cashier','driver','branch_manager']) THEN 'own'
    ELSE NULL
  END;
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'insufficient_role: sales figures are not available to this role'
      USING errcode = 'P0001', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  SELECT * INTO w FROM private.report_period(v_tenant, v_period, p_start, p_end);

  -- totals
  SELECT jsonb_build_object(
           'gross_sales',       coalesce(sum(t.total_amount), 0)::numeric(19,4)::text,
           'completed_tickets', count(*))
    INTO v_totals
    FROM tickets t
   WHERE t.tenant_id = v_tenant AND t.branch_id = p_branch_id AND t.deleted_at IS NULL
     AND t.completed_at >= w.from_ts AND t.completed_at < w.to_ts
     AND (v_scope <> 'own' OR t.created_by = v_user);

  -- by method: collections and refunds in the period, by the payment's method
  WITH m(method, ord) AS (VALUES ('cash',1),('transfer',2),('pos',3),('card',4),('credit',5)),
  col AS (
    SELECT py.method, sum(py.amount) AS amount, count(*) AS n
      FROM payments py
     WHERE py.tenant_id = v_tenant AND py.branch_id = p_branch_id AND py.deleted_at IS NULL
       AND py.received_at >= w.from_ts AND py.received_at < w.to_ts
       AND (v_scope <> 'own' OR py.created_by = v_user)
     GROUP BY py.method
  ),
  ref AS (
    SELECT py.method, sum(rf.amount) AS amount
      FROM refunds rf
      JOIN payments py ON py.id = rf.payment_id AND py.tenant_id = rf.tenant_id
     WHERE rf.tenant_id = v_tenant AND rf.branch_id = p_branch_id AND rf.deleted_at IS NULL
       AND rf.refunded_at >= w.from_ts AND rf.refunded_at < w.to_ts
       AND (v_scope <> 'own' OR py.created_by = v_user)
     GROUP BY py.method
  )
  SELECT jsonb_agg(jsonb_build_object(
           'method',          m.method,
           'payments',        coalesce(col.n, 0),
           'gross_collected', coalesce(col.amount, 0)::numeric(19,4)::text,
           'refunds',         coalesce(ref.amount, 0)::numeric(19,4)::text,
           'net_collected',   (coalesce(col.amount, 0) - coalesce(ref.amount, 0))::numeric(19,4)::text
         ) ORDER BY m.ord)
    INTO v_methods
    FROM m LEFT JOIN col ON col.method = m.method LEFT JOIN ref ON ref.method = m.method;

  SELECT v_totals || jsonb_build_object(
           'gross_collected', coalesce(sum((x->>'gross_collected')::numeric), 0)::numeric(19,4)::text,
           'refunds',         coalesce(sum((x->>'refunds')::numeric), 0)::numeric(19,4)::text,
           'net_collected',   coalesce(sum((x->>'net_collected')::numeric), 0)::numeric(19,4)::text)
    INTO v_totals
    FROM jsonb_array_elements(v_methods) x;

  -- by staff: completed sales per seller (tickets.created_by)
  IF v_scope IN ('full', 'own') THEN
    WITH s AS (
      SELECT t.created_by, sum(t.total_amount) AS amount, count(*) AS n
        FROM tickets t
       WHERE t.tenant_id = v_tenant AND t.branch_id = p_branch_id AND t.deleted_at IS NULL
         AND t.completed_at >= w.from_ts AND t.completed_at < w.to_ts
         AND (v_scope <> 'own' OR t.created_by = v_user)
       GROUP BY t.created_by
    ),
    tot AS (SELECT coalesce(sum(amount), 0) AS amount FROM s)
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'profile_id',        s.created_by,
             'full_name',         coalesce(nullif(p.full_name, ''), NULL),
             'completed_tickets', s.n,
             'gross_sales',       s.amount::numeric(19,4)::text,
             'share_pct',         CASE WHEN tot.amount = 0 THEN '0.00'
                                       ELSE round(s.amount * 100 / tot.amount, 2)::numeric(5,2)::text END
           ) ORDER BY s.amount DESC, p.full_name), '[]'::jsonb)
      INTO v_staff
      FROM s CROSS JOIN tot
      LEFT JOIN profiles p ON p.id = s.created_by;
  ELSE
    v_staff := NULL;
  END IF;

  -- recent completed sales
  SELECT coalesce(jsonb_agg(r.item ORDER BY r.completed_at DESC), '[]'::jsonb) INTO v_recent FROM (
    SELECT jsonb_build_object(
             'ticket_id',     t.id,
             'ticket_number', t.ticket_number,
             'completed_at',  t.completed_at,
             'total_amount',  t.total_amount::numeric(19,4)::text,
             'customer_name', c.full_name,
             'seller_name',   CASE WHEN v_scope = 'branch' THEN NULL ELSE nullif(sp.full_name, '') END,
             'methods',       coalesce((SELECT jsonb_agg(DISTINCT py.method) FROM payments py
                                         WHERE py.ticket_id = t.id AND py.tenant_id = t.tenant_id AND py.deleted_at IS NULL), '[]'::jsonb)
           ) AS item,
           t.completed_at
      FROM tickets t
      LEFT JOIN customers c ON c.id = t.customer_id AND c.tenant_id = t.tenant_id
      LEFT JOIN profiles sp ON sp.id = t.created_by
     WHERE t.tenant_id = v_tenant AND t.branch_id = p_branch_id AND t.deleted_at IS NULL
       AND t.completed_at >= w.from_ts AND t.completed_at < w.to_ts
       AND (v_scope <> 'own' OR t.created_by = v_user)
     ORDER BY t.completed_at DESC
     LIMIT 30
  ) r;

  RETURN jsonb_build_object(
    'branch_id',  p_branch_id,
    'period',     v_period,
    'start_date', w.start_date,
    'end_date',   w.end_date,
    'timezone',   w.timezone,
    'scope',      v_scope,
    'totals',     v_totals,
    'by_method',  v_methods,
    'by_staff',   v_staff,
    'recent',     v_recent
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_sales_breakdown(uuid, text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_sales_breakdown(uuid, text, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_sales_breakdown(uuid, text, date, date) TO authenticated, service_role;

-- 3 ───────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_branch_performance(
  p_period text DEFAULT 'today',
  p_start  date DEFAULT NULL,
  p_end    date DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := current_tenant_id();
  v_all    boolean;
  v_period text := CASE WHEN p_start IS NULL AND p_end IS NULL THEN coalesce(p_period, 'today') ELSE NULL END;
  w record;
  v_rows jsonb;
  v_totals jsonb;
BEGIN
  IF v_tenant IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'no active organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;

  -- Q3 decision
  v_all := has_role(ARRAY['owner','admin']);
  IF NOT v_all AND NOT has_role(ARRAY['branch_manager']) THEN
    RAISE EXCEPTION 'insufficient_role: branch performance is for owners, admins and branch managers'
      USING errcode = 'P0001', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  SELECT * INTO w FROM private.report_period(v_tenant, v_period, p_start, p_end);

  WITH b AS (
    SELECT br.id, br.name, br.code, br.is_primary
      FROM branches br
     WHERE br.tenant_id = v_tenant AND br.deleted_at IS NULL
       AND (v_all OR private.manages_branch(br.id))
  ),
  sales AS (
    SELECT t.branch_id, sum(t.total_amount) AS amount, count(*) AS n
      FROM tickets t
     WHERE t.tenant_id = v_tenant AND t.deleted_at IS NULL
       AND t.completed_at >= w.from_ts AND t.completed_at < w.to_ts
     GROUP BY t.branch_id
  ),
  refs AS (
    SELECT rf.branch_id, sum(rf.amount) AS amount
      FROM refunds rf
     WHERE rf.tenant_id = v_tenant AND rf.deleted_at IS NULL
       AND rf.refunded_at >= w.from_ts AND rf.refunded_at < w.to_ts
     GROUP BY rf.branch_id
  ),
  cols AS (
    SELECT py.branch_id, sum(py.amount) AS amount
      FROM payments py
     WHERE py.tenant_id = v_tenant AND py.deleted_at IS NULL
       AND py.received_at >= w.from_ts AND py.received_at < w.to_ts
     GROUP BY py.branch_id
  ),
  staff AS (
    SELECT ur.branch_id, count(DISTINCT ur.profile_id) AS n
      FROM user_roles ur
     WHERE ur.tenant_id = v_tenant AND ur.deleted_at IS NULL AND ur.branch_id IS NOT NULL
     GROUP BY ur.branch_id
  ),
  per AS (
    SELECT b.*,
           coalesce(sales.amount, 0)::numeric(19,4) AS gross_revenue,
           coalesce(refs.amount, 0)::numeric(19,4)  AS refunds,
           (coalesce(sales.amount, 0) - coalesce(refs.amount, 0))::numeric(19,4) AS net_revenue,
           (coalesce(cols.amount, 0) - coalesce(refs.amount, 0))::numeric(19,4)  AS net_collected,
           coalesce(sales.n, 0) AS completed_tickets,
           coalesce(staff.n, 0) AS staff_count
      FROM b
      LEFT JOIN sales ON sales.branch_id = b.id
      LEFT JOIN refs  ON refs.branch_id  = b.id
      LEFT JOIN cols  ON cols.branch_id  = b.id
      LEFT JOIN staff ON staff.branch_id = b.id
  ),
  tot AS (SELECT coalesce(sum(net_revenue), 0) AS net FROM per),
  trend AS (
    SELECT per.id AS branch_id,
           jsonb_agg(jsonb_build_object('date', d.day, 'net_revenue',
             (coalesce((SELECT sum(t.total_amount) FROM tickets t
                         WHERE t.tenant_id = v_tenant AND t.branch_id = per.id AND t.deleted_at IS NULL
                           AND t.completed_at >= (d.day::timestamp AT TIME ZONE w.timezone)
                           AND t.completed_at <  ((d.day + 1)::timestamp AT TIME ZONE w.timezone)), 0)
              - coalesce((SELECT sum(rf.amount) FROM refunds rf
                         WHERE rf.tenant_id = v_tenant AND rf.branch_id = per.id AND rf.deleted_at IS NULL
                           AND rf.refunded_at >= (d.day::timestamp AT TIME ZONE w.timezone)
                           AND rf.refunded_at <  ((d.day + 1)::timestamp AT TIME ZONE w.timezone)), 0)
             )::numeric(19,4)::text) ORDER BY d.day) AS days
      FROM per
      CROSS JOIN LATERAL (SELECT gs::date AS day FROM generate_series(w.end_date - 6, w.end_date, interval '1 day') gs) d
     GROUP BY per.id
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'branch_id',         per.id,
      'name',              per.name,
      'code',              per.code,
      'is_primary',        per.is_primary,
      'gross_revenue',     per.gross_revenue::text,
      'refunds',           per.refunds::text,
      'net_revenue',       per.net_revenue::text,
      'net_collected',     per.net_collected::text,
      'completed_tickets', per.completed_tickets,
      'staff_count',       per.staff_count,
      'share_pct',         CASE WHEN tot.net <= 0 OR per.net_revenue <= 0 THEN '0.00'
                                ELSE least(round(per.net_revenue * 100 / tot.net, 2), 100)::numeric(5,2)::text END,
      'trend',             trend.days
    ) ORDER BY per.net_revenue DESC, per.is_primary DESC, per.name), '[]'::jsonb),
    jsonb_build_object(
      'gross_revenue',     coalesce(sum(per.gross_revenue), 0)::numeric(19,4)::text,
      'refunds',           coalesce(sum(per.refunds), 0)::numeric(19,4)::text,
      'net_revenue',       coalesce(sum(per.net_revenue), 0)::numeric(19,4)::text,
      'net_collected',     coalesce(sum(per.net_collected), 0)::numeric(19,4)::text,
      'completed_tickets', coalesce(sum(per.completed_tickets), 0)::bigint,
      'branch_count',      count(per.id))
  INTO v_rows, v_totals
  FROM per CROSS JOIN tot LEFT JOIN trend ON trend.branch_id = per.id;

  RETURN jsonb_build_object(
    'period',     v_period,
    'start_date', w.start_date,
    'end_date',   w.end_date,
    'timezone',   w.timezone,
    'scope',      CASE WHEN v_all THEN 'all' ELSE 'managed' END,
    'totals',     v_totals,
    'branches',   v_rows
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_branch_performance(text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_branch_performance(text, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_branch_performance(text, date, date) TO authenticated, service_role;
