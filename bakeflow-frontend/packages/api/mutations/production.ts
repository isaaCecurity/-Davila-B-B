/**
 * Production batch write path — P9.5. **Two shapes of write, not one.**
 *
 * ## Why `scheduled`'s two exits are plain updates, and `in_progress`'s two exits are not
 *
 * Read live from `information_schema.role_table_grants` and `pg_policy` while building
 * this module (2026-08-21): `authenticated` holds `INSERT, SELECT, UPDATE` on
 * `production_batches` — unlike `deliveries`, which has no `UPDATE` grant at all — and
 * `production_batches_update` allows owner/admin/branch_manager/baker with branch access.
 * `scheduled -> in_progress` and `scheduled -> cancelled` touch nothing but `status` (and,
 * for `in_progress`, a server-stamped `started_at`), so they are ordinary PostgREST
 * updates, policed entirely by `guard_production_batch_transition()`.
 *
 * `in_progress -> completed` and `in_progress -> failed` are different in kind: each has
 * to atomically write `stock_movements` rows (ingredient consumption, and for a
 * completion, one product output) alongside the status change. `STATE-MACHINES.md` §2 is
 * explicit that this must be one RPC, never assembled from separate client calls, on pain
 * of leaving stock consumed with no output recorded on a partial failure. That RPC pair —
 * `complete_production_batch()` and `fail_production_batch()` — is what this module calls
 * for those two hops.
 *
 * ## A gap the grants do not close — read live, not patched here
 *
 * Because `authenticated` holds a blanket `UPDATE`, nothing at the grant layer stops a
 * client from setting `status = 'completed'` (or `'failed'`) directly through PostgREST,
 * supplying `actual_quantity` itself. `guard_production_batch_transition()` would allow
 * it — `in_progress -> completed` is a legal hop and an owner/admin/branch_manager/baker
 * is an authorized actor — and the `production_batches_completed_needs_quantity` CHECK
 * is satisfied by any non-null value. **No trigger on this table writes to
 * `stock_movements`**, so that path silently skips both the consumption and the output
 * movement the RPC exists to guarantee. This module never takes that path — the two
 * functions below are the only way it reaches `completed` or `failed` — but the gap is
 * real for any other caller with a valid session, and is recorded as **BLOCKER-017**
 * rather than left implicit in this comment.
 *
 * ## The contracts, read from the live function bodies
 *
 * ```
 * complete_production_batch(p_batch_id uuid, p_actual_quantity numeric,
 *   p_ingredient_actuals jsonb DEFAULT '[]', p_warehouse_id uuid DEFAULT NULL) RETURNS jsonb
 * fail_production_batch(p_batch_id uuid, p_reason text,
 *   p_ingredient_actuals jsonb DEFAULT '[]', p_warehouse_id uuid DEFAULT NULL) RETURNS jsonb
 * ```
 *
 * - **`p_actual_quantity` must be `> 0`** (`complete_production_batch` raises
 *   `invalid_transition` otherwise) and the standing CHECK
 *   `production_batches_actual_le_planned` additionally refuses a value greater than
 *   `planned_quantity`.
 * - **Both functions require the batch to already be `in_progress`**, checked inside the
 *   function ahead of any write, so an illegal hop never touches `stock_movements` at all.
 * - **`p_warehouse_id` defaults to the branch's default warehouse** (`warehouses` row with
 *   `is_default = true` for this `branch_id`). If none exists the function raises rather
 *   than guessing one — a branch with no default warehouse must pass one explicitly.
 * - **`p_ingredient_actuals` is optional and per-line.** Omitting it (or a line within it)
 *   defaults that ingredient's actual quantity to what was *planned*, and its waste to
 *   `0` on completion or to the actual quantity itself on failure — "the ingredients used
 *   in a failed batch are gone" (`STATE-MACHINES.md` §2). This module's public API only
 *   exposes the whole-batch `actualQuantity`; per-ingredient actuals/waste are not yet
 *   collected by any screen and are simply omitted, which is a legitimate default the RPC
 *   itself defines — not a gap this module is working around.
 * - **`insufficient_stock` is a real, expected outcome.** Consumption would drive a level
 *   negative — `apply_stock_movement()`'s policy, not re-implemented here — and the whole
 *   completion or failure rolls back; the batch stays `in_progress`.
 *
 * ## Precision
 *
 * Both RPCs return `to_jsonb(...)`, which renders every `numeric` unquoted and would
 * destroy its scale on the wire — the defect recorded in `@bakeflow/types` `scalars.ts`
 * and TD-012. Nothing is read out of the envelope here beyond confirming its shape; the
 * batch (with its ingredient lines, which the RPC also updated) is re-read through
 * `getProductionBatchWithIngredients` — the same P4.3a projection the detail screen
 * caches, with every `NUMERIC` column `::text`-cast.
 */

