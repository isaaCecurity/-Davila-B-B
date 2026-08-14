/**
 * Read-path primitives shared by the domain query modules.
 *
 * Extracted during P4.2 when inventory became the second consumer. These were private to
 * `queries/catalog.ts` while it was the only one; copying them would have meant two
 * response gates free to drift, and the response gate is the single place the money
 * precision strategy is actually enforced.
 *
 * **Internal to `@bakeflow/api`.** Not exported from the package barrel: callers consume
 * `listWarehouses`, `listProducts` and so on, never these.
 */

import type { z } from 'zod';

import {
  BakeflowApiError,
  normalizePostgrestError,
  normalizeThrown,
  type PostgrestErrorLike,
} from '../errors';

/* -------------------------------------------------------------------------- */
/* Column projections                                                          */
/* -------------------------------------------------------------------------- */

/** Structural shape of a Zod object — avoids importing Zod's generics for one lookup. */
export interface SchemaShape {
  readonly shape: Readonly<Record<string, unknown>>;
}

/**
 * Build a PostgREST `select` list from a schema's keys, casting the named columns to text.
 *
 * This is the single point where "which columns do we read" is decided, and it is the same
 * object that decides "which columns do we validate". Hand-maintaining the two beside each
 * other meant a dropped `::text` cast was caught only at runtime, on a user's phone, by the
 * Zod tripwire. Deriving one from the other makes it unrepresentable.
 *
 * Satisfies `API-CONTRACT.md` §4's requirement to select explicit columns, never `*`.
 *
 * @param textCastColumns every `NUMERIC` column in the target table. Passed in rather than
 *   hard-coded because each domain has its own set.
 */
export function projectionFor(
  schema: SchemaShape,
  textCastColumns: ReadonlySet<string>,
): string {
  return Object.keys(schema.shape)
    .map((column) => (textCastColumns.has(column) ? `${column}::text` : column))
    .join(',');
}

/** A table paired with the schema that both projects and validates it. */
export interface ReadEntity<T> {
  readonly table: string;
  readonly schema: z.ZodType<T>;
  readonly columns: string;
  /**
   * Whether the table carries the `deleted_at`/`deleted_by` soft-delete pair (AD-012).
   *
   * **Required, not optional, and that is the point.** `API-CONTRACT.md` §4 obliges every
   * read to filter `deleted_at IS NULL` explicitly, but `SCHEMA-REFERENCE.md` §11 is
   * equally clear that only *most* tables carry the column: ledger tables are append-only
   * and never soft-deleted, and several child tables are reached through a parent that is.
   *
   * Filtering a column that does not exist is not a harmless extra predicate — PostgREST
   * returns `42703 column ... does not exist` and the entire list fails. Omitting it where
   * the column *does* exist leaks deleted rows past a query whose contract promised
   * otherwise. Neither default is safe, so no default is offered: each entity states which
   * it is, next to the schema that says which columns it has.
   */
  readonly softDeleted: boolean;
}

/**
 * Apply the soft-delete predicate iff the entity has the column.
 *
 * Typed through the builder's own return type rather than a concrete PostgREST generic:
 * this package takes no runtime dependency on `@supabase/supabase-js` (see `../client`),
 * and `.is()` returns the same builder it was called on.
 */
export function withSoftDeleteFilter<Q extends { is(column: string, value: null): Q }>(
  query: Q,
  entity: ReadEntity<unknown>,
): Q {
  return entity.softDeleted ? query.is('deleted_at', null) : query;
}

/* -------------------------------------------------------------------------- */
/* Keyset cursors                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Separator for composite `(sortValue, id)` cursors.
 *
 * Extracted from `queries/inventory.ts` during P4.4, when sales became the second consumer
 * — the same rule that moved the response gate here in P4.2. A cursor encoder and its
 * decoder that exist in two copies are two formats waiting to drift, and the failure would
 * be a page silently starting in the wrong place rather than an error.
 *
 * A composite cursor is required wherever the sort column is not unique within a tenant.
 * `created_at` is the worst case: several rows written in one transaction share the exact
 * instant, so `created_at < :last` would drop every sibling — silently, with no error.
 * `customers.full_name` has the same shape for a duller reason (two customers may share a
 * name). The `id` tiebreak makes the sort key total, which is what keyset paging requires.
 *
 * `NUL` is the separator because Postgres rejects it in `text` outright, so it can never
 * occur inside either component and split the cursor in the wrong place.
 */
const CURSOR_SEPARATOR = '\u0000';

export function encodeCursor(sortValue: string, id: string): string {
  return `${sortValue}${CURSOR_SEPARATOR}${id}`;
}

