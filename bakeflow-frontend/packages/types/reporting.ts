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
