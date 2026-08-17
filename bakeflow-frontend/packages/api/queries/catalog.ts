/**
 * Catalog read service — P4.1a. **Read path only; there is deliberately no write here.**
 *
 * ## Mechanism: PostgREST + RLS, not RPCs
 *
 * `API-CONTRACT.md` §1 assigns reads and simple filtered lists to PostgREST protected by
 * RLS, and reserves RPCs for operations that must be atomic. Catalog reads are neither
 * multi-step nor financial, so **no catalog RPC exists and none should be written.** The
 * roadmap previously specified "CRUD RPCs with tenant/branch scoping" for this milestone;
 * both halves of that were wrong and have been corrected.
 *
 * ## What enforces isolation
 *
 * Verified live on 2026-08-11: all six catalog tables have RLS **enabled and forced**,
 * with 24 policies between them. The SELECT policy on every one is
 *
 * ```sql
 * tenant_id = current_tenant_id() AND deleted_at IS NULL
 * ```
 *
 * where `current_tenant_id()` reads `auth.jwt() ->> 'tenant_id'` — the **active**
 * organization, per AD-003. Two consequences this module depends on:
 *
 * - **A denied read is an empty set, not an error.** Postgres RLS filters `SELECT`; it
 *   does not raise. Cross-organization isolation is therefore proven by asserting row
 *   counts, never by expecting an exception.
 * - **A revoked membership yields a null `tenant_id` claim**, and `NULL = anything` is
 *   `NULL`, so every policy denies and every catalog list comes back empty. That is the
 *   correct behaviour, and it is why the UI needs a distinct "no organization selected"
 *   state rather than rendering an empty catalog (P8.1).
 *
 * The `.is('deleted_at', null)` filter each query adds is redundant with RLS. It is kept
 * because `API-CONTRACT.md` §4 requires every read to filter it explicitly: RLS is the
 * safety net, not the query's contract.
 *
 * ## AD-006 is not violated here
 *
 * AD-006 forbids `current_tenant_id()` in any **sync** path, because a queued operation
 * belongs to the organization it was created under, not the active one. This is the
 * **interactive read** path, where "what the user is looking at now" is exactly the right
 * question. The distinction is deliberate; the catalog policies are not to be "fixed".
 *
 * ## Money precision
 *
 * Every `NUMERIC` column is selected with a `::text` cast, because PostgreSQL renders
 * `numeric` unquoted in JSON and `JSON.parse` collapses it to a double — see
 * `@bakeflow/types` `scalars.ts` for the executed evidence. **The projection is derived
 * from the Zod schema** (`projectionFor`) rather than hand-written beside it, so a column
 * cannot be selected without its cast, and schema and projection cannot drift apart.
 *
 * ## Caller responsibility this layer cannot discharge
 *
 * A returned row carries its `tenant_id`. Cache keys derived only from arguments would be
 * **identical across organizations**, so a TanStack Query cache must be keyed on (or
 * invalidated by) the active organization — otherwise switching bakeries serves the
 * previous one's catalog from cache. That belongs to the P8.1 hook layer; this note is
 * here because nothing in these signatures forces the issue.
 */

import type {
  Ingredient,
  Product,
  ProductCategory,
  ProductVariant,
  ProductWithVariants,
  Recipe,
  RecipeBillOfMaterials,
  RecipeIngredient,
  RecipeIngredientDetail,
  Uuid,
} from '@bakeflow/types';
import {
  ingredientSchema,
  productCategorySchema,
  productSchema,
  productVariantSchema,
  recipeIngredientSchema,
  recipeSchema,
} from '@bakeflow/validation';
import type { z } from 'zod';

import type { BakeflowClient } from '../client';
import {
  chunk,
  IN_CLAUSE_CHUNK,
  parseRow,
  parseRows,
  projectionFor,
  resolveLimit,
  run,
  type Page,
  type PageOptions,
  type ReadEntity,
  type SchemaShape,
} from '../internal/read';

