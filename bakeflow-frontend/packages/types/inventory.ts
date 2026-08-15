/**
 * Inventory domain types — P4.2.
 *
 * Hand-written against the **live** database (project `tvfyxpafbpnkneujcnvr`), verified
 * 2026-08-11 from `information_schema.columns` and `pg_constraint`. Same two deliberate
 * divergences from `supabase gen types` as the catalog types: branded decimal strings
 * instead of `number`, and CHECK constraints narrowed to string-literal unions.
 *
 * ## Tenancy differs from catalog — this is the important part
 *
 * Catalog is tenant-scoped only. **Every inventory table is tenant- *and* branch-scoped**:
 * `warehouses`, `stock_movements`, `ingredient_stock_levels` and `product_stock_levels`
 * each carry `branch_id NOT NULL`, and the SELECT policy on all four is
 *
 * ```sql
 * tenant_id = current_tenant_id() AND has_branch_access(branch_id) AND deleted_at IS NULL
 * ```
 *
 * So there are **two** independent isolation axes here. A user with a valid active
 * organization still sees nothing from a branch they are not assigned to. `branch_id` is
 * therefore carried on every read model: a caller that groups or caches stock without it
 * would merge two branches' quantities into one number.
 *
 * ## The ledger is authoritative; levels are derived
 *
 * `CLAUDE.md` rule 7: stock levels are never written directly. Every change is an insert
 * into the immutable `stock_movements` ledger, and `*_stock_levels` are maintained from it
 * by trigger. These types describe a **read** surface, so that invariant is not something
 * this module can violate — but it is why `StockLevel` is modelled as a derived snapshot
 * and never as something a caller would reconcile by hand.
 */

import type { Money, Quantity, Timestamptz, Uuid } from './scalars';

/** Live: `CHECK (item_type = ANY (ARRAY['ingredient','product']))`. */
export const STOCK_ITEM_TYPES = ['ingredient', 'product'] as const;
export type StockItemType = (typeof STOCK_ITEM_TYPES)[number];

/**
 * Live: `CHECK (reason = ANY (ARRAY[...]))` — nine reasons.
 *
 * The sign of `quantity_delta` is constrained per reason by
 * `stock_movements_sign_matches_reason`: `purchase`, `production_output`, `transfer_in`
 * and `opening_balance` must be `> 0`; `production_consume`, `sale`, `waste` and
 * `transfer_out` must be `< 0`. **`adjustment` is the sole reason permitting either
 * sign** — it is the correction path, so it has to be able to go both ways.
 */
export const STOCK_MOVEMENT_REASONS = [
  'purchase',
  'production_consume',
  'production_output',
  'sale',
  'waste',
  'adjustment',
  'transfer_in',
  'transfer_out',
  'opening_balance',
] as const;
export type StockMovementReason = (typeof STOCK_MOVEMENT_REASONS)[number];

/** Reasons whose `quantity_delta` must be strictly positive (live CHECK). */
export const POSITIVE_STOCK_REASONS = [
  'purchase',
  'production_output',
  'transfer_in',
  'opening_balance',
] as const satisfies readonly StockMovementReason[];

/** Reasons whose `quantity_delta` must be strictly negative (live CHECK). */
export const NEGATIVE_STOCK_REASONS = [
  'production_consume',
  'sale',
  'waste',
  'transfer_out',
] as const satisfies readonly StockMovementReason[];

/**
 * Live: `CHECK (reference_type = ANY (ARRAY['order','production_batch','purchase',
 * 'delivery','manual']))`.
 *
 * Note `'order'`, not `'ticket'`. This is the same historical wart `CLAUDE.md` records for
 * the `p_order_id` RPC arguments: the canonical entity is **Ticket**, but the stored value
 * is the string `'order'` and a `reference_id` pointing at `tickets.id`. Do not "correct"
 * it — the CHECK constraint enforces the literal, and renaming it is a migration.
 */
export const STOCK_REFERENCE_TYPES = [
  'order',
  'production_batch',
  'purchase',
  'delivery',
  'manual',
] as const;
export type StockReferenceType = (typeof STOCK_REFERENCE_TYPES)[number];

/** Soft-delete pair and audit stamps carried by the inventory tables (AD-012). */
interface InventoryAuditColumns {
  created_at: Timestamptz;
  updated_at: Timestamptz;
  deleted_at: Timestamptz | null;
  deleted_by: Uuid | null;
}

/* -------------------------------------------------------------------------- */
/* Full row shapes — exact live column sets                                    */
/* -------------------------------------------------------------------------- */

export interface WarehouseRow extends InventoryAuditColumns {
  id: Uuid;
  tenant_id: Uuid;
  branch_id: Uuid;
  name: string;
  is_default: boolean;
  created_by: Uuid | null;
}

