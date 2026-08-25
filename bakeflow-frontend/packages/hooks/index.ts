/**
 * @bakeflow/hooks — TanStack Query bindings over `@bakeflow/api`.
 *
 * Per `docs/FRONTEND-STRUCTURE.md` §1 the request flow is
 * `Screen -> Feature Hook -> Feature Service -> packages/api`. These are the feature-hook
 * layer. They contain **no business rule** — every one is a thin, correctly-keyed wrapper
 * over a query function that already exists.
 *
 * ## The one thing this module exists to get right: cache identity
 *
 * Nothing in the `packages/api` signatures mentions an organization. `listProducts(client)`
 * takes no tenant argument, because the tenant comes from the **JWT claim** that RLS reads.
 * That is correct for the data layer and a trap for the cache layer: a key derived only
 * from the arguments — `['products']` — is **identical for every organization**, so after
 * switching bakeries TanStack Query would serve organization A's catalog under
 * organization B's name, from memory, with no request and no error.
 *
 * That failure is invisible in testing with one organization and looks exactly like a data
 * leak to a user with two. So:
 *
 * > **Every organization-scoped key starts with `['org', tenantId]`.** `orgScoped()` is the
 * > only way to build one, and every hook below routes through it.
 *
 * The `tenantId` used is the claim **actually in force on the current token**, not the id
 * the user tapped. Those differ for the whole window between the RPC and the token
 * refresh, and keying on intent rather than fact would cache the new organization's key
 * against the old organization's rows.
 *
 * ## This is a correctness boundary, not a security boundary
 *
 * RLS is the security boundary and it does not consult this file. If a key were wrong the
 * database would still refuse to return another organization's rows — the damage is stale
 * *previously-authorized* data being redisplayed, which is a correctness and trust problem
 * rather than an access-control one. Both matter; do not conflate them.
 */

import {
  adjustStock,
  cancelProductionBatch,
  completeDriverTrip,
  completeProductionBatch,
  createRoadsideTicket,
  departDriverTrip,
  failProductionBatch,
  getCurrentDriverTrip,
  getDeliveryById,
  getDriverTripById,
  getProductById,
  getProductionBatchWithIngredients,
  listDeliveries,
  listDriverTrips,
  listDrivers,
  listIngredientStockLevels,
  listIngredients,
  listMyOrganizationRoles,
  listMyOrganizations,
  listProductCategories,
  listProductStockLevels,
  listProductVariants,
  listProducts,
  listProductionBatches,
  listRecipesByIds,
  listTickets,
  listTicketsByIds,
  listVariantsByProduct,
  listWarehouses,
  recordDriverTripPayment,
  reconcileDriverTrip,
  returnDriverTrip,
  startDriverTrip,
  startProductionBatch,
  transitionDelivery,
  updateDeliveryDetails,
  verifyTripLoading,
  type AdjustStockInput,
  type AdjustStockResult,
  type BakeflowClient,
  type CompleteDriverTripInput,
  type CompleteProductionBatchInput,
  type CreateRoadsideTicketInput,
  type DeliveryFilters,
  type DeliveryTransition,
  type DriverTripFilters,
  type FailProductionBatchInput,
  type KeysetPageOptions,
  type Page,
  type PageOptions,
  type ProductionBatchFilters,
  type ReconcileDriverTripInput,
  type RecordDriverTripPaymentInput,
  type RecordDriverTripPaymentResult,
  type ReturnDriverTripInput,
  type StartDriverTripInput,
  type TicketFilters,
  type UpdateDeliveryDetailsInput,
  type VerifyTripLoadingInput,
} from '@bakeflow/api';
import type {
  Delivery,
  Driver,
  DriverTrip,
  Ingredient,
  IngredientStockLevel,
  OrganizationMembership,
  OrganizationRole,
  Product,
  ProductCategory,
  ProductStockLevel,
  ProductVariant,
  ProductionBatch,
  ProductionBatchWithIngredients,
  Recipe,
  Ticket,
  TicketWithItems,
  Warehouse,
} from '@bakeflow/types';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

/* -------------------------------------------------------------------------- */
/* Keys                                                                        */
/* -------------------------------------------------------------------------- */

/** Root of every organization-scoped key. Exported so the switch can evict by prefix. */
export const ORG_SCOPE = 'org' as const;

/**
 * Build an organization-scoped query key.
 *
 * Deliberately takes a non-null `tenantId`: a hook with no active organization must not
 * run at all, rather than run under a key containing `null` that would then be shared by
 * every organization-less state. Callers enforce that with `enabled`.
 */
export function orgScoped(tenantId: string, ...rest: readonly unknown[]): unknown[] {
  return [ORG_SCOPE, tenantId, ...rest];
}

