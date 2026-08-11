/**
 * Display formatting for exact decimal values.
 *
 * ## Why this exists at all
 *
 * `Money` is an exact decimal **string** (`"184500.0000"`) precisely so it never becomes
 * an IEEE-754 double — see `@bakeflow/types` `scalars.ts`. That guarantee holds all the
 * way from PostgreSQL to the component boundary, and then has exactly one place left to
 * die: the render call.
 *
 * Without a formatter, the first screen written against this data does one of two things,
 * and both are wrong:
 *
 * ```ts
 * `₦${variant.unit_price}`              // "₦184500.0000" — shipped to a bakery owner
 * `₦${Number(variant.unit_price).toFixed(2)}`  // undoes the whole strategy at the last inch
 * ```
 *
 * So the formatter has to exist *before* the first screen does. Everything below operates
 * on the digit characters only: no `Number()`, no `parseFloat`, no arithmetic. A value
 * larger than `Number.MAX_SAFE_INTEGER` formats exactly as well as a small one.
 *
 * `Intl.NumberFormat` is not used because it takes a `number` argument — feeding it a
 * `Money` would require the very conversion this module exists to avoid.
 *
 * ## Rounding
 *
 * `truncate` is the default and the only mode implemented. AD-010 permits rounding "only
 * at final display or settlement", and display truncation here is presentational only —
 * it never feeds a stored value. **Half-up rounding is deliberately not offered**: the
 * rounding rule for settlement is unspecified and is BLOCKER-003 territory, so providing
 * a rounding helper would invite it to be used for money that gets written back.
 */

import type { Money, Quantity } from '@bakeflow/types';

export interface FormatDecimalOptions {
  /** Fraction digits to display. Money defaults to 2; quantities to 4 (full scale). */
  fractionDigits?: number;
  /** Thousands separator. Pass `''` to disable. */
  groupSeparator?: string;
  /** Decimal separator. */
  decimalSeparator?: string;
  /** Prefix, e.g. `'₦'`. */
  prefix?: string;
}

interface Parts {
  negative: boolean;
  integer: string;
  fraction: string;
}

/** Split an exact decimal string into sign / integer / fraction without parsing it. */
function split(value: string): Parts {
  const negative = value.startsWith('-');
  const unsigned = negative || value.startsWith('+') ? value.slice(1) : value;
  const dot = unsigned.indexOf('.');
  const integer = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fraction = dot === -1 ? '' : unsigned.slice(dot + 1);
  return { negative, integer: integer === '' ? '0' : integer, fraction };
}

function group(integer: string, separator: string): string {
  if (separator === '') return integer;
  let out = '';
  for (let i = 0; i < integer.length; i += 1) {
    if (i > 0 && (integer.length - i) % 3 === 0) out += separator;
    out += integer[i];
  }
  return out;
}

/**
 * Format an exact decimal string for display.
 *
 * Truncates rather than rounds, and pads with zeros when the stored scale is shorter than
 * requested. `"-0.0000"` formats as `"0.00"`, not `"-0.00"` — a displayed minus sign on
 * zero reads as an error to a bakery owner.
 */
export function formatDecimalString(
  value: string,
  options: FormatDecimalOptions = {},
): string {
  const {
    fractionDigits = 2,
    groupSeparator = ',',
    decimalSeparator = '.',
    prefix = '',
  } = options;

  const { negative, integer, fraction } = split(value);
  const shown = fraction.slice(0, fractionDigits).padEnd(fractionDigits, '0');

  const isZero =
    integer.split('').every((c) => c === '0') && fraction.split('').every((c) => c === '0');

  const sign = negative && !isZero ? '-' : '';
  const body = group(integer, groupSeparator);
  const tail = fractionDigits > 0 ? `${decimalSeparator}${shown}` : '';

  return `${sign}${prefix}${body}${tail}`;
}

/**
 * Format money for display. Defaults to 2 fraction digits.
 *
 * The stored value keeps all four decimals; only the display is shortened. Pass
 * `fractionDigits: 4` where the exact stored value matters, such as an audit view.
 */
export function formatMoney(value: Money, options: FormatDecimalOptions = {}): string {
  return formatDecimalString(value, options);
}

/** Naira-prefixed money, the default presentation for the Nigerian market. */
export function formatNaira(value: Money, options: FormatDecimalOptions = {}): string {
  return formatDecimalString(value, { prefix: '₦', ...options });
}

/**
 * Format a physical quantity. Defaults to the full stored scale of 4, because a baker
 * measuring `0.0005 kg` needs to see it — unlike money, trailing precision is meaningful.
 */
export function formatQuantity(
  value: Quantity,
  options: FormatDecimalOptions = {},
): string {
  return formatDecimalString(value, { fractionDigits: 4, groupSeparator: '', ...options });
}
