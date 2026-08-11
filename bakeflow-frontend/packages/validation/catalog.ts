/**
 * Zod schemas for the catalog read models — P4.1.
 *
 * These mirror the constraints **as verified live on 2026-08-11** by reading
 * `pg_constraint`, not as documented. Where the live schema has no constraint (for
 * example `product_categories.name` has no maximum length while `products.name` is
 * capped at 200) this file has none either, and says so. Inventing a stricter rule than
 * the database enforces would make the client reject rows the database happily stores.
 *
 * ## What these are for
 *
 * They validate **responses**, not just input. Every row returned by the catalog read
 * service is parsed through the matching schema. That converts an untyped PostgREST
 * payload into a typed value at a single checked boundary, and it is what makes the
 * `::text` money strategy enforceable rather than merely intended.
 */

import { UNITS_OF_MEASURE } from '@bakeflow/types';
import { z } from 'zod';

import {
  nonNegativeMoneySchema,
  nonNegativeQuantitySchema,
  positiveQuantitySchema,
  timestamptzSchema,
  uuidSchema,
} from './decimal';

/**
 * Postgres `btrim(s)` with no second argument, reproduced exactly.
 *
 * **It strips the space character only** — not tabs, newlines, or Unicode whitespace.
 * JavaScript's `String.prototype.trim()` strips all of those, so using it here would
 * make the client *stricter than the database*. Executed live:
 *
 * ```
 * length(btrim(E'\t'))        = 1     length(btrim(E'\n'))    = 1
 * length(btrim(U&'\00A0'))    = 1     length(btrim(' '))      = 0
 * ```
 *
 * A product legitimately named `"\t"` therefore satisfies
 * `CHECK (length(btrim(name)) > 0)` and stores fine — but `.trim()` would score it
 * blank, `parseRows` would reject the row, and the **entire product list** would fail to
 * load. With no write path yet, the only read that could find the offending row is the
 * one that breaks. That is the failure this function exists to prevent, and it is
 * exactly what this file's header warns against.
 */
const btrim = (value: string): string => value.replace(/^ +| +$/g, '');

/** Live: `CHECK (length(btrim(name)) > 0)` on all six tables, plus a per-table cap. */
const trimmedNonEmpty = (maxLength?: number) => {
  const base = z.string().refine((v) => btrim(v).length > 0, 'must not be blank');
  return maxLength === undefined
    ? base
    : base.refine(
        (v) => btrim(v).length <= maxLength,
        `must be at most ${maxLength} characters`,
      );
};

/** Columns shared by every catalog read model. */
const readModelBase = {
  id: uuidSchema,
  tenant_id: uuidSchema,
  created_at: timestamptzSchema,
  updated_at: timestamptzSchema,
};

/**
 * `product_categories`.
 * Live constraints: `name` non-blank (**no maximum length**), `sort_order smallint`.
 */
export const productCategorySchema = z.object({
  ...readModelBase,
  name: trimmedNonEmpty(),
  sort_order: z.number().int().min(-32768).max(32767),
});

/**
 * `products`.
 * Live constraints: `name` 1–200 trimmed, `description` ≤ 4000 (untrimmed — the live
 * check is `length(description) <= 4000`, not `length(btrim(...))`).
 */
export const productSchema = z.object({
  ...readModelBase,
  category_id: uuidSchema.nullable(),
  name: trimmedNonEmpty(200),
  description: z.string().max(4000).nullable(),
  image_url: z.string().nullable(),
  is_active: z.boolean(),
});

/**
 * `product_variants`.
 * Live constraints: `name` 1–150, `sku` 1–80, `unit_price NUMERIC(19,4) >= 0`.
 */
export const productVariantSchema = z.object({
  ...readModelBase,
  product_id: uuidSchema,
  name: trimmedNonEmpty(150),
  sku: trimmedNonEmpty(80),
  unit_price: nonNegativeMoneySchema,
  is_active: z.boolean(),
});

/**
 * `ingredients`.
 * Live constraints: `name` 1–150, `unit_of_measure` ∈ {kg,g,l,ml,unit},
 * `reorder_level NUMERIC(18,4) >= 0`, `last_unit_cost NUMERIC(19,4) >= 0` nullable.
 */
export const ingredientSchema = z.object({
  ...readModelBase,
  name: trimmedNonEmpty(150),
  unit_of_measure: z.enum(UNITS_OF_MEASURE),
  reorder_level: nonNegativeQuantitySchema,
  last_unit_cost: nonNegativeMoneySchema.nullable(),
  is_active: z.boolean(),
});

/**
 * `recipes`.
 * Live constraints: `name` non-blank (**no maximum length**),
 * `yield_quantity NUMERIC(18,4) > 0`, `version integer > 0`.
 */
export const recipeSchema = z.object({
  ...readModelBase,
  product_variant_id: uuidSchema,
  name: trimmedNonEmpty(),
  yield_quantity: positiveQuantitySchema,
  version: z.number().int().positive(),
  is_active: z.boolean(),
});

/**
 * `recipe_ingredients`.
 * Live constraints: `quantity NUMERIC(18,4) > 0`, unique `(recipe_id, ingredient_id)`.
 */
export const recipeIngredientSchema = z.object({
  ...readModelBase,
  recipe_id: uuidSchema,
  ingredient_id: uuidSchema,
  quantity: positiveQuantitySchema,
});

// No composed schemas (product+variants, recipe+BOM) are defined here on purpose.
// Those shapes are assembled in TypeScript from parts that were each already validated
// on the way in, so a composed schema would never run — and an unexercised schema
// duplicating the same columns is just a third mirror free to drift from the other two.
// If a composed shape ever arrives from the server in one payload, validate it then.