export const queryKeys = {
  /** Not organization-scoped: this is the list used to *choose* an organization, and it
   *  resolves against `auth.uid()` rather than the tenant claim. Keyed by user so two
   *  accounts on one device cannot share it. */
  myOrganizations: (userId: string): unknown[] => ['me', userId, 'organizations'],
  myOrganizationRoles: (userId: string): unknown[] => ['me', userId, 'organization-roles'],

  products: (tenantId: string, options?: KeysetPageOptions): unknown[] =>
    orgScoped(tenantId, 'products', options ?? {}),
  product: (tenantId: string, productId: string): unknown[] =>
    orgScoped(tenantId, 'product', productId),
  productCategories: (tenantId: string): unknown[] => orgScoped(tenantId, 'product-categories'),
  productVariants: (tenantId: string, productId: string): unknown[] =>
    orgScoped(tenantId, 'product-variants', productId),

  /* P9.4 — inventory. Stock keys carry the warehouse: quantities are per warehouse, and a
   * key that omitted it would let one stockroom's levels answer for another's. */
  warehouses: (tenantId: string, branchId?: string): unknown[] =>
    orgScoped(tenantId, 'warehouses', branchId ?? 'all'),
  ingredients: (tenantId: string, options?: KeysetPageOptions): unknown[] =>
    orgScoped(tenantId, 'ingredients', options ?? {}),
  allProductVariants: (tenantId: string, options?: KeysetPageOptions): unknown[] =>
    orgScoped(tenantId, 'all-product-variants', options ?? {}),
  ingredientStockLevels: (
    tenantId: string,
    warehouseId: string,
    options?: PageOptions,
  ): unknown[] => orgScoped(tenantId, 'ingredient-stock-levels', warehouseId, options ?? {}),
  productStockLevels: (tenantId: string, warehouseId: string, options?: PageOptions): unknown[] =>
    orgScoped(tenantId, 'product-stock-levels', warehouseId, options ?? {}),

  /* P9.5 — production. */
  productionBatches: (
    tenantId: string,
    filters?: ProductionBatchFilters,
    options?: PageOptions,
  ): unknown[] => orgScoped(tenantId, 'production-batches', filters ?? {}, options ?? {}),
  productionBatch: (tenantId: string, batchId: string): unknown[] =>
    orgScoped(tenantId, 'production-batch', batchId),
  /**
   * Keyed on the **sorted** id set, not the array as given.
   *
   * The caller derives these ids from a page of rows, so the same set arrives in a
   * different order whenever the underlying rows reorder. Keying on the raw array would
   * mint a fresh cache entry — and a fresh request — for a set already in memory.
   */
  recipesByIds: (tenantId: string, recipeIds: readonly string[]): unknown[] =>
    orgScoped(tenantId, 'recipes-by-id', [...new Set(recipeIds)].sort().join(',')),

  /* P9.6 — delivery. */
  deliveries: (tenantId: string, filters?: DeliveryFilters, options?: PageOptions): unknown[] =>
    orgScoped(tenantId, 'deliveries', filters ?? {}, options ?? {}),
  delivery: (tenantId: string, deliveryId: string): unknown[] =>
    orgScoped(tenantId, 'delivery', deliveryId),
  /** Sorted id set, for the reason given on `recipesByIds`. */
  ticketsByIds: (tenantId: string, ticketIds: readonly string[]): unknown[] =>
    orgScoped(tenantId, 'tickets-by-id', [...new Set(ticketIds)].sort().join(',')),
  /** Not paged and not filtered by anything but role — see `queries/staff.ts`. */
  drivers: (tenantId: string): unknown[] => orgScoped(tenantId, 'drivers'),

  /* ADR-001 — driver trips. */
  driverTrips: (
    tenantId: string,
    filters?: DriverTripFilters,
    options?: PageOptions,
  ): unknown[] => orgScoped(tenantId, 'driver-trips', filters ?? {}, options ?? {}),
  driverTrip: (tenantId: string, tripId: string): unknown[] =>
    orgScoped(tenantId, 'driver-trip', tripId),
  /** Keyed by driver, not by trip id — this is "whichever trip, if any, this driver is
   *  currently in", which is exactly the ambiguity `driverTrip` above cannot express. */
  currentDriverTrip: (tenantId: string, driverId: string): unknown[] =>
    orgScoped(tenantId, 'current-driver-trip', driverId),
  /** What one driver trip has sold so far — the "Sell" screen's running list. */
  driverTripTickets: (tenantId: string, tripId: string): unknown[] =>
    orgScoped(tenantId, 'driver-trip-tickets', tripId),
} as const;

/* -------------------------------------------------------------------------- */
/* Cache lifecycle                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Drop every organization-scoped entry from the cache.
 *
 * Call on organization switch and on sign-out.
 *
 * **`removeQueries`, not `invalidateQueries`.** Invalidation marks data stale but leaves it
 * in the cache and keeps serving it while the refetch is in flight — so the first frame
 * after switching would render the previous bakery's catalog under the new bakery's name.
 * Removal guarantees the next render is a loading state.
 *
 * This is belt-and-braces: keys already contain the tenant id, so organization B could not
 * read organization A's entry in the first place. It runs anyway, because it also bounds
 * memory on a device that switches often, and because relying on a single mechanism for a
 * property this visible is how the property eventually breaks.
 */
