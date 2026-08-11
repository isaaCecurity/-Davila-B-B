/**
 * Inventory write path — P4.2b. **One operation: `adjust_stock`.**
 *
 * ## Why this is an RPC and not an insert
 *
 * A direct `INSERT INTO stock_movements` is impossible for an application user, and that
 * is deliberate rather than an oversight. Verified live 2026-08-11:
 *
 * - `authenticated` holds **SELECT only** on `stock_movements`. GRANTs are checked before
 *   RLS, so a direct insert fails at the privilege layer for every role, in every branch,
 *   in every organization. The `stock_movements_insert` RLS policy exists but is
 *   unreachable from the client — it governs the `SECURITY DEFINER` path.
 * - `adjust_stock(...)` is `SECURITY DEFINER` and **is** EXECUTE-able by `authenticated`.
 *
 * Routing writes through the function is what lets the server own three things a client
 * must not be trusted with: `created_by` is set from `auth.uid()`, `branch_id` is derived
 * from the warehouse rather than supplied, and an `audit_log` entry is written in the same
 * transaction. An insert grant would have made all three forgeable or skippable.
 *
 * ## The contract, read from the live function
 *
 * ```
 * adjust_stock(p_warehouse_id uuid, p_item_type text, p_item_id uuid,
 *              p_new_quantity numeric, p_reason text = 'adjustment',
 *              p_note text = null) RETURNS jsonb
 * ```
 *
 * - **`p_new_quantity` is an absolute target, not a delta.** The function reads the
 *   current level `FOR UPDATE`, computes `delta = target - current`, and appends that.
 *   This is the single most important thing to get right at the call site: passing a delta
 *   would set stock *to* the delta.
 * - Only three reasons are accepted: `adjustment`, `waste`, `opening_balance`. The other
 *   six live `stock_movements` reasons (`purchase`, `sale`, `production_consume`,
 *   `production_output`, `transfer_in`, `transfer_out`) are written by their own domain
 *   flows, not from here.
 * - A target equal to the current level is a **no-op**: it returns `unchanged: true` and
 *   writes no movement. That gives the operation a natural idempotency — replaying the
 *   same absolute target cannot double-count, which a delta-based API could not promise.
 * - A negative target is refused outright. Stock can still *end up* negative via the
 *   `waste` path, subject to `organizations.allow_negative_stock` — that policy lives in
 *   `apply_stock_movement()` and is not re-implemented here.
 * - Authorization is role-dependent: `adjustment` and `opening_balance` require
 *   owner/admin/branch_manager; `waste` additionally allows `baker`. Plus warehouse
 *   tenancy and `has_branch_access`. None of it is re-checked client-side.
 *
 * ## Precision: the RPC envelope is not trustworthy for quantities
 *
 * The function returns `to_jsonb(v_movement)`, which renders `numeric` **unquoted**. By
 * the time `JSON.parse` inside supabase-js is done, `quantity_delta` and
 * `quantity_on_hand` are IEEE-754 doubles with their scale destroyed — the exact defect
 * recorded in `@bakeflow/types` `scalars.ts` and TD-012.
 *
 * So this module reads only the **`id`** out of the envelope, which is a string and
 * survives, and then re-reads the stored row through `getStockMovementById` — the P4.2a
 * read path, whose projection casts every numeric with `::text`. The exact values a caller
 * receives have therefore never been through a float.
 */

import type { StockItemType, StockMovement, Uuid } from '@bakeflow/types';
import { uuidSchema } from '@bakeflow/validation';

import type { BakeflowClient } from '../client';
import { BakeflowApiError, normalizePostgrestError, normalizeThrown } from '../errors';
import { getStockMovementById } from '../queries/inventory';

/** The three reasons `adjust_stock` accepts. Verified against the live function body. */
export const ADJUSTABLE_STOCK_REASONS = ['adjustment', 'waste', 'opening_balance'] as const;
export type AdjustableStockReason = (typeof ADJUSTABLE_STOCK_REASONS)[number];

export interface AdjustStockInput {
  warehouseId: Uuid;
  itemType: StockItemType;
  /** `ingredients.id` when `itemType` is `'ingredient'`, else `product_variants.id`. */
  itemId: Uuid;
  /**
   * The quantity the item should have **after** this call — an absolute target, not a
   * change. An exact decimal string, never a `number`: passing a JS number here is how
   * `10.1` becomes `10.099999999999999`.
   */
  newQuantity: string;
  /** Defaults to `'adjustment'`, matching the function's own default. */
  reason?: AdjustableStockReason;
  note?: string | null;
}

