-- Remove the `accountant` role entirely — database, and everything that named it (owner request,
-- 2026-09-20): "remove the role accountant from the database, docs, and live app, remove
-- everything about that role." It was never reachable from the app (no invite screen offers it,
-- confirmed live: 0 organization_invites ever used it) and the owner does not recognize it as part
-- of this project's plan, despite CLAUDE.md/docs/ROLES-AND-PERMISSIONS.md describing it as
-- "architecturally present, disabled in MVP 1". Superseding that with AD-029 (docs updated
-- separately, not in this file).
--
-- Live usage found before this migration (grep across every function body, RLS policy, view, and
-- CHECK constraint that mentions 'accountant'):
--   - 1 user_roles row: the smoke.accountant@bakeflow.test test account created 2026-09-19 for
--     manual role testing (20260919120000_smoke_role_credentials.sql). Its whole `auth.users` row
--     is deleted below; ON DELETE CASCADE takes its identity, profile, user_roles and
--     branch_assignments rows with it.
--   - 7 role_permissions rows (financial.audit.confirm/submit, financial.expense.create/update/
--     delete, financial.view, reports.view).
--   - 0 organization_invites (nothing to clean up — confirms no in-app path ever reached it).
--   - 6 functions and 5 RLS policies list 'accountant' alongside other roles in a `has_role(...)`/
--     `has_role_in(...)` array. Each is rewritten below with 'accountant' dropped from that array;
--     nothing else about the function or policy changes. Losing 'accountant' from these arrays is
--     safe by construction: no one holds the role after this migration, so it was already a no-op
--     branch everywhere except `get_sales_breakdown`'s scope selection (branch-scope now reads
--     `has_role(ARRAY['supervisor'])`, matching Q4's actual decision — supervisors, not
--     accountants, were always the intended branch-scope viewer).
--   - `roles_key_check` — a CHECK constraint enumerating every allowed `roles.key` — includes
--     'accountant'; narrowed at the end so the key can never be reintroduced by accident.

-- ── 1. Remove the smoke-test account (cascades identities, profile, user_roles, branch_assignments)
delete from auth.users where id = 'aa000000-0000-4000-8000-00000000da08';

-- ── 2. Remove the role's permission grants
delete from public.role_permissions
 where role_id = (select id from public.roles where key = 'accountant');

-- ── 3. Rewrite every function that named 'accountant' in a role array
create or replace function private.resolve_report_window(p_branch_id uuid, p_period text, p_start date, p_end date, OUT tenant_id uuid, OUT timezone text, OUT start_date date, OUT end_date date, OUT from_ts timestamp with time zone, OUT to_ts timestamp with time zone)
 returns record
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
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

  IF NOT public.has_role(ARRAY['owner','admin','branch_manager','cashier']) THEN
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

create or replace function public.get_daily_revenue_summary(p_branch_id uuid, p_date date DEFAULT NULL::date)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tenant uuid := current_tenant_id();
  v_tz text;
  v_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_gross_revenue numeric(19,4);
  v_recognized_refunds numeric(19,4);
  v_gross_collected numeric(19,4);
begin
  if v_tenant is null then
    raise exception 'no active organization'
      using errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
  end if;

  if not public.has_branch_access(p_branch_id) then
    raise exception 'insufficient_role: no access to this branch'
      using errcode = 'P0001', detail = json_build_object('code','insufficient_role')::text;
  end if;

  if not public.has_role(array['owner','admin','branch_manager','cashier']) then
    raise exception 'insufficient_role: reporting requires an authorized role'
      using errcode = 'P0001', detail = json_build_object('code','insufficient_role')::text;
  end if;

  select o.timezone into v_tz from public.organizations o where o.id = v_tenant;
  v_date := coalesce(p_date, (now() at time zone v_tz)::date);

  v_start := (v_date::timestamp) at time zone v_tz;
  v_end   := ((v_date + 1)::timestamp) at time zone v_tz;

  select coalesce(sum(t.total_amount), 0) into v_gross_revenue
  from public.tickets t
  where t.tenant_id = v_tenant
    and t.branch_id = p_branch_id
    and t.deleted_at is null
    and t.completed_at >= v_start
    and t.completed_at <  v_end;

  select coalesce(sum(r.amount), 0) into v_recognized_refunds
  from public.refunds r
  where r.tenant_id = v_tenant
    and r.branch_id = p_branch_id
    and r.deleted_at is null
    and r.refunded_at >= v_start
    and r.refunded_at <  v_end;

  select coalesce(sum(p.amount), 0) into v_gross_collected
  from public.payments p
  where p.tenant_id = v_tenant
    and p.branch_id = p_branch_id
    and p.deleted_at is null
    and p.received_at >= v_start
    and p.received_at <  v_end;

  return jsonb_build_object(
    'branch_id', p_branch_id,
    'reporting_date', v_date,
    'timezone', v_tz,
    'gross_revenue', v_gross_revenue::text,
    'recognized_refunds', v_recognized_refunds::text,
    'net_revenue', (v_gross_revenue - v_recognized_refunds)::text,
    'gross_collected', v_gross_collected::text,
    'refunds_paid', v_recognized_refunds::text,
    'net_collected', (v_gross_collected - v_recognized_refunds)::text
  );
