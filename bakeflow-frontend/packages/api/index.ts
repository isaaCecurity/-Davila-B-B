// @bakeflow/api — the single Supabase data-access layer.
//
// Per docs/FRONTEND-STRUCTURE.md §1 the request flow is
//   Screen -> Feature Hook -> Feature Service -> packages/api
// A screen never calls Supabase directly, and nothing in this package contains a
// business rule the database does not also enforce.
//
// Scope today: the catalog, inventory, production, sales, delivery, driver-trip, and
// online finance paths. Financial writes remain RPC-only; deferred catalog pricing and
// offline synchronization are intentionally outside this package's current scope.

export type { BakeflowClient } from './client';

export { getExpenseById, listCashSessions, listExpenses, type ExpenseFilters } from './queries/finance';

// P9.8 -- reporting, revenue/cash half only (COGS/gross-profit stay out, BLOCKER-018).
// Read-only RPC; see queries/reporting.ts's header for why it lives in queries/ rather
// than mutations/.
export { getDailyRevenueSummary } from './queries/reporting';
export {
  closeCashSession,
  createExpense,
  openCashSession,
  PAYMENT_METHODS,
  recordPayment,
  type CloseCashSessionInput,
  type CreateExpenseInput,
  type OpenCashSessionInput,
  type PaymentMethod,
  type RecordPaymentInput,
  type RecordPaymentResult,
} from './mutations/finance';

export {
  BakeflowApiError,
  normalizeFunctionsError,
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

// P4.3a — production, read path.
export {
  getProductionBatchById,
  getProductionBatchWithIngredients,
  listProductionBatchIngredients,
  listProductionBatches,
  type ProductionBatchFilters,
} from './queries/production';

// P9.5 — production, write path. `scheduled`'s two exits are plain PostgREST updates,
// policed by `guard_production_batch_transition()`; `in_progress`'s two exits are the
// SECURITY DEFINER RPCs `STATE-MACHINES.md` §2 requires, since each has to write
// `stock_movements` atomically with the status change. `authenticated` holds a blanket
// `UPDATE` on `production_batches` (unlike `deliveries`), which means nothing at the grant
// layer stops a client from reaching `completed`/`failed` without those RPCs and silently
// skipping the movements — see BLOCKER-017 and the header of `mutations/production.ts`.
export {
  cancelProductionBatch,
  completeProductionBatch,
  failProductionBatch,
  startProductionBatch,
  type CompleteProductionBatchInput,
  type FailProductionBatchInput,
} from './mutations/production';

// P4.4a/P4.4b — the sales READ path (customers, tickets, ticket_items).
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
  listTicketsByIds,
  type CustomerFilters,
  type TicketFilters,
} from './queries/sales';

// ADR-001 Phase 5 — the driver "Sell" step: ticket creation (`createRoadsideTicket`, a
// plain INSERT — verified live RLS lets a driver create their own ticket, not an RPC
// workaround, see the module header) and the driver field-sale completion shortcut
// (`completeDriverFieldSale`, AD-020, resolving BLOCKER-021). No *general* lifecycle
// mutation (`confirmTicket`/`submitTicket`) is exported: `guard_ticket_status_transition()`
// still never includes `driver` in the seven normal forward-hop actor lists, and
// `discount_amount`/`tax_amount` still have no approved rules (BLOCKER-003). See
// `mutations/sales.ts`'s header for the full picture.
export {
  completeDriverFieldSale,
  createRoadsideTicket,
  type CreateRoadsideTicketInput,
  type RoadsideTicketLine,
} from './mutations/sales';

// P4.5 — delivery, read and write.
//
// The write path is two SECURITY DEFINER RPCs, whose bodies were read live 2026-08-21:
// `authenticated` holds no UPDATE on `deliveries`, so there is no table-write alternative.
//
// The earlier note here — that the signatures had not been read (BLOCKER-011, resolved
// 2026-08-15) and that the two hops into `returned` write a return stock movement — was
// wrong on both counts. `transition_delivery` writes no stock movement and neither trigger
// on the table does either. See BLOCKER-016 and the header of `mutations/delivery.ts`.
export {
  getDeliveryById,
  getDeliveryForTicket,
  listDeliveries,
  type DeliveryFilters,
} from './queries/delivery';
export {
  TRANSITIONABLE_DELIVERY_STATUSES,
  transitionDelivery,
  updateDeliveryDetails,
  type DeliveryTransition,
  type UpdateDeliveryDetailsInput,
} from './mutations/delivery';

// P9.6 — driver picker read path. `listDrivers` answers "who in this tenant holds the
// `driver` role", which `transition_delivery`'s `assigned` hop has always needed and never
// had. See `queries/staff.ts` for the RLS/RPC provenance.
export { listDrivers } from './queries/staff';

// P8.1 — organization membership reads. The one read path that works with a null tenant
// claim, because `organizations_select` keys off auth.uid() rather than
// current_tenant_id(). Switching the active organization lives in @bakeflow/auth: it is
// an RPC *plus* a token refresh, and separating those produces a UI that switched while
// the database did not.
export { listMyOrganizationRoles, listMyOrganizations } from './queries/organizations';

// P6.2 — invitation creation and delivery.
export {
  createAndSendInvite,
  createOrganizationInvite,
  sendInviteEmail,
  type CreateInviteInput,
  type CreateInviteResult,
  type SendInviteEmailInput,
  type SendInviteEmailResult,
} from './mutations/invitations';

// ADR-001 — driver trips, read and write. `driver_trips` is RPC-only: `authenticated`
// holds no INSERT/UPDATE/DELETE grant at all (a stricter posture than `deliveries`),
// verified live and enforced again after a default-privilege grant was found and revoked.
// See the module headers in queries/driver-trips.ts and mutations/driver-trips.ts.
export {
  getCurrentDriverTrip,
  getDriverTripById,
  listDriverTrips,
  type DriverTripFilters,
} from './queries/driver-trips';
export {
  completeDriverTrip,
  departDriverTrip,
  recordDriverTripPayment,
  reconcileDriverTrip,
  returnDriverTrip,
  startDriverTrip,
  verifyTripLoading,
  type CompleteDriverTripInput,
  type DriverTripManifestItem,
  type DriverTripPaymentMethod,
  type ReconcileDriverTripInput,
  type RecordDriverTripPaymentInput,
  type RecordDriverTripPaymentResult,
  type ReturnDriverTripInput,
  type StartDriverTripInput,
  type VerifyTripLoadingInput,
} from './mutations/driver-trips';

