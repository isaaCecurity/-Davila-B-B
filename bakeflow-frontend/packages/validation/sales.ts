/**
 * Zod schemas for the sales read models — P4.4.
 *
 * **Provenance caveat, same as `@bakeflow/types` `sales.ts`:** these mirror
 * `docs/SCHEMA-REFERENCE.md` §4 and `docs/STATE-MACHINES.md` §1 rather than a live
 * `pg_constraint` read — the Supabase connector available to this session is authorized
 * against a different account and cannot reach project `tvfyxpafbpnkneujcnvr`
 * (BLOCKER-011). Verify before P4.4 is marked COMPLETE.
 *
 * Where a documented constraint is ambiguous these schemas take the **looser** option, on
 * the principle the inventory milestone proved the hard way: a reader stricter than the
 * database rejects rows the writer legitimately stored, and one such row fails the whole
 * list rather than one field.
 *
 * ## What is deliberately *not* validated here
 *
 * `tickets` carries a live `CHECK (total_amount = subtotal_amount - discount_amount +
 * tax_amount)`. This module does **not** re-check it. Doing so would require decimal
 * arithmetic on the branded money strings, and `@bakeflow/types` `scalars.ts` is explicit
 * that arithmetic on those values needs a decimal library — a new dependency, and
 * therefore a decision rather than an implementation detail. `parseFloat` on money to
 * satisfy a validator would defeat the precision strategy the validator exists to protect.
 * The database has already enforced the identity; re-deriving it in JavaScript could only
 * ever be less correct.
 */

import {
  SALE_CUSTOMER_TYPES,
  TICKET_FULFILMENT_TYPES,
  TICKET_STATUSES,
} from '@bakeflow/types';
import { z } from 'zod';

import {
  nonNegativeMoneySchema,
  positiveQuantitySchema,
  timestamptzSchema,
  uuidSchema,
} from './decimal';

/** Columns shared by all three sales read models. */
const readModelBase = {
  id: uuidSchema,
  tenant_id: uuidSchema,
  created_at: timestamptzSchema,
  updated_at: timestamptzSchema,
};

/**
 * `customers`.
 *
 * Documented constraints: `full_name TEXT NOT NULL`, `is_walk_in BOOLEAN NOT NULL DEFAULT
 * false`, everything else nullable, index on `(tenant_id, phone)`. No `branch_id`.
 *
 * Verified live 2026-08-15 — the constraints are tighter than §4 described:
 *
 * ```
 * customers_full_name_check  CHECK (length(btrim(full_name)) > 0)
 * customers_name_length      CHECK (length(btrim(full_name)) BETWEEN 1 AND 200)
 * customers_phone_length     CHECK (phone IS NULL OR length(phone) <= 40)
 * customers_email_length     CHECK (email IS NULL OR length(email) <= 320)
 * customers_notes_length     CHECK (notes IS NULL OR length(notes) <= 2000)
 * ```
 *
 * A `btrim` CHECK **does** exist, so `full_name` is checked on its trimmed length rather
 * than with `.min(1)`. The lengths are mirrored because they are cheap and they turn a
 * silently truncated or corrupted payload into a boundary error.
 *
 * `email` is deliberately **not** `z.email()`. The live constraint is a length bound, not
 * a format one, and bakery staff enter partial addresses; rejecting them at read time
 * would hide the customer entirely rather than surface a bad field. Format checking
 * belongs to the write path, against the value being submitted.
 */
export const customerSchema = z.object({
  ...readModelBase,
  full_name: z.string().trim().min(1).max(200),
  phone: z.string().max(40).nullable(),
  email: z.string().max(320).nullable(),
  address_line: z.string().nullable(),
  notes: z.string().max(2000).nullable(),
  is_walk_in: z.boolean(),
});

