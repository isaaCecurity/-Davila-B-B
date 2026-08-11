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
 *   counts, never by expecting an exception. `tests/sql/catalog_read_rls.sql` tests it
 *   that way.
 * - **A revoked membership yields a null `tenant_id` claim**, and `NULL = anything` is
 *   `NULL`, so every policy denies and every catalog list comes back empty. That is the
 *   correct behaviour, and it is why the UI needs a distinct "no organization selected"
 *   state rather than rendering an empty catalog (P8.1).
 *
 * The `.is('deleted_at', null)` filter each query below adds is therefore redundant with
 * RLS. It is kept because `API-CONTRACT.md` §4 requires every read to filter it
 * explicitly: RLS is the safety net, not the query's contract, and the day a policy is
 * loosened the queries should not start showing deleted rows.
 *
 * ## AD-006 is not violated here
 *
 * AD-006 forbids `current_tenant_id()` in any **sync** path, because a queued operation
 * belongs to the organization it was created under, not the active one. This is the
 * **interactive read** path, where "what the user is looking at now" is exactly the
 * right question, so `current_tenant_id()` is correct. The distinction is deliberate;
 * the catalog policies are not to be "fixed".
 *
 * ## Money precision
 *
 * Every `NUMERIC` column is selected with a `::text` cast. Without it PostgreSQL renders
 * `numeric` as an unquoted JSON number and `JSON.parse` destroys the scale before any
 * application code runs — verified live, see `@bakeflow/types` `scalars.ts`. The Zod
 * schemas reject a JSON number in these positions, so dropping a cast fails loudly at
 * the boundary instead of silently corrupting money.
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
  BakeflowApiError,
  normalizePostgrestError,
  normalizeThrown,
  type PostgrestErrorLike,
} from '../errors';

/* -------------------------------------------------------------------------- */
/* Column projections                                                          */
/* -------------------------------------------------------------------------- */

/**
 * `API-CONTRACT.md` §4: select explicit columns, never `*`.
 *
 * `created_by`, `deleted_at` and `deleted_by` are omitted deliberately — the read path
 * can never observe a soft-deleted row, and `created_by` is an audit column no catalog
 * screen renders.
 */
const CATEGORY_COLUMNS = 'id,tenant_id,name,sort_order,created_at,updated_at';

const PRODUCT_COLUMNS =
  'id,tenant_id,category_id,name,description,image_url,is_active,created_at,updated_at';

/** `unit_price::text` — see the money-precision note above. */
const VARIANT_COLUMNS =
  'id,tenant_id,product_id,name,sku,unit_price::text,is_active,created_at,updated_at';

/** `reorder_level::text`, `last_unit_cost::text`. */
const INGREDIENT_COLUMNS =
  'id,tenant_id,name,unit_of_measure,reorder_level::text,last_unit_cost::text,' +
  'is_active,created_at,updated_at';

/** `yield_quantity::text`. */
const RECIPE_COLUMNS =
  'id,tenant_id,product_variant_id,name,yield_quantity::text,version,is_active,' +
  'created_at,updated_at';

/** `quantity::text`. */
const RECIPE_INGREDIENT_COLUMNS =
  'id,tenant_id,recipe_id,ingredient_id,quantity::text,created_at,updated_at';

/* -------------------------------------------------------------------------- */
/* Paging                                                                      */
/* -------------------------------------------------------------------------- */

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/**
 * Keyset paging options.
 *
 * `API-CONTRACT.md` §4 mandates keyset rather than offset, because offset drifts when
 * rows are inserted mid-scroll. Each paged list below orders by a column that is
 * **unique within a tenant** (`products.name`, `product_variants.sku`,
 * `ingredients.name` — all backed by unique indexes verified live), so a single-column
 * cursor is sufficient and no `(sort_key, id)` tiebreak is needed.
 *
 * Categories, variants-of-a-product and recipe lines are not paged: each is bounded by
 * its parent, and paging them would add a cursor round-trip for a list of ten.
 */
