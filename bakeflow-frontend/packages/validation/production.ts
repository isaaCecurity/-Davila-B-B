/**
 * Zod schemas for the production read models — P4.3.
 *
 * **Provenance caveat, same as `@bakeflow/types` `production.ts`:** these mirror
 * `docs/SCHEMA-REFERENCE.md` §5 rather than a live `pg_constraint` read, because the
 * database was unreachable when they were written. Verify before P4.3 is COMPLETE.
 *
 * Where the documented constraint is ambiguous these schemas are the *looser* option, on
 * the same principle as the catalog and inventory schemas: a reader stricter than the
 * database rejects rows the writer legitimately stored, and the failure surfaces as an
 * entire list refusing to load.
 */

import { PRODUCTION_BATCH_STATUSES } from '@bakeflow/types';
import { z } from 'zod';

import {
  nonNegativeQuantitySchema,
  positiveQuantitySchema,
  signedQuantitySchema,
  timestamptzSchema,
  uuidSchema,
} from './decimal';

/** Columns shared by both production read models. */
const readModelBase = {
  id: uuidSchema,
  tenant_id: uuidSchema,
  created_at: timestamptzSchema,
  updated_at: timestamptzSchema,
};

/**
 * `production_batches`.
 *
 * Documented constraints: `planned_quantity NUMERIC(18,4) CHECK > 0`, `batch_number`
 * unique per tenant, `status` one of five values, `failure_reason` required when
 * `status = 'failed'`.
 *
 * `actual_quantity` uses `signedQuantitySchema` rather than a non-negative one. Nothing
 * in `SCHEMA-REFERENCE.md` §5 records a `>= 0` CHECK on it, and the inventory milestone
 * established what happens when a read schema invents a bound the database does not have:
 * `quantity_on_hand` turned out to be legitimately negative for opted-in organizations,
 * and a non-negative schema would have failed on real rows. If a live check later shows
 * the constraint exists, tighten it then — with the constraint as evidence.
 */
export const productionBatchSchema = z
  .object({
    ...readModelBase,
    branch_id: uuidSchema,
    batch_number: z.string().min(1),
    recipe_id: uuidSchema,
    ticket_id: uuidSchema.nullable(),
    planned_quantity: positiveQuantitySchema,
    actual_quantity: signedQuantitySchema.nullable(),
    status: z.enum(PRODUCTION_BATCH_STATUSES),
    started_at: timestamptzSchema.nullable(),
    completed_at: timestamptzSchema.nullable(),
    assigned_to: uuidSchema.nullable(),
    failure_reason: z.string().nullable(),
  })
  .refine(
    (row) =>
      row.status !== 'failed' ||
      (row.failure_reason !== null && row.failure_reason.trim().length > 0),
    {
      error:
        'a failed batch must carry a failure_reason (SCHEMA-REFERENCE.md §5); a row ' +
        'violating this cannot exist in the database, so the payload is not what it claims',
      path: ['failure_reason'],
    },
  );

/**
 * `production_batch_ingredients`.
 *
 * Documented constraints: `planned_quantity NUMERIC(18,4) NOT NULL`,
 * `waste_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK >= 0`, unique
 * `(batch_id, ingredient_id)`. No `branch_id` — the row is reached through its batch.
 *
 * `planned_quantity` is `nonNegative` rather than `positive`: §5 records `NOT NULL` but no
 * `> 0` CHECK, unlike `production_batches.planned_quantity` which explicitly has one. The
 * asymmetry is preserved rather than smoothed over, because a zero-planned line is how a
 * recipe ingredient that turned out not to be needed would legitimately appear.
 */
export const productionBatchIngredientSchema = z.object({
  ...readModelBase,
  batch_id: uuidSchema,
  ingredient_id: uuidSchema,
  planned_quantity: nonNegativeQuantitySchema,
  actual_quantity: nonNegativeQuantitySchema.nullable(),
  waste_quantity: nonNegativeQuantitySchema,
});
