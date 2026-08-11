-- BakeFlow — reporting views
--
-- Implements docs/REPORTING-MODEL.md. Read that document before changing anything here;
-- every definition below traces to a numbered section in it.
--
-- Locked decisions (REPORTING-MODEL.md section 85):
--   REVENUE      recognized on the fulfilment/delivery event, NOT on payment.
--   REPORTING DAY organization-local calendar day, from organizations.timezone.
--   COSTING      weighted-average.
--   REFUNDS      separate financial events reducing net revenue and net collected,
--                recognized on the refund date, never rewriting payment history.
--   OFFLINE      business-event timestamp determines the reporting date, never sync time.
--
-- STATUS: NOT APPLIED to production. Consistent with the other migrations in this
-- directory, which the owner has chosen to leave unapplied. Nothing here writes data.
--
-- ---------------------------------------------------------------------------
-- TWO BLOCKING GAPS, both flagged rather than silently worked around
-- ---------------------------------------------------------------------------
--
-- GAP 1 — RESOLVED by 20260810110000_add_ticket_fulfilled_at.sql, which must be applied
--   first. That migration adds tickets.fulfilled_at, the authoritative business-event
--   timestamp required by REPORTING-MODEL.md section 78.
--   These views resolve the recognition instant in priority order:
--     a) tickets.fulfilled_at     — authoritative; client-supplied and server-validated
--                                   for offline sales, server-stamped when online
--     b) deliveries.delivered_at  — pre-existing delivery rows, delivery fulfilment only
--     c) audit_log.occurred_at of the status_change into 'delivered' — last resort, and
--        for an offline sale this is SERVER PROCESSING time, which sections 8 and 9
--        forbid using as the business-event time
--   Every row exposes `recognition_basis` and `recognition_is_authoritative` so a row
--   resting on (c) is visibly approximate rather than silently wrong.
--
-- GAP 2 — the revenue-eligible states are unreachable in the deployed database.
--   prevent_submitted_ticket_update() blocks status changes on submitted tickets, so
--   'delivered' and 'completed' can never be reached and NO ticket can ever become
--   revenue-eligible. See docs/STATE-MACHINES.md section 1. The hybrid immutability
--   decision of 2026-08-10 fixes this by letting status advance while freezing money;
--   until that remediation is applied, every revenue view below correctly returns zero
--   rows. That is the schema being wrong, not these views.
--
-- ---------------------------------------------------------------------------
-- Security (REPORTING-MODEL.md section 51)
-- ---------------------------------------------------------------------------
-- Every view is security_invoker = true, so the querying user's RLS applies and a view
-- cannot become a privileged back door across tenants. Views do NOT have RLS of their
-- own; they inherit it from the base tables only because of this setting. Do not remove it.

-- ---------------------------------------------------------------------------
-- Helper: organization-local reporting date (sections 11, 13, 15, 16)
-- ---------------------------------------------------------------------------
-- Converts an instant to the organization's local calendar date. Never uses device or
-- server timezone. Half-open ranges are the caller's responsibility (section 16):
-- filter `event_at >= start AND event_at < next_start`, never a 23:59:59.999 boundary.

create or replace function public.reporting_local_date(
  p_at        timestamptz,
  p_tenant_id uuid
)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (p_at at time zone coalesce(o.timezone, 'Africa/Lagos'))::date
  from public.organizations o
  where o.id = p_tenant_id;
$$;

comment on function public.reporting_local_date(timestamptz, uuid) is
  'Organization-local calendar date for a given instant. REPORTING-MODEL.md section 11.';

