/**
 * Sales domain types — P4.4 (`customers`, `tickets`, `ticket_items`).
 *
 * ## Provenance — read this before trusting it
 *
 * Written from `docs/SCHEMA-REFERENCE.md` §4, `docs/STATE-MACHINES.md` §1 and
 * `docs/SOFT-DELETE-AND-RETENTION.md`, **not** from a live `information_schema` read. The
 * Supabase MCP connector reachable from this session is authorized against a different
 * Supabase account (`Undeify's Org`) and returns *"You do not have permission to perform
 * this action"* for project `tvfyxpafbpnkneujcnvr`. See BLOCKER-011.
 *
 * Same bounded risk as the production types: `SCHEMA-REFERENCE.md` has matched the live
 * schema column-for-column everywhere it has been checked (catalog §2, inventory §4).
 * **Verify against `information_schema.columns` and `pg_constraint` before P4.4 is marked
 * COMPLETE**, and treat any mismatch as the schema being right and this file being wrong.
 *
 * ## "Ticket", not "Order"
 *
 * `CLAUDE.md` fixes the vocabulary: the entity is **Ticket**, the tables are `tickets` and
 * `ticket_items`, the permission keys are `tickets.*`. Several *live database objects*
 * still say `order` — `assign_order_number()`, `guard_order_item_price()`,
 * `guard_order_actor_and_assignment()`, and the `p_order_id` RPC argument. Those names are
 * a historical wart on a `tickets.id`; do not rename them and do not let them suggest a
 * second entity exists.
 *
 * ## Tenancy
 *
 * `customers` is **tenant-scoped only** — no `branch_id` (§4). `tickets` carries
 * `branch_id NOT NULL` and is tenant- *and* branch-scoped, like inventory. `ticket_items`
 * has neither `branch_id` nor its own branch predicate: it is reached through its parent
 * ticket. `branch_id` is carried on the ticket read model for the same reason inventory
 * carries it — a caller grouping revenue without it would merge two branches into one
 * number.
 *
 * ## Money is never a `number` here
 *
 * Five money columns live on `tickets` and two on `ticket_items`. Every one is a branded
 * decimal string, and every one must be selected with `::text`. See `./scalars.ts` for the
 * executed evidence that JSON transport otherwise destroys `NUMERIC` scale.
 *
 * **No total is recomputed in this layer.** `recalculate_ticket_totals()` owns
 * `subtotal_amount`; `total_amount` is `GENERATED ALWAYS AS ((subtotal_amount -
 * discount_amount) + tax_amount) STORED` and cannot be written at all; `amount_paid` is
 * maintained by `apply_payment_to_ticket()` from the `payments` ledger. A client that
 * re-derived any of them would be inventing the financial rules BLOCKER-003 exists to
 * prevent being invented.
 */

import type { Money, Quantity, Timestamptz, Uuid } from './scalars';

/* -------------------------------------------------------------------------- */
/* Ticket lifecycle                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Live `CHECK` per `SCHEMA-REFERENCE.md` §4 — ten values, matching the
 * `STATE-MACHINES.md` §1 diagram:
 *
 * ```
 * draft ─► submitted ─► confirmed ─► scheduled ─► in_production ─► ready ─► delivered ─► completed
 *   │          │            │            │              │            │          │
 *   └──────────┴────────────┴────────────┴──────────────┴────────────┴──────────┴──► cancelled ─► archived
 * ```
 *
 * The array order is the forward path, so `TICKET_STATUSES.indexOf` is a usable progress
 * index for the eight linear states. `cancelled` and `archived` sit at the end precisely
 * because they are *not* on that line — never treat their index as progress.
 */
