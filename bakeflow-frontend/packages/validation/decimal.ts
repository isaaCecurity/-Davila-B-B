/**
 * Zod schemas for exact decimal values.
 *
 * Written against **zod 4.1.12** (the installed version — verified, not assumed). Zod 4
 * moved several checks to top-level factories: `z.uuid()` rather than
 * `z.string().uuid()`, `z.iso.datetime()` rather than `z.string().datetime()`.
 *
 * Every schema here takes a **string** and returns a **branded string**. None of them
 * parses to `number` at any point — see `@bakeflow/types` `scalars.ts` for why, and for
 * the executed evidence that JSON transport silently drops `NUMERIC` scale.
 *
 * Sign and zero checks are performed on the digit characters directly
 * (`isNegativeDecimalString`, `isZeroDecimalString`), never by numeric comparison, so a
 * value too large for a double is still classified correctly.
 */

import {
  MONEY_PATTERN,
  QUANTITY_PATTERN,
  isNegativeDecimalString,
  isZeroDecimalString,
  type Money,
  type Quantity,
} from '@bakeflow/types';
// Deep import on purpose: the unsafe branding helpers are kept out of the
// '@bakeflow/types' barrel so this module is their only realistic caller. See the note
// in packages/types/index.ts.
import { unsafeMoney, unsafeQuantity } from '@bakeflow/types/scalars';
import { z } from 'zod';

const MONEY_MESSAGE =
  'must be an exact NUMERIC(19,4) decimal string (max 15 integer digits, 4 decimals); ' +
  'select it with a ::text cast so scale survives JSON transport';

const QUANTITY_MESSAGE =
  'must be an exact NUMERIC(18,4) decimal string (max 14 integer digits, 4 decimals); ' +
  'select it with a ::text cast so scale survives JSON transport';

/**
 * Rejects a JSON number outright with an actionable message.
 *
 * This is the tripwire for the whole precision strategy. If someone removes a `::text`
 * cast from a select string, PostgREST returns `184500` instead of `"184500.0000"` and
 * this fires — loudly, at the boundary — instead of the value silently losing its scale
 * and flowing onward as a corrupted double.
 */
const exactDecimalString = z.string({
  error: (issue) =>
    typeof issue.input === 'number'
      ? 'received a JSON number where an exact decimal string was required — the ' +
        'column is missing its ::text cast in the PostgREST select, and its scale has ' +
        'already been lost'
      : undefined,
});

// Signed quantity variants were deliberately absent while catalog was the only consumer,
// to be added "when a signed column exists". P4.2 is that moment: `stock_movements`
// records both directions of the ledger, and `*_stock_levels.quantity_on_hand` has **no**
// non-negative CHECK live, so both must accept a leading '-'.
//
// Signed *money* arrived with P4.4. Through P4.3 every money column carried an explicit
// `CHECK (value >= 0)` — `product_variants.unit_price`, `stock_movements.unit_cost` — so
// `nonNegativeMoneySchema` covered the whole surface. The sales tables break that: §4
// documents `CHECK >= 0` on `tickets.discount_amount`, `tickets.tax_amount`,
// `tickets.total_amount` and `ticket_items.line_total`, and documents **no** check on
// `tickets.subtotal_amount`, `tickets.amount_paid` or `ticket_items.unit_price`. See
// `signedMoneySchema` for why that asymmetry is preserved rather than smoothed over.

/** `NUMERIC(19,4) CHECK (value >= 0)` — e.g. `product_variants.unit_price`. */
export const nonNegativeMoneySchema = exactDecimalString
  .regex(MONEY_PATTERN, MONEY_MESSAGE)
  .refine((value) => !isNegativeDecimalString(value), 'must be >= 0')
  .transform((value): Money => unsafeMoney(value));

