/**
 * Error normalization for the Supabase data layer — `API-CONTRACT.md` §3.
 *
 * §3 defines the envelope RPCs raise: a Postgres exception carrying a JSON `detail` with
 * a stable machine `code`, which the client maps to user-facing copy and never displays
 * raw. This module implements that mapping, and extends it to the PostgREST read path,
 * which §3 does not cover explicitly.
 *
 * **The client never displays a raw Postgres message.** `code` is the only thing a screen
 * should branch on; `message` is for logs.
 */

/**
 * Stable machine keys. The first block is `API-CONTRACT.md` §3 verbatim; the second is
 * the read path, which needs codes §3 does not define.
 */
export type BakeflowErrorCode =
  // --- API-CONTRACT.md §3 ---
  | 'insufficient_stock'
  | 'invalid_transition'
  | 'session_already_open'
  | 'variance_note_required'
  | 'order_locked'
  | 'insufficient_role'
  | 'refund_required'
  | 'duplicate_reference'
  // --- read path ---
  /** `.single()` matched no row, or the row is invisible under RLS. */
  | 'not_found'
  /** JWT missing, expired, or carrying no `tenant_id`. */
  | 'session_expired'
  /** Malformed request — a bad filter, an unknown column, an invalid cast. */
  | 'invalid_request'
  /** Transport failure: offline, DNS, TLS, timeout. */
  | 'network_unavailable'
  /**
   * A response did not match its schema. Most often a money column returned as a JSON
   * number because its `::text` cast was dropped — see `packages/types/scalars.ts`.
   */
  | 'response_shape_invalid'
  /** Anything unmapped. Never swallow one of these. */
  | 'unexpected_error';

/** The shape `supabase-js` returns in `{ error }`. Declared structurally so this
 *  package needs no runtime dependency on `@supabase/supabase-js`. */
export interface PostgrestErrorLike {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
}

export interface BakeflowApiErrorOptions {
  code: BakeflowErrorCode;
  message: string;
  /** SQLSTATE (`42501`) or PostgREST code (`PGRST116`), when the failure had one. */
  sqlstate?: string | undefined;
  details?: string | undefined;
  hint?: string | undefined;
  cause?: unknown;
}

/**
 * The single error type the data layer throws.
 *
 * Read functions **throw** rather than returning a result union, because their consumer
 * is TanStack Query (`docs/FRONTEND-STRUCTURE.md` §1), which derives `error` state from a
 * rejected promise. A result union would have to be unwrapped and re-thrown in every
 * hook.
 */
export class BakeflowApiError extends Error {
  readonly code: BakeflowErrorCode;
  readonly sqlstate: string | undefined;
  readonly details: string | undefined;
  readonly hint: string | undefined;

  constructor(options: BakeflowApiErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'BakeflowApiError';
    this.code = options.code;
    this.sqlstate = options.sqlstate;
    this.details = options.details;
    this.hint = options.hint;
  }
}

/**
 * SQLSTATE / PostgREST code → machine key.
 *
 * `42501` (`insufficient_privilege`) is what a policy violation raises on a **write**.
 * A denied **read** does not error at all — RLS filters the row out and the query
 * returns an empty set. That asymmetry is deliberate in Postgres and is proven by the
 * `catalog_read_rls.sql` suite; it is why cross-organization isolation must be tested by
 * asserting *row counts*, never by expecting an exception.
 */
const CODE_MAP: Readonly<Record<string, BakeflowErrorCode>> = {
  // PostgREST
  PGRST116: 'not_found',
  PGRST301: 'session_expired',
  PGRST302: 'session_expired',
  PGRST100: 'invalid_request',
  PGRST102: 'invalid_request',
  PGRST103: 'invalid_request',
  PGRST200: 'invalid_request',
  PGRST202: 'invalid_request',
  // SQLSTATE
  '42501': 'insufficient_role',
  '23505': 'duplicate_reference',
  '23503': 'invalid_request',
  '23514': 'invalid_request',
  '22P02': 'invalid_request',
  '42703': 'invalid_request',
  '42883': 'invalid_request',
};

/**
 * Pull the `code` an RPC embedded in its `detail` payload, per `API-CONTRACT.md` §3.
 *
 * Unused by the read path today, which is exactly why it lives here: the write path and
 * the RPC path both need it, and duplicating the envelope contract per call site is how
 * error handling drifts.
 */
function codeFromDetail(details: string | null | undefined): BakeflowErrorCode | undefined {
  if (details === null || details === undefined || details.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(details);
  } catch {
    // Not every `detail` is JSON — Postgres populates it with prose for built-in
    // errors. A non-JSON detail is normal, not exceptional, so fall through to the
    // SQLSTATE mapping rather than reporting a parse failure the caller cannot act on.
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const candidate = (parsed as { code?: unknown }).code;
  return typeof candidate === 'string' && candidate in KNOWN_CODES
    ? (candidate as BakeflowErrorCode)
    : undefined;
}

const KNOWN_CODES: Readonly<Record<BakeflowErrorCode, true>> = {
  insufficient_stock: true,
  invalid_transition: true,
  session_already_open: true,
  variance_note_required: true,
  order_locked: true,
  insufficient_role: true,
  refund_required: true,
  duplicate_reference: true,
  not_found: true,
  session_expired: true,
  invalid_request: true,
  network_unavailable: true,
  response_shape_invalid: true,
  unexpected_error: true,
};

/** Normalize a `supabase-js` `{ error }` into a `BakeflowApiError`. */
export function normalizePostgrestError(error: PostgrestErrorLike): BakeflowApiError {
  const sqlstate = error.code ?? undefined;
  const code =
    codeFromDetail(error.details) ??
    (sqlstate !== undefined ? CODE_MAP[sqlstate] : undefined) ??
    'unexpected_error';

  return new BakeflowApiError({
    code,
    message: error.message,
    sqlstate,
    details: error.details ?? undefined,
    hint: error.hint ?? undefined,
    cause: error,
  });
}

/**
 * Normalize a thrown value from a transport-level failure.
 *
 * `supabase-js` rejects rather than returning `{ error }` when `fetch` itself fails, so
 * offline is a throw, not an error envelope. Mobile clients are offline constantly
 * (`API-CONTRACT.md` §6), so this is a routine path.
 */
export function normalizeThrown(thrown: unknown): BakeflowApiError {
  if (thrown instanceof BakeflowApiError) return thrown;

  if (thrown instanceof Error) {
    const isTransport =
      thrown.name === 'TypeError' ||
      thrown.name === 'AbortError' ||
      /network|fetch|timeout|connection/i.test(thrown.message);
    return new BakeflowApiError({
      code: isTransport ? 'network_unavailable' : 'unexpected_error',
      message: thrown.message,
      cause: thrown,
    });
  }

  return new BakeflowApiError({
    code: 'unexpected_error',
    message: typeof thrown === 'string' ? thrown : 'Unknown error',
    cause: thrown,
  });
}
