import { z } from 'zod';

import { nonNegativeMoneySchema, nonNegativeQuantitySchema, signedMoneySchema, uuidSchema } from './decimal';

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

const revenueFiguresShape = {
  gross_revenue: nonNegativeMoneySchema,
  recognized_refunds: nonNegativeMoneySchema,
  net_revenue: signedMoneySchema,
  gross_collected: nonNegativeMoneySchema,
  refunds_paid: nonNegativeMoneySchema,
  net_collected: signedMoneySchema,
  completed_tickets: z.number().int().nonnegative(),
};

const reportPeriodSchema = z.enum(['today', '7d', '30d', '90d', 'month', 'last_month']);

/** Mirrors `get_revenue_report()` (P9.9 Q1); money arrives as `::numeric(19,4)::text`. */
export const revenueReportSchema = z.object({
  branch_id: uuidSchema,
  period: reportPeriodSchema.nullable(),
  start_date: dateOnlySchema,
  end_date: dateOnlySchema,
  timezone: z.string(),
  day_count: z.number().int().positive(),
  totals: z.object(revenueFiguresShape),
  days: z.array(z.object({ date: dateOnlySchema, ...revenueFiguresShape })),
});

/** Mirrors `get_product_performance()` (P9.9 Q2). */
export const productPerformanceSchema = z.object({
  branch_id: uuidSchema,
  period: reportPeriodSchema.nullable(),
  start_date: dateOnlySchema,
  end_date: dateOnlySchema,
  timezone: z.string(),
  order: z.enum(['value', 'units']),
  total_line_value: nonNegativeMoneySchema,
  products_sold: z.number().int().nonnegative(),
  rows: z.array(
    z.object({
      rank: z.number().int().positive(),
      product_variant_id: uuidSchema,
      product_id: uuidSchema,
      product_name: z.string(),
      variant_name: z.string(),
      category_name: z.string().nullable(),
      units: nonNegativeQuantitySchema,
      line_value: nonNegativeMoneySchema,
      orders: z.number().int().nonnegative(),
      value_share_pct: z.string().regex(/^\d{1,3}\.\d{2}$/),
    }),
  ),
});
