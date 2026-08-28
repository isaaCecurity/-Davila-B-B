/**
 * Reporting read path — P9.8, the revenue/cash half of P5.8 (`docs/REPORTING-MODEL.md`).
 *
 * This package's first RPC-backed *read*. Every other `queries/*.ts` module is a plain
 * PostgREST `SELECT`; every existing RPC call lives in a `mutations/*.ts` module because
 * every RPC built before this one happened to also write. `get_daily_revenue_summary()`
 * writes nothing — it is a computed aggregate with no underlying row — so it belongs
 * here, keeping `queries/` meaning "no side effects" rather than "no RPC".
 */

import type { DailyRevenueSummary, Uuid } from '@bakeflow/types';
import { dailyRevenueSummarySchema } from '@bakeflow/validation';

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
 *   an authorized role (owner/admin/branch_manager/cashier/accountant); `invalid_request`
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
