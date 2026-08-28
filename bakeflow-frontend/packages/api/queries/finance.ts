import type { CashSession, Expense } from '@bakeflow/types';
import { cashSessionSchema, expenseSchema } from '@bakeflow/validation';

import type { BakeflowClient } from '../client';
import {
  parseRow,
  parseRows,
  projectionFor,
  run,
  withSoftDeleteFilter,
  type ReadEntity,
} from '../internal/read';

const TEXT_CAST_COLUMNS: ReadonlySet<string> = new Set([
  'opening_float',
  'expected_amount',
  'counted_amount',
  'variance_amount',
]);

const CASH_SESSIONS: ReadEntity<CashSession> = {
  table: 'cash_sessions',
  schema: cashSessionSchema,
  columns: projectionFor(cashSessionSchema, TEXT_CAST_COLUMNS),
  softDeleted: true,
};

export async function listCashSessions(
  client: BakeflowClient,
  branchId?: string,
): Promise<CashSession[]> {
  let query = withSoftDeleteFilter(
    client.from(CASH_SESSIONS.table).select(CASH_SESSIONS.columns),
    CASH_SESSIONS,
  );
  if (branchId !== undefined) query = query.eq('branch_id', branchId);

  const data = await run(query.order('opened_at', { ascending: false }));
  return parseRows(CASH_SESSIONS.schema, data, 'listCashSessions');
}

const EXPENSE_TEXT_CAST_COLUMNS: ReadonlySet<string> = new Set(['amount']);

const EXPENSES: ReadEntity<Expense> = {
  table: 'expenses',
  schema: expenseSchema,
  columns: projectionFor(expenseSchema, EXPENSE_TEXT_CAST_COLUMNS),
  softDeleted: true,
};

export interface ExpenseFilters {
  branchId?: string;
  cashSessionId?: string;
}

export async function listExpenses(
  client: BakeflowClient,
  filters: ExpenseFilters = {},
): Promise<Expense[]> {
  let query = withSoftDeleteFilter(
    client.from(EXPENSES.table).select(EXPENSES.columns),
    EXPENSES,
  );
  if (filters.branchId !== undefined) query = query.eq('branch_id', filters.branchId);
  if (filters.cashSessionId !== undefined) {
    query = query.eq('cash_session_id', filters.cashSessionId);
  }

  const data = await run(query.order('incurred_at', { ascending: false }));
  return parseRows(EXPENSES.schema, data, 'listExpenses');
}

/** Used by `mutations/finance.ts`'s `createExpense()` to re-read what it just inserted. */
export async function getExpenseById(
  client: BakeflowClient,
  id: string,
): Promise<Expense | null> {
  const query = withSoftDeleteFilter(
    client.from(EXPENSES.table).select(EXPENSES.columns).eq('id', id),
    EXPENSES,
  );
  const data = await run(query.maybeSingle());
  return parseRow(EXPENSES.schema, data, 'getExpenseById');
}