/**
 * `tickets`.
 *
 * ### Money — every column is non-negative, verified live 2026-08-15
 *
 * `subtotal_amount`, `discount_amount`, `tax_amount`, `total_amount` and `amount_paid` all
 * carry `CHECK (... >= 0)`. §4 listed the check on only some of them; that was an
 * omission, and the briefly-added `signedMoneySchema` has been removed.
 *
 * `tickets_discount_within_subtotal CHECK (discount_amount <= subtotal_amount)` also
 * exists and is **not** mirrored: comparing two money values needs decimal arithmetic on
 * branded strings, which `@bakeflow/types` `scalars.ts` forbids without a decimal library.
 * Same reason `total_amount = subtotal - discount + tax` is not re-derived — and
 * `total_amount` is `GENERATED ALWAYS ... STORED`, so the database is the only writer.
 *
 * ### `revision`
 *
 * `BIGINT NOT NULL CHECK (revision > 0)`, and the one column in this domain deliberately
 * typed as a JavaScript `number`. PostgREST renders `int8` unquoted, so it arrives already
 * parsed; there is nothing a `::text` cast could rescue that has not already happened.
 * Unlike money this is safe: a per-ticket monotonic edit counter cannot approach 2^53.
 *
 * ### `cancelled_reason`
 *
 * Two live constraints say the same thing — `tickets_cancelled_needs_reason` and
 * `tickets_cancel_reason_required`, both `status <> 'cancelled' OR btrim(...) <> ''`. The
 * refinement mirrors them, scoped to `cancelled` alone and deliberately not extended to
 * `archived`: that a ticket reaches `archived` only *through* `cancelled` is an inference
 * from the state machine, not a constraint, and this schema does not enforce inferences.
 */
export const ticketSchema = z
  .object({
    ...readModelBase,
    branch_id: uuidSchema,
    customer_id: uuidSchema.nullable(),
    ticket_number: z.string().min(1),
    status: z.enum(TICKET_STATUSES),
    fulfilment_type: z.enum(TICKET_FULFILMENT_TYPES),
    due_at: timestamptzSchema.nullable(),
    subtotal_amount: nonNegativeMoneySchema,
    discount_amount: nonNegativeMoneySchema,
    tax_amount: nonNegativeMoneySchema,
    total_amount: nonNegativeMoneySchema,
    amount_paid: nonNegativeMoneySchema,
    cancelled_reason: z.string().nullable(),
    assigned_to: uuidSchema.nullable(),
    correction_of_ticket_id: uuidSchema.nullable(),
    sale_customer_type: z.enum(SALE_CUSTOMER_TYPES),
    archived_at: timestamptzSchema.nullable(),
    archived_by: uuidSchema.nullable(),
    archive_reason: z.string().nullable(),
    device_created_at: timestamptzSchema.nullable(),
    server_received_at: timestamptzSchema.nullable(),
    revision: z.number().int().positive(),
  })
  .refine(
    (row) =>
      row.status !== 'cancelled' ||
      (row.cancelled_reason !== null && row.cancelled_reason.trim().length > 0),
    {
      error:
        'a cancelled ticket must carry a cancelled_reason (SCHEMA-REFERENCE.md §4); a row ' +
        'violating this cannot exist in the database, so the payload is not what it claims',
      path: ['cancelled_reason'],
    },
  );

/**
 * `ticket_items`.
 *
 * Live constraints, verified 2026-08-15:
 *
 * ```
 * ticket_items_quantity_check    CHECK (quantity   > 0)
 * ticket_items_unit_price_check  CHECK (unit_price >= 0)
 * ```
 *
 * `line_total` has **no constraint of its own because it is `GENERATED ALWAYS ... STORED`**
 * — not, as §4 describes, a written column carrying a `ROUND(quantity * unit_price, 4)`
 * identity CHECK. It cannot be negative, since it is the product of a positive quantity and
 * a non-negative price, and `nonNegativeMoneySchema` states that without arithmetic by
 * inspecting the digit characters.
 *
 * `deleted_at` **does** exist on this table (verified live), contrary to §4 listing `[std]`
 * alone for it. Its SELECT policy filters `deleted_at IS NULL` and reaches through the
 * parent ticket for branch access, so the read query filters it explicitly.
 */
export const ticketItemSchema = z.object({
  ...readModelBase,
  ticket_id: uuidSchema,
  product_variant_id: uuidSchema,
  quantity: positiveQuantitySchema,
  unit_price: nonNegativeMoneySchema,
  line_total: nonNegativeMoneySchema,
});