import type { ProductionBatch, ProductionBatchWithIngredients, Uuid } from '@bakeflow/types';
import { positiveQuantitySchema, uuidSchema } from '@bakeflow/validation';

import type { BakeflowClient } from '../client';
import { BakeflowApiError, normalizePostgrestError, normalizeThrown } from '../errors';
import { getProductionBatchById, getProductionBatchWithIngredients } from '../queries/production';

/**
 * Move a scheduled batch to `in_progress`. Requires owner/admin/branch_manager/baker with
 * access to the batch's branch — `production_batches_update` and
 * `guard_production_batch_transition()` both check it, the latter also stamping
 * `started_at`.
 *
 * `STATE-MACHINES.md` §2 lists "sufficient ingredient stock" as a precondition for this
 * hop. Read live: no trigger on `production_batches` checks it — `apply_stock_movement()`
 * only refuses at the ledger, which this hop never touches. So starting a batch this app
 * cannot finish is possible today; it fails at `completeProductionBatch` as
 * `insufficient_stock` instead of here. Not patched client-side: inventing a pre-check
 * that duplicates a rule the database does not itself enforce would be exactly the kind
 * of guessed business logic `CLAUDE.md` rules out.
 *
 * @throws {BakeflowApiError} `invalid_transition` when the batch is not visible in this
 *   tenant/branch or the hop is illegal (only `scheduled -> in_progress` is), or
 *   `insufficient_role` from the trigger when the caller's role is inadequate.
 */
export async function startProductionBatch(
  client: BakeflowClient,
  batchId: Uuid,
): Promise<ProductionBatch> {
  return transitionBatchStatus(client, batchId, 'in_progress', 'startProductionBatch');
}

/**
 * Cancel a batch before it starts. Legal only from `scheduled`, and only to
 * owner/admin/branch_manager — `baker` may start or complete a batch but not cancel one
 * (`guard_production_batch_transition()`'s per-target actor list). No stock is touched:
 * a cancelled batch never consumed anything.
 *
 * @throws {BakeflowApiError} `invalid_transition` when the batch is not visible or already
 *   started/finished, `insufficient_role` when the caller lacks the role for this hop.
 */
export async function cancelProductionBatch(
  client: BakeflowClient,
  batchId: Uuid,
): Promise<ProductionBatch> {
  return transitionBatchStatus(client, batchId, 'cancelled', 'cancelProductionBatch');
}

export interface CompleteProductionBatchInput {
  /**
   * What the batch actually yielded, as an exact decimal string — never a JS `number`,
   * for the reason given in `mutations/inventory.ts`. Must be `> 0` and `<=
   * planned_quantity` (both database-enforced; validated here only to fail fast).
   */
  actualQuantity: string;
  /** Overrides the branch's default warehouse. Rarely needed. */
  warehouseId?: Uuid;
}

/**
 * Complete an in-progress batch: writes one consumption movement per ingredient (at its
 * planned quantity, since this module does not yet collect per-ingredient actuals — see
 * the module header) and one output movement for the finished product, in the same
 * transaction as the status change.
 *
 * @throws {BakeflowApiError} `invalid_transition` when the batch is not `in_progress` or
 *   not visible, `insufficient_stock` when consumption would drive a level negative,
 *   `insufficient_role` when the caller's role is inadequate, `invalid_request` for a
 *   malformed `actualQuantity`.
 */
export async function completeProductionBatch(
  client: BakeflowClient,
  batchId: Uuid,
  input: CompleteProductionBatchInput,
): Promise<ProductionBatchWithIngredients> {
  if (!uuidSchema.safeParse(batchId).success) {
    throw invalid('completeProductionBatch', 'batchId must be a uuid');
  }
  const parsedQuantity = positiveQuantitySchema.safeParse(input.actualQuantity);
  if (!parsedQuantity.success) {
    throw invalid(
      'completeProductionBatch',
      'actualQuantity must be an exact decimal string greater than zero',
    );
  }
  if (input.warehouseId !== undefined && !uuidSchema.safeParse(input.warehouseId).success) {
    throw invalid('completeProductionBatch', 'warehouseId must be a uuid');
  }

  const payload = await run(
    client.rpc('complete_production_batch', {
      p_batch_id: batchId,
      p_actual_quantity: parsedQuantity.data,
      p_ingredient_actuals: [],
      p_warehouse_id: input.warehouseId ?? null,
    }),
  );

  return readBackWithIngredients(client, payload, batchId, 'completeProductionBatch');
}

export interface FailProductionBatchInput {
  /** Required and non-blank — `fail_production_batch` raises `invalid_transition`
   *  otherwise, not a distinct "missing reason" code. */
  reason: string;
  warehouseId?: Uuid;
}

