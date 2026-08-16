/**
 * Production read service — P4.3a. **Read path only.**
 *
 * ## Mechanism
 *
 * PostgREST + RLS, per `API-CONTRACT.md` §1, same as catalog and inventory. No read RPC
 * exists for production and none should be written.
 *
 * ## The write path is absent, and that is the important part
 *
 * `STATE-MACHINES.md` §2 is unambiguous: **completion is a single RPC**,
 * `complete_production_batch()`, and "it must not be assembled from separate client
 * calls". In one transaction it re-checks stock, writes one `production_consume` movement
 * per ingredient, writes one `production_output` movement for the variant, sets
 * `actual_quantity`, and sets the status. If any step raises, the batch stays
 * `in_progress`.
 *
 * A client that tried to reproduce that as several calls would, on a partial failure,
 * leave stock consumed with no output recorded — the exact corruption the single-RPC rule
 * exists to prevent. So this module offers **no** batch mutation at all, and the eventual
 * `packages/api/mutations/production.ts` must call the RPC rather than sequence writes.
 *
 * The signature has since been **read from the live database** (2026-08-16, recorded in
 * `IMPLEMENTATION_LOG.md`) and the completion path was executed once inside a rolled-back
 * transaction, so the contract is no longer assumed. Building the mutation is still a
 * separate milestone: this module is the read path.
 *
 * ## Provenance — live-verified
 *
 * The types and schemas for this domain were originally written from
 * `SCHEMA-REFERENCE.md` §5 and `STATE-MACHINES.md` §2 while the database was unreachable.
 * They have since been checked column-for-column against `information_schema.columns` and
 * `pg_constraint` (2026-08-15) and again for P9.5 (2026-08-16): both tables match exactly.
 *
 * The RLS predicates are now known too, and are the reason the queries below still assert
 * nothing about them — they filter what they need explicitly and let the server decide
 * what is visible:
 *
 * ```sql
 * production_batches_select:            tenant_id = current_tenant_id()
 *                                       AND has_branch_access(branch_id)
 *                                       AND deleted_at IS NULL
 * production_batch_ingredients_select:  tenant_id = current_tenant_id()
 *                                       AND deleted_at IS NULL
 *                                       AND EXISTS (parent batch with branch access)
 * ```
 *
 * Note the child reaches its branch axis **through its parent**, which is why a caller
 * cannot widen its own visibility by querying `production_batch_ingredients` directly.
 *
 * ## Money and quantity precision
 *
 * Every `NUMERIC` column is `::text` cast, for the reason in `@bakeflow/types`
 * `scalars.ts`. The projection is derived from the schema, so a column cannot be selected
 * without its cast.
 */

import type {
  ProductionBatch,
  ProductionBatchIngredient,
  ProductionBatchStatus,
  ProductionBatchWithIngredients,
  Uuid,
} from '@bakeflow/types';
import {
  productionBatchIngredientSchema,
  productionBatchSchema,
} from '@bakeflow/validation';

import type { BakeflowClient } from '../client';
import {
  parseRow,
  parseRows,
  projectionFor,
  resolveLimit,
  run,
  withSoftDeleteFilter,
  type Page,
  type PageOptions,
  type ReadEntity,
  type SchemaShape,
} from '../internal/read';

/** Every `NUMERIC` column across the two production tables. */
const TEXT_CAST_COLUMNS: ReadonlySet<string> = new Set([
  'planned_quantity',
  'actual_quantity',
  'waste_quantity',
]);

/**
 * `productionBatchSchema` is a `ZodObject` wrapped in `.refine()`, and zod 4 keeps
 * `.shape` reachable **through** the refinement — so the projection stays derived from
 * the schema rather than hand-listed, the same guarantee catalog gets.
 *
 * Verified by execution against the installed zod 4.1.12, not assumed:
 *
 * ```
 * z.object({…}).refine(…).shape        -> id,planned_quantity,status
 * z.object({…}).refine(…).def.innerType -> undefined
 * ```
 *
 * The first attempt here reached for `.def.innerType`, which is a zod 3 shape. It
 * typechecked only because it went through an `as unknown as` cast, and would have handed
 * `projectionFor` an `undefined` — breaking every production read at runtime with an empty
 * column list. Do not reintroduce the cast: if `.shape` ever stops resolving, the
 * compiler should be allowed to say so.
 */
/**
 * ## `softDeleted: true` — settled by a live read, after one wrong turn
 *
 * These were briefly set to `false`. `SCHEMA-REFERENCE.md` §5 lists `[std]` alone for both
 * production tables — the audit trio from §0 — where §4 spells out `+ deleted_at,
 * deleted_by` for `tickets`, and §11 says only that *most* tables carry the pair. The
 * module appeared to contradict its own source document by filtering a column it did not
 * select, and the contradiction was resolved toward the document.
 *
 * **The document was wrong.** Read live on 2026-08-15, *all sixteen* domain tables carry
 * `deleted_at`/`deleted_by`, production included. `[std]` in `SCHEMA-REFERENCE.md` simply
 * does not enumerate the soft-delete pair even where it exists, so its absence there
 * carries no information at all — and the original unconditional filter was correct.
 *
 * The lesson is the one `CLAUDE.md` already states: **the live database outranks every
 * document in this repo.** Reconciling two documents against each other is not verification
 * when the database is available to answer directly.
 */
