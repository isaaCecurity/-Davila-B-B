import type { CashSession, Uuid } from '@bakeflow/types';
import { isZeroDecimalString } from '@bakeflow/types';
import { nonNegativeMoneySchema, uuidSchema } from '@bakeflow/validation';

import type { BakeflowClient } from '../client';
import { BakeflowApiError, normalizePostgrestError, normalizeThrown } from '../errors';
import { listCashSessions } from '../queries/finance';

export interface OpenCashSessionInput {
  branchId: Uuid;
  openingFloat: string;
}

export interface CloseCashSessionInput {
  sessionId: Uuid;
  countedAmount: string;
  note?: string | null;
}

export async function openCashSession(
  client: BakeflowClient,
  input: OpenCashSessionInput,
): Promise<CashSession> {
  if (!uuidSchema.safeParse(input.branchId).success) {
    throw invalid('openCashSession', 'branchId must be a uuid');
  }
  if (!nonNegativeMoneySchema.safeParse(input.openingFloat).success) {
    throw invalid('openCashSession', 'openingFloat must be a non-negative decimal string');
  }
  try {
    await client.rpc('open_cash_session', {
      p_branch_id: input.branchId,
      p_opening_float: input.openingFloat,
    }).then((result) => {
      if (result.error !== null) throw normalizePostgrestError(result.error);
    });
    const sessions = await listCashSessions(client, input.branchId);
    const session = sessions.find((item) => item.status === 'open');
    if (session === undefined) throw invalid('openCashSession', 'RPC returned no open session');
    return session;
  } catch (error) {
    throw normalizeThrown(error);
  }
}

export async function closeCashSession(
  client: BakeflowClient,
  input: CloseCashSessionInput,
): Promise<CashSession> {
  if (!uuidSchema.safeParse(input.sessionId).success) {
    throw invalid('closeCashSession', 'sessionId must be a uuid');
  }
  if (!nonNegativeMoneySchema.safeParse(input.countedAmount).success) {
    throw invalid('closeCashSession', 'countedAmount must be a non-negative decimal string');
  }
  try {
    await client.rpc('close_cash_session', {
      p_session_id: input.sessionId,
      p_counted_amount: input.countedAmount,
      p_note: input.note ?? null,
    }).then((result) => {
      if (result.error !== null) throw normalizePostgrestError(result.error);
    });
    const sessions = await listCashSessions(client);
    const session = sessions.find((item) => item.id === input.sessionId);
    if (session === undefined) throw invalid('closeCashSession', 'RPC returned no session');
    return session;
  } catch (error) {
    throw normalizeThrown(error);
  }
}

function invalid(context: string, message: string): BakeflowApiError {
  return new BakeflowApiError({ code: 'invalid_request', message: `${context}: ${message}` });
}

export const PAYMENT_METHODS = ['cash', 'card', 'transfer', 'pos'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface RecordPaymentInput {
  ticketId: Uuid;
  amount: string;
  method: PaymentMethod;
  reference?: string | null;
  cashSessionId?: Uuid | null;
}

export interface RecordPaymentResult {
  paymentId: Uuid;
  amount: string;
  method: PaymentMethod;
}

export async function recordPayment(
  client: BakeflowClient,
  input: RecordPaymentInput,
): Promise<RecordPaymentResult> {
  if (!uuidSchema.safeParse(input.ticketId).success) {
    throw invalid('recordPayment', 'ticketId must be a uuid');
  }
  if (input.cashSessionId !== null && input.cashSessionId !== undefined &&
      !uuidSchema.safeParse(input.cashSessionId).success) {
    throw invalid('recordPayment', 'cashSessionId must be a uuid');
  }
  const parsedAmount = nonNegativeMoneySchema.safeParse(input.amount);
  if (!parsedAmount.success || isZeroDecimalString(parsedAmount.data)) {
    throw invalid('recordPayment', 'amount must be an exact decimal string > 0');
  }
  const payload = await client.rpc('record_payment', {
    p_order_id: input.ticketId,
    p_amount: parsedAmount.data,
    p_method: input.method,
    p_reference: input.reference?.trim() || null,
    p_cash_session_id: input.cashSessionId ?? null,
    p_driver_trip_id: null,
  }).then((result) => {
    if (result.error !== null) throw normalizePostgrestError(result.error);
    return result.data;
  });
  if (typeof payload !== 'object' || payload === null) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: `recordPayment: expected a jsonb envelope, received ${typeof payload}`,
    });
  }
  const payment = (payload as { payment?: { id?: unknown } }).payment;
  if (typeof payment?.id !== 'string' || !uuidSchema.safeParse(payment.id).success) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: 'recordPayment: the envelope carried no valid payment id',
    });
  }
  return { paymentId: payment.id, amount: parsedAmount.data, method: input.method };
}