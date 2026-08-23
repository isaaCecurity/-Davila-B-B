/**
 * Error normalization for the Supabase data layer — `API-CONTRACT.md` §3.
 *
 * §3 defines the envelope RPCs raise: a Postgres exception carrying a JSON `detail` with
 * a stable machine `code`, which the client maps to user-facing copy and never displays
 * raw. This module implements that mapping, and extends it to the PostgREST read path,
 * which §3 does not cover.
 *
 * **`code` is the only thing a screen may branch on.** Server-supplied text never becomes
 * `Error.message` — see `serverMessage` below for why that distinction is load-bearing.
 *
 * ## Behaviour of the installed client, verified against source
 *
 * `@supabase/postgrest-js` 2.110.9 (`dist/index.cjs`) determines three things this
 * module must respect, none of which are obvious from the public API:
 *
 * 1. **A `fetch` failure resolves, it does not reject.** Unless `.throwOnError()` is set
 *    — the read path never sets it — a transport failure is converted into
 *    `{ error: { message: "TypeError: Network request failed", code: "" }, status: 0 }`.
 *    So offline arrives through `normalizePostgrestError` with an **empty-string** code,
 *    not through a thrown exception. Treating `""` as "unmapped" is what previously made
 *    every tunnel and lift report as `unexpected_error`.
 * 2. **`PGRST116` from `.maybeSingle()` means *too many* rows, not zero.** `maybeSingle`
 *    post-processes client-side: 0 rows yields `data: null` with **no error at all**;
 *    only `length > 1` synthesizes `PGRST116`. The read path uses `.maybeSingle()`
 *    exclusively, so mapping it to `not_found` would report a genuine integrity
 *    violation as an empty result.
 * 3. **A non-JSON response body becomes `error.message` verbatim.** A captive portal or
 *    ISP interstitial puts an entire HTML document there.
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
  /** A server-side call volume cap was hit (P6.6). Distinct from `insufficient_role`: the
   *  caller is authorized, just over quota — the UI should suggest retrying later, not
   *  re-authenticating or escalating permissions. */
  | 'rate_limited'
  // --- read path ---
  /** A single-row read matched more than one row — a broken uniqueness invariant. */
  | 'multiple_rows_returned'
  /** JWT missing, expired, or not yet established, so the request ran as `anon`. */
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
  /** Our own description. Must never contain server-supplied text. */
  message: string;
  /** SQLSTATE (`42501`) or PostgREST code (`PGRST116`), when the failure had one. */
  sqlstate?: string | undefined;
  /** Untrusted server text, truncated. Diagnostics only — never rendered. */
  serverMessage?: string | undefined;
  details?: string | undefined;
  hint?: string | undefined;
  cause?: unknown;
}

/** Untrusted server text is capped before it is stored at all. */
const MAX_SERVER_TEXT = 300;

function truncate(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined || value.length === 0) return undefined;
  return value.length <= MAX_SERVER_TEXT ? value : `${value.slice(0, MAX_SERVER_TEXT)}…`;
}

/**
 * The single error type the data layer throws.
 *
 * Read functions **throw** rather than returning a result union, because their consumer
 * is TanStack Query (`docs/FRONTEND-STRUCTURE.md` §1), which derives `error` state from a
 * rejected promise.
 */
export class BakeflowApiError extends Error {
  readonly code: BakeflowErrorCode;
  readonly sqlstate: string | undefined;
  /**
   * Raw server text, truncated, kept **off** `message` on purpose.
   *
   * `message` is what React Native's LogBox renders, what crash reporters upload, and
   * what a careless `{String(error)}` puts on screen. postgrest-js assigns a non-JSON
   * response body straight to `error.message`, so letting it through would put a captive
   * portal's HTML — or a Postgres internal — in all three places. `API-CONTRACT.md` §3
   * requires the client never display a raw database message; this makes that structural
   * rather than a convention each call site has to remember.
   */
  readonly serverMessage: string | undefined;
  readonly details: string | undefined;
  readonly hint: string | undefined;