export interface KeysetPageOptions {
  /** Rows per page. Clamped to `MAX_PAGE_SIZE`. */
  limit?: number;
  /** Exclusive cursor — return rows whose sort key sorts strictly after this. */
  after?: string;
  /** Restrict to `is_active = true`. Omitted means both. */
  activeOnly?: boolean;
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new BakeflowApiError({
      code: 'invalid_request',
      message: `limit must be a positive integer, received ${String(limit)}`,
    });
  }
  return Math.min(limit, MAX_PAGE_SIZE);
}

/* -------------------------------------------------------------------------- */
/* Response gate                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Narrow an untrusted PostgREST payload to a typed array.
 *
 * The payload is `unknown`, never `any`. `BakeflowClient` is intentionally not
 * parameterised with the generated `Database` type (see `../client`), so this is the one
 * place the boundary is crossed, and it is crossed by a checked parse rather than an
 * assertion.
 */
function parseRows<T>(schema: z.ZodType<T>, payload: unknown, context: string): T[] {
  if (!Array.isArray(payload)) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: `${context}: expected an array of rows, received ${typeof payload}`,
    });
  }

  const rows: T[] = [];
  for (let index = 0; index < payload.length; index += 1) {
    const result = schema.safeParse(payload[index]);
    if (!result.success) {
      const detail = result.error.issues
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; ');
      throw new BakeflowApiError({
        code: 'response_shape_invalid',
        message: `${context}: row ${index} did not match its schema`,
        details: detail,
        cause: result.error,
      });
    }
    rows.push(result.data);
  }
  return rows;
}

/** Narrow a single-row payload, treating an absent row as `not_found`. */
function parseMaybeRow<T>(schema: z.ZodType<T>, payload: unknown, context: string): T | null {
  if (payload === null || payload === undefined) return null;
  const rows = parseRows(schema, [payload], context);
  return rows[0] ?? null;
}

/** Shape of what `supabase-js` resolves to. Declared structurally — this package has no
 *  runtime dependency on `@supabase/supabase-js`. */
interface PostgrestResultLike {
  data: unknown;
  error: PostgrestErrorLike | null;
}

/**
 * Run a query, normalizing both failure modes.
 *
 * `supabase-js` reports a database error in `{ error }` but **rejects** when `fetch`
 * itself fails, so offline is a throw. Mobile is offline routinely
 * (`API-CONTRACT.md` §6), so both paths are handled rather than only the tidy one.
 */
async function run(query: PromiseLike<PostgrestResultLike>): Promise<unknown> {
  let result: PostgrestResultLike;
  try {
    result = await query;
  } catch (thrown) {
    throw normalizeThrown(thrown);
  }
  if (result.error !== null) throw normalizePostgrestError(result.error);
  return result.data;
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
      .from('product_categories')
      .select(CATEGORY_COLUMNS)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
  );
  return parseRows(productCategorySchema, data, 'listProductCategories');
}

/* -------------------------------------------------------------------------- */
/* Products                                                                    */
/* -------------------------------------------------------------------------- */

/** One page of products, ordered by `name` (unique per tenant, so a safe cursor). */
export async function listProducts(
  client: BakeflowClient,
  options: KeysetPageOptions = {},
): Promise<Product[]> {
  let query = client
    .from('products')
    .select(PRODUCT_COLUMNS)
    .is('deleted_at', null)
    .order('name', { ascending: true })
    .limit(clampLimit(options.limit));

  if (options.activeOnly === true) query = query.eq('is_active', true);
  if (options.after !== undefined) query = query.gt('name', options.after);

  return parseRows(productSchema, await run(query), 'listProducts');
}

/** Products in one category. Same paging contract as `listProducts`. */
export async function listProductsByCategory(
  client: BakeflowClient,
  categoryId: Uuid,
  options: KeysetPageOptions = {},
): Promise<Product[]> {
  let query = client
    .from('products')
    .select(PRODUCT_COLUMNS)
    .eq('category_id', categoryId)
    .is('deleted_at', null)
    .order('name', { ascending: true })
    .limit(clampLimit(options.limit));

  if (options.activeOnly === true) query = query.eq('is_active', true);
  if (options.after !== undefined) query = query.gt('name', options.after);

  return parseRows(productSchema, await run(query), 'listProductsByCategory');
}

