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
// Signed *money* is still absent. `stock_movements.unit_cost` is
// `CHECK (unit_cost >= 0)`, so no money column permits a negative value yet.

/** `NUMERIC(19,4) CHECK (value >= 0)` — e.g. `product_variants.unit_price`. */
export const nonNegativeMoneySchema = exactDecimalString
  .regex(MONEY_PATTERN, MONEY_MESSAGE)
  .refine((value) => !isNegativeDecimalString(value), 'must be >= 0')
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
 * Verified live 2026-08-11: neither level table has a `>= 0` CHECK on `quantity_on_hand`.
 * Negative stock is therefore representable in the database, and a schema that rejected it
 * would make the *reader* fail on a row the writer stored happily — the exact failure mode
 * `catalog.ts`'s `btrim` note warns about. Whether negative stock should be *permitted*
 * is a write-path policy question (roadmap P4.2, "negative-stock policy"); it is not this
 * schema's business, and guessing it here would silently break oversold-stock reads.
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
