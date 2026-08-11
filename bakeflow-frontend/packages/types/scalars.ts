/**
 * Branded scalar types for values that must never become a JavaScript `number`.
 *
 * ## Why these exist
 *
 * `CLAUDE.md` rule 5 and AD-010 fix money at `NUMERIC(19,4)`, physical quantities at
 * `NUMERIC(18,4)` and percentages at `NUMERIC(5,2)`, and forbid floats outright.
 * A JS `number` is an IEEE-754 double and cannot represent those exactly.
 *
 * ## Verified transport behaviour (live, 2026-08-11)
 *
 * `API-CONTRACT.md` §4 states "Money arrives as a string. PostgREST serialises NUMERIC
 * as a string". **That is not what the database does.** Executed against the live
 * database:
 *
 * ```
 * select json_agg(t) from (
 *   select 184500.0000::numeric(19,4)::text as unit_price,
 *          184500.0000::numeric(19,4)       as unit_price_raw) t;
 * -- [{"unit_price":"184500.0000","unit_price_raw":184500.0000}]
 * ```
 *
 * Read that carefully — the loss is **not** in PostgreSQL. Postgres serialises the full
 * scale into the JSON *text*; it simply emits it **unquoted**, as a JSON number. The
 * destruction happens one layer later, in `JSON.parse` inside `supabase-js`, which has no
 * choice but to turn `184500.0000` into the IEEE-754 double `184500`. The declared scale
 * is gone before any application code runs, and beyond 2^53 the digits go too — the SQL
 * suite's C7b shows `12345678901234.5678` arriving as `12345678901234.6`.
 *
 * The `::text` form is quoted, so `JSON.parse` yields a string and never touches it.
 *
 * The consequence, which the read service implements: **every money and quantity column
 * is cast with `::text` in the PostgREST `select`**, and the resulting string is carried
 * end-to-end without ever being parsed. See `packages/api/queries/catalog.ts`.
 *
 * The Supabase type generator has the same defect — it emits `unit_price: number`,
 * `yield_quantity: number`, `reorder_level: number`. That is why the catalog types in
 * this package are hand-written against the verified live columns rather than generated
 * verbatim.
 *
 * ## What a brand does and does not buy
 *
 * The brands below are nominal: a raw `string` cannot be assigned to `Money`, and `Money`
 * cannot be passed where a `number` is expected. They do **not** prevent `a + b` string
 * concatenation, because TypeScript permits `+` on strings.
 *
 * That gap is acceptable **only because the read path performs no arithmetic at all** —
 * it transports and displays. Any future arithmetic on these values requires a decimal
 * library, which is a new dependency and therefore a decision, not an implementation
 * detail. Do not reach for `parseFloat`, `Number()` or `+` to work around it.
 */

declare const MONEY_BRAND: unique symbol;
declare const QUANTITY_BRAND: unique symbol;

/**
 * A `NUMERIC(19,4)` money value in its exact decimal string form, e.g. `"184500.0000"`.
 * Never a `number`. Produced only by `packages/validation`, which validates the shape
 * before branding.
 */
export type Money = string & { readonly [MONEY_BRAND]: true };

/**
 * A `NUMERIC(18,4)` physical quantity in its exact decimal string form, e.g. `"12.5000"`.
 * Never a `number`.
 */
export type Quantity = string & { readonly [QUANTITY_BRAND]: true };

/** A `uuid` primary/foreign key. Aliased rather than branded: route params and client
 *  ids flow through as plain strings constantly, and branding buys no safety there. */
export type Uuid = string;

/** A `timestamptz` in ISO-8601 form, e.g. `"2026-08-11T09:15:00+00:00"`. */
export type Timestamptz = string;

/**
 * `NUMERIC(19,4)`: precision 19, scale 4, so at most 15 integer digits and 4 decimals.
 * Postgres `::text` always emits the full scale, but a shorter form is accepted so the
 * schema does not break if a value is produced by another path.
 */
export const MONEY_PATTERN = /^-?\d{1,15}(\.\d{1,4})?$/;

/** `NUMERIC(18,4)`: precision 18, scale 4, so at most 14 integer digits and 4 decimals. */
export const QUANTITY_PATTERN = /^-?\d{1,14}(\.\d{1,4})?$/;

/**
 * True when a decimal string represents exactly zero, without parsing it as a number.
 * `"0"`, `"0.0000"`, `"-0.00"` are all zero.
 */
export function isZeroDecimalString(value: string): boolean {
  let seenDigit = false;
  for (const char of value) {
    if (char === '-' || char === '+' || char === '.') continue;
    if (char < '0' || char > '9') return false;
    seenDigit = true;
    if (char !== '0') return false;
  }
  return seenDigit;
}

/** True when a decimal string is negative, without parsing it as a number. */
export function isNegativeDecimalString(value: string): boolean {
  return value.startsWith('-') && !isZeroDecimalString(value);
}

/**
 * Brand an already-validated decimal string as `Money`.
 *
 * **Unsafe by name and by intent.** It performs no validation. The only supported caller
 * is `packages/validation`, after its schema has checked the shape. Calling it on
 * arbitrary input defeats the entire point of the brand.
 */
export function unsafeMoney(validated: string): Money {
  return validated as Money;
}

/** Brand an already-validated decimal string as `Quantity`. See `unsafeMoney`. */
export function unsafeQuantity(validated: string): Quantity {
  return validated as Quantity;
}
