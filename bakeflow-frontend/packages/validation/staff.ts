/**
 * Zod schema for the driver-picker read model — P9.6.
 *
 * See `@bakeflow/types` `staff.ts` for why the shape is this narrow: `status` is filtered
 * server-side rather than carried, and `branch_id` is omitted because `transition_delivery`
 * assigns tenant-wide, not per-branch.
 */

import { z } from 'zod';

import { uuidSchema } from './decimal';

export const driverSchema = z.object({
  profile_id: uuidSchema,
  full_name: z.string().min(1),
  phone: z.string().nullable(),
});
