/**
 * Zod schemas for the inventory read models — P4.2.
 *
 * Mirror the constraints **as verified live on 2026-08-11** from `pg_constraint`, not as
 * documented. Same rule as the catalog schemas: never stricter than the database, or the
 * reader rejects rows the writer legitimately stored.
 */

import {
  NEGATIVE_STOCK_REASONS,
  POSITIVE_STOCK_REASONS,
  STOCK_MOVEMENT_REASONS,
  STOCK_REFERENCE_TYPES,
  isNegativeDecimalString,
  type StockMovementReason,
} from '@bakeflow/types';
import { z } from 'zod';

import {
  nonNegativeMoneySchema,
  nonZeroQuantitySchema,
  signedQuantitySchema,
  timestamptzSchema,
  uuidSchema,
} from './decimal';

/** Postgres `btrim(s)` — space only. See the note in `catalog.ts`; same reasoning. */
const btrim = (value: string): string => value.replace(/^ +| +$/g, '');

/** Live: `CHECK (length(btrim(name)) > 0)` on `warehouses`. No maximum length exists. */
const trimmedNonEmpty = z
  .string()
  .refine((v) => btrim(v).length > 0, 'must not be blank');

/** Columns shared by every inventory read model. */
const readModelBase = {
  id: uuidSchema,
  tenant_id: uuidSchema,
  /** Present on all four inventory tables, unlike catalog. Second isolation axis. */
  branch_id: uuidSchema,
  created_at: timestamptzSchema,
  updated_at: timestamptzSchema,
};

/**
 * `warehouses`.
 * Live constraints: `name` non-blank (no cap), unique `(tenant_id, branch_id, name)`.
 */
export const warehouseSchema = z.object({
  ...readModelBase,
  name: trimmedNonEmpty,
  is_default: z.boolean(),
});

/**
 * Reproduces the live CHECK `stock_movements_sign_matches_reason`.
 *
 * Shared by the read schema and the insert schema so one rule governs both directions;
 * a row we would refuse to write is also a row we would refuse to believe.
 */
function signMatchesReason(row: {
  reason: StockMovementReason;
  quantity_delta: string;
}): boolean {
  const negative = isNegativeDecimalString(row.quantity_delta);
  if ((POSITIVE_STOCK_REASONS as readonly string[]).includes(row.reason)) return !negative;
  if ((NEGATIVE_STOCK_REASONS as readonly string[]).includes(row.reason)) return negative;
  // 'adjustment' — either sign is legal; zero is already rejected upstream.
  return true;
}

// `path` is deliberately not `as const`: zod's refine options declare it as a mutable
// PropertyKey[], and a readonly tuple is not assignable to it.
const SIGN_RULE_ISSUE = {
  error:
    'quantity_delta sign does not match reason (live CHECK ' +
    'stock_movements_sign_matches_reason); only "adjustment" permits either sign',
  path: ['quantity_delta'],
};

/** Columns shared by both `stock_movements` variants. */
const movementBase = {
  ...readModelBase,
  warehouse_id: uuidSchema,
  quantity_delta: nonZeroQuantitySchema,
  reason: z.enum(STOCK_MOVEMENT_REASONS),
  reference_type: z.enum(STOCK_REFERENCE_TYPES).nullable(),
  reference_id: uuidSchema.nullable(),
  unit_cost: nonNegativeMoneySchema.nullable(),
  note: z.string().nullable(),
  created_by: uuidSchema.nullable(),
};

/**
 * `stock_movements` where `item_type = 'ingredient'`.
 *
 * `product_variant_id` is pinned to exactly `null` rather than left nullable, so the
 * schema reproduces `stock_movements_item_consistent` instead of merely tolerating it.
 */
const ingredientMovementSchema = z.object({
  ...movementBase,
  item_type: z.literal('ingredient'),
  ingredient_id: uuidSchema,
  product_variant_id: z.null(),
});

/** `stock_movements` where `item_type = 'product'`. See `ingredientMovementSchema`. */
const productMovementSchema = z.object({
  ...movementBase,
  item_type: z.literal('product'),
  ingredient_id: z.null(),
  product_variant_id: uuidSchema,
});

/**
 * One ledger row.
 *
 * A discriminated union rather than a flat object with two nullable ids: it matches the
 * live CHECK exactly, and it gives callers a non-null id after narrowing on `item_type`
 * without a non-null assertion.
 *
 * The per-reason sign rule (`stock_movements_sign_matches_reason`) is applied *after* the
 * union resolves, because it spans two fields and so cannot live on either one alone.
 * A row violating it cannot exist in the database, so this check firing means the payload
 * did not come from the table it claims to — worth failing loudly rather than trusting.
 */
export const stockMovementSchema = z
  .discriminatedUnion('item_type', [ingredientMovementSchema, productMovementSchema])
  .refine(signMatchesReason, SIGN_RULE_ISSUE);

/**
 * `ingredient_stock_levels`.
 * Live constraints: unique `(warehouse_id, ingredient_id)`. **No non-negative CHECK on
 * `quantity_on_hand`** — hence `signedQuantitySchema`.
 */
export const ingredientStockLevelSchema = z.object({
  ...readModelBase,
  warehouse_id: uuidSchema,
  ingredient_id: uuidSchema,
  quantity_on_hand: signedQuantitySchema,
});

/**
 * `product_stock_levels`.
 * Live constraints: unique `(warehouse_id, product_variant_id)`. Signed, as above.
 */
export const productStockLevelSchema = z.object({
  ...readModelBase,
  warehouse_id: uuidSchema,
  product_variant_id: uuidSchema,
  quantity_on_hand: signedQuantitySchema,
});

// No insert schema for `stock_movements` lives here, deliberately.
//
// An application user cannot insert into that table at all: `authenticated` holds SELECT
// only (verified live), so writes go through the SECURITY DEFINER `adjust_stock()` RPC.
// Its input is validated in `packages/api/mutations/inventory.ts` against the function's
// own signature. A schema mirroring a direct-insert payload would be surface that nothing
// can ever exercise -- exactly what the note at the foot of catalog.ts warns against.
