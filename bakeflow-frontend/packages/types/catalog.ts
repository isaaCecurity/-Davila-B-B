/**
 * Catalog domain types — P4.1.
 *
 * Hand-written against the **live** database (project `tvfyxpafbpnkneujcnvr`), verified
 * 2026-08-11 by querying `pg_attribute` / `pg_constraint` directly. They are not derived
 * from `docs/SCHEMA-REFERENCE.md`, and they deliberately diverge from
 * `supabase gen types` output in exactly two places:
 *
 * 1. **Money and quantity columns are `Money`/`Quantity` (branded strings), not
 *    `number`.** The generator emits `unit_price: number`, `yield_quantity: number`,
 *    `reorder_level: number`, `last_unit_cost: number | null`. Those are IEEE-754
 *    doubles and violate AD-010 / `CLAUDE.md` rule 5. See `scalars.ts` for the executed
 *    evidence that scale is lost in transport.
 * 2. **`ingredients.unit_of_measure` is narrowed to its CHECK constraint.** The generator
 *    emits `string`; the live constraint is
 *    `CHECK (unit_of_measure = ANY (ARRAY['kg','g','l','ml','unit']))`.
 *
 * ## Tenancy
 *
 * All six catalog tables are **tenant-scoped only**. Verified live: **no catalog table
 * has a `branch_id` column.** The roadmap previously specified "tenant/branch scoping"
 * for this milestone; that was wrong and has been corrected. "Branch isolation where
 * applicable" does not apply to catalog.
 *
 * Cross-tenant referential integrity is structural, not conventional: every child FK is
 * composite on `(tenant_id, parent_id)` referencing `parent(tenant_id, id)`. A recipe
 * therefore *cannot* reference another organization's variant — the FK itself refuses it,
 * independently of RLS.
 */

import type { Money, Quantity, Timestamptz, Uuid } from './scalars';

/** Live: `CHECK (unit_of_measure = ANY (ARRAY['kg','g','l','ml','unit']))`. */
export const UNITS_OF_MEASURE = ['kg', 'g', 'l', 'ml', 'unit'] as const;
export type UnitOfMeasure = (typeof UNITS_OF_MEASURE)[number];

/**
 * Columns every catalog table carries for the AD-012 soft-delete pair and audit stamps.
 *
 * These appear on the full `*Row` types for fidelity to the live schema, but **not** on
 * the `*` read models below. The SELECT policy on all six tables is
 * `tenant_id = current_tenant_id() AND deleted_at IS NULL`, so a read can never observe
 * a soft-deleted row; carrying `deleted_at` into the read model would imply a decision
 * the read path never has to make.
 */
interface CatalogAuditColumns {
  created_at: Timestamptz;
  updated_at: Timestamptz;
  created_by: Uuid | null;
  deleted_at: Timestamptz | null;
  deleted_by: Uuid | null;
}

/* -------------------------------------------------------------------------- */
/* Full row shapes — exact live column sets                                    */
/* -------------------------------------------------------------------------- */

export interface ProductCategoryRow extends CatalogAuditColumns {
  id: Uuid;
  tenant_id: Uuid;
  name: string;
  /** `smallint NOT NULL DEFAULT 0`. */
  sort_order: number;
}

export interface ProductRow extends CatalogAuditColumns {
  id: Uuid;
  tenant_id: Uuid;
  /** Nullable: a product need not belong to a category. FK is `ON DELETE RESTRICT`. */
  category_id: Uuid | null;
  name: string;
  description: string | null;
  image_url: string | null;
  is_active: boolean;
}

export interface ProductVariantRow extends CatalogAuditColumns {
  id: Uuid;
  tenant_id: Uuid;
  product_id: Uuid;
  name: string;
  sku: string;
  /** `NUMERIC(19,4) NOT NULL CHECK (unit_price >= 0)` — the authoritative sale price. */
  unit_price: Money;
  is_active: boolean;
}

export interface IngredientRow extends CatalogAuditColumns {
  id: Uuid;
  tenant_id: Uuid;
  name: string;
  unit_of_measure: UnitOfMeasure;
  /** `NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0)`. */
  reorder_level: Quantity;
  /** `NUMERIC(19,4) NULL CHECK (last_unit_cost >= 0)`. */
  last_unit_cost: Money | null;
  is_active: boolean;
}

export interface RecipeRow extends CatalogAuditColumns {
  id: Uuid;
  tenant_id: Uuid;
  product_variant_id: Uuid;
  name: string;
  /** `NUMERIC(18,4) NOT NULL CHECK (yield_quantity > 0)`. */
  yield_quantity: Quantity;
  /** `integer NOT NULL DEFAULT 1 CHECK (version > 0)`. */
  version: number;
  is_active: boolean;
}

export interface RecipeIngredientRow extends CatalogAuditColumns {
  id: Uuid;
  tenant_id: Uuid;
  recipe_id: Uuid;
  ingredient_id: Uuid;
  /** `NUMERIC(18,4) NOT NULL CHECK (quantity > 0)`. */
  quantity: Quantity;
}

/* -------------------------------------------------------------------------- */
/* Read models — what the read service actually returns                        */
/* -------------------------------------------------------------------------- */

/**
 * Read models omit `created_by`, `deleted_at` and `deleted_by`.
 *
 * `API-CONTRACT.md` §4 requires explicit column selection rather than `*`, because
 * embedded relations on a wide table cost real bandwidth on a Nigerian mobile
 * connection. Omitting the soft-delete pair also makes it structurally impossible for a
 * screen to branch on it.
 */
type ReadModel<T extends CatalogAuditColumns> = Omit<
  T,
  'created_by' | 'deleted_at' | 'deleted_by'
>;

export type ProductCategory = ReadModel<ProductCategoryRow>;
export type Product = ReadModel<ProductRow>;
export type ProductVariant = ReadModel<ProductVariantRow>;
export type Ingredient = ReadModel<IngredientRow>;
export type Recipe = ReadModel<RecipeRow>;
export type RecipeIngredient = ReadModel<RecipeIngredientRow>;

/* -------------------------------------------------------------------------- */
/* Composed relation views                                                     */
/* -------------------------------------------------------------------------- */

/** A recipe line joined to the ingredient it consumes — the BOM row a baker reads. */
export interface RecipeIngredientDetail extends RecipeIngredient {
  ingredient: Ingredient;
}

/**
 * A recipe with its full bill of materials resolved.
 *
 * `unresolvedLines` is not defensive padding — it is a state the live schema permits.
 * Under AD-012 an ingredient is soft-deleted, not deleted, so
 * `recipe_ingredients_ingredient_fkey`'s `ON DELETE RESTRICT` never fires and the line
 * survives while its ingredient becomes invisible to the SELECT policy. Collapsing that
 * into a silently shorter list would under-report a recipe's true composition, so the
 * caller is made to decide what to show.
 */
export interface RecipeBillOfMaterials extends Recipe {
  lines: RecipeIngredientDetail[];
  unresolvedLines: RecipeIngredient[];
}

/** A product with its sellable variants. */
export interface ProductWithVariants extends Product {
  variants: ProductVariant[];
}
