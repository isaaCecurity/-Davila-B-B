/**
 * Reporting read path — P9.8, the revenue/cash half of P5.8 (`docs/REPORTING-MODEL.md`).
 *
 * This package's first RPC-backed *read*. Every other `queries/*.ts` module is a plain
 * PostgREST `SELECT`; every existing RPC call lives in a `mutations/*.ts` module because
 * every RPC built before this one happened to also write. `get_daily_revenue_summary()`
 * writes nothing — it is a computed aggregate with no underlying row — so it belongs
 * here, keeping `queries/` meaning "no side effects" rather than "no RPC".
 */

import type {
  BranchPerformance,
  DailyRevenueSummary,
  ProductPerformance,
  ProductPerformanceOrder,
  ReportPeriod,
  RevenueReport,
  SalesBreakdown,
  Uuid,
} from '@bakeflow/types';
import {
  branchPerformanceSchema,
  dailyRevenueSummarySchema,
  productPerformanceSchema,
  revenueReportSchema,
  salesBreakdownSchema,
} from '@bakeflow/validation';

import type { BakeflowClient } from '../client';
import { BakeflowApiError } from '../errors';
import { parseRow, run } from '../internal/read';

/**
 * The organization-local daily revenue/cash summary for one branch.
 *
 * `date`, when omitted, resolves server-side to "today in the organization's own
 * timezone" — never the device's local date, per `REPORTING-MODEL.md` §13. Pass an
 * explicit `YYYY-MM-DD` to look at a different day.
 *
 * @throws {BakeflowApiError} `insufficient_role` when the caller lacks branch access or
 *   an authorized role (owner/admin/branch_manager/cashier); `invalid_request`
 *   when there is no active organization.
 */
export async function getDailyRevenueSummary(
  client: BakeflowClient,
  branchId: Uuid,
  date?: string,
): Promise<DailyRevenueSummary> {
  const payload = await run(
    client.rpc('get_daily_revenue_summary', {
      p_branch_id: branchId,
      p_date: date ?? null,
    }),
  );
  const parsed = parseRow(dailyRevenueSummarySchema, payload, 'getDailyRevenueSummary');
  if (parsed === null) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: 'getDailyRevenueSummary: the RPC returned no envelope',
    });
  }
  return parsed;
}

/**
 * Revenue and cash for one branch over a period — `get_revenue_report()` (P9.9 Q1).
 *
 * The server resolves `period` in the organization's timezone and returns the totals plus one row
 * per organization-local day (oldest first), each identical to that day's
 * `get_daily_revenue_summary()`. Totals are summed server-side; nothing is added up here.
 *
 * @throws {BakeflowApiError} `insufficient_role` without branch access or an authorized role
 *   (owner/admin/branch_manager/cashier); `invalid_request` for an unknown period or
 *   when there is no active organization.
 */
export async function getRevenueReport(
  client: BakeflowClient,
  branchId: Uuid,
  period: ReportPeriod,
): Promise<RevenueReport> {
  const payload = await run(client.rpc('get_revenue_report', { p_branch_id: branchId, p_period: period }));
  const parsed = parseRow(revenueReportSchema, payload, 'getRevenueReport');
  if (parsed === null) {
    throw new BakeflowApiError({ code: 'response_shape_invalid', message: 'getRevenueReport: the RPC returned no envelope' });
  }
  return parsed;
}

/**
 * Which products sold, for one branch over a period — `get_product_performance()` (P9.9 Q2).
 *
 * Ranked by line value (`value`) or by quantity (`units`). Line value is quantity × unit price
 * before order-level discounts and tax, so its total can differ from gross revenue. Shares are
 * computed server-side. At most `limit` rows (1–200); `products_sold` counts them all.
 *
 * @throws {BakeflowApiError} as `getRevenueReport`.
 */
export async function getProductPerformance(
  client: BakeflowClient,
  branchId: Uuid,
  period: ReportPeriod,
  order: ProductPerformanceOrder = 'value',
  limit = 100,
): Promise<ProductPerformance> {
  const payload = await run(
    client.rpc('get_product_performance', {
      p_branch_id: branchId,
      p_period: period,
      p_order: order,
      p_limit: Math.min(Math.max(Math.trunc(limit), 1), 200),
    }),
  );
  const parsed = parseRow(productPerformanceSchema, payload, 'getProductPerformance');
  if (parsed === null) {
    throw new BakeflowApiError({ code: 'response_shape_invalid', message: 'getProductPerformance: the RPC returned no envelope' });
  }
  return parsed;
}

/**
 * Sales by payment method and by staff member for one branch — `get_sales_breakdown()` (P9.9 Q4).
 * What comes back depends on the caller (`scope`): owner/admin/the branch's manager everything,
 * supervisors no per-person figures, cashiers and drivers only their own sales.
 *
 * @throws {BakeflowApiError} `insufficient_role` without branch access or for a role with no view.
 */
export async function getSalesBreakdown(
  client: BakeflowClient,
  branchId: Uuid,
  period: ReportPeriod = 'today',
): Promise<SalesBreakdown> {
  const payload = await run(client.rpc('get_sales_breakdown', { p_branch_id: branchId, p_period: period }));
  const parsed = parseRow(salesBreakdownSchema, payload, 'getSalesBreakdown');
  if (parsed === null) {
    throw new BakeflowApiError({ code: 'response_shape_invalid', message: 'getSalesBreakdown: the RPC returned no envelope' });
  }
  return parsed;
}

/**
 * Branches side by side — `get_branch_performance()` (P9.9 Q3). Owner/admin: every branch; branch
 * manager: the branches they manage. Each branch carries a 7-day net revenue trend.
 *
 * @throws {BakeflowApiError} `insufficient_role` for any other role.
 */
export async function getBranchPerformance(client: BakeflowClient, period: ReportPeriod = 'today'): Promise<BranchPerformance> {
  const payload = await run(client.rpc('get_branch_performance', { p_period: period }));
  const parsed = parseRow(branchPerformanceSchema, payload, 'getBranchPerformance');
  if (parsed === null) {
    throw new BakeflowApiError({ code: 'response_shape_invalid', message: 'getBranchPerformance: the RPC returned no envelope' });
  }
  return parsed;
}
