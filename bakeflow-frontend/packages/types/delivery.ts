/**
 * Delivery domain types — P4.5 (`deliveries`).
 *
 * ## Provenance — live-verified 2026-08-17
 *
 * Written from `docs/SCHEMA-REFERENCE.md` §6 and `docs/STATE-MACHINES.md` §3, and since
 * **confirmed against `information_schema` and `pg_constraint` on the live database**. Every
 * field below exists with the nullability stated, and `deliveries_status_check` allows
 * exactly the six values in `DELIVERY_STATUSES`. No mismatch was found. The BLOCKER-011
 * caveat that stood here is retired — that blocker was resolved 2026-08-15.
 *
 * ## One delivery per ticket
 *
 * `ticket_id` is `NOT NULL` **and `UNIQUE`** (§6). A delivery cannot exist without a
 * ticket, and a ticket cannot have two. That is why `getDeliveryForTicket` can return a
 * single row rather than an array, and why a failed delivery is *not* re-attempted by
 * inserting a second row — the state machine routes `failed → returned` instead.
 *
 * ## The delivery gate is a database rule, not a UI convention
 *
 * `STATE-MACHINES.md` §1: a ticket may only move `ready → delivered` when its
 * `fulfilment_type` is `pickup`, **or** the linked `deliveries` row's own status is
 * `delivered`. The guard trigger looks the row up and blocks the transition otherwise.
 *
 * `isDeliveryVerified` below mirrors that condition for display purposes only. It is not
 * the gate and must never be used as one: the authority runs in the database, where a
 * client cannot skip it, and a driver's phone is precisely the device most likely to be
 * running stale state when it matters.
 *
 * ## Tenancy
 *
 * `branch_id NOT NULL`, but the SELECT policy is **weaker than `tickets`'** by design.
 * Verified live 2026-08-15:
 *
 * ```sql
 * tenant_id = current_tenant_id()
 *   AND (driver_id = auth.uid() OR has_branch_access(branch_id))
 *   AND deleted_at IS NULL
 * ```
 *
 * The disjunction is the point: a driver sees a delivery assigned to them **even outside
 * the branches they are assigned to**. That is correct for the job — a driver crossing town
 * for one drop should not need a branch assignment — but it means branch isolation on this
 * table is conditional, unlike every other branch-scoped table in the schema, where the
 * predicate is a plain `has_branch_access(branch_id)`.
 *
 * Tenant isolation is **not** weakened: `tenant_id = current_tenant_id()` is conjoined and
 * no driver clause can escape it.
 *
 * ## No money
 *
 * `deliveries` carries no `NUMERIC` column at all — no fee, no distance, no COD amount. A
 * delivery costs nothing in this schema, which is worth stating because it is the reason
 * this domain is untouched by BLOCKER-003 and needs no `::text` cast anywhere.
 */

import type { Timestamptz, Uuid } from './scalars';

/**
 * Live `CHECK` per `SCHEMA-REFERENCE.md` §6, matching the `STATE-MACHINES.md` §3 diagram:
 *
 * ```
 * pending ──► assigned ──► in_transit ──► delivered
 *                              │
 *                              ├──► failed ──► returned
 *                              └──► returned
 * ```
 */
export const DELIVERY_STATUSES = [
  'pending',
  'assigned',
  'in_transit',
  'delivered',
  'failed',
  'returned',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/**
 * Statuses from which no transition is legal (`STATE-MACHINES.md` §3).
 *
 * `failed` is **not** terminal — its exit is `returned`, and that hop writes a return stock
 * movement. Treating `failed` as an end state would leave the goods unaccounted for in the
 * ledger, which is the whole reason the extra state exists.
 */
export const TERMINAL_DELIVERY_STATUSES = [
  'delivered',
  'returned',
] as const satisfies readonly DeliveryStatus[];

/** True when a delivery can no longer transition. Advisory; the guard trigger is the authority. */
export function isTerminalDeliveryStatus(status: DeliveryStatus): boolean {
  return (TERMINAL_DELIVERY_STATUSES as readonly string[]).includes(status);
}

/**
 * True when this delivery satisfies the `ready → delivered` gate on its parent ticket.
 *
 * **Display only.** See the module header: the database performs this check itself, and a
 * client that treated this as permission would be trusting whatever the device last
 * synced. Use it to enable a button, never to decide an outcome.
 */
export function isDeliveryVerified(status: DeliveryStatus): boolean {
  return status === 'delivered';
}

/**
 * A delivery against one ticket.
 *
 * `address_line` is `NOT NULL` here while `customers.address_line` is nullable, and the
 * duplication is deliberate rather than a normalization slip: a delivery goes where the
 * customer said *that day*, and rewriting history by following the customer record would
 * change where a past delivery was sent.
 *
 * `proof_url` points at Supabase Storage — a photo or a signature. `STATE-MACHINES.md` §3
 * requires `proof_url` **or** `recipient_name` before `in_transit → delivered`, so neither
 * is individually `NOT NULL` and a caller must handle each being absent.
 *
 * `driver_id` is nullable because a delivery legitimately exists as `pending` before anyone
 * is assigned; it is set on the `pending → assigned` transition.
 */
export interface Delivery {
  id: Uuid;
  tenant_id: Uuid;
  branch_id: Uuid;
  /** `NOT NULL UNIQUE` — exactly one delivery per ticket. */
  ticket_id: Uuid;
  /** Null until `pending → assigned`. */
  driver_id: Uuid | null;
  status: DeliveryStatus;
  address_line: string;
  contact_phone: string | null;
  scheduled_at: Timestamptz | null;
  /** Set by the `assigned → in_transit` transition. */
  dispatched_at: Timestamptz | null;
  /** Set by the `in_transit → delivered` transition. */
  delivered_at: Timestamptz | null;
  /** Supabase Storage URL for a photo or signature. */
  proof_url: string | null;
  recipient_name: string | null;
  /** Required by the guard when `status = 'failed'`. */
  failure_reason: string | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}