/**
 * `NUMERIC(19,4)` with **no sign constraint** — `tickets.subtotal_amount`,
 * `tickets.amount_paid`, `ticket_items.unit_price`.
 *
 * The `signedQuantitySchema` precedent applies exactly: a reader stricter than the
 * database rejects rows the writer legitimately stored, and the failure surfaces as an
 * entire ticket list refusing to load rather than as one bad field. `quantity_on_hand` is
 * the worked example — it was assumed non-negative, turned out not to be, and a
 * non-negative schema would have failed on real rows.
 *
 * `SCHEMA-REFERENCE.md` §4 lists `CHECK >= 0` beside `discount_amount`, `tax_amount`,
 * `total_amount` and `line_total`, and lists none beside these three. That asymmetry is
 * treated as information, not as an omission. Tighten only against a live `pg_constraint`
 * read — with the constraint as the evidence.
 */
export const signedMoneySchema = exactDecimalString
  .regex(MONEY_PATTERN, MONEY_MESSAGE)
  .transform((value): Money => unsafeMoney(value));

/** `NUMERIC(18,4) CHECK (value >= 0)` — e.g. `ingredients.reorder_level`. */
export const nonNegativeQuantitySchema = exactDecimalString
  .regex(QUANTITY_PATTERN, QUANTITY_MESSAGE)
  .refine((value) => !isNegativeDecimalString(value), 'must be >= 0')
  .transform((value): Quantity => unsafeQuantity(value));

/**
 * `NUMERIC(18,4) CHECK (value > 0)` — e.g. `recipes.yield_quantity`,
 * `recipe_ingredients.quantity`. Strictly positive: zero is rejected.
 */
export const positiveQuantitySchema = exactDecimalString
  .regex(QUANTITY_PATTERN, QUANTITY_MESSAGE)
  .refine(
    (value) => !isNegativeDecimalString(value) && !isZeroDecimalString(value),
    'must be > 0',
  )
  .transform((value): Quantity => unsafeQuantity(value));

/**
 * `NUMERIC(18,4)` with **no sign constraint** — e.g. `ingredient_stock_levels
 * .quantity_on_hand`, `product_stock_levels.quantity_on_hand`.
 *
 * Verified live 2026-08-11: neither level table has a `>= 0` CHECK on `quantity_on_hand`,
 * and negative levels are genuinely reachable. The policy is enforced in
 * `apply_stock_movement()`, not by a constraint, and it is conditional:
 *
 * - `sale` and `production_consume` may **never** drive stock negative, whatever the
 *   organization setting — the trigger raises `insufficient_stock` (P0001).
 * - `waste` and `adjustment` may, but only where `organizations.allow_negative_stock`
 *   is true.
 *
 * So an opted-in bakery legitimately stores a negative `quantity_on_hand`, and a schema
 * rejecting negatives would make the *reader* fail on a row the writer stored happily —
 * the exact failure mode `catalog.ts`'s `btrim` note warns about. Proven by
 * `tests/sql/inventory_read_rls.sql` I10 (a waste movement takes a level to `-42.5000`)
 * and I11 (a sale is refused even with the setting on), both executed.
 */
export const signedQuantitySchema = exactDecimalString
  .regex(QUANTITY_PATTERN, QUANTITY_MESSAGE)
  .transform((value): Quantity => unsafeQuantity(value));

/**
 * `NUMERIC(18,4) CHECK (value <> 0)` — `stock_movements.quantity_delta`.
 *
 * Signed, because the ledger's direction *is* the sign: `purchase`, `production_output`,
 * `transfer_in` and `opening_balance` are `> 0`; `production_consume`, `sale`, `waste`
 * and `transfer_out` are `< 0` (live CHECK `stock_movements_sign_matches_reason`).
 * `adjustment` may be either, which is why the per-reason sign rule is not reproduced
 * here — see `inventory.ts`, where it is enforced against the reason.
 */
export const nonZeroQuantitySchema = exactDecimalString
  .regex(QUANTITY_PATTERN, QUANTITY_MESSAGE)
  .refine((value) => !isZeroDecimalString(value), 'must not be 0')
  .transform((value): Quantity => unsafeQuantity(value));

/** A `uuid` column. */
export const uuidSchema = z.uuid();

/** A `timestamptz` column, as PostgREST renders it. */
export const timestamptzSchema = z.iso.datetime({ offset: true });
