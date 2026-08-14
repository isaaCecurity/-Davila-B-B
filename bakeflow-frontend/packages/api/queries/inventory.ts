/**
 * Inventory read service — P4.2. **Read path only; there is deliberately no write here.**
 *
 * ## Mechanism: PostgREST + RLS, not RPCs
 *
 * Same rule as catalog (`API-CONTRACT.md` §1): reads and simple filtered lists go through
 * PostgREST protected by RLS. No inventory read RPC exists and none should be written.
 *
 * ## Two isolation axes, not one
 *
 * Verified live 2026-08-11 — the SELECT policy on all four inventory tables is
 *
 * ```sql
 * tenant_id = current_tenant_id() AND has_branch_access(branch_id) AND deleted_at IS NULL
 * ```
 *
 * Catalog had only the tenant predicate. Here a user with a perfectly valid active
 * organization still sees **nothing** from a branch they are not assigned to. Two
 * consequences this module depends on:
 *
 * - **A denied read is an empty set, not an error** — RLS filters `SELECT`, it does not
 *   raise. Isolation is proven by asserting row counts, never by expecting an exception.
 * - **`branch_id` is on every read model.** Aggregating stock without grouping by it would
 *   silently sum two branches' quantities into one figure.
 *
 * ## Why the write path is absent
 *
 * `CLAUDE.md` rule 7: stock levels are never updated directly — every change is an insert
 * into the immutable `stock_movements` ledger, with levels maintained by
 * `apply_stock_movement()`. A write path here would therefore be an *insert into the
 * ledger*, never an update to a level, and the negative-stock policy it must respect is
 * already enforced server-side by that trigger (`sale`/`production_consume` may never go
 * negative; `waste`/`adjustment` only where `organizations.allow_negative_stock` is set).
 *
 * That policy being enforced in the database is precisely why this module does not
 * reimplement it: a client-side copy would be a second authority free to drift from the
 * one that actually binds.
 *
 * ## Money and quantity precision
 *
 * Every `NUMERIC` column is selected with a `::text` cast, for the reason recorded in
 * `@bakeflow/types` `scalars.ts`: Postgres emits `numeric` unquoted, and `JSON.parse`
 * collapses it to a double before application code runs. The projection is derived from
 * the Zod schema so a column cannot be selected without its cast.
 */

import type {
  IngredientStockLevel,
  ProductStockLevel,
  StockItemType,
  StockMovement,
  Uuid,
  Warehouse,
} from '@bakeflow/types';
import {
  ingredientStockLevelSchema,
  productStockLevelSchema,
  stockMovementSchema,
  warehouseSchema,
} from '@bakeflow/validation';

import type { BakeflowClient } from '../client';
import {
  decodeCursor,
  encodeCursor,
  parseRow,
  parseRows,
  projectionFor,
  quoteFilterValue,
  resolveLimit,
  run,
  type Page,
  type PageOptions,
  type ReadEntity,
  type SchemaShape,
} from '../internal/read';

/** Every `NUMERIC` column across the four inventory tables. */
const TEXT_CAST_COLUMNS: ReadonlySet<string> = new Set([
  'quantity_delta',
  'quantity_on_hand',
  'unit_cost',
]);

/**
 * All four inventory tables carry `deleted_at`/`deleted_by`, verified live 2026-08-11:
 * the SELECT policy on each is
 * `tenant_id = current_tenant_id() AND has_branch_access(branch_id) AND deleted_at IS NULL`,
 * which could not reference the column if it did not exist.
 *
 * `stock_movements` is included despite `SCHEMA-REFERENCE.md` §11 listing it among the
 * append-only ledgers that "are not soft-deleted either". The column being present and
 * referenced by its own policy is the stronger evidence; §11 describes the *policy* that
 * nothing sets it, not the absence of the column.
 */
function entity<T>(
  table: string,
  schema: ReadEntity<T>['schema'] & SchemaShape,
): ReadEntity<T> {
  return {
    table,
    schema,
    columns: projectionFor(schema, TEXT_CAST_COLUMNS),
    softDeleted: true,
  };
}

const WAREHOUSES = entity<Warehouse>('warehouses', warehouseSchema);
const INGREDIENT_LEVELS = entity<IngredientStockLevel>(
  'ingredient_stock_levels',
  ingredientStockLevelSchema,
);
const PRODUCT_LEVELS = entity<ProductStockLevel>(
  'product_stock_levels',
  productStockLevelSchema,
);