  constructor(options: BakeflowApiErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = 'BakeflowApiError';
    this.code = options.code;
    this.sqlstate = options.sqlstate;
    this.serverMessage = options.serverMessage;
    this.details = options.details;
    this.hint = options.hint;
  }
}

/**
 * SQLSTATE / PostgREST code → machine key.
 *
 * `42501` is deliberately absent: on the read path it needs to be disambiguated by
 * message, not by code. See `classify42501`.
 *
 * A denied **read** does not appear here at all, because RLS does not raise for `SELECT`
 * — it filters the row out and the query returns an empty set. Cross-organization
 * isolation is therefore proven by asserting row counts, never by expecting an
 * exception, which is exactly how `tests/sql/catalog_read_rls.sql` tests it.
 */
const CODE_MAP: Readonly<Record<string, BakeflowErrorCode>> = {
  // PostgREST
  PGRST116: 'multiple_rows_returned',
  PGRST301: 'session_expired',
  PGRST302: 'session_expired',
  PGRST100: 'invalid_request',
  PGRST102: 'invalid_request',
  PGRST103: 'invalid_request',
  PGRST200: 'invalid_request',
  PGRST202: 'invalid_request',
  // SQLSTATE
  '23505': 'duplicate_reference',
  '23503': 'invalid_request',
  '23514': 'invalid_request',
  '22P02': 'invalid_request',
  '42703': 'invalid_request',
  '42883': 'invalid_request',
  /** `type "…" does not exist` — a malformed `::text` cast in a projection, which is
   *  precisely the failure the money strategy has to notice rather than bury. */
  '42704': 'invalid_request',
};

const KNOWN_CODES: Readonly<Record<BakeflowErrorCode, true>> = {
  insufficient_stock: true,
  invalid_transition: true,
  session_already_open: true,
  variance_note_required: true,
  order_locked: true,
  insufficient_role: true,
  refund_required: true,
  duplicate_reference: true,
  rate_limited: true,
  multiple_rows_returned: true,
  session_expired: true,
  invalid_request: true,
  network_unavailable: true,
  response_shape_invalid: true,
  unexpected_error: true,
};

/** `Object.prototype` members are reachable through `in`, so `'constructor' in obj` and
 *  `'__proto__' in obj` are both true. Server-supplied strings index these maps, so the
 *  lookup must be own-property only or a crafted value escapes the union entirely. */
