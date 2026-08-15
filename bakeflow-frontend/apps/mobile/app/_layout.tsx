import '../global.css';

import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';

import { AppProviders } from '../providers/AppProviders';
import { useSessionStore } from '../stores/session';

/**
 * Root layout: providers plus the single navigation gate.
 *
 * ## Why the gate lives here and not in each screen
 *
 * There are exactly three destinations and one rule set:
 *
 * | Session state | Destination |
 * |---|---|
 * | still reading persisted session | stay put — render nothing that branches on auth |
 * | signed out | `/sign-in` |
 * | signed in, no `tenant_id` claim | `/select-organization` |
 * | signed in, claim present | the app |
 *
 * Per-screen guards would duplicate that table and drift. Note the third row is driven by
 * the **token claim**, not by "has the user picked one before" — a revoked membership
 * mints a token with a null claim, and this sends that user back to the picker rather than
 * into an app where every screen is silently empty.
 */
function NavigationGate(): null {
  const status = useSessionStore((s) => s.status);
  const activeTenantId = useSessionStore((s) => s.activeTenantId);
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    // Never redirect while the persisted session is still being read: doing so bounces
    // every returning user through the sign-in screen on cold start.
    if (status === 'loading') return;

    const first = segments[0];
    const onSignIn = first === 'sign-in';
    const onPicker = first === 'select-organization';

    if (status === 'signed-out') {
      if (!onSignIn) router.replace('/sign-in');
      return;
    }
    if (activeTenantId === null) {
      if (!onPicker) router.replace('/select-organization');
      return;
    }
    // Signed in with a claim: the auth screens are no longer reachable destinations.
    if (onSignIn || onPicker) router.replace('/');
  }, [status, activeTenantId, segments, router]);

  return null;
}

export default function RootLayout(): React.JSX.Element {
  return (
    <AppProviders>
      <NavigationGate />
      <Stack screenOptions={{ headerShown: false }} />
    </AppProviders>
  );
}