/**
 * Fail an in-progress batch: writes a consumption movement per ingredient at its planned
 * quantity (a failed batch still consumed them — `STATE-MACHINES.md` §2) and no output
 * movement, in the same transaction as the status change.
 *
 * @throws {BakeflowApiError} `invalid_transition` when the batch is not `in_progress`, not
 *   visible, or `reason` is blank; `insufficient_stock` when consumption would drive a
 *   level negative; `insufficient_role` when the caller's role is inadequate.
 */
export async function failProductionBatch(
  client: BakeflowClient,
  batchId: Uuid,
  input: FailProductionBatchInput,
): Promise<ProductionBatchWithIngredients> {
  if (!uuidSchema.safeParse(batchId).success) {
    throw invalid('failProductionBatch', 'batchId must be a uuid');
  }
  const reason = input.reason.trim();
  if (reason === '') {
    throw invalid('failProductionBatch', 'reason must be non-blank');
  }
  if (input.warehouseId !== undefined && !uuidSchema.safeParse(input.warehouseId).success) {
    throw invalid('failProductionBatch', 'warehouseId must be a uuid');
  }

  const payload = await run(
    client.rpc('fail_production_batch', {
      p_batch_id: batchId,
      p_reason: reason,
      p_ingredient_actuals: [],
      p_warehouse_id: input.warehouseId ?? null,
    }),
  );

  return readBackWithIngredients(client, payload, batchId, 'failProductionBatch');
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

type PlainBatchTransition = 'in_progress' | 'cancelled';

/**
 * `scheduled -> in_progress` and `scheduled -> cancelled` share everything except the
 * target status: a bare `UPDATE`, re-read through the precision-safe query layer
 * afterward. A `select('id')` on the same call is what turns "the row wasn't visible under
 * `production_batches_update`" from a silent zero-row no-op into a thrown error — without
 * it, an unauthorized or nonexistent `batchId` would resolve as if nothing were wrong.
 */
async function transitionBatchStatus(
  client: BakeflowClient,
  batchId: Uuid,
  status: PlainBatchTransition,
  context: string,
): Promise<ProductionBatch> {
  if (!uuidSchema.safeParse(batchId).success) {
    throw invalid(context, 'batchId must be a uuid');
  }

  const updated = await run(
    client.from('production_batches').update({ status }).eq('id', batchId).select('id'),
  );

  if (!Array.isArray(updated) || updated.length === 0) {
    throw new BakeflowApiError({
      code: 'invalid_transition',
      message:
        `${context}: no row was updated — the batch is not visible in this tenant/branch, ` +
        `or the hop to '${status}' is not legal from its current status`,
    });
  }

  const row = await getProductionBatchById(client, batchId);
  if (row === null) {
    throw new BakeflowApiError({
      code: 'unexpected_error',
      message:
        `${context}: the change was applied but the row could not be read back; the ` +
        'update and production_batches_select disagree for this caller',
    });
  }
  return row;
}

/**
 * Confirm the envelope is the shape the function promises, then return the batch and its
 * ingredient lines as the read path sees them. See the module header for why the envelope
 * itself is not parsed for its numerics.
 */
async function readBackWithIngredients(
  client: BakeflowClient,
  payload: unknown,
  batchId: Uuid,
  context: string,
): Promise<ProductionBatchWithIngredients> {
  if (typeof payload !== 'object' || payload === null) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: `${context}: expected a jsonb envelope, received ${typeof payload}`,
    });
  }
  const envelope = payload as { batch?: unknown };
  if (typeof envelope.batch !== 'object' || envelope.batch === null) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: `${context}: the envelope carried no batch`,
    });
  }

  const result = await getProductionBatchWithIngredients(client, batchId);
  if (result === null) {
    throw new BakeflowApiError({
      code: 'unexpected_error',
      message:
        `${context}: the change was applied but the batch could not be read back; the RPC ` +
        'and production_batches_select disagree for this caller',
    });
  }
  return result;
}

function invalid(context: string, message: string): BakeflowApiError {
  return new BakeflowApiError({ code: 'invalid_request', message: `${context}: ${message}` });
}

/** Local copy of the query runner, for the reason given in `mutations/inventory.ts`. */
async function run(query: PromiseLike<{ data: unknown; error?: unknown }>): Promise<unknown> {
  let result: { data: unknown; error?: unknown };
  try {
    result = await query;
  } catch (thrown) {
    throw normalizeThrown(thrown);
  }
  if (result.error !== null && result.error !== undefined) {
    throw normalizePostgrestError(result.error as Parameters<typeof normalizePostgrestError>[0]);
  }
  return result.data;
}
