// @bakeflow/api — the single Supabase data-access layer.
//
// Per docs/FRONTEND-STRUCTURE.md §1 the request flow is
//   Screen -> Feature Hook -> Feature Service -> packages/api
// A screen never calls Supabase directly, and nothing in this package contains a
// business rule the database does not also enforce.
//
// Scope today: the P4.1a catalog READ path and the P4.2a inventory READ path. Both WRITE
// paths are absent deliberately — catalog's is BLOCKED (BLOCKER-010), and inventory's
// depends on the unspecified negative-stock policy plus CLAUDE.md rule 7 (stock levels are
// never written directly; only the ledger is appended to). Neither may be added here
// until those decisions are made.

export type { BakeflowClient } from './client';

export {
  BakeflowApiError,
  normalizePostgrestError,
  normalizeThrown,
  type BakeflowErrorCode,
  type PostgrestErrorLike,
} from './errors';

export {
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

export {
  getStockMovementById,
  getWarehouseById,
  listIngredientStockLevels,
  listProductStockLevels,
  listStockMovements,
  listWarehouses,
  type StockMovementFilters,
} from './queries/inventory';

// P4.2b — the inventory WRITE path. Exactly one operation, because the database grants
// exactly one: `authenticated` cannot INSERT into `stock_movements` (SELECT only), so all
// writes go through the SECURITY DEFINER `adjust_stock()` RPC, which owns `created_by`,
// `branch_id` and the audit entry.
export {
  ADJUSTABLE_STOCK_REASONS,
  adjustStock,
  type AdjustStockInput,
  type AdjustStockResult,
  type AdjustableStockReason,
} from './mutations/inventory';

// `Page` and the paging constants come from the shared read primitives rather than from
// either domain module, so both surface the same type and the same limits.
export { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './internal/read';
export type { Page, PageOptions } from './internal/read';
