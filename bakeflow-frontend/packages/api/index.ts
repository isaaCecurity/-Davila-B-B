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
  listRecipesByIds,
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

// P4.3a — production READ path. No batch mutation is exported: STATE-MACHINES.md §2
// requires completion to be the single `complete_production_batch()` RPC, never a
// sequence of client calls, and that signature has not been read from the live database
// yet.
export {
  getProductionBatchById,
  getProductionBatchWithIngredients,
  listProductionBatchIngredients,
  listProductionBatches,
  type ProductionBatchFilters,
} from './queries/production';

// P4.4a/P4.4b — the sales READ path (customers, tickets, ticket_items). No ticket mutation
// is exported. `guard_ticket_status_transition()` is the sole authority on status since
// 2026-08-14, the four lifecycle RPCs (`confirm_ticket`, `complete_ticket`,
// `cancel_ticket`, `archive_ticket`) have not had their signatures read from the live
// database, `draft -> submitted` has no RPC at all, and `discount_amount`/`tax_amount` have
// no approved rules (BLOCKER-003). See the module header for why none of that is guessed.
export {
  findCustomersByPhone,
  getCustomerById,
  getTicketById,
  getTicketByNumber,
  getTicketWithItems,
  listCustomers,
  listTicketCorrections,
  listTicketItems,
  listTickets,
  type CustomerFilters,
  type TicketFilters,
} from './queries/sales';

// P4.5 — the delivery READ path. No mutation: `failed -> returned` and
// `in_transit -> returned` each write a return stock movement, so under STATE-MACHINES.md
// universal rule 4 they are RPCs by construction, and their signatures have not been read
// from the live database (BLOCKER-011).
export {
  getDeliveryById,
  getDeliveryForTicket,
  listDeliveries,
  type DeliveryFilters,
} from './queries/delivery';

// P8.1 — organization membership reads. The one read path that works with a null tenant
// claim, because `organizations_select` keys off auth.uid() rather than
// current_tenant_id(). Switching the active organization lives in @bakeflow/auth: it is
// an RPC *plus* a token refresh, and separating those produces a UI that switched while
// the database did not.
export { listMyOrganizationRoles, listMyOrganizations } from './queries/organizations';