export interface StockMovementRow extends InventoryAuditColumns {
  id: Uuid;
  tenant_id: Uuid;
  branch_id: Uuid;
  warehouse_id: Uuid;
  item_type: StockItemType;
  ingredient_id: Uuid | null;
  product_variant_id: Uuid | null;
  quantity_delta: Quantity;
  reason: StockMovementReason;
  reference_type: StockReferenceType | null;
  reference_id: Uuid | null;
  unit_cost: Money | null;
  note: string | null;
  created_by: Uuid | null;
}

export interface IngredientStockLevelRow extends InventoryAuditColumns {
  id: Uuid;
  tenant_id: Uuid;
  branch_id: Uuid;
  warehouse_id: Uuid;
  ingredient_id: Uuid;
  quantity_on_hand: Quantity;
}

export interface ProductStockLevelRow extends InventoryAuditColumns {
  id: Uuid;
  tenant_id: Uuid;
  branch_id: Uuid;
  warehouse_id: Uuid;
  product_variant_id: Uuid;
  quantity_on_hand: Quantity;
}

/* -------------------------------------------------------------------------- */
/* Read models                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A stockroom, scoped to one branch.
 *
 * `is_default` is per branch, not per organization: the live unique key is
 * `(tenant_id, branch_id, name)`, and each branch has its own default.
 */
export interface Warehouse {
  id: Uuid;
  tenant_id: Uuid;
  branch_id: Uuid;
  name: string;
  is_default: boolean;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

/**
 * Columns common to both ledger variants.
 *
 * `created_by` is carried here, unlike the catalog read models which drop audit stamps.
 * The ledger exists to answer "who changed stock, by how much, when" (`CLAUDE.md` rule 9),
 * so dropping the actor would defeat the table's purpose rather than tidy the model.
 */
interface StockMovementBase {
  id: Uuid;
  tenant_id: Uuid;
  branch_id: Uuid;
  warehouse_id: Uuid;
  quantity_delta: Quantity;
  reason: StockMovementReason;
  reference_type: StockReferenceType | null;
  reference_id: Uuid | null;
  unit_cost: Money | null;
  note: string | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
  created_by: Uuid | null;
}

/**
 * A ledger row for an ingredient.
 *
 * The `ingredient_id` / `product_variant_id` exclusivity is modelled as a discriminated
 * union rather than two nullable fields, because that is exactly what the live constraint
 * says:
 *
 * ```sql
 * CHECK ((item_type = 'ingredient' AND ingredient_id IS NOT NULL AND product_variant_id IS NULL)
 *     OR (item_type = 'product'    AND product_variant_id IS NOT NULL AND ingredient_id IS NULL))
 * ```
 *
 * Narrowing on `item_type` therefore gives the caller a non-null id with no assertion and
 * no `!`, and makes the impossible combination unrepresentable in the type system.
 */
export interface IngredientStockMovement extends StockMovementBase {
  item_type: 'ingredient';
  ingredient_id: Uuid;
  product_variant_id: null;
}

/** A ledger row for a finished-good variant. See `IngredientStockMovement`. */
export interface ProductStockMovement extends StockMovementBase {
  item_type: 'product';
  ingredient_id: null;
  product_variant_id: Uuid;
}

/** One immutable stock ledger entry. Discriminate on `item_type`. */
export type StockMovement = IngredientStockMovement | ProductStockMovement;

/**
 * Current ingredient quantity in one warehouse.
 *
 * Trigger-maintained from `stock_movements`; never written directly (`CLAUDE.md` rule 7).
 *
 * `quantity_on_hand` is **signed**, and when it can actually go negative is decided by
 * `apply_stock_movement()`, not by a CHECK constraint — verified against the live trigger
 * 2026-08-15:
 *
 * | Movement reason | Negative result |
 * |---|---|
 * | `production_consume`, `sale` | **never**, whatever the tenant setting |
 * | `waste`, `adjustment`, `transfer_out` | only where `organizations.allow_negative_stock` is true |
 *
 * Both refusals raise `P0001` with `{"code":"insufficient_stock", …}` in the detail, so an
 * over-consuming write fails loudly rather than silently reconciling later
 * (`STATE-MACHINES.md` §2). A negative level therefore means the organization opted in and
 * wrote off more than it held — real, and worth surfacing rather than clamping to zero.
 */
export interface IngredientStockLevel {
  id: Uuid;
  tenant_id: Uuid;
  branch_id: Uuid;
  warehouse_id: Uuid;
  ingredient_id: Uuid;
  quantity_on_hand: Quantity;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

/** Current finished-good quantity in one warehouse. See `IngredientStockLevel`. */
export interface ProductStockLevel {
  id: Uuid;
  tenant_id: Uuid;
  branch_id: Uuid;
  warehouse_id: Uuid;
  product_variant_id: Uuid;
  quantity_on_hand: Quantity;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}
