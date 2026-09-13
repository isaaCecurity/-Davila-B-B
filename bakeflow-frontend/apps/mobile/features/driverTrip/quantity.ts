/**
 * Exact arithmetic on physical quantities — `NUMERIC(18,4)` carried as decimal strings.
 *
 * Quantities are never parsed into floats (`@bakeflow/types` `scalars.ts`). A trip needs a
 * little arithmetic on them — a count stepper, and loaded/sold/returned per product — so each
 * value is scaled to an integer number of ten-thousandths in a `BigInt`, added exactly, and
 * written back as a string. Money never passes through here.
 */

const SCALE = 4;
const FACTOR = 10n ** BigInt(SCALE);
const PATTERN = /^(-)?(\d+)(?:\.(\d{1,4}))?$/;

/** "12.5" → 125000n. Throws on anything that is not an exact decimal of scale ≤ 4. */
export function toUnits(quantity: string): bigint {
  const m = PATTERN.exec(quantity.trim());
  if (m === null) throw new Error(`Not an exact quantity: ${quantity}`);
  const whole = BigInt(m[2] ?? '0');
  const frac = BigInt((m[3] ?? '').padEnd(SCALE, '0'));
  const units = whole * FACTOR + frac;
  return m[1] === '-' ? -units : units;
}

/** 125000n → "12.5"; trailing zeros trimmed, "0" for zero. */
export function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / FACTOR;
  const frac = (abs % FACTOR).toString().padStart(SCALE, '0').replace(/0+$/, '');
  const text = frac === '' ? whole.toString() : `${whole.toString()}.${frac}`;
  return negative && abs !== 0n ? `-${text}` : text;
}

/** Exact sum of quantity strings. */
export function sumQuantities(values: readonly string[]): string {
  return fromUnits(values.reduce((acc, v) => acc + toUnits(v), 0n));
}

/** `quantity + step` in whole units, never below zero; an unparseable value counts as zero. */
export function stepQuantity(quantity: string, step: number): string {
  let base = 0n;
  try {
    base = toUnits(quantity === '' ? '0' : quantity);
  } catch {
    // A half-typed value ("1.") steps from zero rather than throwing out of a tap.
  }
  const next = base + BigInt(step) * FACTOR;
  return fromUnits(next < 0n ? 0n : next);
}

/** True for a valid, strictly positive quantity string. */
export function isPositiveQuantity(quantity: string): boolean {
  try {
    return toUnits(quantity) > 0n;
  } catch {
    return false;
  }
}
