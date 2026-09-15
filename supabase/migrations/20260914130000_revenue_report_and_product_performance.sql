-- BACKEND_ROADMAP P9.9 Q1 + Q2: a ranged revenue report and product performance, per branch.
--
-- Both follow get_daily_revenue_summary() exactly (REPORTING-MODEL.md §5, §8, §13, §15–17, §53):
--   • same callers — owner, admin, branch_manager, cashier, accountant — with access to the branch;
--   • organization-local calendar days, converted to half-open UTC ranges [start, next day);
--   • revenue = tickets.total_amount by completed_at (completed is terminal); refunds by
--     refunded_at; collections by payments.received_at; soft-deleted rows excluded;
--   • every money figure returned as exact text, every sum and share computed here, never on a device.
--
-- Periods (resolved in the organization's timezone, so a phone's clock or zone never moves a day):
--   today · 7d · 30d · 90d (each ending today) · month (month to date) · last_month
--   or an explicit p_start / p_end (inclusive local dates). At most 366 days (§53).
--
-- 1. private.resolve_report_window(): authorization + period → dates and UTC bounds (shared).
-- 2. get_revenue_report(): totals and one row per local day (the month view aggregates the same
--    daily facts, §17).
-- 3. get_product_performance(): per product variant — units sold, line value, orders, share of line
--    value — ranked by value or by units. Line value is quantity × unit price before any order-level
--    discount or tax, so its total can differ from gross revenue; the response says so by name.
--    Refunds are ticket-level and are not attributed to products. No cost or margin (AD-022).
-- 4. idx_tickets_branch_completed_at: every revenue read filters tickets by branch and completed_at,
--    which had no index.

-- 4 ── index ──────────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tickets_branch_completed_at
  ON public.tickets (tenant_id, branch_id, completed_at)
  WHERE completed_at IS NOT NULL AND deleted_at IS NULL;