export function clearOrganizationScopedCache(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: [ORG_SCOPE] });
}

/** Drop everything, including the organization list. For sign-out. */
export function clearAllCache(queryClient: QueryClient): void {
  queryClient.clear();
}

/* -------------------------------------------------------------------------- */
/* Hooks                                                                       */
/* -------------------------------------------------------------------------- */

export function useMyOrganizations(
  client: BakeflowClient,
  userId: string | null,
): UseQueryResult<OrganizationMembership[], Error> {
  return useQuery({
    queryKey: queryKeys.myOrganizations(userId ?? 'anonymous'),
    queryFn: () => listMyOrganizations(client),
    enabled: userId !== null,
  });
}

export function useMyOrganizationRoles(
  client: BakeflowClient,
  userId: string | null,
): UseQueryResult<OrganizationRole[], Error> {
  return useQuery({
    queryKey: queryKeys.myOrganizationRoles(userId ?? 'anonymous'),
    queryFn: () => listMyOrganizationRoles(client),
    enabled: userId !== null,
  });
}

/**
 * One page of products for the active organization.
 *
 * `enabled` is false without a tenant claim. That is not an optimisation: with a null
 * claim every catalog policy denies and the query would resolve to an empty array, which
 * renders as "this bakery has no products" — indistinguishable from a real empty catalog
 * and badly wrong. The screen shows a distinct "no organization selected" state instead.
 */
export function useProducts(
  client: BakeflowClient,
  tenantId: string | null,
  options?: KeysetPageOptions,
): UseQueryResult<Page<Product>, Error> {
  return useQuery({
    queryKey: queryKeys.products(tenantId ?? 'none', options),
    queryFn: () => listProducts(client, options),
    enabled: tenantId !== null,
  });
}

export function useProductCategories(
  client: BakeflowClient,
  tenantId: string | null,
): UseQueryResult<ProductCategory[], Error> {
  return useQuery({
    queryKey: queryKeys.productCategories(tenantId ?? 'none'),
    queryFn: () => listProductCategories(client),
    enabled: tenantId !== null,
  });
}

/**
 * One product — P9.1.
 *
 * Resolves to `null` when the product does not exist, belongs to another organization, or
 * is soft-deleted. All three are indistinguishable by design, so the detail screen renders
 * one "not found" state rather than pretending to know which happened.
 */
export function useProduct(
  client: BakeflowClient,
  tenantId: string | null,
  productId: string | null,
): UseQueryResult<Product | null, Error> {
  return useQuery({
    queryKey: queryKeys.product(tenantId ?? 'none', productId ?? 'none'),
    queryFn: () => getProductById(client, productId ?? ''),
    enabled: tenantId !== null && productId !== null,
  });
}

/** The variants of one product. `listVariantsByProduct` is unpaged — the set is bounded
 *  by its parent — so this returns an array rather than a `Page`. */
export function useProductVariants(
  client: BakeflowClient,
  tenantId: string | null,
  productId: string | null,
): UseQueryResult<ProductVariant[], Error> {
  return useQuery({
    queryKey: queryKeys.productVariants(tenantId ?? 'none', productId ?? 'none'),
    queryFn: () => listVariantsByProduct(client, productId ?? ''),
    enabled: tenantId !== null && productId !== null,
  });
}

/* -------------------------------------------------------------------------- */
/* Inventory — P9.4 read path                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Stockrooms the caller can see, optionally one branch's.
 *
 * Note this is narrowed by **branch** access as well as tenant: `warehouses` is
 * branch-scoped, so a cashier at one branch sees fewer rows than an owner. An empty result
 * is therefore a legitimate state for a real member, not necessarily a bakery with no
 * stockrooms — the screen says so rather than implying nothing exists.
 */
export function useWarehouses(
  client: BakeflowClient,
  tenantId: string | null,
  branchId?: string,
): UseQueryResult<Warehouse[], Error> {
  return useQuery({
    queryKey: queryKeys.warehouses(tenantId ?? 'none', branchId),
    queryFn: () => listWarehouses(client, branchId === undefined ? {} : { branchId }),
    enabled: tenantId !== null,
  });
}

/** One page of ingredients. Used both as a list and to put names on stock levels. */
export function useIngredients(
  client: BakeflowClient,
  tenantId: string | null,
  options?: KeysetPageOptions,
): UseQueryResult<Page<Ingredient>, Error> {
  return useQuery({
    queryKey: queryKeys.ingredients(tenantId ?? 'none', options),
    queryFn: () => listIngredients(client, options),
    enabled: tenantId !== null,
  });
}

/** Every variant in the organization, for resolving names on finished-good stock levels. */
export function useAllProductVariants(
  client: BakeflowClient,
  tenantId: string | null,
  options?: KeysetPageOptions,
): UseQueryResult<Page<ProductVariant>, Error> {
  return useQuery({
    queryKey: queryKeys.allProductVariants(tenantId ?? 'none', options),
    queryFn: () => listProductVariants(client, options),
    enabled: tenantId !== null,
  });
}

