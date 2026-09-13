/**
 * Exact money preview for the counter sale — the prototype's running total and line totals.
 *
 * Prices are `NUMERIC(19,4)` strings and counts are whole units, so `price × count` and the sum of
 * lines are computed exactly in BigInt ten-thousandths (the same scale the database's
 * `ticket_items.line_total = round(quantity * unit_price, 4)` uses — exact for whole counts).
 * No float is involved, and nothing here is written anywhere: `complete_counter_sale()` prices the
 * lines from the catalogue itself, and the confirmation shows the server's total.
 */

import type { Money } from '@bakeflow/types';
import { nonNegativeMoneySchema } from '@bakeflow/validation';

import { fromUnits, toUnits } from '../driverTrip/quantity';

function asMoney(units: bigint): Money {
  const parsed = nonNegativeMoneySchema.safeParse(fromUnits(units));
  if (!parsed.success) throw new Error('Sale preview produced an invalid amount');
  return parsed.data;
}

/** `unitPrice × count`, exactly. */
export function lineTotal(unitPrice: string, count: number): Money {
  return asMoney(toUnits(unitPrice) * BigInt(Math.max(0, Math.trunc(count))));
}

/** The sum of every line, exactly. */
export function saleTotal(lines: readonly { unitPrice: string; count: number }[]): Money {
  return asMoney(lines.reduce((acc, l) => acc + toUnits(l.unitPrice) * BigInt(Math.max(0, Math.trunc(l.count))), 0n));
}