/**
 * One product, or `null` when it does not exist, belongs to another organization, or is
 * soft-deleted. All three are indistinguishable to the client by design — telling them
 * apart would leak the existence of another organization's row.
 */
export async function getProductById(
  client: BakeflowClient,
  productId: Uuid,
): Promise<Product | null> {
  const data = await run(
    client
      .from('products')
      .select(PRODUCT_COLUMNS)
      .eq('id', productId)
      .is('deleted_at', null)
      .maybeSingle(),
  );
  return parseMaybeRow(productSchema, data, 'getProductById');
}

/* -------------------------------------------------------------------------- */
/* Product variants                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Variants of one product, ordered by name. Unpaged: a product has a handful of
 * variants, bounded by the parent.
 */
export async function listVariantsByProduct(
  client: BakeflowClient,
  productId: Uuid,
  options: { activeOnly?: boolean } = {},
): Promise<ProductVariant[]> {
  let query = client
    .from('product_variants')
    .select(VARIANT_COLUMNS)
    .eq('product_id', productId)
    .is('deleted_at', null)
    .order('name', { ascending: true });

  if (options.activeOnly === true) query = query.eq('is_active', true);

  return parseRows(productVariantSchema, await run(query), 'listVariantsByProduct');
}

/**
 * Every variant in the organization, ordered by `sku` (unique per tenant, so a safe
 * cursor). This is the export/administrative path; a catalog screen wants
 * `listVariantsByProduct`.
 */
export async function listProductVariants(
  client: BakeflowClient,
  options: KeysetPageOptions = {},
): Promise<ProductVariant[]> {
  let query = client
    .from('product_variants')
    .select(VARIANT_COLUMNS)
    .is('deleted_at', null)
    .order('sku', { ascending: true })
    .limit(clampLimit(options.limit));

  if (options.activeOnly === true) query = query.eq('is_active', true);
  if (options.after !== undefined) query = query.gt('sku', options.after);

  return parseRows(productVariantSchema, await run(query), 'listProductVariants');
}

/** One variant, or `null`. See `getProductById` on why the null cases are merged. */
export async function getProductVariantById(
  client: BakeflowClient,
  variantId: Uuid,
): Promise<ProductVariant | null> {
  const data = await run(
    client
      .from('product_variants')
      .select(VARIANT_COLUMNS)
      .eq('id', variantId)
      .is('deleted_at', null)
      .maybeSingle(),
  );
  return parseMaybeRow(productVariantSchema, data, 'getProductVariantById');
}

/**
 * A product with its variants attached.
 *
 * Two round trips rather than one PostgREST embed. An embed would need a nested
 * `deleted_at` filter on the embedded resource, and getting that subtly wrong fails
 * open — it shows soft-deleted variants — which is the failure direction that matters
 * here. Two explicitly filtered, independently validated queries cost one round trip and
 * cannot fail that way.
 */
export async function getProductWithVariants(
  client: BakeflowClient,
  productId: Uuid,
  options: { activeOnly?: boolean } = {},
): Promise<ProductWithVariants | null> {
  const product = await getProductById(client, productId);
  if (product === null) return null;
  const variants = await listVariantsByProduct(client, productId, options);
  return { ...product, variants };
}

/* -------------------------------------------------------------------------- */
/* Ingredients                                                                 */
/* -------------------------------------------------------------------------- */

/** One page of ingredients, ordered by `name` (unique per tenant). */
export async function listIngredients(
  client: BakeflowClient,
  options: KeysetPageOptions = {},
): Promise<Ingredient[]> {
  let query = client
    .from('ingredients')
    .select(INGREDIENT_COLUMNS)
    .is('deleted_at', null)
    .order('name', { ascending: true })
    .limit(clampLimit(options.limit));

  if (options.activeOnly === true) query = query.eq('is_active', true);
  if (options.after !== undefined) query = query.gt('name', options.after);

  return parseRows(ingredientSchema, await run(query), 'listIngredients');
}

/** One ingredient, or `null`. */
export async function getIngredientById(
  client: BakeflowClient,
  ingredientId: Uuid,
): Promise<Ingredient | null> {
  const data = await run(
    client
      .from('ingredients')
      .select(INGREDIENT_COLUMNS)
      .eq('id', ingredientId)
      .is('deleted_at', null)
      .maybeSingle(),
  );
  return parseMaybeRow(ingredientSchema, data, 'getIngredientById');
}

