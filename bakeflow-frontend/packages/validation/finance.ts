import { CASH_SESSION_STATUSES, EXPENSE_CATEGORIES, EXPENSE_PAID_METHODS } from '@bakeflow/types';
import { z } from 'zod';

import {
  nonNegativeMoneySchema,
  positiveMoneySchema,
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

/** Mirrors `expenses`' live constraints, read 2026-08-28 (`pg_constraint`, `pg_policies`). */
export const expenseSchema = z.object({
  id: uuidSchema,
  tenant_id: uuidSchema,
  branch_id: uuidSchema,
  category: z.enum(EXPENSE_CATEGORIES),
  amount: positiveMoneySchema,
  description: z.string().max(2000).nullable(),
  paid_method: z.enum(EXPENSE_PAID_METHODS).nullable(),
  cash_session_id: uuidSchema.nullable(),
  incurred_at: timestamptzSchema,
  receipt_url: z.string().nullable(),
  created_at: timestamptzSchema,
  updated_at: timestamptzSchema,
  created_by: uuidSchema.nullable(),
});