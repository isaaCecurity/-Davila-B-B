import { z } from 'zod';

import { nonNegativeMoneySchema, signedMoneySchema, uuidSchema } from './decimal';

/** `YYYY-MM-DD`, as Postgres renders a `date` inside a jsonb payload. */
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date, YYYY-MM-DD');

/** Mirrors `get_daily_revenue_summary()`'s jsonb envelope — every money field is cast to
 *  `::text` server-side (see the RPC's own migration comment), so this schema never sees
 *  a bare JSON number for a money value. */
export const dailyRevenueSummarySchema = z.object({
  branch_id: uuidSchema,
  reporting_date: dateOnlySchema,
  timezone: z.string(),
  gross_revenue: nonNegativeMoneySchema,
  recognized_refunds: nonNegativeMoneySchema,
  net_revenue: signedMoneySchema,
  gross_collected: nonNegativeMoneySchema,
  refunds_paid: nonNegativeMoneySchema,
  net_collected: signedMoneySchema,
});
