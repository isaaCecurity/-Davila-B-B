/**
 * Sales write path — the driver "Sell" step, ADR-001 Phase 5. **Ticket creation only.**
 *
 * ## Why this is the first plain-table-write mutation module in the package
 *
 * Every other write path in `@bakeflow/api` (inventory, production, delivery, driver
 * trips, invitations) is RPC-only, because `API-CONTRACT.md` §1's decision rule reserves
 * RPCs for anything that must either fully happen or not happen at all. Ticket creation is
 * different **by the live schema's own design, not by choice here**: `tickets_insert` RLS
 * (verified live 2026-08-25) explicitly lets a `driver` insert a row with
 * `created_by = auth.uid()`, `ticket_items_insert` reaches through to the same check on the
 * parent ticket, and — per `queries/sales.ts`'s own header and `BACKEND_ROADMAP.md` P9.3 —
 * **no `create_ticket()` RPC exists for anyone, driver or otherwise.** The RLS shape only
 * makes sense as a plain-INSERT contract; there is nothing to "discover" here the way
 * `adjust_stock()` turned out to hide an RPC nobody had read yet.
 *
 * ## The atomicity gap this accepts, and why it is bounded
 *
 * Two round trips: insert `tickets` (one row), then insert `ticket_items` (one INSERT
 * statement, one or many rows — a single Postgres statement, so that half is atomic across
 * every line). If the network dies between them, the result is a `draft` ticket with zero
 * items — visible, recoverable, and **not a financial fact**: `subtotal_amount` defaults to
 * `0`, nothing has been confirmed, and no stock movement or revenue has been recorded. This
 * is the bounded case `API-CONTRACT.md` §1 is willing to accept split, unlike a payment or a
 * stock movement — see the module's own reasoning trail in `IMPLEMENTATION_LOG.md`.
 *
 * ## What this deliberately does not do: advance the ticket past `draft`
 *
 * **BLOCKER-021** (see `BLOCKERS.md`): `guard_ticket_status_transition()`'s actor lists
 * never include `driver` at any of the seven forward hops, so a driver-created ticket
 * cannot legally reach `submitted`, let alone `confirmed`/`completed`, without a
 * cashier/branch_manager/owner/admin doing it. This module stops at `draft` on purpose — a
 * driver hands the created ticket off; someone with the right role advances it later (at
 * reconciliation, or live over the till). Do not add a `confirmTicket`/`submitTicket` call
 * here until BLOCKER-021 is resolved; every such call from a driver would come back
 * `insufficient_role`.
 *
 * `record_payment()` is **not** blocked by any of this — its own driver branch is already
 * correctly scoped (see `mutations/driver-trips.ts`) and works against a `draft` ticket,
 * since the RPC only refuses a `cancelled` one. So "Sell" (this module) followed by "Record
 * Payment" (`recordDriverTripPayment`) is a complete, honest driver flow today, even though
 * the ticket itself stays in `draft` until the office processes it.
 *
 * ## `unit_price` is never actually written by this client
 *
 * `guard_order_item_price()` (`BEFORE INSERT ON ticket_items`) overwrites `NEW.unit_price`
 * from `product_variants.unit_price` unconditionally on insert — verified live. The column
 * is `NOT NULL` so a value must be sent, but whatever is sent is discarded; `'0'` is sent
 * here rather than a client-held price, so nothing here can be mistaken for a price this
 * module controls.
 *
 * ## Precision
 *
 * The only column read back from either INSERT response is `id` — a `uuid`, not a
 * `NUMERIC`, so no `::text` cast is needed and none of this touches the money-precision
 * hazard the read path guards against. The created ticket is re-read in full through
 * `getTicketWithItems`, which already carries every cast.
 */

import type { TicketWithItems, Uuid } from '@bakeflow/types';
import { positiveQuantitySchema, uuidSchema } from '@bakeflow/validation';

import type { BakeflowClient } from '../client';
import { BakeflowApiError, normalizePostgrestError, normalizeThrown } from '../errors';
import { getTicketWithItems } from '../queries/sales';

/** One line of a roadside sale. */
export interface RoadsideTicketLine {
  productVariantId: Uuid;
  /** Exact decimal string, never a JS `number`. Must be `> 0`. */
  quantity: string;
}

