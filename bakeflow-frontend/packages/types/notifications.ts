import type { Uuid } from './scalars';

/** The events that notify someone (P9.9 Q5, owner decision 2026-09-17). */
export const NOTIFICATION_KINDS = [
  'order_new',
  'order_ready',
  'payment_received',
  'stock_out',
  'invite_accepted',
  'till_variance',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** One entry in the signed-in person's notification history for the active organization. */
export interface AppNotification {
  id: Uuid;
  kind: NotificationKind;
  title: string;
  body: string | null;
  /** App route to open, e.g. `/order/<id>`; null when there is nothing to open. */
  route: string | null;
  entity_type: string | null;
  entity_id: Uuid | null;
  branch_id: Uuid | null;
  read_at: string | null;
  created_at: string;
}
