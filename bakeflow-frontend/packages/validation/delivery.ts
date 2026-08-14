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
 * ### Three refinements, all mirroring live CHECK constraints
 *
 * Verified 2026-08-15:
 *
 * ```
 * deliveries_failed_needs_reason   CHECK (status <> 'failed'    OR btrim(failure_reason) <> '')
 * deliveries_delivered_needs_proof CHECK (status <> 'delivered' OR btrim(proof_url) <> ''
 *                                                               OR btrim(recipient_name) <> '')
 * deliveries_assigned_needs_driver CHECK (status NOT IN ('assigned','in_transit')
 *                                                               OR driver_id IS NOT NULL)
 * ```
 *
 * The proof rule was initially left out of this schema on the reasoning that §3 states it
 * as a *transition* precondition — checked at the `in_transit → delivered` hop — and that a
 * delivered row could later lose its `proof_url` to an expiring storage object, which a
 * reader enforcing it would then hide entirely.
 *
 * **That reasoning was wrong: it is a standing table CHECK**, so the row that would have
 * been hidden cannot exist. Postgres re-validates the constraint on every UPDATE, so
 * clearing `proof_url` on a delivered row is itself refused unless `recipient_name` is set.
 * The distinction between a transition precondition and a standing invariant is real and
 * worth drawing — this just is not an instance of it, and only the database could say so.
 *
 * `deliveries_assigned_needs_driver` is modelled as a discriminated pairing rather than a
 * bare refinement: an `assigned` or `in_transit` delivery always has a driver, so callers
 * get a non-null `driver_id` by narrowing on `status` instead of asserting.
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
    address_line: z.string().trim().min(1).max(1000),
    contact_phone: z.string().nullable(),
    scheduled_at: timestamptzSchema.nullable(),
    dispatched_at: timestamptzSchema.nullable(),
    delivered_at: timestamptzSchema.nullable(),
    proof_url: z.string().nullable(),
    recipient_name: z.string().max(200).nullable(),
    failure_reason: z.string().max(1000).nullable(),
    created_at: timestamptzSchema,
    updated_at: timestamptzSchema,
  })
  .refine(
    (row) =>
      row.status !== 'failed' ||
      (row.failure_reason !== null && row.failure_reason.trim().length > 0),
    {
      error:
        'a failed delivery must carry a failure_reason (deliveries_failed_needs_reason); a ' +
        'row violating this cannot exist in the database, so the payload is not what it claims',
      path: ['failure_reason'],
    },
  )
  .refine(
    (row) =>
      row.status !== 'delivered' ||
      (row.proof_url ?? '').trim().length > 0 ||
      (row.recipient_name ?? '').trim().length > 0,
    {
      error:
        'a delivered delivery must carry a proof_url or a recipient_name ' +
        '(deliveries_delivered_needs_proof); a row violating this cannot exist in the ' +
        'database, so the payload is not what it claims',
      path: ['proof_url'],
    },
  )
  .refine(
    (row) =>
      (row.status !== 'assigned' && row.status !== 'in_transit') || row.driver_id !== null,
    {
      error:
        'an assigned or in-transit delivery must carry a driver_id ' +
        '(deliveries_assigned_needs_driver); a row violating this cannot exist in the ' +
        'database, so the payload is not what it claims',
      path: ['driver_id'],
    },
  );
