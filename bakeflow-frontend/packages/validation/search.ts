import { TICKET_STATUSES } from '@bakeflow/types';
import { z } from 'zod';

import { nonNegativeMoneySchema, timestamptzSchema, uuidSchema } from './decimal';

/** Mirrors `search_workspace()` (P9.9 Q6); money arrives as `numeric(19,4)::text`. */
export const workspaceSearchSchema = z.object({
  query: z.string(),
  customers: z.array(z.object({ id: uuidSchema, full_name: z.string(), phone: z.string().nullable() })),
  orders: z.array(
    z.object({
      id: uuidSchema,
      ticket_number: z.string(),
      status: z.enum(TICKET_STATUSES),
      total_amount: nonNegativeMoneySchema,
      created_at: timestamptzSchema,
      customer_name: z.string().nullable(),
    }),
  ),
  products: z.array(
    z.object({
      id: uuidSchema,
      name: z.string(),
      variant_count: z.number().int().nonnegative(),
      price_from: nonNegativeMoneySchema.nullable(),
    }),
  ),
});