/**
 * `stock_movements` is the one entity whose schema is a discriminated union, so it has no
 * single `.shape` for `projectionFor` to derive a projection from, and its columns are
 * listed by hand.
 *
 * That loses the compile-time guarantee the other entities get, but not the tripwire: a
 * Zod object errors on a **missing** required key, so dropping a column here — or dropping
 * a `::text` cast, which makes the value arrive as a JSON number — fails loudly in
 * `parseRows` at the boundary rather than corrupting a quantity downstream. Keep this list
 * in sync with both members of `stockMovementSchema`.
 */
const MOVEMENT_COLUMNS = [
  'id',
  'tenant_id',
  'branch_id',
  'warehouse_id',
  'item_type',
  'ingredient_id',
  'product_variant_id',
  'quantity_delta::text',
  'reason',
  'reference_type',
  'reference_id',
  'unit_cost::text',
  'note',
  'created_at',
  'updated_at',
  'created_by',
].join(',');

const MOVEMENTS = {
  table: 'stock_movements',
  schema: stockMovementSchema,
  columns: MOVEMENT_COLUMNS,
  softDeleted: true,
} as const satisfies ReadEntity<StockMovement>;

/* -------------------------------------------------------------------------- */
/* Warehouses                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Warehouses visible to the caller, optionally restricted to one branch.
 *
 * Unpaged, like `listProductCategories`: a bakery has a handful of stockrooms per branch,
 * and the set is bounded by branches the caller can access — which RLS already limits.
 *
 * Ordered by `branch_id` then `name` so results group per branch, with `id` as a final
 * tiebreak to keep the order total (`name` is unique only within a branch).
 */
export async function listWarehouses(
  client: BakeflowClient,
  options: { branchId?: Uuid } = {},
): Promise<Warehouse[]> {
  let query = client
    .from(WAREHOUSES.table)
    .select(WAREHOUSES.columns)
    .is('deleted_at', null);

  if (options.branchId !== undefined) query = query.eq('branch_id', options.branchId);

  const data = await run(
    query
      .order('branch_id', { ascending: true })
      .order('name', { ascending: true })
      .order('id', { ascending: true }),
  );
  return parseRows(WAREHOUSES.schema, data, 'listWarehouses');
}

/**
 * One warehouse, or `null` when it does not exist, belongs to another organization, sits in
 * a branch the caller cannot access, or is soft-deleted. All four are indistinguishable by
 * design — telling them apart would leak the existence of another branch's row.
 */
export async function getWarehouseById(
  client: BakeflowClient,
  warehouseId: Uuid,
): Promise<Warehouse | null> {
  const data = await run(
    client
      .from(WAREHOUSES.table)
      .select(WAREHOUSES.columns)
      .eq('id', warehouseId)
      .is('deleted_at', null)
      .maybeSingle(),
  );
  return parseRow(WAREHOUSES.schema, data, 'getWarehouseById');
}

/* -------------------------------------------------------------------------- */
/* Stock levels                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Paged stock levels for one warehouse.
 *
 * Scoped to a single warehouse deliberately: within one warehouse the item id is unique
 * (live `UNIQUE (warehouse_id, ingredient_id)` and `UNIQUE (warehouse_id,
 * product_variant_id)`), which makes a single-column cursor safe. An unscoped list would
 * need the composite cursor the ledger uses.
 */
async function listStockLevels<T>(
  client: BakeflowClient,
  target: ReadEntity<T>,
  warehouseId: Uuid,
  itemColumn: string,
  /**
   * Reads the cursor column off a row.
   *
   * Passed explicitly rather than indexing `row[itemColumn]`, which would require
   * constraining `T` to `Record<string, unknown>` — a constraint the read-model interfaces
   * cannot satisfy, since an interface has no implicit index signature. Widening the
   * models to satisfy it would have traded away their exactness for a lookup.
   */
  cursorOf: (row: T) => Uuid,
  options: PageOptions,
  context: string,
): Promise<Page<T>> {
  const limit = resolveLimit(options.limit);

  let query = client
    .from(target.table)
    .select(target.columns)
    .eq('warehouse_id', warehouseId)
    .is('deleted_at', null);

  if (options.after !== undefined) query = query.gt(itemColumn, options.after);

  const data = await run(query.order(itemColumn, { ascending: true }).limit(limit + 1));
  const rows = parseRows(target.schema, data, context);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.length > 0 ? page[page.length - 1] : undefined;

  return {
    rows: page,
    nextCursor: hasMore && last !== undefined ? cursorOf(last) : null,
  };
}