export interface CreateRoadsideTicketInput {
  branchId: Uuid;
  /** The driver's own `in_transit` trip. Enforced by `guard_ticket_driver_trip_assignment()`
   *  — the trip must be `in_transit` and its `driver_id` must equal `created_by`. */
  driverTripId: Uuid;
  lines: readonly RoadsideTicketLine[];
}

/**
 * Create a roadside (walk-up, no registered customer) ticket for a sale made during an
 * active driver trip, with its line items, as a `draft`.
 *
 * `customer_id` is always `null` and `sale_customer_type` is always `'ROADSIDE'` — the
 * unblocked path per `BLOCKERS.md` BLOCKER-021's "not blocking" note: customer
 * create/select (P9.2) is itself blocked (P3.7), and a roadside sale needs no customer
 * record, `tickets.customer_id` being nullable for exactly this case.
 *
 * @throws {BakeflowApiError} `invalid_request` for a malformed argument or an empty
 *   `lines` array; `insufficient_role` when the caller lacks branch access or is not a
 *   driver acting on their own `created_by`; `invalid_transition` when
 *   `guard_ticket_driver_trip_assignment()` refuses the trip link (not `in_transit`, or
 *   not this driver's own trip); `invalid_request` (`23503`) when a `productVariantId`
 *   does not exist in this tenant's catalog.
 */
export async function createRoadsideTicket(
  client: BakeflowClient,
  tenantId: Uuid,
  input: CreateRoadsideTicketInput,
): Promise<TicketWithItems> {
  if (!uuidSchema.safeParse(tenantId).success) {
    throw invalid('createRoadsideTicket', 'tenantId must be a uuid');
  }
  if (!uuidSchema.safeParse(input.branchId).success) {
    throw invalid('createRoadsideTicket', 'branchId must be a uuid');
  }
  if (!uuidSchema.safeParse(input.driverTripId).success) {
    throw invalid('createRoadsideTicket', 'driverTripId must be a uuid');
  }
  if (input.lines.length === 0) {
    throw invalid('createRoadsideTicket', 'at least one line item is required');
  }

  const lines = input.lines.map((line, index) => {
    if (!uuidSchema.safeParse(line.productVariantId).success) {
      throw invalid('createRoadsideTicket', `lines[${index}].productVariantId must be a uuid`);
    }
    const parsedQuantity = positiveQuantitySchema.safeParse(line.quantity);
    if (!parsedQuantity.success) {
      throw invalid(
        'createRoadsideTicket',
        `lines[${index}].quantity must be an exact decimal string > 0`,
      );
    }
    return { productVariantId: line.productVariantId, quantity: parsedQuantity.data };
  });

  const ticketRow = (await run(
    client
      .from('tickets')
      .insert({
        tenant_id: tenantId,
        branch_id: input.branchId,
        customer_id: null,
        fulfilment_type: 'pickup',
        sale_customer_type: 'ROADSIDE',
        driver_trip_id: input.driverTripId,
      })
      .select('id')
      .single(),
  )) as { id?: unknown };

  const ticketId = ticketRow.id;
  if (typeof ticketId !== 'string' || !uuidSchema.safeParse(ticketId).success) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: 'createRoadsideTicket: the inserted ticket carried no valid id',
    });
  }

  await run(
    client.from('ticket_items').insert(
      lines.map((line) => ({
        tenant_id: tenantId,
        ticket_id: ticketId,
        product_variant_id: line.productVariantId,
        quantity: line.quantity,
        // Overwritten unconditionally by guard_order_item_price() — see the module header.
        unit_price: '0',
      })),
    ),
  );

  const row = await getTicketWithItems(client, ticketId);
  if (row === null) {
    throw new BakeflowApiError({
      code: 'unexpected_error',
      message:
        'createRoadsideTicket: the ticket was created but could not be read back; the ' +
        'insert and tickets_select disagree for this caller',
    });
  }
  return row;
}

/* -------------------------------------------------------------------------- */
/* Internals                                                                   */
/* -------------------------------------------------------------------------- */

function invalid(context: string, message: string): BakeflowApiError {
  return new BakeflowApiError({ code: 'invalid_request', message: `${context}: ${message}` });
}

/** Local copy of the query runner, matching every other mutations module in this package. */
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
