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