export function decodeCursor(
  cursor: string,
  context: string,
): { sortValue: string; id: string } {
  const parts = cursor.split(CURSOR_SEPARATOR);
  const sortValue = parts[0];
  const id = parts[1];
  if (parts.length !== 2 || sortValue === undefined || id === undefined || id === '') {
    throw new BakeflowApiError({
      code: 'invalid_request',
      message:
        `${context}: malformed cursor. Pass the previous page's nextCursor unmodified; ` +
        'cursors are opaque and must not be constructed by hand.',
    });
  }
  return { sortValue, id };
}

/**
 * A PostgREST `or=` value containing a quoted literal.
 *
 * Values are wrapped in double quotes so reserved characters inside them — the `+` and `:`
 * of a `timestamptz`, a `,` in a customer's name — are read as data rather than as
 * PostgREST syntax. An embedded double quote is escaped by doubling, per PostgREST's rules.
 */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/* -------------------------------------------------------------------------- */
/* Paging                                                                      */
/* -------------------------------------------------------------------------- */

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** Keyset paging options common to every paged list. */
export interface PageOptions {
  /** Rows per page. Must not exceed `MAX_PAGE_SIZE` — see `resolveLimit`. */
  limit?: number;
  /**
   * Exclusive cursor. Pass the previous page's `nextCursor`; never construct one by hand,
   * because the column(s) it encodes differ per list.
   */
  after?: string;
}

/**
 * One page, with the cursor for the next.
 *
 * `nextCursor` is `null` when the end has been reached, determined by fetching one row
 * beyond `limit` rather than by comparing `rows.length` to the requested limit. That
 * distinction matters: an earlier version clamped an over-large `limit` silently, so a
 * caller asking for 500 got 200 back, concluded `200 < 500` meant "last page", and
 * stopped — dropping the rest of the list with no error anywhere.
 */
export interface Page<T> {
  rows: T[];
  nextCursor: string | null;
}

export function resolveLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    // Rejected rather than clamped: silently returning fewer rows than asked for is
    // indistinguishable from reaching the end of the list.
    throw new BakeflowApiError({
      code: 'invalid_request',
      message: `limit must be an integer between 1 and ${MAX_PAGE_SIZE}, received ${String(limit)}`,
    });
  }
  return limit;
}

/* -------------------------------------------------------------------------- */
/* Response gate                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Narrow an untrusted PostgREST payload to a typed array.
 *
 * `BakeflowClient` is intentionally not parameterised with the generated `Database` type
 * (see `../client`), so this is the one place the boundary is crossed — and it is crossed
 * by a checked parse rather than an assertion.
 *
 * Note `Array.isArray` narrows an `unknown` to `any[]`, not `unknown[]`, so the result is
 * rebound to `unknown[]` immediately; otherwise every element access below would silently
 * be `any` and the guarantee this function exists to provide would be hollow.
 */
export function parseRows<T>(schema: z.ZodType<T>, payload: unknown, context: string): T[] {
  if (!Array.isArray(payload)) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: `${context}: expected an array of rows, received ${typeof payload}`,
    });
  }
  const items: unknown[] = payload;

  const rows: T[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const result = schema.safeParse(items[index]);
    if (!result.success) {
      throw new BakeflowApiError({
        code: 'response_shape_invalid',
        message: `${context}: row ${index} did not match its schema`,
        details: describeIssues(result.error),
        cause: result.error,
      });
    }
    rows.push(result.data);
  }
  return rows;
}

/** Narrow a single-row payload. An absent row is `null`, not an error. */
export function parseRow<T>(
  schema: z.ZodType<T>,
  payload: unknown,
  context: string,
): T | null {
  if (payload === null || payload === undefined) return null;
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new BakeflowApiError({
      code: 'response_shape_invalid',
      message: `${context}: row did not match its schema`,
      details: describeIssues(result.error),
      cause: result.error,
    });
  }
  return result.data;
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
}

/** Shape of what `supabase-js` resolves to. Declared structurally — this package has no
 *  runtime dependency on `@supabase/supabase-js`. */
export interface PostgrestResultLike {
  data: unknown;
  /** `undefined` is accepted alongside `null` so the `== null` guard below is honest
   *  about what it handles rather than narrowing a case it would then crash on. */
  error?: PostgrestErrorLike | null | undefined;
}

/**
 * Run a query, normalizing every failure mode.
 *
 * Note that a `fetch` failure does **not** reject here: postgrest-js 2.110.9 converts it
 * into `{ error: { code: "" } }` and resolves. Offline therefore flows through
 * `normalizePostgrestError`, which is where it is classified. The `catch` remains for
 * programming faults and for callers that opt into `.throwOnError()`.
 */
export async function run(query: PromiseLike<PostgrestResultLike>): Promise<unknown> {
  let result: PostgrestResultLike;
  try {
    result = await query;
  } catch (thrown) {
    throw normalizeThrown(thrown);
  }
  if (result.error != null) throw normalizePostgrestError(result.error);
  return result.data;
}
