import { corsHeaders } from './cors.ts';

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
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

export function handleFunctionError(err: unknown): Response {
  console.error('[Edge Function Error]', err);

  if (err instanceof HttpError) {
    return errorResponse(err.status, err.code, err.message, err.details);
  }

  if (err instanceof Error) {
    return errorResponse(500, 'internal_error', err.message);
  }

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
