/**
 * Ticket lifecycle — creating a customer order as a draft, and moving a counter or customer
 * ticket along its state machine.
 *
 * Kept apart from `./sales`, whose header records that the driver "Sell" module exposes no
 * generic status-setter and must not grow one. This module is the operational path used by
 * owners, admins, branch managers, cashiers and bakers (`STATE-MACHINES.md` §1).
 *
 * ## The database decides; this module only chooses the door
 *
 * `guard_ticket_status_transition()` is the sole authority on which hop is legal and who may
 * take it. Nothing here re-implements that matrix — a refused hop comes back as a normalised
 * error and the screen shows it. What this module *does* own is picking the right RPC for a
 * target, because three hops have side effects that a plain status write would skip:
 *
 * | Target | RPC | Why not `update_ticket` |
 * |---|---|---|
 * | `confirmed` | `confirm_ticket` | recomputes the subtotal and issues the invoice |
 * | `completed` | `complete_ticket` | writes one `sale` stock movement per variant first — a
 * |  |  | plain status write would record the sale with no stock leaving the shelf |
 * | `cancelled` | `cancel_ticket` | requires the reason and the refund precondition |
 * | everything else | `update_ticket(p_status)` | — |
 *
 * `update_ticket` coalesces every argument, so sending only `p_status` leaves pricing,
 * assignment and customer untouched (verified live 2026-09-13). Discount and tax stay under
 * BLOCKER-003 and are never sent from here.
 *
 * ## Precision
 *
 * Only `id` and `status` are read back from the RPC envelopes — neither is `NUMERIC`. The
 * ticket is re-read through `getTicketWithItems`/`listTickets`, which carry the `::text` casts.
 */

import type { TicketFulfilmentType, TicketStatus, TicketWithItems, Uuid } from '@bakeflow/types';
import { TICKET_FULFILMENT_TYPES, TICKET_STATUSES } from '@bakeflow/types';
import { positiveQuantitySchema, uuidSchema } from '@bakeflow/validation';

import type { BakeflowClient } from '../client';
import { BakeflowApiError, normalizePostgrestError } from '../errors';
import { run } from '../internal/read';
import { getTicketWithItems } from '../queries/sales';

function invalid(context: string, message: string): BakeflowApiError {
  return new BakeflowApiError({ code: 'invalid_request', message: `${context}: ${message}` });
}

/**
 * The next forward hop from each status (`STATE-MACHINES.md` §1). `completed`, `cancelled`
 * and `archived` have no forward hop: cancellation and archival are separate actions.
 */
export const NEXT_TICKET_STATUS: Readonly<Partial<Record<TicketStatus, TicketStatus>>> = {
  draft: 'submitted',
  submitted: 'confirmed',
  confirmed: 'scheduled',
  scheduled: 'in_production',
  in_production: 'ready',
  ready: 'delivered',
  delivered: 'completed',
};

export function nextTicketStatus(from: TicketStatus): TicketStatus | null {
  return NEXT_TICKET_STATUS[from] ?? null;
}

export interface TicketTransitionResult {
  ticketId: Uuid;
  status: TicketStatus;
}

export interface AdvanceTicketInput {
  ticketId: Uuid;
  /**
   * The status the user was looking at. The target is derived from it rather than re-read,
   * so a ticket someone else advanced in the meantime is refused by the guard instead of
   * silently skipping a step.
   */
  from: TicketStatus;
  /** Only for `delivered → completed`. Omitted uses the branch's default warehouse. */
  warehouseId?: Uuid | null;
}

async function callRpc(
  client: BakeflowClient,
  context: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<TicketTransitionResult> {
  const payload = await client.rpc(fn, args).then((result) => {
    if (result.error !== null) throw normalizePostgrestError(result.error);
    return result.data;
  });

  const ticket = (payload as { ticket?: { id?: unknown; status?: unknown } } | null)?.ticket;
  const id = ticket?.id;
  const status = ticket?.status;
  if (typeof id !== 'string' || !uuidSchema.safeParse(id).success) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: `${context}: the envelope carried no valid ticket id`,
    });
  }
  if (typeof status !== 'string' || !(TICKET_STATUSES as readonly string[]).includes(status)) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: `${context}: the envelope carried no recognised ticket status`,
    });
  }
  return { ticketId: id, status: status as TicketStatus };
}

/** Move a ticket one step forward along its lifecycle. */
export async function advanceTicket(
  client: BakeflowClient,
  input: AdvanceTicketInput,
): Promise<TicketTransitionResult> {
  const context = 'advanceTicket';
  if (!uuidSchema.safeParse(input.ticketId).success) {
    throw invalid(context, 'ticketId must be a uuid');
  }
  const to = nextTicketStatus(input.from);
  if (to === null) {
    throw invalid(context, `a ${input.from} ticket has no forward step`);
  }
  if (input.warehouseId !== undefined && input.warehouseId !== null &&
      !uuidSchema.safeParse(input.warehouseId).success) {
    throw invalid(context, 'warehouseId must be a uuid');
  }

  if (to === 'confirmed') {
    return callRpc(client, context, 'confirm_ticket', { p_order_id: input.ticketId });
  }
  if (to === 'completed') {
    return callRpc(client, context, 'complete_ticket', {
      p_order_id: input.ticketId,
      p_warehouse_id: input.warehouseId ?? null,
    });
  }
  return callRpc(client, context, 'update_ticket', { p_order_id: input.ticketId, p_status: to });
}