end;
$function$;

create or replace function public.apply_expense_create(p_operation sync_operations)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_payload    jsonb := p_operation.payload;
  v_category   text := nullif(v_payload ->> 'category', '');
  v_amount     numeric := nullif(v_payload ->> 'amount', '')::numeric;
  v_description text := nullif(v_payload ->> 'description', '');
  v_paid_method text := nullif(v_payload ->> 'paid_method', '');
  v_cash_session_id uuid := nullif(v_payload ->> 'cash_session_id', '')::uuid;
  v_incurred_at timestamptz := nullif(v_payload ->> 'incurred_at', '')::timestamptz;
  v_receipt_url text := nullif(v_payload ->> 'receipt_url', '');
  v_expense    public.expenses;
BEGIN
  IF p_operation.branch_id IS NULL THEN
    RAISE EXCEPTION 'expense.create requires a branch-scoped operation'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_category IS NULL OR v_category NOT IN ('ingredients','rent','utilities','salaries','transport','other') THEN
    RAISE EXCEPTION 'expense.create payload requires a valid category'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION 'expense.create payload requires amount greater than zero'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_description IS NOT NULL AND length(v_description) > 2000 THEN
    RAISE EXCEPTION 'expense.create payload description must be 2000 characters or fewer'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_paid_method IS NOT NULL AND v_paid_method NOT IN ('cash','card','transfer','pos') THEN
    RAISE EXCEPTION 'expense.create payload paid_method must be cash, card, transfer, or pos'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_paid_method = 'cash' AND v_cash_session_id IS NULL THEN
    RAISE EXCEPTION 'expense.create payload requires cash_session_id for cash expenses'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;
  IF v_paid_method IS DISTINCT FROM 'cash' AND v_cash_session_id IS NOT NULL THEN
    RAISE EXCEPTION 'cash session can only be attached to cash expenses'
      USING errcode = '22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  IF NOT public.has_role_in(p_operation.actor_id, p_operation.tenant_id,
       ARRAY['owner','admin','branch_manager','cashier']) THEN
    RAISE EXCEPTION 'insufficient_role: actor may not record expenses in this organization'
      USING errcode = '42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  IF v_cash_session_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.cash_sessions
       WHERE id = v_cash_session_id AND tenant_id = p_operation.tenant_id
         AND branch_id = p_operation.branch_id
    ) THEN
      RAISE EXCEPTION 'cash session not found at the operation branch'
        USING errcode = 'P0001', detail = json_build_object('code','invalid_request')::text;
    END IF;
  END IF;

  INSERT INTO public.expenses
    (tenant_id, branch_id, category, amount, description, paid_method, cash_session_id,
     incurred_at, receipt_url, created_by)
  VALUES
    (p_operation.tenant_id, p_operation.branch_id, v_category, v_amount, v_description,
     v_paid_method, v_cash_session_id, coalesce(v_incurred_at, now()), v_receipt_url,
     p_operation.actor_id)
  RETURNING * INTO v_expense;

  INSERT INTO public.sync_changes (tenant_id, branch_id, entity_type, entity_id,
    operation_type, domain_operation, revision, changed_by, payload)
  VALUES (v_expense.tenant_id, v_expense.branch_id, 'expenses', v_expense.id,
    'CREATE', 'expense.create', 1, p_operation.actor_id, to_jsonb(v_expense));

  RETURN jsonb_build_object('expense_id', v_expense.id, 'category', v_expense.category,
    'amount', v_expense.amount, 'revision', 1);