/**
 * Ingredient quantities on hand in one warehouse.
 *
 * These rows are trigger-maintained from the `stock_movements` ledger and are never written
 * directly (`CLAUDE.md` rule 7), so this is a read-only projection of the ledger. Disabled
 * without a warehouse: an unscoped level query would need the composite cursor the ledger
 * uses, and `listStockLevels` is deliberately single-warehouse.
 */
export function useIngredientStockLevels(
  client: BakeflowClient,
  tenantId: string | null,
  warehouseId: string | null,
  options?: PageOptions,
): UseQueryResult<Page<IngredientStockLevel>, Error> {
  return useQuery({
    queryKey: queryKeys.ingredientStockLevels(tenantId ?? 'none', warehouseId ?? 'none', options),
    queryFn: () => listIngredientStockLevels(client, warehouseId ?? '', options),
    enabled: tenantId !== null && warehouseId !== null,
  });
}

/** Finished-good quantities on hand in one warehouse. See `useIngredientStockLevels`. */
export function useProductStockLevels(
  client: BakeflowClient,
  tenantId: string | null,
  warehouseId: string | null,
  options?: PageOptions,
): UseQueryResult<Page<ProductStockLevel>, Error> {
  return useQuery({
    queryKey: queryKeys.productStockLevels(tenantId ?? 'none', warehouseId ?? 'none', options),
    queryFn: () => listProductStockLevels(client, warehouseId ?? '', options),
    enabled: tenantId !== null && warehouseId !== null,
  });
}

/* -------------------------------------------------------------------------- */
/* Production — P9.5 read path                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One page of production batches, newest batch number last.
 *
 * Narrowed by **branch** as well as tenant — `production_batches_select` is
 * `tenant_id = current_tenant_id() AND has_branch_access(branch_id) AND deleted_at IS NULL`
 * (read live) — so a baker assigned to one branch sees that branch's batches and no others.
 * The filters are passed through to the query rather than applied to the result, so the
 * cache key and the request always describe the same set.
 */
export function useProductionBatches(
  client: BakeflowClient,
  tenantId: string | null,
  filters?: ProductionBatchFilters,
  options?: PageOptions,
): UseQueryResult<Page<ProductionBatch>, Error> {
  return useQuery({
    queryKey: queryKeys.productionBatches(tenantId ?? 'none', filters, options),
    queryFn: () => listProductionBatches(client, filters ?? {}, options),
    enabled: tenantId !== null,
  });
}

/**
 * One batch together with its planned ingredient lines.
 *
 * Resolves to `null` when the batch does not exist, belongs to another organization, sits
 * in an unreachable branch, or is soft-deleted — indistinguishable by design, so the screen
 * renders a single "not found" state rather than guessing which.
 */
export function useProductionBatch(
  client: BakeflowClient,
  tenantId: string | null,
  batchId: string | null,
): UseQueryResult<ProductionBatchWithIngredients | null, Error> {
  return useQuery({
    queryKey: queryKeys.productionBatch(tenantId ?? 'none', batchId ?? 'none'),
    queryFn: () => getProductionBatchWithIngredients(client, batchId ?? ''),
    enabled: tenantId !== null && batchId !== null,
  });
}

/**
 * Recipes by id, for putting names on rows that carry only a `recipe_id`.
 *
 * Disabled on an empty id set: with no ids the query would resolve to `[]` under a key
 * shared by every empty-set caller, and the request would be pure overhead.
 */
export function useRecipesByIds(
  client: BakeflowClient,
  tenantId: string | null,
  recipeIds: readonly string[],
): UseQueryResult<Recipe[], Error> {
  return useQuery({
    queryKey: queryKeys.recipesByIds(tenantId ?? 'none', recipeIds),
    queryFn: () => listRecipesByIds(client, recipeIds),
    enabled: tenantId !== null && recipeIds.length > 0,
  });
}

/* -------------------------------------------------------------------------- */
/* Delivery (P9.6)                                                             */
/* -------------------------------------------------------------------------- */

/**
 * One page of deliveries, newest first.
 *
 * **Narrowed differently from every other branch-scoped list.** `deliveries_select` is
 * `tenant_id = current_tenant_id() AND (driver_id = auth.uid() OR has_branch_access(branch_id))
 * AND deleted_at IS NULL` — read live. The disjunction means a driver sees a delivery
 * assigned to them even outside the branches they are assigned to, which is right for the
 * job but makes `filters.branchId` a convenience filter and never a security boundary.
 *
 * Tenant isolation is untouched by that: `tenant_id = current_tenant_id()` is conjoined and
 * no driver clause escapes it.
 */
export function useDeliveries(
  client: BakeflowClient,
  tenantId: string | null,
  filters?: DeliveryFilters,
  options?: PageOptions,
): UseQueryResult<Page<Delivery>, Error> {
  return useQuery({
    queryKey: queryKeys.deliveries(tenantId ?? 'none', filters, options),
    queryFn: () => listDeliveries(client, filters ?? {}, options),
    enabled: tenantId !== null,
  });
}