/* -------------------------------------------------------------------------- */
/* Column projections, derived from the schemas                                */
/* -------------------------------------------------------------------------- */

/**
 * Columns that must be cast to text so their exact decimal scale survives transport.
 * Every `NUMERIC` column across the six catalog tables appears here.
 */
const TEXT_CAST_COLUMNS: ReadonlySet<string> = new Set([
  'unit_price',
  'reorder_level',
  'last_unit_cost',
  'yield_quantity',
  'quantity',
]);

/**
 * All six catalog tables carry `deleted_at`/`deleted_by`, verified live 2026-08-11: the
 * SELECT policy on every one is `tenant_id = current_tenant_id() AND deleted_at IS NULL`,
 * and the 2026-08-14 migration `partial_unique_indexes_for_soft_delete_restore` rebuilt
 * five of their unique indexes as `WHERE deleted_at IS NULL`.
 */
function entity<T>(table: string, schema: z.ZodType<T> & SchemaShape): ReadEntity<T> {
  return {
    table,
    schema,
    columns: projectionFor(schema, TEXT_CAST_COLUMNS),
    softDeleted: true,
  };
}

const CATEGORIES = entity<ProductCategory>('product_categories', productCategorySchema);
const PRODUCTS = entity<Product>('products', productSchema);
const VARIANTS = entity<ProductVariant>('product_variants', productVariantSchema);
const INGREDIENTS = entity<Ingredient>('ingredients', ingredientSchema);
const RECIPES = entity<Recipe>('recipes', recipeSchema);
const RECIPE_LINES = entity<RecipeIngredient>('recipe_ingredients', recipeIngredientSchema);

/* -------------------------------------------------------------------------- */
/* Paging                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Keyset paging options.
 *
 * `API-CONTRACT.md` §4 mandates keyset rather than offset, because offset drifts when
 * rows are inserted mid-scroll. Each paged list orders by a column that is **unique
 * within a tenant** (`products.name`, `product_variants.sku`, `ingredients.name`, all
 * backed by non-partial unique indexes verified live), so a single-column cursor is
 * sufficient and no `(sort_key, id)` tiebreak is needed.
 *
 * Categories, variants-of-a-product and recipe lines are not paged: each is bounded by
 * its parent.
 */