/** Ingredient quantities on hand in one warehouse, ordered by ingredient id. */
export function listIngredientStockLevels(
  client: BakeflowClient,
  warehouseId: Uuid,
  options: PageOptions = {},
): Promise<Page<IngredientStockLevel>> {
  return listStockLevels(
    client,
    INGREDIENT_LEVELS,
    warehouseId,
    'ingredient_id',
    (row) => row.ingredient_id,
    options,
    'listIngredientStockLevels',
  );
}

/** Finished-good quantities on hand in one warehouse, ordered by variant id. */
export function listProductStockLevels(
  client: BakeflowClient,
  warehouseId: Uuid,
  options: PageOptions = {},
): Promise<Page<ProductStockLevel>> {
  return listStockLevels(
    client,
    PRODUCT_LEVELS,
    warehouseId,
    'product_variant_id',
    (row) => row.product_variant_id,
    options,
    'listProductStockLevels',
  );
}

/* -------------------------------------------------------------------------- */
/* Stock movement ledger                                                       */
/* -------------------------------------------------------------------------- */

/** Filters for the ledger. All are optional and combine with AND. */
export interface StockMovementFilters {
  warehouseId?: Uuid;
  itemType?: StockItemType;
  ingredientId?: Uuid;
  productVariantId?: Uuid;
  /** Inclusive lower bound on `created_at`, as an ISO-8601 timestamp. */
  since?: string;
}

/**
 * One page of the immutable stock ledger, **newest first**.
 *
 * Newest-first because the ledger is read to answer "what just happened to this stock",
 * and because an append-only table's tail is the part that changes.
 *
 * Uses the composite `(created_at, id)` cursor — see `encodeCursor` for why a single-column
 * cursor would silently drop rows written in the same transaction.
 */
export async function listStockMovements(
  client: BakeflowClient,
  filters: StockMovementFilters = {},
  options: PageOptions = {},
): Promise<Page<StockMovement>> {
  const context = 'listStockMovements';
  const limit = resolveLimit(options.limit);

  let query = client
    .from(MOVEMENTS.table)
    .select(MOVEMENTS.columns)
    .is('deleted_at', null);

  if (filters.warehouseId !== undefined) query = query.eq('warehouse_id', filters.warehouseId);
  if (filters.itemType !== undefined) query = query.eq('item_type', filters.itemType);
  if (filters.ingredientId !== undefined)
    query = query.eq('ingredient_id', filters.ingredientId);
  if (filters.productVariantId !== undefined)
    query = query.eq('product_variant_id', filters.productVariantId);
  if (filters.since !== undefined) query = query.gte('created_at', filters.since);

  if (options.after !== undefined) {
    const { sortValue, id } = decodeCursor(options.after, context);
    const ts = quoteFilterValue(sortValue);
    // (created_at, id) < (cursor.created_at, cursor.id) under DESC ordering.
    query = query.or(
      `created_at.lt.${ts},and(created_at.eq.${ts},id.lt.${quoteFilterValue(id)})`,
    );
  }

  const data = await run(
    query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1),
  );
  const rows = parseRows(MOVEMENTS.schema, data, context);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.length > 0 ? page[page.length - 1] : undefined;

  return {
    rows: page,
    nextCursor: hasMore && last !== undefined ? encodeCursor(last.created_at, last.id) : null,
  };
}

/** One ledger entry, or `null` when it is not visible to the caller. */
export async function getStockMovementById(
  client: BakeflowClient,
  movementId: Uuid,
): Promise<StockMovement | null> {
  const data = await run(
    client
      .from(MOVEMENTS.table)
      .select(MOVEMENTS.columns)
      .eq('id', movementId)
      .is('deleted_at', null)
      .maybeSingle(),
  );
  return parseRow(MOVEMENTS.schema, data, 'getStockMovementById');
}