export const TICKET_STATUSES = [
  'draft',
  'submitted',
  'confirmed',
  'scheduled',
  'in_production',
  'ready',
  'delivered',
  'completed',
  'cancelled',
  'archived',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/**
 * Statuses from which no transition is legal (`STATE-MACHINES.md` §1).
 *
 * Note `cancelled` is **not** here: its one legal exit is `archived`. That trips people up
 * often enough that the state machine document calls it out explicitly.
 */
export const TERMINAL_TICKET_STATUSES = [
  'completed',
  'archived',
] as const satisfies readonly TicketStatus[];

/**
 * True when a ticket can no longer transition.
 *
 * A read-side convenience for disabling actions in a UI. It is **not** an authorization
 * check and must never be used as one: `guard_ticket_status_transition()` is the sole
 * authority on status since `prevent_submitted_ticket_update()` was dropped on 2026-08-14,
 * and it runs in the database where a client cannot skip it.
 */
export function isTerminalTicketStatus(status: TicketStatus): boolean {
  return (TERMINAL_TICKET_STATUSES as readonly string[]).includes(status);
}

/**
 * Statuses at which `guard_ticket_item_mutation()` raises `order_locked`.
 *
 * Verified statement in `SCHEMA-REFERENCE.md` §9, which explicitly corrects
 * `STATE-MACHINES.md` §1: **items stay editable through `confirmed`, `scheduled` and
 * `in_production`**. The freeze point is `ready`, not `confirmed`. Reproducing the wrong
 * boundary here would grey out an edit the database would have accepted.
 */
export const TICKET_ITEMS_LOCKED_STATUSES = [
  'ready',
  'delivered',
  'completed',
  'cancelled',
  'archived',
] as const satisfies readonly TicketStatus[];

/**
 * True when `ticket_items` for this ticket can no longer be inserted, updated or deleted.
 *
 * `delivered`, `completed` and `archived` are included beyond the three statuses
 * `SCHEMA-REFERENCE.md` §9 names, because they are only reachable *through* `ready` — a
 * ticket that is locked at `ready` cannot become unlocked by advancing. Advisory only; the
 * trigger is the authority.
 */
export function areTicketItemsLocked(status: TicketStatus): boolean {
  return (TICKET_ITEMS_LOCKED_STATUSES as readonly string[]).includes(status);
}

/** Live `tickets_fulfilment_type_check` — verified 2026-08-15. */
export const TICKET_FULFILMENT_TYPES = ['pickup', 'delivery'] as const;
export type TicketFulfilmentType = (typeof TICKET_FULFILMENT_TYPES)[number];

/**
 * Live `tickets_sale_customer_type_check` — verified 2026-08-15:
 *
 * ```sql
 * CHECK (sale_customer_type = ANY (ARRAY['REGISTERED','ROADSIDE']))
 * ```
 *
 * **The values are upper-case, and the column is `NOT NULL`.** Both facts were wrong in
 * the first version of this file, which typed it `string | null` on the strength of
 * `SCHEMA-REFERENCE.md` §4 recording the column but no constraint. §4 was incomplete; the
 * live constraint is the authority (`CLAUDE.md`: the live database outranks every document
 * in this repo).
 *
 * `ROADSIDE` is the walk-in counter sale. Note it is a *sale* classification and is
 * independent of `customer_id` being null and of `customers.is_walk_in` — a registered
 * customer can buy at the roadside, and all three exist in the schema at once.
 */
export const SALE_CUSTOMER_TYPES = ['REGISTERED', 'ROADSIDE'] as const;
export type SaleCustomerType = (typeof SALE_CUSTOMER_TYPES)[number];

/* -------------------------------------------------------------------------- */
/* Read models                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A customer of one organization.
 *
 * Tenant-scoped, not branch-scoped: a bakery's customer belongs to the business, not to
 * the branch that happened to serve them first.
 *
 * `is_walk_in` marks the anonymous counter-sale placeholder. `tickets.customer_id` is
 * separately nullable for the same situation, so both representations exist live and a
 * caller must handle each: a null `customer_id` *and* a customer row whose `is_walk_in` is
 * true. They are not interchangeable and neither is a bug.
 *
 * `full_name` is the only required field. Nigerian bakery customers are frequently
 * recorded by name and phone alone, so `email` and `address_line` being null is the normal
 * case rather than incomplete data.
 */
export interface Customer {
  id: Uuid;
  tenant_id: Uuid;
  full_name: string;
  phone: string | null;
  email: string | null;
  address_line: string | null;
  notes: string | null;
  is_walk_in: boolean;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

/**
 * A customer order.
 *
 * ## The money fields, and which of them anything may write
 *
 * | Column | Written by |
 * |---|---|
 * | `subtotal_amount` | `recalculate_ticket_totals()` from `ticket_items`; frozen once the ticket leaves `draft` |
 * | `discount_amount`, `tax_amount` | unspecified — **BLOCKER-003** |
 * | `total_amount` | nobody: `GENERATED ALWAYS ... STORED` |
 * | `amount_paid` | `apply_payment_to_ticket()`, from the append-only `payments` ledger |
 *
 * So a ticket read model is a **report of a financial fact**, never an input to one.
 *
 * ## Payment is not a status
 *
 * `amount_paid` moves independently of `status`. A ticket may be fully paid while still
 * `in_production`, and `completed` while unpaid (a credit sale). `STATE-MACHINES.md` §1
 * calls conflating the two "the most common way this schema gets corrupted" — do not
 * derive a payment state from `status`, or a status from `amount_paid`.
 *
 * ## Sync ordering columns
 *
 * `device_created_at` (client clock), `server_received_at` (server clock) and `revision`
 * (monotonic counter) are carried because §12 makes them the ordering authority for
 * offline reconciliation, and a caller that sorted tickets by `created_at` would order
 * them by when the server heard about them rather than when the cashier wrote them.
 */
export interface Ticket {
  id: Uuid;
  tenant_id: Uuid;
  branch_id: Uuid;
  /** Null for an anonymous walk-in with no customer record. */
  customer_id: Uuid | null;
  /** `UNIQUE (tenant_id, ticket_number)`, assigned by trigger from `next_document_number()`. */
  ticket_number: string;
  status: TicketStatus;
  fulfilment_type: TicketFulfilmentType;
  due_at: Timestamptz | null;
  subtotal_amount: Money;
  discount_amount: Money;
  tax_amount: Money;
  /** Generated: `(subtotal_amount - discount_amount) + tax_amount`. Never writable. */
  total_amount: Money;
  amount_paid: Money;
  /** Required by trigger when `status = 'cancelled'`. */
  cancelled_reason: string | null;
  assigned_to: Uuid | null;
  /**
   * Set when this ticket reverses or corrects an earlier one. A financial correction is
   * always a new ticket pointing back, never an edit of the original (clarification §4).
   */
  correction_of_ticket_id: Uuid | null;
  /** `NOT NULL`, one of two upper-case values. See `SALE_CUSTOMER_TYPES`. */
  sale_customer_type: SaleCustomerType;
  /** ADR-001. The driver trip this ticket was sold on, or `null` for a non-driver sale.
   *  Setting or changing it is guarded by `guard_ticket_driver_trip_assignment()` —
   *  `STATE-MACHINES.md` §6. */
  driver_trip_id: Uuid | null;
  archived_at: Timestamptz | null;
  archived_by: Uuid | null;
  archive_reason: string | null;
  /** Client clock — when the device created it, which may long precede `created_at`. */
  device_created_at: Timestamptz | null;
  /** Server clock — when the gateway accepted it. */
  server_received_at: Timestamptz | null;
  /** Monotonic per-ticket counter used for sync conflict ordering. */
  revision: number;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

/**
 * One line of a ticket.
 *
 * `unit_price` is a **snapshot taken at the time of sale** and is never re-read from
 * `product_variants.unit_price`. That is what makes historical revenue reproducible after
 * a price change, and it is enforced live by `guard_order_item_price()`. A UI that
 * displayed the variant's current price beside a historical line would be showing two
 * different numbers and calling both "price".
 *
 * `line_total` is **`GENERATED ALWAYS ... STORED`** (verified live 2026-08-15), not a
 * written column with a CHECK as `SCHEMA-REFERENCE.md` §4 describes. Nothing can write it,
 * so it is read and never computed here: the database has already done the rounding at the
 * one scale `CLAUDE.md` rule 5 permits, and recomputing it in JavaScript would require
 * float arithmetic on money.
 *
 * It needs no `>= 0` constraint of its own — `quantity > 0` and `unit_price >= 0` are both
 * checked, so the product cannot be negative.
 */
export interface TicketItem {
  id: Uuid;
  tenant_id: Uuid;
  ticket_id: Uuid;
  product_variant_id: Uuid;
  quantity: Quantity;
  unit_price: Money;
  line_total: Money;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

/**
 * A ticket with its lines, assembled client-side from two validated reads.
 *
 * Deliberately not a PostgREST embed: an embedded resource does not carry the `::text`
 * casts this layer's precision guarantee depends on, so every nested money value would
 * arrive as a double. Two round trips, both on the exact-decimal path.
 */
export interface TicketWithItems {
  ticket: Ticket;
  items: TicketItem[];
}
