/**
 * How stock records present: movement reasons and signed quantity changes.
 *
 * Quantities stay exact decimal strings. Signs are read from the string and trailing zeros
 * trimmed as text — nothing is parsed into a float.
 */

import type { AdjustableStockReason } from '@bakeflow/api';
import type { StockMovementReason } from '@bakeflow/types';
import { isNegativeDecimalString, isZeroDecimalString } from '@bakeflow/types';
import type { BadgeTone, IconName, TileTone } from '@bakeflow/ui';

import { trimQuantity } from '../tickets/ticketDisplay';

export const REASON_LABEL: Record<StockMovementReason, string> = {
  purchase: 'Purchase',
  production_consume: 'Used in production',
  production_output: 'Baked',
  sale: 'Sold',
  waste: 'Waste',
  adjustment: 'Correction',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
  opening_balance: 'Opening balance',
};

/** The three reasons `adjust_stock` accepts, in the order the sheet offers them. */
export const ADJUST_REASONS: readonly { key: AdjustableStockReason; label: string; hint: string }[] = [
  { key: 'adjustment', label: 'Correction', hint: 'The count was wrong' },
  { key: 'waste', label: 'Waste', hint: 'Spoiled, burnt or damaged' },
  { key: 'opening_balance', label: 'Opening balance', hint: 'First count for this item' },
];

/** "+12", "−3.5", "0" — a ledger delta as text. */
export function signedDelta(delta: string): string {
  if (isZeroDecimalString(delta)) return '0';
  return isNegativeDecimalString(delta) ? `−${trimQuantity(delta.slice(1))}` : `+${trimQuantity(delta)}`;
}

export interface LevelView {
  state: 'out' | 'negative' | 'in';
  label: string | null;
  tone: BadgeTone;
  tile: TileTone;
  icon: IconName;
}

/**
 * A stock level's state, from the sign of its exact string.
 *
 * PORT-NOTE: the prototype also flags "Running low" at 9 or fewer. Product variants carry no
 * reorder level (it lives on ingredients, deactivated for MVP — AD-022), so a threshold would
 * be an invented business rule; only out-of-stock and below-zero are flagged.
 */
export function levelView(quantity: string): LevelView {
  if (isNegativeDecimalString(quantity)) {
    return { state: 'negative', label: 'Below zero', tone: 'bad', tile: 'bad', icon: 'alert' };
  }
  if (isZeroDecimalString(quantity)) {
    return { state: 'out', label: 'Out', tone: 'bad', tile: 'bad', icon: 'box' };
  }
  return { state: 'in', label: null, tone: 'neutral', tile: 'neutral', icon: 'box' };
}