function ownLookup<T>(map: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

/**
 * Pull the `code` an RPC embedded in its `detail` payload, per `API-CONTRACT.md` §3.
 *
 * Unused by the read path today, which is why it is guarded rather than trusted: it
 * takes precedence over the SQLSTATE map, so an RPC that interpolates user text into
 * `DETAIL` could otherwise downgrade a real `42501`.
 */
function codeFromDetail(details: string | null | undefined): BakeflowErrorCode | undefined {
  if (details === null || details === undefined || details.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(details);
  } catch {
    // Not every `detail` is JSON — Postgres populates it with prose for built-in errors,
    // so a non-JSON detail is the common case, not an exceptional one. Nothing is lost:
    // the raw text is still attached as `details` below.
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const candidate = (parsed as { code?: unknown }).code;
  if (typeof candidate !== 'string') return undefined;
  return ownLookup(KNOWN_CODES, candidate) === undefined
    ? undefined
    : (candidate as BakeflowErrorCode);
}

/**
 * `42501` means two very different things, and the read path only ever sees one of them.
 *
 * Verified against the live REST endpoint: a request carrying no valid session runs as
 * `anon`, which holds **no grants at all** on the catalog tables, and PostgREST answers
 * `401 {"code":"42501","message":"permission denied for table products"}`. The GRANT
 * layer is checked before RLS, so this is what an expired or not-yet-established session
 * produces on every read.
 *
 * Reporting that as `insufficient_role` tells a user they lack permission and gives the
 * app no reason to re-authenticate — when the actual fix is to refresh the session.
 * A table-level denial is therefore a session problem; anything else keeps the §3
 * meaning.
 */
function classify42501(message: string): BakeflowErrorCode {
  return /permission denied for (table|relation|schema)/i.test(message)
    ? 'session_expired'
    : 'insufficient_role';
}

/**
 * `P0001` (raise_exception) with **no** JSON `detail`.
 *
 * `API-CONTRACT.md` §3's envelope — a machine `code` inside `DETAIL` — is honoured by the
 * trigger path (`apply_stock_movement()` embeds `insufficient_stock`), and `codeFromDetail`
 * catches those before this function is reached. But several deployed `SECURITY DEFINER`
 * functions raise with a bare message and no detail at all. `adjust_stock()` is the one
 * the inventory write path calls, verified live: it raises `authentication required`,
 * `invalid item_type: …`, `invalid stock adjustment reason`, `target quantity cannot be
 * negative`, `an increase cannot be recorded as waste`, `warehouse not found or branch
 * access denied`, and two `insufficient_role: …` variants.
 *
 * Without this, every one of those became `unexpected_error` — indistinguishable from a
 * genuine bug, and impossible for a screen to respond to. Matching on message text is
 * unattractive, but the alternative is silently losing the distinction; the durable fix is
 * for those functions to carry a `DETAIL` code, which is a database change.
 *
 * `warehouse not found or branch access denied` deliberately conflates a missing warehouse
 * with a denied one, so it is reported as an authorization failure rather than a not-found:
 * treating it as "no such row" would let a caller probe which warehouse ids exist in other
 * branches.
 */
function classifyP0001(message: string): BakeflowErrorCode {
  if (/^insufficient_role\b|insufficient_role:/i.test(message)) return 'insufficient_role';
  if (/authentication required/i.test(message)) return 'session_expired';
  if (/branch access denied|access denied/i.test(message)) return 'insufficient_role';
  if (/insufficient_stock/i.test(message)) return 'insufficient_stock';
  if (
    /invalid item_type|invalid stock adjustment reason|cannot be negative|cannot be recorded as waste|not found/i.test(
      message,
    )
  ) {
    return 'invalid_request';
  }
  return 'unexpected_error';
}

/** Transport failures arrive with an empty code and a JS error name in the message. */
const TRANSPORT_MESSAGE =
  /^(TypeError|FetchError|AbortError|Error):|network request failed|failed to fetch|load failed|timeout|abort/i;

/** Normalize a `supabase-js` `{ error }` into a `BakeflowApiError`. */
export function normalizePostgrestError(error: PostgrestErrorLike): BakeflowApiError {
  // postgrest-js initialises `code` to "" for a fetch failure and never overwrites it.
  // Treating "" as a real SQLSTATE is what made `network_unavailable` unreachable.
  const raw = error.code;
  const sqlstate = raw === null || raw === undefined || raw === '' ? undefined : raw;

  const fromDetail = codeFromDetail(error.details);
  const fromSqlstate =
    sqlstate === undefined
      ? undefined
      : sqlstate === '42501'
        ? classify42501(error.message)
        : sqlstate === 'P0001'
          ? classifyP0001(error.message)
          : ownLookup(CODE_MAP, sqlstate);

  const code: BakeflowErrorCode =
    fromDetail ??
    fromSqlstate ??
    (sqlstate === undefined && TRANSPORT_MESSAGE.test(error.message)
      ? 'network_unavailable'
      : 'unexpected_error');

  return new BakeflowApiError({
    code,
    // Deliberately domain-neutral: this normalizer serves the catalog reads, the
    // inventory reads and the inventory ledger writes. Naming one domain here put
    // "catalog request failed" on a stock-movement rejection.
    message: `request failed (${code}${sqlstate === undefined ? '' : `, ${sqlstate}`})`,
    sqlstate,
    serverMessage: truncate(error.message),
    // A transport failure's `details` is a JS stack, not something a caller can act on.
    details: sqlstate === undefined ? undefined : truncate(error.details),
    hint: truncate(error.hint),
    cause: error,
  });
}

/** The `{error: {code, message, details}}` envelope every BakeFlow Edge Function returns
 *  — `supabase/functions/_shared/errors.ts`'s `errorResponse()`. Declared structurally,
 *  same reasoning as `PostgrestErrorLike`: no runtime dependency on the Edge Function
 *  package this client never imports. */
interface EdgeFunctionErrorBody {
  error?: {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };
}

/**
 * Normalize a `supabase-js` Edge Function invocation error — `functions.invoke()`'s
 * `{ error }` — into a `BakeflowApiError`.
 *
 * `@supabase/functions-js` (verified against the installed version's source, `types.ts`/
 * `FunctionsClient.ts`) sets `FunctionsHttpError`/`FunctionsRelayError`'s `context` to the
 * raw `Response` object on a non-2xx reply, and throws `FunctionsFetchError` instead — with
 * no `Response` at all — for a transport failure. This reads that `Response`'s JSON body
 * and pulls the `code` every BakeFlow Edge Function embeds in it
 * (`send-invite-email`'s `errorResponse()` calls, for one), the same envelope §3 of
 * `API-CONTRACT.md` defines for RPCs. Before this existed, every Edge Function error —
 * `rate_limited` included — was reported as `unexpected_error`, indistinguishable from a
 * genuine bug (see TD-017).
 *
 * Only a `code` already in `KNOWN_CODES` is trusted, the same guard `codeFromDetail` uses
 * for the RPC path: an Edge Function that raises a code this client has no vocabulary for
 * yet still degrades to `unexpected_error`, exactly as every code does today, rather than
 * this function inventing an unreviewed mapping.
 */
export async function normalizeFunctionsError(error: unknown): Promise<BakeflowApiError> {
  if (error instanceof BakeflowApiError) return error;

  const name = error instanceof Error ? error.name : undefined;

  if (name === 'FunctionsFetchError') {
    return new BakeflowApiError({
      code: 'network_unavailable',
      message: 'Could not reach the server. Check your connection and try again.',
      cause: error,
    });
  }

  if (name === 'FunctionsHttpError' || name === 'FunctionsRelayError') {
    const context = (error as { context?: unknown }).context;
    // Duck-typed rather than `instanceof Response`: React Native's fetch polyfill and the
    // JS engine's own `Response` are not guaranteed to be the same constructor identity.
    if (context !== null && typeof context === 'object' && 'json' in context) {
      try {
        const body = (await (context as Response).json()) as EdgeFunctionErrorBody;
        const candidate = body.error?.code;
        const known =
          typeof candidate === 'string' ? ownLookup(KNOWN_CODES, candidate) : undefined;
        if (known !== undefined) {
          const bodyMessage = body.error?.message;
          const serverText = typeof bodyMessage === 'string' ? bodyMessage : undefined;
          return new BakeflowApiError({
            code: candidate as BakeflowErrorCode,
            // Domain-neutral and server-text-free, matching `normalizePostgrestError`
            // below: `message` must never carry server-supplied text (see the class doc
            // comment on `serverMessage`) -- the caller maps `code` to real UI copy.
            message: `request failed (${candidate})`,
            serverMessage: truncate(serverText),
            details: truncate(
              body.error?.details === undefined ? undefined : JSON.stringify(body.error.details),
            ),
            cause: error,
          });
        }
      } catch {
        // Body wasn't JSON, or reading it failed -- fall through to unexpected_error,
        // matching handleFunctionError's own unknown-shape fallback on the server side.
      }
    }
  }

  return new BakeflowApiError({
    code: 'unexpected_error',
    message: 'Something went wrong. Please try again.',
    cause: error,
  });
}

/**
 * Normalize a thrown value.
 *
 * Reachable for a programming fault inside the data layer, and for a caller that opted
 * into `.throwOnError()`. Ordinary transport failures do **not** arrive here — see the
 * module header — so a bare `TypeError` is far more likely to be a real bug than an
 * offline event, and is not classified as one without corroborating text.
 */
export function normalizeThrown(thrown: unknown): BakeflowApiError {
  if (thrown instanceof BakeflowApiError) return thrown;

  if (thrown instanceof Error) {
    const isTransport =
      thrown.name === 'AbortError' || TRANSPORT_MESSAGE.test(`${thrown.name}: ${thrown.message}`);
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
