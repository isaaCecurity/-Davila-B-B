// @bakeflow/api — the single Supabase data-access layer.
//
// Per docs/FRONTEND-STRUCTURE.md §1 the request flow is
//   Screen -> Feature Hook -> Feature Service -> packages/api
// A screen never calls Supabase directly, and nothing in this package contains a
// business rule the database does not also enforce.
//
// Scope today: the P4.1a catalog READ path. The catalog WRITE path is BLOCKED
// (BLOCKER-010) and must not be added here until those decisions are made.

export type { BakeflowClient } from './client';

export {
  BakeflowApiError,
  normalizePostgrestError,
  normalizeThrown,
  type BakeflowErrorCode,
  type PostgrestErrorLike,
} from './errors';

export {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  getActiveRecipeForVariant,
  getIngredientById,
  getProductById,
  getProductVariantById,
  getProductWithVariants,
  getRecipeBillOfMaterials,
  getRecipeById,
  listIngredients,
  listProductCategories,
  listProductVariants,
  listProducts,
  listProductsByCategory,
  listRecipeIngredients,
  listRecipeVersionsForVariant,
  listVariantsByProduct,
  type KeysetPageOptions,
} from './queries/catalog';
