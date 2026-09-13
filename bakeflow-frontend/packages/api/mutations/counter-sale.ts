/**
 * Counter sale — AD-024 (resolves BLOCKER-030). **One RPC, one transaction.**
 *
 * ```
 * complete_counter_sale(p_branch_id uuid, p_items jsonb, p_payment_method text,
 *                       p_customer_id uuid DEFAULT NULL, p_warehouse_id uuid DEFAULT NULL) RETURNS jsonb
 * ```
 *
 * A walk-in (or named) customer buys what is already on the shelf and pays in full. The function
 * creates the ticket and its lines (prices from the catalogue), completes it through the guarded
 * `draft → completed` shortcut, issues the invoice, writes one sale stock movement per product
 * from the branch's default stockroom, and records the payment for the server-computed total —
 * all or nothing. An oversold line, a cash sale with no open till, or a refused role rolls the
 * whole sale back.
 *
 * Authorization (read from the function body): owner, admin, branch manager or cashier with
 * access to the branch; the guard trigger re-checks the actor for the completion hop.
 *
 * ## Precision
 *
 * The function returns every money figure already cast to text, so the envelope is read directly
 * and validated with the money schemas — no float ever touches the total.
 */

import type { Money, Uuid } from '@bakeflow/types';
import { nonNegativeMoneySchema, positiveQuantitySchema, uuidSchema } from '@bakeflow/validation';

import type { BakeflowClient } from '../client';
import { BakeflowApiError, normalizePostgrestError, normalizeThrown } from '../errors';

/** The methods the prototype's counter sale offers. `card` is accepted server-side too. */
export const COUNTER_SALE_METHODS = ['cash', 'transfer', 'pos'] as const;
export type CounterSaleMethod = (typeof COUNTER_SALE_METHODS)[number];

export interface CounterSaleLine {
  productVariantId: Uuid;
  /** Exact decimal string > 0, at most 4 decimal places. */
  quantity: string;
}

export interface CompleteCounterSaleInput {
  branchId: Uuid;
  lines: readonly CounterSaleLine[];
  paymentMethod: CounterSaleMethod;
  /** Null for a walk-in customer. */
  customerId?: Uuid | null;
}

export interface CounterSaleResult {
  ticketId: Uuid;
  ticketNumber: string;
  invoiceId: Uuid;
  /** The server's total — authoritative, whatever a device previewed. */
  totalAmount: Money;
  amountPaid: Money;
  /** Null only for a zero-total sale, which records no payment. */
  paymentId: Uuid | null;
  paymentMethod: CounterSaleMethod;
}

/**
 * Ring up a counter sale in one step.
 *
 * @throws {BakeflowApiError} `insufficient_role` for a role or branch the caller may not sell in;
 *   `invalid_transition` with reason `no_open_till` for cash without an open till;
 *   `insufficient_stock` when a line would oversell; `invalid_request` for malformed input or an
 *   unavailable product.
 */
export async function completeCounterSale(
  client: BakeflowClient,
  input: CompleteCounterSaleInput,
): Promise<CounterSaleResult> {
  const context = 'completeCounterSale';
  if (!uuidSchema.safeParse(input.branchId).success) throw invalid(context, 'branchId must be a uuid');
  if (input.customerId != null && !uuidSchema.safeParse(input.customerId).success) {
    throw invalid(context, 'customerId must be a uuid or null');
  }
  if (!(COUNTER_SALE_METHODS as readonly string[]).includes(input.paymentMethod)) {
    throw invalid(context, 'paymentMethod must be cash, transfer or pos');
  }
  if (input.lines.length === 0) throw invalid(context, 'a sale needs at least one line');

  const items = input.lines.map((line, index) => {
    if (!uuidSchema.safeParse(line.productVariantId).success) {
      throw invalid(context, `lines[${index}].productVariantId must be a uuid`);
    }
    const quantity = positiveQuantitySchema.safeParse(line.quantity);
    if (!quantity.success) throw invalid(context, `lines[${index}].quantity must be an exact decimal string > 0`);
    return { product_variant_id: line.productVariantId, quantity: quantity.data };
  });

  let result: { data: unknown; error: unknown };
  try {
    result = (await client.rpc('complete_counter_sale', {
      p_branch_id: input.branchId,
      p_items: items,
      p_payment_method: input.paymentMethod,
      p_customer_id: input.customerId ?? null,
      p_warehouse_id: null,
    })) as { data: unknown; error: unknown };
  } catch (thrown) {
    throw normalizeThrown(thrown);
  }
  if (result.error !== null && result.error !== undefined) {
    throw normalizePostgrestError(result.error as Parameters<typeof normalizePostgrestError>[0]);
  }

  const payload = (result.data ?? {}) as Record<string, unknown>;
  const ticketId = uuidSchema.safeParse(payload.ticket_id);
  const invoiceId = uuidSchema.safeParse(payload.invoice_id);
  const total = nonNegativeMoneySchema.safeParse(payload.total_amount);
  const paid = nonNegativeMoneySchema.safeParse(payload.amount_paid);
  const paymentId = payload.payment_id == null ? null : uuidSchema.safeParse(payload.payment_id);
  if (
    !ticketId.success ||
    !invoiceId.success ||
    !total.success ||
    !paid.success ||
    typeof payload.ticket_number !== 'string' ||
    (paymentId !== null && !paymentId.success)
  ) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: `${context}: the sale was recorded but the response was not in the expected shape`,
      details: JSON.stringify(payload).slice(0, 500),
    });
  }

  return {
    ticketId: ticketId.data,
    ticketNumber: payload.ticket_number,
    invoiceId: invoiceId.data,
    totalAmount: total.data,
    amountPaid: paid.data,
    paymentId: paymentId === null ? null : (paymentId.data ?? null),
    paymentMethod: input.paymentMethod,
  };
}

function invalid(context: string, message: string): BakeflowApiError {
  return new BakeflowApiError({ code: 'invalid_request', message: `${context}: ${message}` });
}
