import type { Money, Timestamptz, Uuid } from './scalars';

export const CASH_SESSION_STATUSES = ['open', 'closed'] as const;
export type CashSessionStatus = (typeof CASH_SESSION_STATUSES)[number];

export interface CashSession {
  id: Uuid;
  tenant_id: Uuid;
  branch_id: Uuid;
  opened_by: Uuid;
  closed_by: Uuid | null;
  opening_float: Money;
  expected_amount: Money | null;
  counted_amount: Money | null;
  variance_amount: Money | null;
  variance_note: string | null;
  status: CashSessionStatus;
  opened_at: Timestamptz;
  closed_at: Timestamptz | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
  revision: number;
}

/** `expenses.category` — live CHECK `expenses_category_check`, read 2026-08-28. */
export const EXPENSE_CATEGORIES = [
  'ingredients',
  'rent',
  'utilities',
  'salaries',
  'transport',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/**
 * `expenses.paid_method` — live CHECK `expenses_paid_method_check`. Same four values as
 * `PAYMENT_METHODS` in `@bakeflow/api` (`mutations/finance.ts`), kept as a separate
 * constant here rather than shared: that one is a payments-domain runtime value, this one
 * a types-domain one, and the two columns' CHECKs were verified independently.
 */
export const EXPENSE_PAID_METHODS = ['cash', 'card', 'transfer', 'pos'] as const;
export type ExpensePaidMethod = (typeof EXPENSE_PAID_METHODS)[number];

export interface Expense {
  id: Uuid;
  tenant_id: Uuid;
  branch_id: Uuid;
  category: ExpenseCategory;
  amount: Money;
  description: string | null;
  paid_method: ExpensePaidMethod | null;
  cash_session_id: Uuid | null;
  incurred_at: Timestamptz;
  receipt_url: string | null;
  created_at: Timestamptz;
  updated_at: Timestamptz;
  created_by: Uuid | null;
}