/**
 * One delivery, or `null` when it does not exist, belongs to another organization, sits in
 * an unreachable branch, or is soft-deleted. All four are indistinguishable by design, so
 * the screen renders one "not found" state rather than guessing which.
 */
export function useDelivery(
  client: BakeflowClient,
  tenantId: string | null,
  deliveryId: string | null,
): UseQueryResult<Delivery | null, Error> {
  return useQuery({
    queryKey: queryKeys.delivery(tenantId ?? 'none', deliveryId ?? 'none'),
    queryFn: () => getDeliveryById(client, deliveryId ?? ''),
    enabled: tenantId !== null && deliveryId !== null,
  });
}

/**
 * Every tenant member holding the `driver` role — the picker list for the `pending ->
 * assigned` transition. See `@bakeflow/types` `staff.ts` for why this is tenant-wide
 * rather than branch-filtered: `transition_delivery()` itself checks nothing narrower.
 *
 * `enabled` follows the same null-tenant rule as every other organization-scoped hook, not
 * a role check — a caller who cannot actually assign a driver will still resolve this query
 * successfully and simply have nothing to do with the result, since `useTransitionDelivery`
 * (and the RPC behind it) is the real authorization boundary.
 */
export function useDrivers(
  client: BakeflowClient,
  tenantId: string | null,
): UseQueryResult<Driver[], Error> {
  return useQuery({
    queryKey: queryKeys.drivers(tenantId ?? 'none'),
    queryFn: () => listDrivers(client),
    enabled: tenantId !== null,
  });
}

/**
 * Tickets by id, for putting `ticket_number` on rows that carry only a `ticket_id`.
 *
 * Disabled on an empty id set, for the reason given on `useRecipesByIds`.
 */
export function useTicketsByIds(
  client: BakeflowClient,
  tenantId: string | null,
  ticketIds: readonly string[],
): UseQueryResult<Ticket[], Error> {
  return useQuery({
    queryKey: queryKeys.ticketsByIds(tenantId ?? 'none', ticketIds),
    queryFn: () => listTicketsByIds(client, ticketIds),
    enabled: tenantId !== null && ticketIds.length > 0,
  });
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Refresh what a changed delivery invalidates.
 *
 * **`invalidateQueries`, not `removeQueries`** — the opposite of the organization switch
 * above, and for the opposite reason. There the cached rows belonged to a *different*
 * bakery and showing them for even one frame was the bug. Here they belong to this
 * bakery and are merely one status behind, so keeping them on screen while the refetch
 * runs is the better experience; removing them would blank a board the user is reading.
 *
 * The fresh row is written straight into the detail key rather than waiting for a refetch,
 * because the mutation already returned it — re-read through the same projection the
 * detail screen caches, so it is not a differently-shaped object.
 *
 * The list key is invalidated by **prefix**: `['org', tenantId, 'deliveries']` matches
 * every filter and page combination, and a transition changes which of those a row belongs
 * to. Invalidating only the filters currently mounted would leave a dispatched delivery
 * sitting in the "Open" board it just left.
 */
function invalidateDelivery(
  queryClient: QueryClient,
  tenantId: string,
  row: Delivery,
): void {
  queryClient.setQueryData(queryKeys.delivery(tenantId, row.id), row);
  void queryClient.invalidateQueries({ queryKey: orgScoped(tenantId, 'deliveries') });
  void queryClient.invalidateQueries({ queryKey: queryKeys.delivery(tenantId, row.id) });
}

/**
 * A hook whose mutation needs an active organization refuses to run without one.
 *
 * A query in that state is simply `enabled: false`. A mutation has no such switch — it is
 * fired by a tap, and the tap has to do something — so the guard is thrown from inside
 * `mutationFn`, where it lands in `error` like any other failure rather than escaping as
 * an unhandled rejection.
 */
function requireTenant(tenantId: string | null): string {
  if (tenantId === null) {
    throw new Error('No active organization. Choose a bakery before changing a delivery.');
  }
  return tenantId;
}

export interface TransitionDeliveryVariables {
  deliveryId: string;
  transition: DeliveryTransition;
}

/**
 * Move a delivery to its next status.
 *
 * No retry. The default TanStack Query mutation behaviour is already no-retry, and it is
 * left that way deliberately: these calls are not idempotent in the way a GET is — a
 * replayed `failed` overwrites the stored reason, and a replayed hop against a row that
 * has since moved returns `invalid_transition`, which would surface to the user as a
 * confusing failure of an action that actually succeeded.
 *
 * Errors arrive as `BakeflowApiError` with a `code` the screen may branch on —
 * `invalid_transition`, `insufficient_role` — never as text to render raw.
 */
export function useTransitionDelivery(
  client: BakeflowClient,
  tenantId: string | null,
): UseMutationResult<Delivery, Error, TransitionDeliveryVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ deliveryId, transition }: TransitionDeliveryVariables) => {
      requireTenant(tenantId);
      return transitionDelivery(client, deliveryId, transition);
    },
    onSuccess: (row) => {
      invalidateDelivery(queryClient, requireTenant(tenantId), row);
    },
  });
}

