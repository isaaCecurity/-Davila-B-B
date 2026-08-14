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

import { TICKET_FULFILMENT_TYPES, TICKET_STATUSES } from '@bakeflow/types';
import { z } from 'zod';

import {
  nonNegativeMoneySchema,
  positiveQuantitySchema,
  signedMoneySchema,
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
 * `full_name` is `.min(1)` rather than a trimmed-length check. `SCHEMA-REFERENCE.md` §4
 * records `NOT NULL` and no `btrim` CHECK, and the catalog milestone established what
 * happens when a read schema invents one: a legitimately stored `" "` would fail the read
 * of a row the database was happy to write.
 *
 * `email` is **not** `z.email()`. It is `TEXT` with no format constraint live, and bakery
 * staff enter partial or malformed addresses; rejecting them at read time would hide the
 * customer entirely rather than surface a bad field. Format checking belongs to the write
 * path, against the value being submitted.
 */
export const customerSchema = z.object({
  ...readModelBase,
  full_name: z.string().min(1),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address_line: z.string().nullable(),
  notes: z.string().nullable(),
  is_walk_in: z.boolean(),
});

/**
 * `tickets`.
 *
 * ### Money
 *
 * `discount_amount`, `tax_amount` and `total_amount` carry documented `CHECK >= 0` and use
 * `nonNegativeMoneySchema`. `subtotal_amount` and `amount_paid` carry no documented check
 * and use `signedMoneySchema` — see the note on that schema for why the asymmetry is
 * preserved.
 *
 * ### `revision`
 *
 * `BIGINT`, and the one column in this domain deliberately typed as a JavaScript `number`.
 * PostgREST renders `int8` unquoted, so it arrives already parsed; there is nothing a
 * `::text` cast could rescue that has not already happened. Unlike money this is safe: a
 * per-ticket monotonic edit counter cannot approach 2^53, and `.int()` is asserted so a
 * value that somehow lost integrality is caught rather than carried.
 *
 * ### `cancelled_reason`
 *
 * §4 records "Required when status = 'cancelled'", the same phrasing that justified the
 * `failure_reason` refinement on production batches, so it is mirrored here. The check is
 * scoped to `cancelled` alone and deliberately not extended to `archived`: that a ticket
 * can only reach `archived` *through* `cancelled` is an inference from the state machine,
 * not a documented constraint, and this schema does not enforce inferences.
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
    subtotal_amount: signedMoneySchema,
    discount_amount: nonNegativeMoneySchema,
    tax_amount: nonNegativeMoneySchema,
    total_amount: nonNegativeMoneySchema,
    amount_paid: signedMoneySchema,
    cancelled_reason: z.string().nullable(),
    assigned_to: uuidSchema.nullable(),
    correction_of_ticket_id: uuidSchema.nullable(),
    sale_customer_type: z.string().nullable(),
    archived_at: timestamptzSchema.nullable(),
    archived_by: uuidSchema.nullable(),
    archive_reason: z.string().nullable(),
    device_created_at: timestamptzSchema.nullable(),
    server_received_at: timestamptzSchema.nullable(),
    revision: z.number().int(),
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
 * Documented constraints: `quantity NUMERIC(18,4) CHECK > 0`, `unit_price NUMERIC(19,4)
 * NOT NULL` (no sign check documented), `line_total NUMERIC(19,4)` with both
 * `CHECK (line_total = ROUND(quantity * unit_price, 4))` and `CHECK (line_total >= 0)`.
 *
 * The rounding identity is not re-checked — see the module note. `line_total >= 0` is,
 * because it needs no arithmetic: `nonNegativeMoneySchema` inspects the digit characters.
 *
 * No `deleted_at`. §4 lists `[std]` alone for this table, unlike `tickets` which lists
 * `[std] + deleted_at, deleted_by` explicitly. That distinction drives the read query, so
 * it is recorded here rather than left implicit.
 */
export const ticketItemSchema = z.object({
  ...readModelBase,
  ticket_id: uuidSchema,
  product_variant_id: uuidSchema,
  quantity: positiveQuantitySchema,
  unit_price: signedMoneySchema,
  line_total: nonNegativeMoneySchema,
});
