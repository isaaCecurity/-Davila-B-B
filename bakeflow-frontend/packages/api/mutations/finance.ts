import type { CashSession, Expense, ExpenseCategory, ExpensePaidMethod, Uuid } from '@bakeflow/types';
import { isZeroDecimalString } from '@bakeflow/types';
import { nonNegativeMoneySchema, positiveMoneySchema, uuidSchema } from '@bakeflow/validation';

import type { BakeflowClient } from '../client';
import { BakeflowApiError, normalizePostgrestError, normalizeThrown } from '../errors';
import { getExpenseById, listCashSessions } from '../queries/finance';

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

/**
 * Expense capture — a plain PostgREST INSERT, not an RPC.
 *
 * `expenses` grants `authenticated` `INSERT`/`SELECT`/`UPDATE` directly (verified live
 * 2026-08-28, `information_schema.role_table_grants`) — unlike its P5 siblings `payments`/
 * `refunds`/`cash_sessions`, which are RPC-only. `guard_expense_cash_session()` (the one
 * `BEFORE INSERT OR UPDATE` trigger) only validates cash/session coherence; it does not
 * derive any column, so `tenant_id` and `created_by` must both be supplied explicitly —
 * `tenant_id` per `CLAUDE.md` rule 3 (never a JWT-derived default), `created_by` because,
 * unlike `tickets` (whose `guard_order_actor_and_assignment()` trigger overwrites it from
 * `auth.uid()` unconditionally), `expenses` has no such trigger.
 *
 * ## A real authorization gap, found and fixed the same pass this mutation was written
 *
 * `expenses_insert`'s `WITH CHECK` never constrained `created_by` at all — reproduced live
 * 2026-08-28 in a rolled-back transaction: a simulated cashier inserted an expense with
 * `created_by` set to a *different* profile, and it succeeded. Every sibling table already
 * closes this: `tickets` via the trigger above, `daily_financial_audits_insert` via an
 * explicit `submitted_by = auth.uid()` clause. Fixed by mirroring the latter exactly
 * (migration `fix_expenses_insert_created_by_forgery`) — `expenses_insert` now also
 * requires `created_by = auth.uid()`. Re-verified live after the fix (forged and omitted
 * `created_by` both refused; the caller's own id succeeds) and the full `tests/sql/
 * financial_write_rls.sql` suite re-run clean (28/28, F14/F15 unaffected). This is why
 * `createdBy` is a required parameter here rather than something this function infers —
 * the one value the database will now accept is the caller's own id, and the caller (the
 * screen, reading `useSessionStore().userId`) is the only place that value legitimately
 * comes from.
 */
export interface CreateExpenseInput {
  branchId: Uuid;
  category: ExpenseCategory;
  /** Exact decimal string, never a JS `number`. Must be `> 0` (`expenses_amount_check`). */
  amount: string;
  /** Omit for an expense with no attributable payment method. */
  paidMethod?: ExpensePaidMethod | null;
  /** Required when `paidMethod === 'cash'`; must be omitted otherwise
   *  (`guard_expense_cash_session()`: a cash session may only attach to a cash expense). */
  cashSessionId?: Uuid | null;
  description?: string | null;
  receiptUrl?: string | null;
}

export async function createExpense(
  client: BakeflowClient,
  tenantId: Uuid,
  createdBy: Uuid,
  input: CreateExpenseInput,
): Promise<Expense> {
  if (!uuidSchema.safeParse(tenantId).success) {
    throw invalid('createExpense', 'tenantId must be a uuid');
  }
  if (!uuidSchema.safeParse(createdBy).success) {
    throw invalid('createExpense', 'createdBy must be a uuid');
  }
  if (!uuidSchema.safeParse(input.branchId).success) {
    throw invalid('createExpense', 'branchId must be a uuid');
  }
  const parsedAmount = positiveMoneySchema.safeParse(input.amount);
  if (!parsedAmount.success) {
    throw invalid('createExpense', 'amount must be an exact decimal string > 0');
  }
  if (input.cashSessionId !== null && input.cashSessionId !== undefined) {
    if (!uuidSchema.safeParse(input.cashSessionId).success) {
      throw invalid('createExpense', 'cashSessionId must be a uuid');
    }
    if (input.paidMethod !== 'cash') {
      throw invalid('createExpense', 'cashSessionId requires paidMethod to be "cash"');
    }
  }
  if (input.paidMethod === 'cash' && (input.cashSessionId === null || input.cashSessionId === undefined)) {
    throw invalid('createExpense', 'a cash expense requires the currently open till\'s cashSessionId');
  }
  if (input.description !== null && input.description !== undefined && input.description.length > 2000) {
    throw invalid('createExpense', 'description must be at most 2000 characters');
  }

  const row = await run(
    client
      .from('expenses')
      .insert({
        tenant_id: tenantId,
        branch_id: input.branchId,
        category: input.category,
        amount: parsedAmount.data,
        paid_method: input.paidMethod ?? null,
        cash_session_id: input.cashSessionId ?? null,
        description: input.description?.trim() || null,
        receipt_url: input.receiptUrl?.trim() || null,
        created_by: createdBy,
      })
      .select('id')
      .single(),
  ) as { id?: unknown };

  const expenseId = row.id;
  if (typeof expenseId !== 'string' || !uuidSchema.safeParse(expenseId).success) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: 'createExpense: the inserted expense carried no valid id',
    });
  }

  const expense = await getExpenseById(client, expenseId);
  if (expense === null) {
    throw new BakeflowApiError({
      code: 'unexpected_error',
      message:
        'createExpense: the expense was created but could not be read back; the insert ' +
        'and expenses_select disagree for this caller',
    });
  }
  return expense;
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