export interface UpdateDeliveryDetailsVariables {
  deliveryId: string;
  input: UpdateDeliveryDetailsInput;
}

/** Correct a delivery's address, contact number or scheduled time. */
export function useUpdateDeliveryDetails(
  client: BakeflowClient,
  tenantId: string | null,
): UseMutationResult<Delivery, Error, UpdateDeliveryDetailsVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ deliveryId, input }: UpdateDeliveryDetailsVariables) => {
      requireTenant(tenantId);
      return updateDeliveryDetails(client, deliveryId, input);
    },
    onSuccess: (row) => {
      invalidateDelivery(queryClient, requireTenant(tenantId), row);
    },
  });
}

/**
 * Refresh what a changed batch invalidates. Same shape as `invalidateDelivery`, for the
 * same reason: the list is invalidated by tenant-scoped prefix (a transition changes which
 * status filter the row belongs to), and the fresh row is written straight into the detail
 * key rather than waiting on a refetch.
 */
function invalidateProductionBatch(
  queryClient: QueryClient,
  tenantId: string,
  batchId: string,
): void {
  void queryClient.invalidateQueries({ queryKey: orgScoped(tenantId, 'production-batches') });
  void queryClient.invalidateQueries({ queryKey: queryKeys.productionBatch(tenantId, batchId) });
}

export interface ProductionBatchIdVariables {
  batchId: string;
}

/**
 * Move a scheduled batch to `in_progress`.
 *
 * No retry, for the same reason as the delivery transitions: a replay against a batch that
 * has already moved on returns `invalid_transition`, which would read to the user as a
 * failure of an action that actually succeeded the first time.
 */
export function useStartProductionBatch(
  client: BakeflowClient,
  tenantId: string | null,
): UseMutationResult<ProductionBatch, Error, ProductionBatchIdVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ batchId }: ProductionBatchIdVariables) => {
      requireTenant(tenantId);
      return startProductionBatch(client, batchId);
    },
    onSuccess: (row) => {
      invalidateProductionBatch(queryClient, requireTenant(tenantId), row.id);
    },
  });
}

/** Cancel a batch before it starts. */
export function useCancelProductionBatch(
  client: BakeflowClient,
  tenantId: string | null,
): UseMutationResult<ProductionBatch, Error, ProductionBatchIdVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ batchId }: ProductionBatchIdVariables) => {
      requireTenant(tenantId);
      return cancelProductionBatch(client, batchId);
    },
    onSuccess: (row) => {
      invalidateProductionBatch(queryClient, requireTenant(tenantId), row.id);
    },
  });
}

export interface CompleteProductionBatchVariables {
  batchId: string;
  input: CompleteProductionBatchInput;
}

/** Complete an in-progress batch — writes its consumption and output movements. */
export function useCompleteProductionBatch(
  client: BakeflowClient,
  tenantId: string | null,
): UseMutationResult<ProductionBatchWithIngredients, Error, CompleteProductionBatchVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ batchId, input }: CompleteProductionBatchVariables) => {
      requireTenant(tenantId);
      return completeProductionBatch(client, batchId, input);
    },
    onSuccess: ({ batch }) => {
      invalidateProductionBatch(queryClient, requireTenant(tenantId), batch.id);
    },
  });
}

export interface FailProductionBatchVariables {
  batchId: string;
  input: FailProductionBatchInput;
}

/** Fail an in-progress batch — writes its consumption movements, no output. */
export function useFailProductionBatch(
  client: BakeflowClient,
  tenantId: string | null,
): UseMutationResult<ProductionBatchWithIngredients, Error, FailProductionBatchVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ batchId, input }: FailProductionBatchVariables) => {
      requireTenant(tenantId);
      return failProductionBatch(client, batchId, input);
    },
    onSuccess: ({ batch }) => {
      invalidateProductionBatch(queryClient, requireTenant(tenantId), batch.id);
    },
  });
}

/**
 * Refresh the stock-level cache a completed adjustment invalidates.
 *
 * Keyed on `itemType`, not on the caller's guess of which list is mounted: `adjustStock`
 * takes either an ingredient or a product variant, and only the matching level list
 * (`ingredient-stock-levels` or `product-stock-levels`) for that warehouse could possibly
 * have changed. Invalidated by prefix — same reasoning as `invalidateDelivery` — so every
 * paged/filtered variant of that list currently cached is covered.
 */
function invalidateStockLevels(
  queryClient: QueryClient,
  tenantId: string,
  warehouseId: string,
  itemType: 'ingredient' | 'product',
): void {
  const listName = itemType === 'ingredient' ? 'ingredient-stock-levels' : 'product-stock-levels';
  void queryClient.invalidateQueries({ queryKey: orgScoped(tenantId, listName, warehouseId) });
}

/**
 * Set an item's stock in one warehouse to an absolute target — the P9.4 write path.
 *
 * No retry: `adjust_stock`'s absolute-target semantics make a *replay* safe (it would
 * either repeat a no-op or set the same target twice), but this still follows the same
 * no-retry convention as every other mutation here, so a transient failure surfaces to the
 * user rather than silently reapplying behind their back.
 */
