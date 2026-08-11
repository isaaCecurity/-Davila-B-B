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
  unsafeMoney,
  unsafeQuantity,
  type Money,
  type Quantity,
} from '@bakeflow/types';
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

/** Any `NUMERIC(19,4)` money value, including negatives. */
export const moneySchema = exactDecimalString
  .regex(MONEY_PATTERN, MONEY_MESSAGE)
  .transform((value): Money => unsafeMoney(value));

/** `NUMERIC(19,4) CHECK (value >= 0)` — e.g. `product_variants.unit_price`. */
export const nonNegativeMoneySchema = exactDecimalString
  .regex(MONEY_PATTERN, MONEY_MESSAGE)
  .refine((value) => !isNegativeDecimalString(value), 'must be >= 0')
  .transform((value): Money => unsafeMoney(value));

/** Any `NUMERIC(18,4)` quantity value. */
export const quantitySchema = exactDecimalString
  .regex(QUANTITY_PATTERN, QUANTITY_MESSAGE)
  .transform((value): Quantity => unsafeQuantity(value));

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

/** A `uuid` column. */
export const uuidSchema = z.uuid();

/** A `timestamptz` column, as PostgREST renders it. */
export const timestamptzSchema = z.iso.datetime({ offset: true });