/* -------------------------------------------------------------------------- */
/* Recipes                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The active recipe for a variant, or `null` when none is set.
 *
 * At most one row can come back: the live partial unique index
 * `recipes_one_active_per_variant ON (tenant_id, product_variant_id) WHERE is_active`
 * makes "one active recipe per variant" a database guarantee, not a convention. Note the
 * index is partial on `is_active` and **not** on `deleted_at` — a soft-deleted but still
 * `is_active` recipe therefore still occupies the slot. That is the schema defect
 * recorded as BLOCKER-010(a); it is designed around here, not fixed.
 */
export async function getActiveRecipeForVariant(
  client: BakeflowClient,
  variantId: Uuid,
): Promise<Recipe | null> {
  const data = await run(
    client
      .from('recipes')
      .select(RECIPE_COLUMNS)
      .eq('product_variant_id', variantId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle(),
  );
  return parseMaybeRow(recipeSchema, data, 'getActiveRecipeForVariant');
}

/** Every recipe version for a variant, newest version first. Bounded, so unpaged. */
export async function listRecipeVersionsForVariant(
  client: BakeflowClient,
  variantId: Uuid,
): Promise<Recipe[]> {
  const data = await run(
    client
      .from('recipes')
      .select(RECIPE_COLUMNS)
      .eq('product_variant_id', variantId)
      .is('deleted_at', null)
      .order('version', { ascending: false }),
  );
  return parseRows(recipeSchema, data, 'listRecipeVersionsForVariant');
}

/** One recipe, or `null`. */
export async function getRecipeById(
  client: BakeflowClient,
  recipeId: Uuid,
): Promise<Recipe | null> {
  const data = await run(
    client
      .from('recipes')
      .select(RECIPE_COLUMNS)
      .eq('id', recipeId)
      .is('deleted_at', null)
      .maybeSingle(),
  );
  return parseMaybeRow(recipeSchema, data, 'getRecipeById');
}

/** The raw BOM lines for a recipe, without the ingredients resolved. */
export async function listRecipeIngredients(
  client: BakeflowClient,
  recipeId: Uuid,
): Promise<RecipeIngredient[]> {
  const data = await run(
    client
      .from('recipe_ingredients')
      .select(RECIPE_INGREDIENT_COLUMNS)
      .eq('recipe_id', recipeId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true }),
  );
  return parseRows(recipeIngredientSchema, data, 'listRecipeIngredients');
}

/**
 * A recipe with its bill of materials resolved.
 *
 * Lines whose ingredient is not visible are returned in `unresolvedLines` rather than
 * dropped. That is a reachable state, not paranoia: AD-012 soft-deletes an ingredient
 * instead of deleting it, so `ON DELETE RESTRICT` never fires and the line outlives its
 * ingredient's visibility. Silently omitting those lines would under-report what a
 * recipe consumes.
 */
export async function getRecipeBillOfMaterials(
  client: BakeflowClient,
  recipeId: Uuid,
): Promise<RecipeBillOfMaterials | null> {
  const recipe = await getRecipeById(client, recipeId);
  if (recipe === null) return null;

  const lines = await listRecipeIngredients(client, recipeId);
  if (lines.length === 0) return { ...recipe, lines: [], unresolvedLines: [] };

  const ingredientIds = [...new Set(lines.map((line) => line.ingredient_id))];
  const ingredients = parseRows(
    ingredientSchema,
    await run(
      client
        .from('ingredients')
        .select(INGREDIENT_COLUMNS)
        .in('id', ingredientIds)
        .is('deleted_at', null),
    ),
    'getRecipeBillOfMaterials.ingredients',
  );

  const byId = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const resolved: RecipeIngredientDetail[] = [];
  const unresolved: RecipeIngredient[] = [];

  for (const line of lines) {
    const ingredient = byId.get(line.ingredient_id);
    if (ingredient === undefined) unresolved.push(line);
    else resolved.push({ ...line, ingredient });
  }

  return { ...recipe, lines: resolved, unresolvedLines: unresolved };
}
