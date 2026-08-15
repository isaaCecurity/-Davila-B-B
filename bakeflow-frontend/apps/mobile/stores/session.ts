/**
 * Session store — the app's single source of truth for "who is signed in, and as which
 * organization".
 *
 * Zustand per `docs/FRONTEND-STRUCTURE.md` §3: **client state only.** Nothing here is
 * fetched, cached or refetched — server state belongs to TanStack Query. What lives here
 * is the Supabase session object and the two derived values every screen branches on.
 *
 * ## `activeTenantId` is read from the token, never from the tap
 *
 * It is derived from `session.user.app_metadata.tenant_id` — the claim the database will
 * actually enforce — rather than from whichever organization the user selected. Between
 * `set_active_organization()` and the token refresh those two disagree, and a UI that
 * trusted the tap would key its cache and render its header for an organization the
 * database was not yet serving.
 *
 * ## Not a security boundary
 *
 * `activeTenantId` decides what to *render* and how to *key caches*. It decides nothing
 * about access: RLS reads the JWT server-side and is unaffected by anything in this file.
 * Setting it by hand would produce empty screens, not leaked data.
 */

import { activeTenantIdFromSession, type Session } from '@bakeflow/auth';
import { create } from 'zustand';

export type SessionStatus = 'loading' | 'signed-out' | 'signed-in';

interface SessionState {
  /**
   * `loading` until the persisted session has been read from SecureStore. Distinct from
   * `signed-out` on purpose: rendering the sign-in screen during that read would flash it
   * at every returning user on every cold start.
   */
  status: SessionStatus;
  session: Session | null;
  userId: string | null;
  /** The `tenant_id` claim in force, or null when no organization is active. */
  activeTenantId: string | null;
  setSession: (session: Session | null) => void;
  clear: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: 'loading',
  session: null,
  userId: null,
  activeTenantId: null,

  setSession: (session) =>
    set({
      status: session === null ? 'signed-out' : 'signed-in',
      session,
      userId: session?.user.id ?? null,
      activeTenantId: activeTenantIdFromSession(session),
    }),

  clear: () =>
    set({ status: 'signed-out', session: null, userId: null, activeTenantId: null }),
}));
