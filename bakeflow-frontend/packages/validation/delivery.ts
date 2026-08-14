/**
 * Zod schema for the delivery read model — P4.5.
 *
 * **Provenance caveat, same as `@bakeflow/types` `delivery.ts`:** mirrors
 * `docs/SCHEMA-REFERENCE.md` §6 and `docs/STATE-MACHINES.md` §3 rather than a live
 * `pg_constraint` read (BLOCKER-011). Verify before P4.5 is marked COMPLETE.
 *
 * Looser where the documented constraint is ambiguous, on the established principle: a
 * reader stricter than the database rejects rows the writer legitimately stored, and one
 * such row fails the entire list rather than one field.
 */

import { DELIVERY_STATUSES } from '@bakeflow/types';
import { z } from 'zod';

import { timestamptzSchema, uuidSchema } from './decimal';

/**
 * `deliveries`.
 *
 * Documented constraints: `ticket_id NOT NULL UNIQUE`, `branch_id NOT NULL`,
 * `address_line TEXT NOT NULL`, `status` one of six values with default `'pending'`.
 *
 * ### One refinement, and one deliberately omitted
 *
 * `failure_reason` is required when `status = 'failed'` — the same shape as
 * `production_batches.failure_reason` and `tickets.cancelled_reason`, and refined the same
 * way.
 *
 * The `proof_url` **or** `recipient_name` requirement on a `delivered` row is **not**
 * refined here, even though §3 states it. It is a *transition* precondition, checked by the
 * guard at the moment of the `in_transit → delivered` hop, not a table CHECK. Nothing stops
 * a legitimately delivered row later having its `proof_url` cleared — a storage object
 * expiring, a retention job, a correction — and a reader enforcing it would then hide a
 * completed delivery entirely. The distinction between a transition precondition and a
 * standing invariant is exactly what a read schema must not blur.
 *
 * ### No `::text` casts
 *
 * `deliveries` has no `NUMERIC` column, so the projection derived from this schema contains
 * no cast at all. That is expected, not an omission — see the module header in
 * `@bakeflow/types` `delivery.ts`.
 */
export const deliverySchema = z
  .object({
    id: uuidSchema,
    tenant_id: uuidSchema,
    branch_id: uuidSchema,
    ticket_id: uuidSchema,
    driver_id: uuidSchema.nullable(),
    status: z.enum(DELIVERY_STATUSES),
    address_line: z.string().min(1),
    contact_phone: z.string().nullable(),
    scheduled_at: timestamptzSchema.nullable(),
    dispatched_at: timestamptzSchema.nullable(),
    delivered_at: timestamptzSchema.nullable(),
    proof_url: z.string().nullable(),
    recipient_name: z.string().nullable(),
    failure_reason: z.string().nullable(),
    created_at: timestamptzSchema,
    updated_at: timestamptzSchema,
  })
  .refine(
    (row) =>
      row.status !== 'failed' ||
      (row.failure_reason !== null && row.failure_reason.trim().length > 0),
    {
      error:
        'a failed delivery must carry a failure_reason (STATE-MACHINES.md §3); a row ' +
        'violating this cannot exist in the database, so the payload is not what it claims',
      path: ['failure_reason'],
    },
  );