export function useAdjustStock(
  client: BakeflowClient,
  tenantId: string | null,
): UseMutationResult<AdjustStockResult, Error, AdjustStockInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AdjustStockInput) => {
      requireTenant(tenantId);
      return adjustStock(client, input);
    },
    onSuccess: (_result, variables) => {
      invalidateStockLevels(
        queryClient,
        requireTenant(tenantId),
        variables.warehouseId,
        variables.itemType,
      );
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Driver trips (ADR-001)                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One page of driver trips, newest first. Narrowed by the same tenant/branch/driver
 * disjunction as `useDeliveries` — see `queries/driver-trips.ts`'s module header for the
 * live SELECT policy this mirrors.
 */
export function useDriverTrips(
  client: BakeflowClient,
  tenantId: string | null,
  filters?: DriverTripFilters,
  options?: PageOptions,
): UseQueryResult<Page<DriverTrip>, Error> {
  return useQuery({
    queryKey: queryKeys.driverTrips(tenantId ?? 'none', filters, options),
    queryFn: () => listDriverTrips(client, filters ?? {}, options),
    enabled: tenantId !== null,
  });
}

/**
 * One driver trip, or `null` when it does not exist, belongs to another organization, or
 * sits in a branch the caller cannot reach and is not their own.
 */
export function useDriverTrip(
  client: BakeflowClient,
  tenantId: string | null,
  tripId: string | null,
): UseQueryResult<DriverTrip | null, Error> {
  return useQuery({
    queryKey: queryKeys.driverTrip(tenantId ?? 'none', tripId ?? 'none'),
    queryFn: () => getDriverTripById(client, tripId ?? ''),
    enabled: tenantId !== null && tripId !== null,
  });
}

/**
 * The calling driver's own active trip, or `null` when they have none. This is what
 * `apps/mobile/app/driver/home.tsx` anchors on: the one query that answers "what phase of
 * Load → Go → Sell → Return → Reconcile am I in, if any."
 */
export function useCurrentDriverTrip(
  client: BakeflowClient,
  tenantId: string | null,
  driverId: string | null,
): UseQueryResult<DriverTrip | null, Error> {
  return useQuery({
    queryKey: queryKeys.currentDriverTrip(tenantId ?? 'none', driverId ?? 'none'),
    queryFn: () => getCurrentDriverTrip(client, driverId ?? ''),
    enabled: tenantId !== null && driverId !== null,
  });
}

/**
 * Refresh what a changed trip invalidates. Same shape as `invalidateDelivery`: the fresh
 * row is written straight into the detail key (the mutation already returned it, re-read
 * through the same projection this cache uses), the list is invalidated by tenant-scoped
 * prefix (a transition changes which filter/page the row belongs to), and — the one thing
 * with no analogue elsewhere — the driver's own `currentDriverTrip` key is invalidated too,
 * since that is a *different* cache entry from `driverTrip(tripId)` and a stale copy there
 * is exactly what would leave the Home screen showing a trip that just completed.
 */
function invalidateDriverTrip(queryClient: QueryClient, tenantId: string, row: DriverTrip): void {
  queryClient.setQueryData(queryKeys.driverTrip(tenantId, row.id), row);
  void queryClient.invalidateQueries({ queryKey: orgScoped(tenantId, 'driver-trips') });
  void queryClient.invalidateQueries({ queryKey: queryKeys.driverTrip(tenantId, row.id) });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.currentDriverTrip(tenantId, row.driver_id),
  });
}

/**
 * Start a new trip. No retry — a replay while the first call actually succeeded would hit
 * `driver_trips_one_active_per_driver` and surface as a confusing failure of an action that
 * already worked.
 */
export function useStartDriverTrip(
  client: BakeflowClient,
  tenantId: string | null,
): UseMutationResult<DriverTrip, Error, StartDriverTripInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: StartDriverTripInput) => {
      requireTenant(tenantId);
      return startDriverTrip(client, input);
    },
    onSuccess: (row) => {
      invalidateDriverTrip(queryClient, requireTenant(tenantId), row);
    },
  });
}

export interface VerifyTripLoadingVariables {
  tripId: string;
  input: VerifyTripLoadingInput;
}

/** Record and verify a trip's loading. Called by a supervisor/manager/baker, never the
 *  driver — see `mutations/driver-trips.ts`'s module header. */
export function useVerifyTripLoading(
  client: BakeflowClient,
  tenantId: string | null,
): UseMutationResult<DriverTrip, Error, VerifyTripLoadingVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tripId, input }: VerifyTripLoadingVariables) => {
      requireTenant(tenantId);
      return verifyTripLoading(client, tripId, input);
    },
    onSuccess: (row) => {
      invalidateDriverTrip(queryClient, requireTenant(tenantId), row);
    },
  });
}

export interface DriverTripIdVariables {
  tripId: string;
}

