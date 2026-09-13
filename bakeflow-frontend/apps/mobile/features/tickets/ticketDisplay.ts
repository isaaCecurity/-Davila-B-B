/**
 * How tickets present on screen — labels, tones, icons, payment state and the list filters.
 *
 * Presentation only. Which transitions are legal, and who may take them, is decided by
 * `guard_ticket_status_transition()` in the database (STATE-MACHINES.md §1); nothing here is
 * consulted to permit an action.
 */

import type { TicketFilters } from '@bakeflow/api';
import type { Ticket, TicketFulfilmentType, TicketStatus } from '@bakeflow/types';
import { compareDecimalStrings, isZeroDecimalString } from '@bakeflow/types';
import type { BadgeTone, IconName } from '@bakeflow/ui';

/*
 * PORT-NOTE: the prototype has six statuses; the live lifecycle has ten. Stages the prototype
 * merged keep its wording where the meaning matches — `submitted` reads "Pending",
 * `in_production` reads "Preparing" — and the rest get plain labels of their own.
 */
export const STATUS_META: Record<TicketStatus, { label: string; tone: BadgeTone; icon: IconName }> = {
  draft: { label: 'Draft', tone: 'neutral', icon: 'edit' },
  submitted: { label: 'Pending', tone: 'pending', icon: 'clock' },
  confirmed: { label: 'Confirmed', tone: 'info', icon: 'checkCircle' },
  scheduled: { label: 'Scheduled', tone: 'info', icon: 'calendar' },
  in_production: { label: 'Preparing', tone: 'info', icon: 'flame' },
  ready: { label: 'Ready', tone: 'live', icon: 'checkCircle' },
  delivered: { label: 'Delivered', tone: 'info', icon: 'truck' },
  completed: { label: 'Completed', tone: 'ok', icon: 'check' },
  cancelled: { label: 'Cancelled', tone: 'neutral', icon: 'close' },
  archived: { label: 'Archived', tone: 'neutral', icon: 'box' },
};

/** Verb for moving *to* a status — "Mark ready", never a bare "Submit". */
export const ADVANCE_VERB: Partial<Record<TicketStatus, string>> = {
  submitted: 'Submit order',
  confirmed: 'Confirm order',
  scheduled: 'Schedule',
  in_production: 'Start preparing',
  ready: 'Mark ready',
  delivered: 'Mark delivered',
  completed: 'Complete order',
};

export const FULFILMENT_LABEL: Record<TicketFulfilmentType, string> = {
  pickup: 'Pickup',
  delivery: 'Delivery',
};

export type PayState = 'paid' | 'partial' | 'unpaid';

export const PAY_META: Record<PayState, { label: string; tone: BadgeTone; icon: IconName }> = {
  paid: { label: 'Paid', tone: 'ok', icon: 'check' },
  partial: { label: 'Part paid', tone: 'pending', icon: 'alert' },
  unpaid: { label: 'Unpaid', tone: 'bad', icon: 'clock' },
};

/**
 * Payment position, compared on exact decimal strings — never converted to floats.
 * `null` for a ticket with nothing to pay yet (a draft with no lines).
 */
export function payStateOf(ticket: Ticket): PayState | null {
  if (isZeroDecimalString(ticket.total_amount)) return null;
  if (isZeroDecimalString(ticket.amount_paid)) return 'unpaid';
  return compareDecimalStrings(ticket.amount_paid, ticket.total_amount) >= 0 ? 'paid' : 'partial';
}

/** `2.0000` → `2`, `1.5000` → `1.5`. Display-only string trimming, no arithmetic. */
export function trimQuantity(value: string): string {
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

const timeFormat = new Intl.DateTimeFormat('en-NG', { hour: 'numeric', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short' });

/** "2:30 PM" for today, "12 Sep" otherwise. */
export function ticketTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  return d.toDateString() === now.toDateString() ? timeFormat.format(d) : dayFormat.format(d);
}

export type OrderFilterKey = 'today' | 'pending' | 'ready' | 'upcoming' | 'completed' | 'cancelled';

/**
 * PORT-NOTE: "Today" starts at the device's local midnight. Revenue reporting resolves
 * "today" in the organization's timezone server-side; for a list filter the device clock is
 * the reasonable reading of "today's orders", but a bakery operating across timezones would
 * see the boundary differ.
 */
function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export interface OrderFilter {
  key: OrderFilterKey;
  label: string;
  filters: () => TicketFilters;
  empty: [title: string, text: string];
}

export const TODAY_FILTER: OrderFilter = {
  key: 'today',
  label: 'Today',
  filters: () => ({ since: startOfToday() }),
  empty: ['No orders yet today', 'Your first order of the day will appear here.'],
};

export const ORDER_FILTERS: readonly OrderFilter[] = [
  TODAY_FILTER,
  {
    key: 'pending',
    label: 'Pending',
    // `draft` belongs here: a started-but-unsubmitted order is the most pending order there
    // is, and no other filter would ever show one older than today.
    filters: () => ({ statuses: ['draft', 'submitted', 'confirmed', 'in_production'] }),
    empty: ['Nothing pending', 'Every order has been prepared. Good shift.'],
  },
  {
    key: 'ready',
    label: 'Ready',
    filters: () => ({ statuses: ['ready', 'delivered'] }),
    empty: ['Nothing waiting for pick-up', 'Orders appear here once the kitchen marks them ready.'],
  },
  {
    key: 'upcoming',
    label: 'Upcoming',
    filters: () => ({ status: 'scheduled' }),
    empty: ['No upcoming orders', 'Orders scheduled for later days will show here.'],
  },
  {
    key: 'completed',
    label: 'Completed',
    filters: () => ({ status: 'completed' }),
    empty: ['No completed orders yet', 'Completed orders build up through the day.'],
  },
  {
    key: 'cancelled',
    label: 'Cancelled',
    filters: () => ({ status: 'cancelled' }),
    empty: ['No cancellations', 'Cancelled orders are kept here for the record.'],
  },
];