export interface CancelTicketInput {
  ticketId: Uuid;
  /** Required by the database; a blank reason is refused here before the round trip. */
  reason: string;
}

/**
 * Cancel a ticket. Manager-only and refused by the database while money is held without a
 * matching refund — both surface as errors the screen shows verbatim.
 */
export async function cancelTicket(
  client: BakeflowClient,
  input: CancelTicketInput,
): Promise<TicketTransitionResult> {
  const context = 'cancelTicket';
  if (!uuidSchema.safeParse(input.ticketId).success) {
    throw invalid(context, 'ticketId must be a uuid');
  }
  const reason = input.reason.trim();
  if (reason === '') throw invalid(context, 'a cancellation reason is required');

  return callRpc(client, context, 'cancel_ticket', { p_order_id: input.ticketId, p_reason: reason });
}

/* -------------------------------------------------------------------------- */
/* Creating a customer order                                                   */
/* -------------------------------------------------------------------------- */

export interface CreateTicketLine {
  productVariantId: Uuid;
  /** Exact decimal string > 0. */
  quantity: string;
}

export interface CreateTicketInput {
  branchId: Uuid;
  /** Null for a walk-in with no customer record. */
  customerId: Uuid | null;
  fulfilmentType: TicketFulfilmentType;
  lines: readonly CreateTicketLine[];
}

/**
 * Create a customer order as a `draft` with its lines.
 *
 * The same plain-INSERT contract `createRoadsideTicket` documents in `./sales`, for the
 * operational roles: `tickets_insert` and `ticket_items_insert` admit owner, admin,
 * branch_manager and cashier (verified live 2026-09-13), and no `create_ticket()` RPC exists.
 * The bounded atomicity gap is the same — a lost connection between the two inserts leaves a
 * visible, item-less draft with a zero subtotal, not a financial fact.
 *
 * Deliberately stops at `draft`. Submitting and confirming are separate, user-visible steps
 * (`advanceTicket`); a single-action counter sale that completes on creation is BLOCKER-030.
 *
 * `unit_price` is sent as `'0'` and overwritten by `guard_order_item_price()`; the subtotal is
 * computed from the lines by `recalculate_ticket_totals()`. This function never prices anything.
 */
export async function createTicket(
  client: BakeflowClient,
  tenantId: Uuid,
  input: CreateTicketInput,
): Promise<TicketWithItems> {
  const context = 'createTicket';
  if (!uuidSchema.safeParse(tenantId).success) throw invalid(context, 'tenantId must be a uuid');
  if (!uuidSchema.safeParse(input.branchId).success) throw invalid(context, 'branchId must be a uuid');
  if (input.customerId !== null && !uuidSchema.safeParse(input.customerId).success) {
    throw invalid(context, 'customerId must be a uuid or null');
  }
  if (!(TICKET_FULFILMENT_TYPES as readonly string[]).includes(input.fulfilmentType)) {
    throw invalid(context, 'fulfilmentType must be pickup or delivery');
  }
  if (input.lines.length === 0) throw invalid(context, 'at least one line item is required');

  const lines = input.lines.map((line, index) => {
    if (!uuidSchema.safeParse(line.productVariantId).success) {
      throw invalid(context, `lines[${index}].productVariantId must be a uuid`);
    }
    const quantity = positiveQuantitySchema.safeParse(line.quantity);
    if (!quantity.success) {
      throw invalid(context, `lines[${index}].quantity must be an exact decimal string > 0`);
    }
    return { productVariantId: line.productVariantId, quantity: quantity.data };
  });

  const ticketRow = (await run(
    client
      .from('tickets')
      .insert({
        tenant_id: tenantId,
        branch_id: input.branchId,
        customer_id: input.customerId,
        fulfilment_type: input.fulfilmentType,
        // ROADSIDE is the walk-in classification; a named customer is REGISTERED.
        sale_customer_type: input.customerId === null ? 'ROADSIDE' : 'REGISTERED',
        driver_trip_id: null,
      })
      .select('id')
      .single(),
  )) as { id?: unknown };

  const ticketId = ticketRow.id;
  if (typeof ticketId !== 'string' || !uuidSchema.safeParse(ticketId).success) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: `${context}: the inserted ticket carried no valid id`,
    });
  }

  await run(
    client.from('ticket_items').insert(
      lines.map((line) => ({
        tenant_id: tenantId,
        ticket_id: ticketId,
        product_variant_id: line.productVariantId,
        quantity: line.quantity,
        unit_price: '0',
      })),
    ),
  );

  const row = await getTicketWithItems(client, ticketId);
  if (row === null) {
    throw new BakeflowApiError({
      code: 'unexpected_error',
      message: `${context}: the order was created but could not be read back`,
    });
  }
  return row;
}
