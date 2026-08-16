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
  getProductById,
  getProductionBatchWithIngredients,
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
  listVariantsByProduct,
  listWarehouses,
  type BakeflowClient,
  type KeysetPageOptions,
  type Page,
  type PageOptions,
  type ProductionBatchFilters,
} from '@bakeflow/api';
import type {
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
  Warehouse,
} from '@bakeflow/types';
import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query';

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
