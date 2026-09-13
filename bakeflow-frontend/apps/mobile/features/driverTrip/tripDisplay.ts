/**
 * How a driver trip presents — the prototype's `TRIP_STAGE` copy, keyed to the live statuses.
 *
 * `loading` is real but never observed at rest: `verify_trip_loading()` passes through it
 * inside one call (see `mutations/driver-trips.ts`).
 */

import { BakeflowApiError } from '@bakeflow/api';
import type { DriverTripStatus } from '@bakeflow/types';
import type { BadgeTone, IconName, TileTone } from '@bakeflow/ui';

export const TRIP_STAGE: Record<DriverTripStatus, { label: string; tone: BadgeTone; tile: TileTone; icon: IconName }> = {
  created: { label: 'Waiting for loading', tone: 'pending', tile: 'warn', icon: 'box' },
  loading: { label: 'Loading stock', tone: 'pending', tile: 'warn', icon: 'box' },
  ready_to_depart: { label: 'Ready to depart', tone: 'live', tile: 'accent', icon: 'truck' },
  in_transit: { label: 'On the road', tone: 'live', tile: 'accent', icon: 'truck' },
  returning: { label: 'Returned · awaiting reconciliation', tone: 'info', tile: 'info', icon: 'refresh' },
  reconciled: { label: 'Reconciled · awaiting settlement', tone: 'info', tile: 'info', icon: 'cash' },
  completed: { label: 'Trip completed', tone: 'ok', tile: 'ok', icon: 'check' },
};

/** Server codes in plain words. Raw Postgres text is never shown (`API-CONTRACT.md` §3). */
export function describeTripError(error: Error): string {
  const code = error instanceof BakeflowApiError ? error.code : 'unexpected_error';
  switch (code) {
    case 'insufficient_role':
      return 'Your role cannot take this step on this trip.';
    case 'invalid_transition':
      return 'This trip has moved on since you opened it. Pull down to refresh.';
    case 'variance_note_required':
      return 'The cash does not match what was expected. Add a note explaining the difference.';
    case 'insufficient_stock':
      return 'There is not enough stock in the source stockroom for that load.';
    case 'invalid_request':
      return 'Something in that request was not accepted. Check the counts and try again.';
    case 'network_unavailable':
      return 'No connection. Nothing has been saved.';
    case 'session_expired':
      return 'Your session has expired. Sign in again.';
    default:
      return 'That did not work. Nothing has been changed.';
  }
}

const clock = new Intl.DateTimeFormat('en-NG', { hour: 'numeric', minute: '2-digit' });
const stamp = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** "6:45 AM" today, "12 Sep, 6:45 AM" otherwise. */
export function tripTime(iso: string | null): string | null {
  if (iso === null) return null;
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? clock.format(d) : stamp.format(d);
}