revoke all on function public.reporting_local_date(timestamptz, uuid) from public, anon;
grant execute on function public.reporting_local_date(timestamptz, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. reporting_ticket_revenue — recognized revenue, one row per ticket
-- ---------------------------------------------------------------------------
-- Sections 5, 7, 8, 40. A ticket contributes gross revenue only once fulfilled.
-- Archived tickets REMAIN in revenue (section 40): archived_at is not a financial
-- reversal. Soft-deleted tickets are excluded. Correction tickets are included as
-- ordinary rows and carry correction_of_ticket_id so adjustments are traceable
-- (sections 38, 39).

create or replace view public.reporting_ticket_revenue
with (security_invoker = true) as
select
  t.id                    as ticket_id,
  t.tenant_id,
  t.branch_id,
  t.ticket_number,
  t.customer_id,
  t.correction_of_ticket_id,
  t.status,
  t.fulfilment_type,
  t.total_amount          as gross_revenue,
  t.subtotal_amount,
  t.discount_amount,
  t.tax_amount,
  t.archived_at is not null as is_archived,
  -- Fulfilment instant, in priority order. See GAP 1 in the header.
  coalesce(t.fulfilled_at, d.delivered_at, a.occurred_at) as recognized_at,
  case
    when t.fulfilled_at is not null then 'ticket_fulfilled_at'
    when d.delivered_at is not null then 'delivery_row'
    when a.occurred_at  is not null then 'audit_log_status_change'
    else 'none'
  end                     as recognition_basis,
  -- False only when we fell back to the audit log, which for an offline sale is
  -- server-processing time — forbidden as a business-event time by section 8.
  (t.fulfilled_at is not null or d.delivered_at is not null) as recognition_is_authoritative,
  public.reporting_local_date(coalesce(t.fulfilled_at, d.delivered_at, a.occurred_at), t.tenant_id)
                          as reporting_date
from public.tickets t
left join public.deliveries d
       on d.ticket_id = t.id
      and d.status    = 'delivered'
      and d.deleted_at is null
left join lateral (
  select al.occurred_at
  from public.audit_log al
  where al.entity_type = 'ticket'
    and al.entity_id   = t.id
    and al.action      = 'status_change'
    and al.after ->> 'status' = 'delivered'
    and al.deleted_at is null
  order by al.occurred_at
  limit 1
) a on true
where t.deleted_at is null
  and t.status in ('delivered', 'completed');

comment on view public.reporting_ticket_revenue is
  'Recognized gross revenue per ticket. Revenue is recognized on fulfilment, not payment (REPORTING-MODEL.md section 5). Archived tickets remain included (section 40).';

-- ---------------------------------------------------------------------------
-- 2. reporting_payments — cash collection, independent of revenue
-- ---------------------------------------------------------------------------
-- Sections 6, 45, 46. Collection is NEVER an alias for revenue. Payment method values
-- come from the live payments_method_check constraint; do not invent new ones (section 46).
--
-- NOTE: the payments table has no status column, so every non-deleted row counts as
-- successful. Section 78 asks for successful payments to be distinguishable from
-- failed/voided ones — today the only available signal is deleted_at. If voided
-- payments become a real case, add an explicit status rather than overloading soft delete.

create or replace view public.reporting_payments
with (security_invoker = true) as
select
  p.id            as payment_id,
  p.tenant_id,
  p.branch_id,
  p.ticket_id,
  p.invoice_id,
  p.cash_session_id,
  p.amount,
  p.method,
  -- Only physical cash counts toward till reconciliation (section 45).
  (p.method = 'cash') as is_cash,
  p.received_at,
  public.reporting_local_date(p.received_at, p.tenant_id) as reporting_date
from public.payments p
where p.deleted_at is null;

comment on view public.reporting_payments is
  'Customer payments by organization-local receipt date. Collection is separate from revenue (REPORTING-MODEL.md section 6).';

-- ---------------------------------------------------------------------------
-- 3. reporting_refunds — refunds as first-class financial events
-- ---------------------------------------------------------------------------
-- Sections 19-26. A refund is recognized on refunded_at, which may fall in a LATER
-- period than the sale (section 25). Historical reports are not restated, and a refund
-- after a confirmed daily audit lands in the later period (section 26).
-- Refunds reach a ticket through their payment; that join is the only link.

create or replace view public.reporting_refunds
with (security_invoker = true) as
select
  r.id          as refund_id,
  r.tenant_id,
  r.branch_id,
  r.payment_id,
  p.ticket_id,
  p.method      as original_method,
  (p.method = 'cash') as is_cash,
  r.amount,
  r.reason,
  r.refunded_at,
  public.reporting_local_date(r.refunded_at, r.tenant_id) as reporting_date
from public.refunds r
join public.payments p
  on p.id = r.payment_id
 and p.deleted_at is null
where r.deleted_at is null;

comment on view public.reporting_refunds is
  'Refunds recognized on their own event date, possibly a later period than the sale (REPORTING-MODEL.md section 25).';

-- ---------------------------------------------------------------------------
-- 4. reporting_ticket_financial_state — payment state x refund state
-- ---------------------------------------------------------------------------
-- Sections 20, 21, 65. Payment state and refund state are INDEPENDENT and must never
-- be collapsed into one column. A fully refunded ticket legitimately reads
-- payment_status='paid' AND refund_status='fully_refunded' with net_collected = 0.
-- This view is what stops a dashboard reporting a refunded sale as money in hand.

create or replace view public.reporting_ticket_financial_state
with (security_invoker = true) as
with paid as (
  select ticket_id, tenant_id, sum(amount) as gross_paid
  from public.payments
  where deleted_at is null and ticket_id is not null
  group by ticket_id, tenant_id
),
refunded as (
  select p.ticket_id, sum(r.amount) as total_refunded
  from public.refunds r
  join public.payments p on p.id = r.payment_id and p.deleted_at is null
  where r.deleted_at is null
  group by p.ticket_id
)
select
  t.id        as ticket_id,
  t.tenant_id,
  t.branch_id,
  t.total_amount,
  coalesce(paid.gross_paid, 0)      as gross_paid,
  coalesce(refunded.total_refunded, 0) as total_refunded,
  coalesce(paid.gross_paid, 0) - coalesce(refunded.total_refunded, 0) as net_collected,
  case
    when coalesce(paid.gross_paid, 0) = 0                  then 'unpaid'
    when coalesce(paid.gross_paid, 0) < t.total_amount     then 'partially_paid'
    else 'paid'
  end as payment_status,
  case
    when coalesce(refunded.total_refunded, 0) = 0                            then 'none'
    when coalesce(refunded.total_refunded, 0) < coalesce(paid.gross_paid, 0) then 'partially_refunded'
    else 'fully_refunded'
  end as refund_status,
  -- Receivable only where the sale is recognized and credit semantics apply (section 63).
  case
    when t.status in ('delivered', 'completed')
    then t.total_amount - (coalesce(paid.gross_paid, 0) - coalesce(refunded.total_refunded, 0))
    else 0
  end as outstanding_amount
from public.tickets t
left join paid     on paid.ticket_id     = t.id
left join refunded on refunded.ticket_id = t.id
where t.deleted_at is null;

comment on view public.reporting_ticket_financial_state is
  'Independent payment_status and refund_status per ticket. paid + fully_refunded is a valid combination with net_collected = 0 (REPORTING-MODEL.md sections 21, 65).';

-- ---------------------------------------------------------------------------
-- 5. reporting_cogs — cost of goods sold, weighted-average
-- ---------------------------------------------------------------------------
-- Sections 27, 33, 36. COGS is fixed at the moment inventory is consumed, using the
-- unit_cost stamped on the movement. It must NEVER be recomputed from today's prices,
-- or historical P&L would move whenever new stock is bought (section 33).
--
-- Sale movements carry a negative quantity_delta, so cost is negated back to positive.
--
-- Refunds do NOT reverse COGS here, deliberately: section 37 requires knowing whether
-- goods physically returned to usable stock. A return shows up as its own inventory
-- movement and is reflected through that, not inferred from the refund amount.

create or replace view public.reporting_cogs
with (security_invoker = true) as
select
  sm.id           as movement_id,
  sm.tenant_id,
  sm.branch_id,
  sm.warehouse_id,
  sm.item_type,
  sm.ingredient_id,
  sm.product_variant_id,
  sm.reference_type,
  sm.reference_id,
  -sm.quantity_delta                            as quantity_sold,
  sm.unit_cost,
  round((-sm.quantity_delta) * coalesce(sm.unit_cost, 0), 4) as cogs_amount,
  sm.unit_cost is null                          as cost_missing,
  sm.created_at,
  public.reporting_local_date(sm.created_at, sm.tenant_id) as reporting_date
from public.stock_movements sm
where sm.deleted_at is null
  and sm.reason = 'sale'
  and sm.quantity_delta < 0;

comment on view public.reporting_cogs is
  'COGS per sale stock movement at the cost stamped when consumed. Never recomputed from current prices (REPORTING-MODEL.md section 33).';

-- ---------------------------------------------------------------------------
-- 6. reporting_inventory_valuation — weighted-average on-hand value
-- ---------------------------------------------------------------------------
-- Sections 27, 30. Derived from the stock_movements ledger, which is the authoritative
-- source; the level tables are a cache (CLAUDE.md rule 7).
--
-- The running value is sum(quantity_delta * unit_cost). This is only correct if every
-- OUTFLOW is stamped with the weighted-average cost prevailing at that moment.
-- apply_stock_movement() must guarantee that; if an outflow is written with a null or
-- purchase-specific cost, valuation drifts. cost_missing_movements surfaces exactly that.

create or replace view public.reporting_inventory_valuation
with (security_invoker = true) as
select
  sm.tenant_id,
  sm.branch_id,
  sm.warehouse_id,
  sm.item_type,
  sm.ingredient_id,
  sm.product_variant_id,
  sum(sm.quantity_delta)                                   as quantity_on_hand,
  round(sum(sm.quantity_delta * coalesce(sm.unit_cost, 0)), 4) as inventory_value,
  case
    when sum(sm.quantity_delta) > 0
    then round(sum(sm.quantity_delta * coalesce(sm.unit_cost, 0)) / sum(sm.quantity_delta), 4)
    else null
  end                                                      as weighted_average_cost,
  count(*) filter (where sm.unit_cost is null)             as cost_missing_movements
from public.stock_movements sm
where sm.deleted_at is null
group by sm.tenant_id, sm.branch_id, sm.warehouse_id,
         sm.item_type, sm.ingredient_id, sm.product_variant_id;

comment on view public.reporting_inventory_valuation is
  'Weighted-average inventory valuation rebuilt from the stock_movements ledger (REPORTING-MODEL.md sections 27, 30).';

-- ---------------------------------------------------------------------------
-- 7. reporting_daily_summary — the daily fact table
-- ---------------------------------------------------------------------------
-- Sections 18, 44, 47, 48. Every longer period (week, month, custom) aggregates THESE
-- daily facts rather than reimplementing the financial logic (section 17).
--
-- Revenue, collection, refunds and COGS each land on their own event date, so a single
-- day's row can legitimately show revenue with no collection, or a refund against a
-- sale recognized weeks earlier (sections 25, 64).
--
-- The profit column is named gross_profit and NOT net profit: operating expenses are
-- not part of this model (section 47).

create or replace view public.reporting_daily_summary
with (security_invoker = true) as
with facts as (
  select tenant_id, branch_id, reporting_date,
         gross_revenue as revenue, 0::numeric as collected,
         0::numeric as refunded, 0::numeric as cash_collected,
         0::numeric as cash_refunded, 0::numeric as cogs
  from public.reporting_ticket_revenue
  where reporting_date is not null

  union all
  select tenant_id, branch_id, reporting_date,
         0, amount, 0,
         case when is_cash then amount else 0 end, 0, 0
  from public.reporting_payments

  union all
  select tenant_id, branch_id, reporting_date,
         0, 0, amount,
         0, case when is_cash then amount else 0 end, 0
  from public.reporting_refunds

  union all
  select tenant_id, branch_id, reporting_date,
         0, 0, 0, 0, 0, cogs_amount
  from public.reporting_cogs
)
select
  tenant_id,
  branch_id,
  reporting_date,
  round(sum(revenue), 4)                          as gross_revenue,
  round(sum(refunded), 4)                         as refunds,
  round(sum(revenue) - sum(refunded), 4)          as net_revenue,
  round(sum(collected), 4)                        as gross_collected,
  round(sum(collected) - sum(refunded), 4)        as net_collected,
  round(sum(cash_collected) - sum(cash_refunded), 4) as net_cash,
  round(sum(cogs), 4)                             as cogs,
  round(sum(revenue) - sum(refunded) - sum(cogs), 4) as gross_profit,
  -- NULL, not Infinity and not a bare zero, when net revenue is zero (section 48).
  case
    when sum(revenue) - sum(refunded) <> 0
    then round((sum(revenue) - sum(refunded) - sum(cogs)) / (sum(revenue) - sum(refunded)), 4)
    else null
  end                                             as gross_margin
from facts
group by tenant_id, branch_id, reporting_date;

comment on view public.reporting_daily_summary is
  'Daily financial facts per branch in organization-local dates. Longer periods aggregate this view (REPORTING-MODEL.md section 17). gross_profit excludes operating expenses (section 47).';

-- ---------------------------------------------------------------------------
-- 8. reporting_cash_reconciliation — payments vs till vs audit
-- ---------------------------------------------------------------------------
-- Sections 45, 58, 59. Three independent measures of the same day's cash. A variance is
-- a financial exception to be surfaced, never silently corrected by editing payments
-- (section 59). The daily audit and the dashboard must not overwrite one another (section 58).
--
-- Cash sessions are a control structure, NOT the reporting-day boundary (section 12);
-- a session is attributed to the local date it opened.

create or replace view public.reporting_cash_reconciliation
with (security_invoker = true) as
with cash_by_day as (
  select tenant_id, branch_id, reporting_date,
         sum(case when is_cash then amount else 0 end) as cash_collected,
         0::numeric as cash_refunded
  from public.reporting_payments
  group by tenant_id, branch_id, reporting_date
  union all
  select tenant_id, branch_id, reporting_date,
         0, sum(case when is_cash then amount else 0 end)
  from public.reporting_refunds
  group by tenant_id, branch_id, reporting_date
),
cash_rolled as (
  select tenant_id, branch_id, reporting_date,
         sum(cash_collected) as cash_collected,
         sum(cash_refunded)  as cash_refunded
  from cash_by_day
  group by tenant_id, branch_id, reporting_date
),
sessions as (
  select cs.tenant_id, cs.branch_id,
         public.reporting_local_date(cs.opened_at, cs.tenant_id) as reporting_date,
         sum(cs.counted_amount)  as session_counted,
         sum(cs.expected_amount) as session_expected,
         sum(cs.variance_amount) as session_variance
  from public.cash_sessions cs
  where cs.deleted_at is null and cs.status = 'closed'
  group by cs.tenant_id, cs.branch_id, public.reporting_local_date(cs.opened_at, cs.tenant_id)
),
audits as (
  select dfa.tenant_id, dfa.branch_id, dfa.audit_date as reporting_date,
         sum(dfa.physical_cash) as audited_cash,
         sum(dfa.expected_cash) as audited_expected,
         sum(dfa.variance)      as audited_variance
  from public.daily_financial_audits dfa
  where dfa.status = 'CONFIRMED'
    and dfa.deleted_at is null
  group by dfa.tenant_id, dfa.branch_id, dfa.audit_date
)
select
  coalesce(c.tenant_id, s.tenant_id, a.tenant_id)             as tenant_id,
  coalesce(c.branch_id, s.branch_id, a.branch_id)             as branch_id,
  coalesce(c.reporting_date, s.reporting_date, a.reporting_date) as reporting_date,
  coalesce(c.cash_collected, 0)                               as cash_collected,
  coalesce(c.cash_refunded, 0)                                as cash_refunded,
  coalesce(c.cash_collected, 0) - coalesce(c.cash_refunded, 0) as net_cash_per_payments,
  s.session_counted,
  s.session_expected,
  s.session_variance,
  a.audited_cash,
  a.audited_expected,
  a.audited_variance,
  -- What the payment records say, minus what was physically counted at close.
  case
    when a.audited_cash is not null
    then round((coalesce(c.cash_collected, 0) - coalesce(c.cash_refunded, 0)) - a.audited_cash, 4)
    else null
  end                                                          as payments_vs_audit_variance
from cash_rolled c
full join sessions s
  on s.tenant_id = c.tenant_id and s.branch_id = c.branch_id and s.reporting_date = c.reporting_date
full join audits a
  on a.tenant_id = coalesce(c.tenant_id, s.tenant_id)
 and a.branch_id = coalesce(c.branch_id, s.branch_id)
 and a.reporting_date = coalesce(c.reporting_date, s.reporting_date);

comment on view public.reporting_cash_reconciliation is
  'Payments vs cash-session totals vs confirmed daily audit. Variance is an exception to surface, never to silently correct (REPORTING-MODEL.md section 59).';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- SELECT only, and only for signed-in users. security_invoker means each caller still
-- sees exactly what the base-table RLS allows them to see. anon gets nothing.

grant select on
  public.reporting_ticket_revenue,
  public.reporting_payments,
  public.reporting_refunds,
  public.reporting_ticket_financial_state,
  public.reporting_cogs,
  public.reporting_inventory_valuation,
  public.reporting_daily_summary,
  public.reporting_cash_reconciliation
to authenticated;

revoke all on
  public.reporting_ticket_revenue,
  public.reporting_payments,
  public.reporting_refunds,
  public.reporting_ticket_financial_state,
  public.reporting_cogs,
  public.reporting_inventory_valuation,
  public.reporting_daily_summary,
  public.reporting_cash_reconciliation
from anon;

-- ---------------------------------------------------------------------------
-- Indexes for date-range access (section 54)
-- ---------------------------------------------------------------------------
-- Deliberately minimal. Section 54 warns against creating indexes blindly; verify with
-- real query plans once there is data, then add more.

create index if not exists payments_tenant_branch_received_idx
  on public.payments (tenant_id, branch_id, received_at)
  where deleted_at is null;

create index if not exists refunds_tenant_branch_refunded_idx
  on public.refunds (tenant_id, branch_id, refunded_at)
  where deleted_at is null;

create index if not exists stock_movements_sale_cost_idx
  on public.stock_movements (tenant_id, branch_id, created_at)
  where deleted_at is null and reason = 'sale';

create index if not exists audit_log_ticket_status_idx
  on public.audit_log (entity_type, entity_id, occurred_at)
  where action = 'status_change';