export interface KeysetPageOptions extends PageOptions {
  /** Restrict to `is_active = true`. Omitted means both. */
  activeOnly?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Shared read shapes                                                          */
/* -------------------------------------------------------------------------- */

/** Fetch one row by primary key. */
async function getById<T>(
  client: BakeflowClient,
  target: ReadEntity<T>,
  id: Uuid,
  context: string,
): Promise<T | null> {
  const data = await run(
    client
      .from(target.table)
      .select(target.columns)
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle(),
  );
  return parseRow(target.schema, data, context);
}

/**
 * Fetch one keyset page, ordered by `sortColumn`.
 *
 * Fetches `limit + 1` rows and uses the surplus row purely as the has-more signal, so
 * `nextCursor` is exact rather than inferred from page length.
 */
async function getPage<T extends Record<string, unknown>>(
  client: BakeflowClient,
  target: ReadEntity<T>,
  sortColumn: string,
  options: KeysetPageOptions,
  context: string,
  /** Extra equality filters, as data rather than a builder callback — the builder's type
   *  changes after `.select()`, and threading that through a callback buys nothing. */
  eqFilters: Readonly<Record<string, string>> = {},
): Promise<Page<T>> {
  const limit = resolveLimit(options.limit);

  let query = client.from(target.table).select(target.columns).is('deleted_at', null);
  for (const [column, value] of Object.entries(eqFilters)) query = query.eq(column, value);
  if (options.activeOnly === true) query = query.eq('is_active', true);
  if (options.after !== undefined) query = query.gt(sortColumn, options.after);

  const data = await run(query.order(sortColumn, { ascending: true }).limit(limit + 1));
  const rows = parseRows(target.schema, data, context);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.length > 0 ? page[page.length - 1] : undefined;
  const cursorValue = last === undefined ? undefined : last[sortColumn];

  return {
    rows: page,
    nextCursor: hasMore && typeof cursorValue === 'string' ? cursorValue : null,
  };
}

/* -------------------------------------------------------------------------- */
/* Product categories                                                          */
/* -------------------------------------------------------------------------- */

/**
 * All categories for the active organization.
 *
 * Unpaged: `product_categories` is a small hand-curated list. Ordered by `sort_order`
 * then `name`, which is the display order the `sort_order` column exists to provide.
 */
export async function listProductCategories(
  client: BakeflowClient,
): Promise<ProductCategory[]> {
  const data = await run(
    client
      .from(CATEGORIES.table)
      .select(CATEGORIES.columns)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
  );
  return parseRows(CATEGORIES.schema, data, 'listProductCategories');
}

/* -------------------------------------------------------------------------- */
/* Products                                                                    */
/* -------------------------------------------------------------------------- */

/** One page of products, ordered by `name` (unique per tenant, so a safe cursor). */
export function listProducts(
  client: BakeflowClient,
  options: KeysetPageOptions = {},
): Promise<Page<Product>> {
  return getPage(client, PRODUCTS, 'name', options, 'listProducts');
}

/** Products in one category. Same cursor column as `listProducts`. */
export function listProductsByCategory(
  client: BakeflowClient,
  categoryId: Uuid,
  options: KeysetPageOptions = {},
): Promise<Page<Product>> {
  return getPage(client, PRODUCTS, 'name', options, 'listProductsByCategory', {
    category_id: categoryId,
  });
}

/**
 * One product, or `null` when it does not exist, belongs to another organization, or is
 * soft-deleted. All three are indistinguishable to the client by design — telling them
 * apart would leak the existence of another organization's row.
 */
export function getProductById(
  client: BakeflowClient,
  productId: Uuid,
): Promise<Product | null> {
  return getById(client, PRODUCTS, productId, 'getProductById');
}

/* -------------------------------------------------------------------------- */
/* Product variants                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Variants of one product, ordered by name. Unpaged: a product has a handful of variants,
 * bounded by the parent.
 */
export async function listVariantsByProduct(
  client: BakeflowClient,
  productId: Uuid,
  options: { activeOnly?: boolean } = {},
): Promise<ProductVariant[]> {
  let query = client
    .from(VARIANTS.table)
    .select(VARIANTS.columns)
    .eq('product_id', productId)
    .is('deleted_at', null);

  if (options.activeOnly === true) query = query.eq('is_active', true);

  const data = await run(query.order('name', { ascending: true }));
  return parseRows(VARIANTS.schema, data, 'listVariantsByProduct');
}

/**
 * Every variant in the organization, ordered by `sku` (unique per tenant, so a safe
 * cursor). This is the export/administrative path; a catalog screen wants
 * `listVariantsByProduct`.
 */
export function listProductVariants(
  client: BakeflowClient,
  options: KeysetPageOptions = {},
): Promise<Page<ProductVariant>> {
  return getPage(client, VARIANTS, 'sku', options, 'listProductVariants');
}

/** One variant, or `null`. See `getProductById` on why the null cases are merged. */
export function getProductVariantById(
  client: BakeflowClient,
  variantId: Uuid,
): Promise<ProductVariant | null> {
  return getById(client, VARIANTS, variantId, 'getProductVariantById');
}

/**
 * A product with its variants attached.
 *
 * Two round trips rather than one PostgREST embed. An embed would need a nested
 * `deleted_at` filter on the embedded resource, and getting that subtly wrong fails
 * open — it shows soft-deleted variants — which is the failure direction that matters.
 * Two explicitly filtered, independently validated queries cost one *extra* round trip
 * and cannot fail that way.
 *
 * The `tenant_id` equality check is defence in depth, not RLS duplication: RLS already
 * guarantees it for an `authenticated` client, but this function would otherwise join
 * across organizations without complaint if ever handed a `service_role` client, which
 * bypasses RLS entirely. Failing closed costs one comparison.
 */
export async function getProductWithVariants(
  client: BakeflowClient,
  productId: Uuid,
  options: { activeVariantsOnly?: boolean } = {},
): Promise<ProductWithVariants | null> {
  const product = await getProductById(client, productId);
  if (product === null) return null;

  const variants = await listVariantsByProduct(client, productId, {
    ...(options.activeVariantsOnly === undefined
      ? {}
      : { activeOnly: options.activeVariantsOnly }),
  });

  return { ...product, variants: variants.filter((v) => v.tenant_id === product.tenant_id) };
}

/* -------------------------------------------------------------------------- */
/* Ingredients                                                                 */
/* -------------------------------------------------------------------------- */

/** One page of ingredients, ordered by `name` (unique per tenant). */
export function listIngredients(
  client: BakeflowClient,
  options: KeysetPageOptions = {},
): Promise<Page<Ingredient>> {
  return getPage(client, INGREDIENTS, 'name', options, 'listIngredients');
}

/** One ingredient, or `null`. */
export function getIngredientById(
  client: BakeflowClient,
  ingredientId: Uuid,
): Promise<Ingredient | null> {
  return getById(client, INGREDIENTS, ingredientId, 'getIngredientById');
}

/* -------------------------------------------------------------------------- */
/* Recipes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The active recipe for a variant, or `null` when none is set.
 *
 * At most one row can come back: the live partial unique index
 * `recipes_one_active_per_variant ON (tenant_id, product_variant_id) WHERE is_active`
 * makes "one active recipe per variant" a database guarantee, not a convention. If that
 * invariant were ever broken the read surfaces `multiple_rows_returned` rather than
 * silently picking one — which is why `PGRST116` must not be mapped to `not_found`.
 *
 * Note the index is partial on `is_active` and **not** on `deleted_at`, so a soft-deleted
 * but still-`is_active` recipe occupies the slot. That is BLOCKER-010(a); it is designed
 * around here, not fixed.
 */
export async function getActiveRecipeForVariant(
  client: BakeflowClient,
  variantId: Uuid,
): Promise<Recipe | null> {
  const data = await run(
    client
      .from(RECIPES.table)
      .select(RECIPES.columns)
      .eq('product_variant_id', variantId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle(),
  );
  return parseRow(RECIPES.schema, data, 'getActiveRecipeForVariant');
}

/** Every recipe version for a variant, newest version first. Bounded, so unpaged. */
export async function listRecipeVersionsForVariant(
  client: BakeflowClient,
  variantId: Uuid,
): Promise<Recipe[]> {
  const data = await run(
    client
      .from(RECIPES.table)
      .select(RECIPES.columns)
      .eq('product_variant_id', variantId)
      .is('deleted_at', null)
      .order('version', { ascending: false }),
  );
  return parseRows(RECIPES.schema, data, 'listRecipeVersionsForVariant');
}

/** One recipe, or `null`. */
export function getRecipeById(
  client: BakeflowClient,
  recipeId: Uuid,
): Promise<Recipe | null> {
  return getById(client, RECIPES, recipeId, 'getRecipeById');
}

/**
 * The raw BOM lines for a recipe, without the ingredients resolved.
 *
 * Ordered by `(created_at, id)`: `created_at` alone is not unique, so ties would reorder
 * between fetches and a baker's checklist would appear to shuffle.
 */
export async function listRecipeIngredients(
  client: BakeflowClient,
  recipeId: Uuid,
): Promise<RecipeIngredient[]> {
  const data = await run(
    client
      .from(RECIPE_LINES.table)
      .select(RECIPE_LINES.columns)
      .eq('recipe_id', recipeId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
  );
  return parseRows(RECIPE_LINES.schema, data, 'listRecipeIngredients');
}

/**
 * The recipes named by a set of ids.
 *
 * Exists to put names on rows that carry only a `recipe_id` — the production batch list is
 * the caller. Deliberately id-driven rather than a paged `listRecipes()`: `recipes` has no
 * tenant-unique text column to key a cursor on (`UNIQUE (tenant_id, product_variant_id,
 * version)` is composite and `name` is not unique at all), so a keyset page would need a
 * composite cursor to decorate a set that is already bounded by the page it belongs to.
 *
 * Ids that are not visible are simply absent from the result rather than an error. The
 * caller renders those rows with no recipe name instead of hiding them: a batch whose
 * recipe was soft-deleted is still a batch that was produced, and dropping it would
 * under-report what the bakery made.
 */
export async function listRecipesByIds(
  client: BakeflowClient,
  recipeIds: readonly Uuid[],
): Promise<Recipe[]> {
  const unique = [...new Set(recipeIds)];
  if (unique.length === 0) return [];

  const batches = await Promise.all(
    chunk(unique, IN_CLAUSE_CHUNK).map(async (ids) =>
      parseRows(
        RECIPES.schema,
        await run(
          client
            .from(RECIPES.table)
            .select(RECIPES.columns)
            .in('id', ids)
            .is('deleted_at', null),
        ),
        'listRecipesByIds',
      ),
    ),
  );
  return batches.flat();
}

/**
 * A recipe with its bill of materials resolved.
 *
 * Lines whose ingredient is not visible are returned in `unresolvedLines` rather than
 * dropped. That is a reachable state, not paranoia: AD-012 soft-deletes an ingredient
 * instead of deleting it, so `ON DELETE RESTRICT` never fires and the line outlives its
 * ingredient's visibility. Silently omitting those lines would under-report what a recipe
 * consumes.
 *
 * A line whose ingredient belongs to a different organization is also treated as
 * unresolved. The composite FK makes that unstorable and RLS makes it unreadable, so it
 * is unreachable today — but it is the correct fail-closed behaviour if this is ever
 * handed a `service_role` client, which bypasses RLS.
 */
export async function getRecipeBillOfMaterials(
  client: BakeflowClient,
  recipeId: Uuid,
): Promise<RecipeBillOfMaterials | null> {
  // Independent reads, so they overlap rather than queue. At a realistic mobile RTT this
  // is the difference between two round trips and three.
  const [recipe, lines] = await Promise.all([
    getRecipeById(client, recipeId),
    listRecipeIngredients(client, recipeId),
  ]);
  if (recipe === null) return null;
  if (lines.length === 0) return { ...recipe, lines: [], unresolvedLines: [] };

  const ingredientIds = [...new Set(lines.map((line) => line.ingredient_id))];
  const batches = await Promise.all(
    chunk(ingredientIds, IN_CLAUSE_CHUNK).map(async (ids) =>
      parseRows(
        INGREDIENTS.schema,
        await run(
          client
            .from(INGREDIENTS.table)
            .select(INGREDIENTS.columns)
            .in('id', ids)
            .is('deleted_at', null),
        ),
        'getRecipeBillOfMaterials.ingredients',
      ),
    ),
  );

  const byId = new Map(
    batches.flat().map((ingredient) => [ingredient.id, ingredient] as const),
  );

  const resolved: RecipeIngredientDetail[] = [];
  const unresolved: RecipeIngredient[] = [];

  for (const line of lines) {
    const ingredient = byId.get(line.ingredient_id);
    if (ingredient === undefined || ingredient.tenant_id !== recipe.tenant_id) {
      unresolved.push(line);
    } else {
      resolved.push({ ...line, ingredient });
    }
  }

  return { ...recipe, lines: resolved, unresolvedLines: unresolved };
}
