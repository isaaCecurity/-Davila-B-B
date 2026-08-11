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
 * Live: `CHECK (length(btrim(name)) > 0)` on all six tables. Postgres tests the
 * *trimmed* length, so `"   "` is rejected there and must be rejected here too.
 */
const trimmedNonEmpty = (maxLength?: number) => {
  const base = z.string().refine((v) => v.trim().length > 0, 'must not be blank');
  return maxLength === undefined
    ? base
    : base.refine(
        (v) => v.trim().length <= maxLength,
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

/** A recipe line with its ingredient embedded, as returned by the BOM read. */
export const recipeIngredientDetailSchema = recipeIngredientSchema.extend({
  ingredient: ingredientSchema,
});

/** A product with its variants attached. */
export const productWithVariantsSchema = productSchema.extend({
  variants: z.array(productVariantSchema),
});

/** A recipe with its bill of materials resolved. See `RecipeBillOfMaterials` for why
 *  unresolved lines are surfaced rather than dropped. */
export const recipeBillOfMaterialsSchema = recipeSchema.extend({
  lines: z.array(recipeIngredientDetailSchema),
  unresolvedLines: z.array(recipeIngredientSchema),
});
