/**
 * JWT claim reading — deliberately free of any React Native import.
 *
 * Split out of `index.ts` so it can be exercised by `scripts/verify-cache-isolation.mts`
 * under plain Node. `index.ts` pulls in `expo-secure-store`, which pulls in `react-native`,
 * whose Flow-typed entry point esbuild cannot transform — so anything importable by a test
 * has to live where the native surface does not reach. The claim logic has no native
 * dependency, and it is the piece that was wrong in P8.1, so it is exactly the piece that
 * belongs on the testable side of that line.
 *
 * ## These values are not authorization
 *
 * Nothing here verifies a signature, and nothing here needs to. The results choose a cache
 * key and a route. The database re-derives the same claims server-side for every RLS
 * policy, so a forged token changes which empty screen a user sees and nothing else.
 */

/** The parts of a Supabase session this module reads. Structural, so tests need no mock. */
export interface SessionLike {
  access_token: string;
  user: { id: string; app_metadata?: Record<string, unknown> | undefined };
}

/**
 * Decode a JWT payload without verifying it.
 *
 * `atob` rather than `Buffer` (absent in React Native) or a JWT library (a dependency for
 * twenty lines). Hermes has shipped `atob`/`btoa` since RN 0.74; this app is on 0.86.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    if (payload === undefined) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const parsed: unknown = JSON.parse(atob(padded));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * The `tenant_id` claim on the current access token, or `null` when none is set.
 *
 * ## This reads the token payload, and the first implementation did not — it was wrong
 *
 * P8.1 originally read `session.user.app_metadata.tenant_id`. The live
 * `custom_access_token_hook` does **not** put it there:
 *
 * ```sql
 * claims := jsonb_set(claims, '{tenant_id}', coalesce(to_jsonb(v_active), 'null'), true);
 * claims := jsonb_set(claims, '{roles}',     coalesce(to_jsonb(v_roles),  '[]'),   true);
 * ```
 *
 * Both are **top-level claims**, siblings of `sub` and `exp`. So the old accessor returned
 * `null` for every signed-in user — the app redirected to the organization picker forever
 * and every catalog query stayed disabled. Typecheck, lint and the cache-isolation checks
 * all passed regardless, because none of them touches a real token. That is why
 * `verify-cache-isolation.mts` now builds one.
 *
 * `app_metadata` remains a fallback: one property read, and it keeps the app working if the
 * hook is ever changed to mirror the claim there.
 */
export function activeTenantIdFromSession(session: SessionLike | null): string | null {
  if (session === null) return null;

  const fromClaims = decodeJwtPayload(session.access_token)?.['tenant_id'];
  if (typeof fromClaims === 'string' && fromClaims !== '') return fromClaims;

  const fromMetadata = session.user.app_metadata?.['tenant_id'];
  return typeof fromMetadata === 'string' && fromMetadata !== '' ? fromMetadata : null;
}

/**
 * The `roles` claim — role keys for the **active** organization only.
 *
 * Advisory. AD-016 records that role-based RLS is the authority and that `has_permission()`
 * gates zero live policies. Use it to label a screen or hide a control that would fail
 * anyway; never to decide that an action is permitted.
 */
export function rolesFromSession(session: SessionLike | null): string[] {
  if (session === null) return [];
  const raw = decodeJwtPayload(session.access_token)?.['roles'];
  return Array.isArray(raw) ? raw.filter((r): r is string => typeof r === 'string') : [];
}