END;
$function$;

create or replace function public.guard_driver_created_order_assignment()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
BEGIN
  IF public.has_role_in(auth.uid(), NEW.tenant_id, ARRAY['driver'])
     AND NOT public.has_role_in(auth.uid(), NEW.tenant_id, ARRAY['owner','admin','branch_manager','cashier','baker']) THEN
    NEW.assigned_to := auth.uid();
  END IF;
  RETURN NEW;
END;
$function$;

create or replace function public.update_invoice_due_at(p_invoice_id uuid, p_due_at timestamp with time zone)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_invoice public.invoices;
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF NOT public.has_role(ARRAY['owner','admin']) THEN
    RAISE EXCEPTION 'insufficient_role';
  END IF;

  UPDATE public.invoices
  SET due_at = p_due_at
  WHERE id = p_invoice_id AND tenant_id = v_tenant
  RETURNING * INTO v_invoice;

  IF v_invoice.id IS NULL THEN
    RAISE EXCEPTION 'invoice not found';
  END IF;

  RETURN jsonb_build_object('invoice', to_jsonb(v_invoice));
END;
$function$;

create or replace function public.get_sales_breakdown(p_branch_id uuid, p_period text DEFAULT 'today'::text, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
    WHEN has_role(ARRAY['supervisor']) THEN 'branch'
    WHEN has_role(ARRAY['cashier','driver','branch_manager']) THEN 'own'
    ELSE NULL
  END;
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'insufficient_role: sales figures are not available to this role'
      USING errcode = 'P0001', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  SELECT * INTO w FROM private.report_period(v_tenant, v_period, p_start, p_end);

  SELECT jsonb_build_object(
           'gross_sales',       coalesce(sum(t.total_amount), 0)::numeric(19,4)::text,
           'completed_tickets', count(*))
    INTO v_totals
    FROM tickets t
   WHERE t.tenant_id = v_tenant AND t.branch_id = p_branch_id AND t.deleted_at IS NULL
     AND t.completed_at >= w.from_ts AND t.completed_at < w.to_ts
     AND (v_scope <> 'own' OR t.created_by = v_user);

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
    'branch_id', p_branch_id, 'period', v_period, 'start_date', w.start_date, 'end_date', w.end_date,
    'timezone', w.timezone, 'scope', v_scope, 'totals', v_totals, 'by_method', v_methods,
    'by_staff', v_staff, 'recent', v_recent
  );
END;
$function$;

-- ── 4. Rewrite the 5 RLS policies that named 'accountant'
drop policy audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (tenant_id = current_tenant_id() and has_role(array['owner','admin']) and deleted_at is null);

drop policy daily_financial_audits_select on public.daily_financial_audits;
create policy daily_financial_audits_select on public.daily_financial_audits
  for select to authenticated
  using (
    tenant_id = current_tenant_id() and deleted_at is null
    and (
      submitted_by = (select auth.uid())
      or (has_branch_access(branch_id) and has_role(array['owner','admin','branch_manager']))
    )
  );

drop policy expenses_insert on public.expenses;
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (
    tenant_id = current_tenant_id()
    and has_branch_access(branch_id)
    and has_role(array['owner','admin','branch_manager','cashier'])
    and created_by = (select auth.uid())
  );

drop policy expenses_update on public.expenses;
create policy expenses_update on public.expenses
  for update to authenticated
  using (tenant_id = current_tenant_id() and has_branch_access(branch_id) and has_role(array['owner','admin','branch_manager']))
  with check (tenant_id = current_tenant_id());

drop policy invoices_update on public.invoices;
create policy invoices_update on public.invoices
  for update to authenticated
  using (tenant_id = current_tenant_id() and has_branch_access(branch_id) and has_role(array['owner','admin']))
  with check (tenant_id = current_tenant_id());

-- ── 5. Remove the role itself, then close off its key so it cannot silently return
delete from public.roles where key = 'accountant';

alter table public.roles drop constraint roles_key_check;
alter table public.roles add constraint roles_key_check
  check (key = any (array['owner','admin','branch_manager','supervisor','baker','cashier','driver']));