/** Depart with the loaded vehicle. The trip's own driver only. */
export function useDepartDriverTrip(
  client: BakeflowClient,
  tenantId: string | null,
): UseMutationResult<DriverTrip, Error, DriverTripIdVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tripId }: DriverTripIdVariables) => {
      requireTenant(tenantId);
      return departDriverTrip(client, tripId);
    },
    onSuccess: (row) => {
      invalidateDriverTrip(queryClient, requireTenant(tenantId), row);
    },
  });
}

export interface ReturnDriverTripVariables {
  tripId: string;
  input: ReturnDriverTripInput;
}

/** Record the physical return. The trip's own driver only. */
export function useReturnDriverTrip(
  client: BakeflowClient,
  tenantId: string | null,
): UseMutationResult<DriverTrip, Error, ReturnDriverTripVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tripId, input }: ReturnDriverTripVariables) => {
      requireTenant(tenantId);
      return returnDriverTrip(client, tripId, input);
    },
    onSuccess: (row) => {
      invalidateDriverTrip(queryClient, requireTenant(tenantId), row);
    },
  });
}

export interface ReconcileDriverTripVariables {
  tripId: string;
  input: ReconcileDriverTripInput;
}

/** Reconcile a returned trip's cash. Management only — never the driver. */
export function useReconcileDriverTrip(
  client: BakeflowClient,
  tenantId: string | null,
): UseMutationResult<DriverTrip, Error, ReconcileDriverTripVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tripId, input }: ReconcileDriverTripVariables) => {
      requireTenant(tenantId);
      return reconcileDriverTrip(client, tripId, input);
    },
    onSuccess: (row) => {
      invalidateDriverTrip(queryClient, requireTenant(tenantId), row);
    },
  });
}

export interface CompleteDriverTripVariables {
  tripId: string;
  input: CompleteDriverTripInput;
}

/** Close a reconciled trip out. Management only. */
export function useCompleteDriverTrip(
  client: BakeflowClient,
  tenantId: string | null,
): UseMutationResult<DriverTrip, Error, CompleteDriverTripVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tripId, input }: CompleteDriverTripVariables) => {
      requireTenant(tenantId);
      return completeDriverTrip(client, tripId, input);
    },
    onSuccess: (row) => {
      invalidateDriverTrip(queryClient, requireTenant(tenantId), row);
    },
  });
}

export interface RecordDriverTripPaymentVariables {
  tripId: string;
  input: RecordDriverTripPaymentInput;
}

/**
 * Record a payment collected on the road, scoped to this trip's own cash custody rather
 * than a till session (AD-018). Does not change `driver_trips.status`, but the trip detail
 * key is still invalidated: `reconcile_driver_trip()`'s `expected_cash` is computed from
 * this payment, so a screen showing that figure should not serve a stale one.
 */
export function useRecordDriverTripPayment(
  client: BakeflowClient,
  tenantId: string | null,
): UseMutationResult<RecordDriverTripPaymentResult, Error, RecordDriverTripPaymentVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tripId, input }: RecordDriverTripPaymentVariables) => {
      requireTenant(tenantId);
      return recordDriverTripPayment(client, tripId, input);
    },
    onSuccess: (_result, variables) => {
      const tenant = requireTenant(tenantId);
      void queryClient.invalidateQueries({ queryKey: queryKeys.driverTrip(tenant, variables.tripId) });
    },
  });
}

/**
 * What one driver trip has sold so far — the "Sell" screen's running list. Each row stays
 * `draft` (see `mutations/sales.ts`'s header on **BLOCKER-021**) until the office advances
 * it, so this is "created", not "confirmed".
 */
export function useDriverTripTickets(
  client: BakeflowClient,
  tenantId: string | null,
  tripId: string | null,
): UseQueryResult<Page<Ticket>, Error> {
  const filters: TicketFilters | undefined =
    tripId === null ? undefined : { driverTripId: tripId };
  return useQuery({
    queryKey: queryKeys.driverTripTickets(tenantId ?? 'none', tripId ?? 'none'),
    queryFn: () => listTickets(client, filters ?? {}),
    enabled: tenantId !== null && tripId !== null,
  });
}

export interface CreateRoadsideTicketVariables {
  input: CreateRoadsideTicketInput;
}

/**
 * Create a roadside ticket for a sale made during the current trip — the "Sell" step.
 * Stays `draft`; no lifecycle RPC is called (BLOCKER-021). Invalidates the trip's own
 * running sales list, not `driverTrip` — creating a ticket does not change trip status.
 */
export function useCreateRoadsideTicket(
  client: BakeflowClient,
  tenantId: string | null,
): UseMutationResult<TicketWithItems, Error, CreateRoadsideTicketVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ input }: CreateRoadsideTicketVariables) => {
      const tenant = requireTenant(tenantId);
      return createRoadsideTicket(client, tenant, input);
    },
    onSuccess: (_result, variables) => {
      const tenant = requireTenant(tenantId);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.driverTripTickets(tenant, variables.input.driverTripId),
      });
    },
  });
}
