/**
 * Composition root: the query client, the Supabase auth listener, and the bridge between
 * them.
 *
 * ## The bridge is the important part
 *
 * Supabase refreshes tokens on its own schedule. When it does, the `tenant_id` claim can
 * change — that is exactly how `setActiveOrganization` takes effect — so the session store
 * and the query cache must both react to a token the app did not explicitly ask for.
 *
 * `onAuthStateChange` therefore does two things, and the order matters:
 *
 * 1. If the tenant claim on the new token differs from the one already in the store,
 *    **evict every organization-scoped cache entry**. Keys already contain the tenant id,
 *    so nothing could be *served* across organizations; eviction additionally guarantees
 *    the next render is a loading state rather than a flash of the old bakery.
 * 2. Then publish the new session, which re-renders every screen against the new claim.
 *
 * Doing it the other way round would let a render land between the store update and the
 * eviction, with the new tenant id keying a lookup that still had the old entries present.
 */

import { getSupabaseClient, activeTenantIdFromSession } from '@bakeflow/auth';
import { clearOrganizationScopedCache } from '@bakeflow/hooks';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useSessionStore } from '../stores/session';

/**
 * One client for the app's lifetime.
 *
 * `retry: 1` rather than the default 3: these are mobile users on Nigerian mobile data,
 * and three silent retries turn a dead connection into a ten-second spinner with no
 * explanation. One retry absorbs a transient blip; anything worse should surface as an
 * error the user can act on.
 *
 * `staleTime` is 30s so that navigating back to the catalog does not refetch on every
 * mount, without letting a price edit go unseen for long.
 */
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function AppProviders({ children }: { children: ReactNode }): React.JSX.Element {
  const [queryClient] = useState(createQueryClient);
  const setSession = useSessionStore((s) => s.setSession);

  // Held in a ref rather than read from the store inside the listener: the listener is
  // registered once, and a store value captured in its closure would be the value from
  // first render forever.
  const lastTenantId = useRef<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    let active = true;

    // Cold start: read the persisted session before rendering anything that branches on
    // it. Failure here is treated as signed-out — a corrupt or unreadable keystore entry
    // should land the user on sign-in, not on an error they cannot clear.
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        lastTenantId.current = activeTenantIdFromSession(data.session);
        setSession(data.session);
      })
      .catch(() => {
        if (!active) return;
        setSession(null);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const nextTenantId = activeTenantIdFromSession(session);
      if (nextTenantId !== lastTenantId.current) {
        clearOrganizationScopedCache(queryClient);
        lastTenantId.current = nextTenantId;
      }
      setSession(session);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [queryClient, setSession]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
