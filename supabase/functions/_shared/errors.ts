import { corsHeaders } from './cors.ts';

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Identifies one Edge Function invocation for log correlation — P6.5.
 *
 * `requestId` is generated once per invocation (`crypto.randomUUID()`, no request header
 * to trust for it) and threaded through every log line for that request, so a start line,
 * an error line and a success line for the same call can be joined in the log viewer.
 */
export interface FunctionLogContext {
  function: string;
  requestId: string;
}

/**
 * One structured, single-line JSON log entry — P6.5's "structured logs" deliverable.
 *
 * Before this, the only logging in this codebase was ad hoc `console.log`/`console.error`
 * calls with a hand-written `[function-name]` prefix and freeform text appended (see the
 * dispatch-success line this replaced in `send-invite-email/index.ts`). That is fine for a
 * human tailing logs live and useless for a log platform trying to filter or alert on
 * `level`, `function`, or `code` — there is no field to filter on, only a string to grep.
 *
 * Deliberately NDJSON (one `JSON.stringify` object per line) rather than a pretty-printed
 * object: that is the format Supabase's own log drain and every common log platform expect
 * for structured parsing, and `console.error`/`console.warn` vs `console.log` is what
 * Supabase's log viewer uses to assign a severity facet — hence the level-to-console-method
 * mapping below, not `console.log` for everything.
 */
export function logStructured(
  level: 'info' | 'warn' | 'error',
  event: string,
  context: FunctionLogContext,
  fields: Record<string, unknown> = {}
): void {
  const line = JSON.stringify({
    level,
    event,
    function: context.function,
    request_id: context.requestId,
    timestamp: new Date().toISOString(),
    ...fields,
  });

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: unknown
): Response {
  const body: ApiErrorResponse = {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  };

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

/**
 * `context` is required, not optional: an error log with no `function`/`request_id` field
 * is exactly the un-correlatable log line this change exists to stop producing. Every
 * Edge Function's top-level `catch` must generate a request id and pass it here.
 */
export function handleFunctionError(err: unknown, context: FunctionLogContext): Response {
  if (err instanceof HttpError) {
    logStructured('error', 'function_error', context, {
      status: err.status,
      code: err.code,
      message: err.message,
      details: err.details,
    });
    return errorResponse(err.status, err.code, err.message, err.details);
  }

  if (err instanceof Error) {
    logStructured('error', 'function_error', context, {
      status: 500,
      code: 'internal_error',
      message: err.message,
      stack: err.stack,
    });
    // The real message/stack goes to the structured server log above only -- an unexpected
    // (non-HttpError) exception may carry DB detail, provider responses, or paths, and the
    // client response must stay generic. See audit-findings/SECURITY-AUDIT-2026-09-02.md.
    return errorResponse(500, 'internal_error', 'An unexpected error occurred');
  }

  logStructured('error', 'function_error', context, {
    status: 500,
    code: 'internal_error',
    message: 'An unexpected error occurred',
    thrown: typeof err,
  });
  return errorResponse(500, 'internal_error', 'An unexpected error occurred');
}

export function jsonResponse<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
