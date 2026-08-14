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
 * Verified live 2026-08-15 — the constraint set is richer than §5 records:
 *
 * ```
 * CHECK (planned_quantity > 0)
 * CHECK (actual_quantity  >= 0)
 * CHECK (status <> 'failed'    OR btrim(failure_reason) <> '')
 * CHECK (status <> 'completed' OR actual_quantity IS NOT NULL)
 * CHECK (status =  'completed' AND completed_at IS NOT NULL AND actual_quantity IS NOT NULL
 *        OR status <> 'completed')
 * CHECK (actual_quantity IS NULL OR actual_quantity <= planned_quantity)
 * UNIQUE (tenant_id, batch_number)
 * ```
 *
 * `actual_quantity` was `signedQuantitySchema` on the reasoning that §5 recorded no bound
 * and that `quantity_on_hand` had already burned that assumption once. **The bound exists**
 * — that was the right instinct applied to the wrong column — so it is now non-negative,
 * with the constraint as the evidence the earlier comment asked for.
 *
 * `actual_quantity <= planned_quantity` is **not** mirrored: comparing two branded decimal
 * strings needs a decimal library, which `@bakeflow/types` `scalars.ts` forbids reaching
 * for casually. The database enforces it; a reader cannot improve on that.
 */
export const productionBatchSchema = z
  .object({
    ...readModelBase,
    branch_id: uuidSchema,
    batch_number: z.string().min(1),
    recipe_id: uuidSchema,
    ticket_id: uuidSchema.nullable(),
    planned_quantity: positiveQuantitySchema,
    actual_quantity: nonNegativeQuantitySchema.nullable(),
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
  )
  .refine((row) => row.status !== 'completed' || row.actual_quantity !== null, {
    error:
      'a completed batch must carry an actual_quantity (two live CHECKs enforce this); a ' +
      'row violating it cannot exist in the database, so the payload is not what it claims',
    path: ['actual_quantity'],
  });

/**
 * `production_batch_ingredients`.
 *
 * Documented constraints: `planned_quantity NUMERIC(18,4) NOT NULL`,
 * `waste_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK >= 0`, unique
 * `(batch_id, ingredient_id)`. No `branch_id` — the row is reached through its batch.
 *
 * Verified live 2026-08-15: `planned_quantity > 0`, `actual_quantity >= 0`,
 * `waste_quantity >= 0`, `UNIQUE (batch_id, ingredient_id)`.
 *
 * `planned_quantity` was `nonNegative` here, on the reading that §5 records `NOT NULL` but
 * no `> 0` CHECK for this table while stating one for `production_batches` — an asymmetry
 * deliberately preserved on the theory that a zero-planned line was how an unneeded recipe
 * ingredient would appear. **There is no asymmetry**: both carry `> 0`, so a zero-planned
 * line cannot exist and the schema now says so.
 */
export const productionBatchIngredientSchema = z.object({
  ...readModelBase,
  batch_id: uuidSchema,
  ingredient_id: uuidSchema,
  planned_quantity: positiveQuantitySchema,
  actual_quantity: nonNegativeQuantitySchema.nullable(),
  waste_quantity: nonNegativeQuantitySchema,
});
