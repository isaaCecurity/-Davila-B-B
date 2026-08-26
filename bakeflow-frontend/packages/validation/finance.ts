import { CASH_SESSION_STATUSES } from '@bakeflow/types';
import { z } from 'zod';

import {
  nonNegativeMoneySchema,
  signedMoneySchema,
  timestamptzSchema,
  uuidSchema,
} from './decimal';

export const cashSessionSchema = z.object({
  id: uuidSchema,
  tenant_id: uuidSchema,
  branch_id: uuidSchema,
  opened_by: uuidSchema,
  closed_by: uuidSchema.nullable(),
  opening_float: nonNegativeMoneySchema,
  expected_amount: nonNegativeMoneySchema.nullable(),
  counted_amount: nonNegativeMoneySchema.nullable(),
  variance_amount: signedMoneySchema.nullable(),
  variance_note: z.string().nullable(),
  status: z.enum(CASH_SESSION_STATUSES),
  opened_at: timestamptzSchema,
  closed_at: timestamptzSchema.nullable(),
  created_at: timestamptzSchema,
  updated_at: timestamptzSchema,
  revision: z.number().int().positive(),
});