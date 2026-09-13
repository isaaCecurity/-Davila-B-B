/**
 * How deliveries present, and which next steps a screen offers.
 *
 * `NEXT_ACTIONS` transcribes `guard_delivery_transition()` (read live, see
 * `packages/api/mutations/delivery.ts`). It decides what to *offer*, never what is allowed —
 * the trigger re-checks every hop and a stale screen gets `invalid_transition` back.
 */

import { BakeflowApiError } from '@bakeflow/api';
import type { DeliveryStatus } from '@bakeflow/types';
import type { BadgeTone, IconName, TileTone } from '@bakeflow/ui';

/**
 * `failed` is a warning, not an error: it is not an end state. Its exit is `returned`, and
 * until then the goods are out of the branch — the row someone still has to chase.
 */
export const DELIVERY_META: Record<DeliveryStatus, { label: string; tone: BadgeTone; tile: TileTone; icon: IconName }> = {
  pending: { label: 'Unassigned', tone: 'pending', tile: 'warn', icon: 'clock' },
  assigned: { label: 'Assigned', tone: 'info', tile: 'info', icon: 'user' },
  in_transit: { label: 'On the road', tone: 'live', tile: 'accent', icon: 'truck' },
  delivered: { label: 'Delivered', tone: 'ok', tile: 'ok', icon: 'checkCircle' },
  failed: { label: 'Problem', tone: 'pending', tile: 'warn', icon: 'alert' },
  returned: { label: 'Returned', tone: 'neutral', tile: 'neutral', icon: 'arrowLeft' },
};

export type DeliveryAction =
  | { to: 'assigned'; label: string }
  | { to: 'in_transit'; label: string }
  | { to: 'delivered'; label: string }
  | { to: 'failed'; label: string }
  | { to: 'returned'; label: string };

export const NEXT_ACTIONS: Readonly<Record<DeliveryStatus, readonly DeliveryAction[]>> = {
  pending: [{ to: 'assigned', label: 'Assign a driver' }],
  assigned: [{ to: 'in_transit', label: 'Start delivery' }],
  in_transit: [
    { to: 'delivered', label: 'Mark delivered' },
    { to: 'failed', label: 'Could not deliver' },
    { to: 'returned', label: 'Return to bakery' },
  ],
  delivered: [],
  failed: [{ to: 'returned', label: 'Return to bakery' }],
  returned: [],
};

/** The prototype's driver-detail groups, in reading order. */
export const DRIVER_GROUPS: readonly { status: DeliveryStatus; label: string }[] = [
  { status: 'in_transit', label: 'Active' },
  { status: 'assigned', label: 'Pending' },
  { status: 'failed', label: 'Problems' },
  { status: 'delivered', label: 'Completed' },
  { status: 'returned', label: 'Returned' },
];

/** Server codes in the words of the person holding the phone. Raw Postgres text is never shown. */
export function describeDeliveryError(error: Error): string {
  const code = error instanceof BakeflowApiError ? error.code : 'unexpected_error';
  switch (code) {
    case 'invalid_transition':
      return 'That is no longer possible — this delivery has moved on, or its order is not ready yet. Pull to refresh.';
    case 'insufficient_role':
      return 'Only the assigned driver or a manager can do this.';
    case 'session_expired':
      return 'Your session has expired. Sign in again.';
    case 'network_unavailable':
      return 'No connection. Nothing has been saved.';
    case 'invalid_request':
      return 'Something in that request was not accepted. Check the details and try again.';
    default:
      return 'That did not work. Nothing has been changed.';
  }
}

const stamp = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** "12 Sep, 6:45 AM", or null. */
export function deliveryWhen(iso: string | null): string | null {
  return iso === null ? null : stamp.format(new Date(iso));
}
