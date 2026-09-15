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