-- 1 ── window ─────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.resolve_report_window(
  p_branch_id uuid,
  p_period    text,
  p_start     date,
  p_end       date,
  OUT tenant_id  uuid,
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
  tenant_id := public.current_tenant_id();
  IF tenant_id IS NULL THEN
    RAISE EXCEPTION 'no active organization'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  END IF;

  IF p_branch_id IS NULL OR NOT public.has_branch_access(p_branch_id) THEN
    RAISE EXCEPTION 'insufficient_role: no access to this branch'
      USING errcode = 'P0001', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  IF NOT public.has_role(ARRAY['owner','admin','branch_manager','cashier','accountant']) THEN
    RAISE EXCEPTION 'insufficient_role: reporting requires an authorized role'
      USING errcode = 'P0001', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  SELECT o.timezone INTO timezone FROM public.organizations o WHERE o.id = tenant_id;
  v_today := (now() AT TIME ZONE timezone)::date;

  IF p_period IS NOT NULL THEN
    IF p_start IS NOT NULL OR p_end IS NOT NULL THEN
      RAISE EXCEPTION 'give a period or explicit dates, not both'
        USING errcode = 'P0001', detail = json_build_object('code','invalid_request','reason','invalid_range')::text;
    END IF;
    CASE p_period
      WHEN 'today'      THEN start_date := v_today;                                   end_date := v_today;
      WHEN '7d'         THEN start_date := v_today - 6;                               end_date := v_today;
      WHEN '30d'        THEN start_date := v_today - 29;                              end_date := v_today;
      WHEN '90d'        THEN start_date := v_today - 89;                              end_date := v_today;
      WHEN 'month'      THEN start_date := date_trunc('month', v_today)::date;        end_date := v_today;
      WHEN 'last_month' THEN start_date := (date_trunc('month', v_today) - interval '1 month')::date;
                             end_date   := (date_trunc('month', v_today) - interval '1 day')::date;
      ELSE
        RAISE EXCEPTION 'unknown period %', p_period
          USING errcode = 'P0001', detail = json_build_object('code','invalid_request','reason','invalid_period')::text;
    END CASE;
  ELSE
    end_date   := coalesce(p_end, v_today);
    start_date := coalesce(p_start, end_date - 6);
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

REVOKE ALL ON FUNCTION private.resolve_report_window(uuid, text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.resolve_report_window(uuid, text, date, date) FROM anon, authenticated;

-- 2 ── revenue ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_revenue_report(
  p_branch_id uuid,
  p_period    text DEFAULT NULL,
  p_start     date DEFAULT NULL,
  p_end       date DEFAULT NULL
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  w record;
  v_days jsonb;
  v_totals jsonb;
BEGIN
  SELECT * INTO w FROM private.resolve_report_window(p_branch_id, p_period, p_start, p_end);

  WITH d AS (
    SELECT gs::date AS day FROM generate_series(w.start_date, w.end_date, interval '1 day') gs
  ),
  t AS (
    SELECT (tk.completed_at AT TIME ZONE w.timezone)::date AS day,
           sum(tk.total_amount) AS amount, count(*) AS n
      FROM public.tickets tk
     WHERE tk.tenant_id = w.tenant_id AND tk.branch_id = p_branch_id AND tk.deleted_at IS NULL
       AND tk.completed_at >= w.from_ts AND tk.completed_at < w.to_ts
     GROUP BY 1
  ),
  r AS (
    SELECT (rf.refunded_at AT TIME ZONE w.timezone)::date AS day, sum(rf.amount) AS amount
      FROM public.refunds rf
     WHERE rf.tenant_id = w.tenant_id AND rf.branch_id = p_branch_id AND rf.deleted_at IS NULL
       AND rf.refunded_at >= w.from_ts AND rf.refunded_at < w.to_ts
     GROUP BY 1
  ),
  p AS (
    SELECT (py.received_at AT TIME ZONE w.timezone)::date AS day, sum(py.amount) AS amount
      FROM public.payments py
     WHERE py.tenant_id = w.tenant_id AND py.branch_id = p_branch_id AND py.deleted_at IS NULL
       AND py.received_at >= w.from_ts AND py.received_at < w.to_ts
     GROUP BY 1
  ),
  daily AS (
    SELECT d.day,
           coalesce(t.amount, 0)::numeric(19,4) AS gross_revenue,
           coalesce(r.amount, 0)::numeric(19,4) AS refunds,
           coalesce(p.amount, 0)::numeric(19,4) AS gross_collected,
           coalesce(t.n, 0)                     AS completed_tickets
      FROM d
      LEFT JOIN t ON t.day = d.day
      LEFT JOIN r ON r.day = d.day
      LEFT JOIN p ON p.day = d.day
  )
  SELECT
    jsonb_agg(jsonb_build_object(
      'date',               daily.day,
      'gross_revenue',      daily.gross_revenue::text,
      'recognized_refunds', daily.refunds::text,
      'net_revenue',        (daily.gross_revenue - daily.refunds)::numeric(19,4)::text,
      'gross_collected',    daily.gross_collected::text,
      'refunds_paid',       daily.refunds::text,
      'net_collected',      (daily.gross_collected - daily.refunds)::numeric(19,4)::text,
      'completed_tickets',  daily.completed_tickets
    ) ORDER BY daily.day),
    jsonb_build_object(
      'gross_revenue',      sum(daily.gross_revenue)::numeric(19,4)::text,
      'recognized_refunds', sum(daily.refunds)::numeric(19,4)::text,
      'net_revenue',        (sum(daily.gross_revenue) - sum(daily.refunds))::numeric(19,4)::text,
      'gross_collected',    sum(daily.gross_collected)::numeric(19,4)::text,
      'refunds_paid',       sum(daily.refunds)::numeric(19,4)::text,
      'net_collected',      (sum(daily.gross_collected) - sum(daily.refunds))::numeric(19,4)::text,
      'completed_tickets',  sum(daily.completed_tickets)::bigint
    )
  INTO v_days, v_totals
  FROM daily;

  RETURN jsonb_build_object(
    'branch_id',  p_branch_id,
    'period',     p_period,
    'start_date', w.start_date,
    'end_date',   w.end_date,
    'timezone',   w.timezone,
    'day_count',  w.end_date - w.start_date + 1,
    'totals',     v_totals,
    'days',       coalesce(v_days, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_revenue_report(uuid, text, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_revenue_report(uuid, text, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_revenue_report(uuid, text, date, date) TO authenticated, service_role;

-- 3 ── products ───────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_product_performance(
  p_branch_id uuid,
  p_period    text    DEFAULT NULL,
  p_start     date    DEFAULT NULL,
  p_end       date    DEFAULT NULL,
  p_order     text    DEFAULT 'value',
  p_limit     integer DEFAULT 100
)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  w record;
  v_rows jsonb;
  v_total numeric(19,4);
  v_count integer;
BEGIN
  IF p_order NOT IN ('value','units') THEN
    RAISE EXCEPTION 'order must be value or units'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request','reason','invalid_order')::text;
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200 THEN
    RAISE EXCEPTION 'limit must be between 1 and 200'
      USING errcode = 'P0001', detail = json_build_object('code','invalid_request','reason','invalid_limit')::text;
  END IF;

  SELECT * INTO w FROM private.resolve_report_window(p_branch_id, p_period, p_start, p_end);

  WITH lines AS (
    SELECT ti.product_variant_id, ti.quantity, ti.line_total, tk.id AS ticket_id
      FROM public.tickets tk
      JOIN public.ticket_items ti
        ON ti.ticket_id = tk.id AND ti.tenant_id = tk.tenant_id AND ti.deleted_at IS NULL
     WHERE tk.tenant_id = w.tenant_id AND tk.branch_id = p_branch_id AND tk.deleted_at IS NULL
       AND tk.completed_at >= w.from_ts AND tk.completed_at < w.to_ts
  ),
  agg AS (
    SELECT product_variant_id,
           sum(quantity)::numeric(18,4)    AS units,
           sum(line_total)::numeric(19,4)  AS line_value,
           count(DISTINCT ticket_id)       AS orders
      FROM lines
     GROUP BY product_variant_id
  ),
  total AS (
    SELECT coalesce(sum(line_value), 0)::numeric(19,4) AS value, count(*)::integer AS n FROM agg
  ),
  ranked AS (
    SELECT agg.*,
           pv.product_id, pv.name AS variant_name, pr.name AS product_name, pc.name AS category_name,
           row_number() OVER (
             ORDER BY CASE WHEN p_order = 'units' THEN agg.units END DESC NULLS LAST,
                      agg.line_value DESC, agg.units DESC, pr.name, pv.name
           ) AS rank
      FROM agg
      JOIN public.product_variants pv ON pv.id = agg.product_variant_id
      JOIN public.products pr ON pr.id = pv.product_id
      LEFT JOIN public.product_categories pc ON pc.id = pr.category_id
  )
  SELECT
    (SELECT jsonb_agg(jsonb_build_object(
       'rank',               ranked.rank,
       'product_variant_id', ranked.product_variant_id,
       'product_id',         ranked.product_id,
       'product_name',       ranked.product_name,
       'variant_name',       ranked.variant_name,
       'category_name',      ranked.category_name,
       'units',              ranked.units::text,
       'line_value',         ranked.line_value::text,
       'orders',             ranked.orders,
       'value_share_pct',    CASE WHEN total.value = 0 THEN '0.00'
                                  ELSE round(ranked.line_value * 100 / total.value, 2)::numeric(5,2)::text END
     ) ORDER BY ranked.rank)
       FROM ranked CROSS JOIN total
      WHERE ranked.rank <= p_limit),
    total.value, total.n
  INTO v_rows, v_total, v_count
  FROM total;

  RETURN jsonb_build_object(
    'branch_id',         p_branch_id,
    'period',            p_period,
    'start_date',        w.start_date,
    'end_date',          w.end_date,
    'timezone',          w.timezone,
    'order',             p_order,
    'total_line_value',  v_total::text,
    'products_sold',     v_count,
    'rows',              coalesce(v_rows, '[]'::jsonb)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_product_performance(uuid, text, date, date, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_product_performance(uuid, text, date, date, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_product_performance(uuid, text, date, date, text, integer) TO authenticated, service_role;