const BATCHES: ReadEntity<ProductionBatch> = {
  table: 'production_batches',
  schema: productionBatchSchema,
  columns: projectionFor(productionBatchSchema as unknown as SchemaShape, TEXT_CAST_COLUMNS),
  softDeleted: true,
};

const BATCH_INGREDIENTS: ReadEntity<ProductionBatchIngredient> = {
  table: 'production_batch_ingredients',
  schema: productionBatchIngredientSchema,
  columns: projectionFor(productionBatchIngredientSchema, TEXT_CAST_COLUMNS),
  softDeleted: true,
};

/** Filters for the batch list. All optional, combined with AND. */
export interface ProductionBatchFilters {
  status?: ProductionBatchStatus;
  branchId?: Uuid;
  recipeId?: Uuid;
  /** Batches raised against one ticket. */
  ticketId?: Uuid;
}

/**
 * One page of production batches, ordered by `batch_number`.
 *
 * A single-column cursor is safe here, unlike the stock ledger: `batch_number` is
 * `UNIQUE (tenant_id, batch_number)` per `SCHEMA-REFERENCE.md` §5, so it totally orders
 * the rows a caller can see and no sibling can be skipped. The ledger needed a composite
 * `(created_at, id)` cursor precisely because it had no such column.
 */
export async function listProductionBatches(
  client: BakeflowClient,
  filters: ProductionBatchFilters = {},
  options: PageOptions = {},
): Promise<Page<ProductionBatch>> {
  const limit = resolveLimit(options.limit);

  let query = withSoftDeleteFilter(
    client.from(BATCHES.table).select(BATCHES.columns),
    BATCHES,
  );

  if (filters.status !== undefined) query = query.eq('status', filters.status);
  if (filters.branchId !== undefined) query = query.eq('branch_id', filters.branchId);
  if (filters.recipeId !== undefined) query = query.eq('recipe_id', filters.recipeId);
  if (filters.ticketId !== undefined) query = query.eq('ticket_id', filters.ticketId);
  if (options.after !== undefined) query = query.gt('batch_number', options.after);

  const data = await run(query.order('batch_number', { ascending: true }).limit(limit + 1));
  const rows = parseRows(BATCHES.schema, data, 'listProductionBatches');

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.length > 0 ? page[page.length - 1] : undefined;

  return {
    rows: page,
    nextCursor: hasMore && last !== undefined ? last.batch_number : null,
  };
}

/**
 * One batch, or `null` when it does not exist, belongs to another organization, sits in a
 * branch the caller cannot reach, or is soft-deleted. All four are indistinguishable by
 * design.
 */
export async function getProductionBatchById(
  client: BakeflowClient,
  batchId: Uuid,
): Promise<ProductionBatch | null> {
  const data = await run(
    withSoftDeleteFilter(
      client.from(BATCHES.table).select(BATCHES.columns).eq('id', batchId),
      BATCHES,
    ).maybeSingle(),
  );
  return parseRow(BATCHES.schema, data, 'getProductionBatchById');
}

/**
 * The ingredient lines of one batch, ordered by ingredient.
 *
 * Unpaged: the set is bounded by the recipe it was snapshotted from.
 */
export async function listProductionBatchIngredients(
  client: BakeflowClient,
  batchId: Uuid,
): Promise<ProductionBatchIngredient[]> {
  const data = await run(
    withSoftDeleteFilter(
      client
        .from(BATCH_INGREDIENTS.table)
        .select(BATCH_INGREDIENTS.columns)
        .eq('batch_id', batchId),
      BATCH_INGREDIENTS,
    ).order('ingredient_id', { ascending: true }),
  );
  return parseRows(BATCH_INGREDIENTS.schema, data, 'listProductionBatchIngredients');
}

/**
 * A batch together with its ingredient lines.
 *
 * Two sequential round trips rather than one embedded PostgREST select: an embed would
 * return the child quantities nested, and the `::text` projection this layer depends on
 * does not survive into an embedded resource cleanly. Two validated reads keep every
 * numeric on the exact-decimal path.
 *
 * Returns `null` when the batch itself is not visible, rather than an empty shell — a
 * caller checking `ingredients.length === 0` on an invisible batch would otherwise read it
 * as "a batch with no ingredients", which is a data error under `STATE-MACHINES.md` §2.
 */
export async function getProductionBatchWithIngredients(
  client: BakeflowClient,
  batchId: Uuid,
): Promise<ProductionBatchWithIngredients | null> {
  const batch = await getProductionBatchById(client, batchId);
  if (batch === null) return null;
  const ingredients = await listProductionBatchIngredients(client, batchId);
  return { batch, ingredients };
}
