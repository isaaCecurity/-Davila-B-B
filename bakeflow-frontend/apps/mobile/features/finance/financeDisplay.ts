/**
 * How finance records present: expense categories, payment methods, and cash-session variance.
 *
 * Presentation only, and no arithmetic on money: every amount comes from the database as an
 * exact decimal string and is formatted, never computed.
 */

import type { ExpenseCategory, ExpensePaidMethod, Money } from '@bakeflow/types';
import { isZeroDecimalString } from '@bakeflow/types';
import type { BadgeTone, IconName, TileTone } from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';

export const CATEGORY_META: Record<ExpenseCategory, { label: string; icon: IconName }> = {
  ingredients: { label: 'Ingredients', icon: 'bread' },
  rent: { label: 'Rent', icon: 'store' },
  utilities: { label: 'Utilities', icon: 'bolt' },
  salaries: { label: 'Salaries', icon: 'users' },
  transport: { label: 'Transport', icon: 'truck' },
  other: { label: 'Other', icon: 'receipt' },
};

export const METHOD_LABEL: Record<ExpensePaidMethod, string> = {
  cash: 'Cash',
  transfer: 'Transfer',
  pos: 'POS',
  card: 'Card',
};

export interface VarianceView {
  label: string;
  /** Always shown as a positive amount; the label carries the direction. */
  amount: string;
  tone: BadgeTone;
  tile: TileTone;
}

/**
 * A closed session's variance, described in words.
 *
 * PORT-NOTE: the prototype grades a gap as a warning under ₦5,000 and a failure above, and
 * states it as a percentage of the drawer. The threshold is an invented business rule and the
 * percentage is money arithmetic, so neither is ported: any non-zero variance is flagged, and
 * the direction is read from the sign of the server's exact figure.
 */
export function varianceView(variance: Money | null): VarianceView | null {
  if (variance === null) return null;
  if (isZeroDecimalString(variance)) {
    return { label: 'Balanced', amount: formatNaira(variance), tone: 'ok', tile: 'ok' };
  }
  const short = variance.startsWith('-');
  // Dropping the sign is string handling, not arithmetic; the magnitude is untouched.
  const magnitude = (short ? variance.slice(1) : variance) as Money;
  return short
    ? { label: 'Short by', amount: formatNaira(magnitude), tone: 'bad', tile: 'bad' }
    : { label: 'Over by', amount: formatNaira(magnitude), tone: 'pending', tile: 'warn' };
}

const stamp = new Intl.DateTimeFormat('en-NG', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

/** "12 Sep, 6:45 AM". */
export function when(iso: string): string {
  return stamp.format(new Date(iso));
}
