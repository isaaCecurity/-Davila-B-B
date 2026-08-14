/**
 * Production domain types — P4.3.
 *
 * ## Provenance differs from catalog and inventory — read this before trusting it
 *
 * The catalog and inventory types were written against the **live** database, column by
 * column. These were written from `docs/SCHEMA-REFERENCE.md` §5 and
 * `docs/STATE-MACHINES.md` §2 because the database was unreachable (the Supabase
 * connection required re-authorization). They are **NOT yet live-verified.**
 *
 * That is a deliberate, bounded risk rather than a guess: `SCHEMA-REFERENCE.md` has
 * matched the live schema exactly everywhere it has been checked so far (catalog §2 and
 * inventory §4 both verified column-for-column). The documents that proved wrong in this
 * project were `BACKEND_ROADMAP.md` and `API-CONTRACT.md`, not this one.
 *
 * **Verify against `information_schema.columns` before P4.3 is marked COMPLETE**, and
 * treat any mismatch as the schema being right and this file being wrong.
 *
 * ## Deliberately absent: the write path
 *
 * `complete_production_batch()` and `fail_production_batch()` are the mutation surface,
 * and their signatures are **not** reproduced here. The `adjust_stock()` episode is the
 * precedent: the milestone assumed a direct insert, the live function turned out to take
 * an absolute target rather than a delta, and a whole implementation had to be discarded.
 * A mutation contract is read from the database or not written at all.
 *
 * ## Tenancy
 *
 * `production_batches` carries `branch_id NOT NULL`, so it is expected to be tenant- AND
 * branch-scoped like inventory. `production_batch_ingredients` has **no** `branch_id` —
 * it is reached through its parent batch. Neither RLS predicate has been read from the
 * live database yet, so no isolation claim is made here; the read service simply never
 * relies on one.
 */

import type { Quantity, Timestamptz, Uuid } from './scalars';

/**
 * Live CHECK per `SCHEMA-REFERENCE.md` §5, matching the `STATE-MACHINES.md` §2 diagram:
 *
 * ```
 * scheduled ──► in_progress ──► completed
 *     │              │
 *     │              └──► failed
 *     └──► cancelled
 * ```
 *
 * Terminal: `completed`, `failed`, `cancelled`.
 */
export const PRODUCTION_BATCH_STATUSES = [
  'scheduled',
  'in_progress',
  'completed',
  'failed',
  'cancelled',
] as const;
export type ProductionBatchStatus = (typeof PRODUCTION_BATCH_STATUSES)[number];

/** Statuses from which no further transition is legal (`STATE-MACHINES.md` §2). */
export const TERMINAL_PRODUCTION_BATCH_STATUSES = [
  'completed',
  'failed',
  'cancelled',
] as const satisfies readonly ProductionBatchStatus[];

/**
 * True when a batch can no longer transition.
 *
 * A read-side convenience for disabling actions in a UI. It is **not** an authorization
 * check and must never be used as one: `guard_production_batch_transition()` is the
 * authority, and it runs in the database where a client cannot skip it.
 */
export function isTerminalProductionBatchStatus(status: ProductionBatchStatus): boolean {
  return (TERMINAL_PRODUCTION_BATCH_STATUSES as readonly string[]).includes(status);
}

/**
 * A production batch.
 *
 * `ticket_id` is nullable: a batch may be raised against a customer ticket, or built to
 * stock with no ticket at all (`SCHEMA-REFERENCE.md` §5).
 *
 * `actual_quantity` is null until completion — it is what the batch actually yielded, as
 * opposed to `planned_quantity`. `failure_reason` is required only when `status` is
 * `'failed'`; that pairing is a database CHECK, reproduced in the validation schema.
 */
export interface ProductionBatch {
  id: Uuid;
  tenant_id: Uuid;
  branch_id: Uuid;
  batch_number: string;
  recipe_id: Uuid;
  /** Null for stock-building batches with no originating ticket. */
  ticket_id: Uuid | null;
  planned_quantity: Quantity;
  /** Null until the batch completes. */
  actual_quantity: Quantity | null;
  status: ProductionBatchStatus;
  started_at: Timestamptz | null;
  completed_at: Timestamptz | null;
  assigned_to: Uuid | null;
  failure_reason: string | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

/**
 * One ingredient line of a batch — planned at scheduling, actual at completion.
 *
 * `planned_quantity` is snapshotted from the recipe by `copy_batch_planned_ingredients()`
 * when the batch is created, so a later recipe edit does not rewrite history.
 *
 * `waste_quantity` matters for failed batches: `STATE-MACHINES.md` §2 records that a
 * failed batch still consumes its ingredients, and that a failed batch which consumed
 * nothing is a data error. Waste is recorded here rather than inferred.
 */
export interface ProductionBatchIngredient {
  id: Uuid;
  tenant_id: Uuid;
  batch_id: Uuid;
  ingredient_id: Uuid;
  planned_quantity: Quantity;
  /** Null until the batch completes or fails. */
  actual_quantity: Quantity | null;
  waste_quantity: Quantity;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

/** A batch with its ingredient lines, assembled client-side from two validated reads. */
export interface ProductionBatchWithIngredients {
  batch: ProductionBatch;
  ingredients: ProductionBatchIngredient[];
}
