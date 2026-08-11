// @bakeflow/types — shared domain types.
//
// Per docs/FRONTEND-STRUCTURE.md this package is nominally "generated from live DB
// schema (`supabase gen types`)". The catalog types are hand-written instead, for two
// verified reasons documented in ./scalars.ts and ./catalog.ts: the generator types
// money and quantity columns as `number` (IEEE-754 doubles, forbidden by AD-010 and
// CLAUDE.md rule 5), and it widens CHECK-constrained text columns to `string`.
//
// The generator output was still consulted as a cross-check — the non-numeric column
// sets below match it exactly.

export type { Money, Quantity, Timestamptz, Uuid } from './scalars';
export {
  MONEY_PATTERN,
  QUANTITY_PATTERN,
  isNegativeDecimalString,
  isZeroDecimalString,
  unsafeMoney,
  unsafeQuantity,
} from './scalars';

export type {
  Ingredient,
  IngredientRow,
  Product,
  ProductCategory,
  ProductCategoryRow,
  ProductRow,
  ProductVariant,
  ProductVariantRow,
  ProductWithVariants,
  Recipe,
  RecipeBillOfMaterials,
  RecipeIngredient,
  RecipeIngredientDetail,
  RecipeIngredientRow,
  RecipeRow,
  UnitOfMeasure,
} from './catalog';
export { UNITS_OF_MEASURE } from './catalog';