export interface AdjustStockResult {
  /**
   * The movement that was appended, re-read exactly. `null` when the target already
   * matched the current level and nothing was written.
   */
  movement: StockMovement | null;
  /** True when the call was a no-op because the level already equalled the target. */
  unchanged: boolean;
}

/** Decimal string, any scale up to NUMERIC(18,4). Mirrors `QUANTITY_PATTERN` but is
 *  applied to *input*, so it rejects a JS number before it can reach the wire. */
const QUANTITY_INPUT = /^\d{1,14}(\.\d{1,4})?$/;

/**
 * Set an item's stock in one warehouse to an absolute quantity.
 *
 * Prefer this over constructing movements by hand: it is the only write path the database
 * grants an application user, and its absolute-target semantics make a retry safe.
 *
 * @throws {BakeflowApiError} `insufficient_role` when the caller's role or branch access
 *   is inadequate, `insufficient_stock` when the resulting level would breach the
 *   negative-stock policy, `invalid_request` for a malformed target or reason.
 */
export async function adjustStock(
  client: BakeflowClient,
  input: AdjustStockInput,
): Promise<AdjustStockResult> {
  // Validated locally only to fail fast with a field-specific message. The database
  // re-checks every one of these, and it is the authority.
  if (!uuidSchema.safeParse(input.warehouseId).success) {
    throw invalid('warehouseId must be a uuid');
  }
  if (!uuidSchema.safeParse(input.itemId).success) {
    throw invalid('itemId must be a uuid');
  }
  if (typeof input.newQuantity !== 'string' || !QUANTITY_INPUT.test(input.newQuantity)) {
    throw invalid(
      'newQuantity must be a non-negative exact decimal STRING with at most 4 decimal ' +
        'places (an absolute target, not a delta). A JS number loses scale before it is sent.',
    );
  }

  const payload = await run(
    client.rpc('adjust_stock', {
      p_warehouse_id: input.warehouseId,
      p_item_type: input.itemType,
      p_item_id: input.itemId,
      // Sent as a string so PostgREST hands Postgres an exact literal to cast to
      // numeric(18,4). A JS number would already have lost its scale in JSON.stringify.
      p_new_quantity: input.newQuantity,
      p_reason: input.reason ?? 'adjustment',
      p_note: input.note ?? null,
    }),
  );

  if (typeof payload !== 'object' || payload === null) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: `adjustStock: expected a jsonb envelope, received ${typeof payload}`,
    });
  }
  const envelope = payload as { movement?: unknown; unchanged?: unknown };

  if (envelope.unchanged === true || envelope.movement === null) {
    return { movement: null, unchanged: true };
  }

  // Only the id is taken from the envelope. Every numeric in it has already been through
  // JSON.parse as a double — see the module header.
  const movementId = (envelope.movement as { id?: unknown } | null)?.id;
  if (typeof movementId !== 'string') {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: 'adjustStock: the envelope carried no movement id',
    });
  }

  const movement = await getStockMovementById(client, movementId);
  if (movement === null) {
    throw new BakeflowApiError({
      code: 'unexpected_error',
      message:
        'adjustStock: the movement was recorded but could not be read back; the RPC and ' +
        'the select policy disagree for this branch',
    });
  }
  return { movement, unchanged: false };
}

function invalid(message: string): BakeflowApiError {
  return new BakeflowApiError({ code: 'invalid_request', message: `adjustStock: ${message}` });
}

/** Local copy of the query runner: `internal/read`'s version is typed for PostgREST
 *  builders, and `.rpc()` resolves the same `{ data, error }` shape. */
async function run(query: PromiseLike<{ data: unknown; error?: unknown }>): Promise<unknown> {
  let result: { data: unknown; error?: unknown };
  try {
    result = await query;
  } catch (thrown) {
    throw normalizeThrown(thrown);
  }
  if (result.error !== null && result.error !== undefined) {
    throw normalizePostgrestError(
      result.error as Parameters<typeof normalizePostgrestError>[0],
    );
  }
  return result.data;
}
