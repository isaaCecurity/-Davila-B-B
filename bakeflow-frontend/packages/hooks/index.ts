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
  listMyOrganizationRoles,
  listMyOrganizations,
  listProductCategories,
  listProducts,
  listVariantsByProduct,
  type BakeflowClient,
  type KeysetPageOptions,
  type Page,
} from '@bakeflow/api';
import type {
  OrganizationMembership,
  OrganizationRole,
  Product,
  ProductCategory,
  ProductVariant,
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
