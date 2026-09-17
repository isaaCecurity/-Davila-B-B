import type { Money, Uuid } from './scalars';

/**
 * `get_daily_revenue_summary()`'s response — P9.8, the revenue/cash half of P5.8.
 *
 * COGS/gross_profit/gross_margin are deliberately absent: BLOCKER-018
 * (`stock_movements.unit_cost` is 100% NULL live) blocks weighted-average costing, so
 * this type only carries the metrics `docs/REPORTING-MODEL.md` §85 locks that do not
 * depend on it. `net_revenue`/`net_collected` can be negative — a day with a refund but
 * no matching same-day sale or collection is a real, valid case (refunds are recognized
 * on their own event date per §25, independent of the original sale's date).
 */
export interface DailyRevenueSummary {
  branch_id: Uuid;
  /** `YYYY-MM-DD`, the organization-local calendar day this summary covers. */
  reporting_date: string;
  /** The organization's configured IANA timezone, e.g. `"Africa/Lagos"`. */
  timezone: string;
  gross_revenue: Money;
  recognized_refunds: Money;
  net_revenue: Money;
  gross_collected: Money;
  refunds_paid: Money;
  net_collected: Money;
}

/**
 * A reporting period, resolved by the server in the organization's own timezone (P9.9 Q1/Q2):
 * `today`; the last 7, 30 or 90 days ending today; `month` (month to date); `last_month`.
 */
export const REPORT_PERIODS = ['today', '7d', '30d', '90d', 'month', 'last_month'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

/** The revenue and cash figures of `get_revenue_report()`, for one day or for the whole range. */
export interface RevenueFigures {
  gross_revenue: Money;
  recognized_refunds: Money;
  /** Can be negative (a refund with no same-period sale). */
  net_revenue: Money;
  gross_collected: Money;
  refunds_paid: Money;
  /** Can be negative. */
  net_collected: Money;
  completed_tickets: number;
}

export interface RevenueReportDay extends RevenueFigures {
  /** `YYYY-MM-DD`, organization-local. */
  date: string;
}

/**
 * `get_revenue_report()` — one branch over a period: totals and one row per organization-local day,
 * oldest first. Every figure follows `get_daily_revenue_summary()` (a day's row equals that day's
 * summary); the totals are summed server-side.
 */
export interface RevenueReport {
  branch_id: Uuid;
  period: ReportPeriod | null;
  start_date: string;
  end_date: string;
  timezone: string;
  day_count: number;
  totals: RevenueFigures;
  days: RevenueReportDay[];
}

export type ProductPerformanceOrder = 'value' | 'units';

/** One product variant's sales over the period, as `get_product_performance()` ranks them. */
export interface ProductPerformanceRow {
  rank: number;
  product_variant_id: Uuid;
  product_id: Uuid;
  product_name: string;
  variant_name: string;
  category_name: string | null;
  /** Exact decimal quantity sold. */
  units: string;
  /** Quantity × unit price, before any order-level discount or tax. */
  line_value: Money;
  orders: number;
  /** This row's share of the period's total line value, `NN.NN`, computed server-side. */
  value_share_pct: string;
}

/**
 * `get_product_performance()` — which products sold, over a period, for one branch. Line value is
 * before order-level discounts and tax, so its total can differ from gross revenue; refunds are
 * not attributed to products; no cost or margin (AD-022).
 */
export interface ProductPerformance {
  branch_id: Uuid;
  period: ReportPeriod | null;
  start_date: string;
  end_date: string;
  timezone: string;
  order: ProductPerformanceOrder;
  total_line_value: Money;
  /** Every variant sold in the period, even when `rows` is limited. */
  products_sold: number;
  rows: ProductPerformanceRow[];
}

/** Who a sales breakdown was computed for (Q4, owner decision 2026-09-17). */
export type SalesBreakdownScope = 'full' | 'branch' | 'own';

export const SALES_BREAKDOWN_METHODS = ['cash', 'transfer', 'pos', 'card', 'credit'] as const;
export type SalesBreakdownMethod = (typeof SALES_BREAKDOWN_METHODS)[number];

export interface SalesMethodRow {
  method: SalesBreakdownMethod;
  payments: number;
  gross_collected: Money;
  refunds: Money;
  /** Can be negative. */
  net_collected: Money;
}

export interface SalesStaffRow {
  profile_id: Uuid | null;
  full_name: string | null;
  completed_tickets: number;
  gross_sales: Money;
  /** Share of the listed sales, `NN.NN`, server-computed. */
  share_pct: string;
}

export interface SalesRecentRow {
  ticket_id: Uuid;
  ticket_number: string;
  completed_at: string;
  total_amount: Money;
  customer_name: string | null;
  /** Null in a supervisor's view (no per-person figures). */
  seller_name: string | null;
  methods: SalesBreakdownMethod[];
}

/**
 * `get_sales_breakdown()` — P9.9 Q4. `full`: every seller and method (owner, admin, the branch's
 * manager); `branch`: totals and methods, no per-person figures (supervisor); `own`: only the caller's
 * sales (cashier, driver). `by_staff` is null for `branch`.
 */
export interface SalesBreakdown {
  branch_id: Uuid;
  period: ReportPeriod | null;
  start_date: string;
  end_date: string;
  timezone: string;
  scope: SalesBreakdownScope;
  totals: {
    gross_sales: Money;
    completed_tickets: number;
    gross_collected: Money;
    refunds: Money;
    net_collected: Money;
  };
  by_method: SalesMethodRow[];
  by_staff: SalesStaffRow[] | null;
  recent: SalesRecentRow[];
}

export interface BranchPerformanceRow {
  branch_id: Uuid;
  name: string;
  code: string;
  is_primary: boolean;
  gross_revenue: Money;
  refunds: Money;
  net_revenue: Money;
  net_collected: Money;
  completed_tickets: number;
  staff_count: number;
  /** Share of the listed branches' net revenue, `NN.NN`. */
  share_pct: string;
  /** Net revenue for the 7 organization-local days ending at the period end, oldest first. */
  trend: { date: string; net_revenue: Money }[];
}

/**
 * `get_branch_performance()` — P9.9 Q3. `all` for owner/admin; `managed` for a branch manager (only
 * branches they manage). Branches ordered by net revenue, highest first.
 */
export interface BranchPerformance {
  period: ReportPeriod | null;
  start_date: string;
  end_date: string;
  timezone: string;
  scope: 'all' | 'managed';
  totals: {
    gross_revenue: Money;
    refunds: Money;
    net_revenue: Money;
    net_collected: Money;
    completed_tickets: number;
    branch_count: number;
  };
  branches: BranchPerformanceRow[];
}
