import '../global.css';

import { Stack, useGlobalSearchParams, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';

import { AppProviders } from '../providers/AppProviders';
import { usePendingInviteStore } from '../stores/auth/pendingInvite.store';
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
 * An invite link (`/invite?token=…`) is the one exception: a signed-in user stays on it with or
 * without a claim, since accepting is how someone with no organization gets one. Opened while
 * signed out, the token is held in memory through sign-in and the user is brought back to it.
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
  const params = useGlobalSearchParams<{ token?: string }>();
  const pendingInvite = usePendingInviteStore((s) => s.token);
  const holdInvite = usePendingInviteStore((s) => s.hold);

  useEffect(() => {
    // Never redirect while the persisted session is still being read: doing so bounces
    // every returning user through the sign-in screen on cold start.
    if (status === 'loading') return;

    const first = segments[0];
    const onSignIn = first === 'sign-in';
    const onPicker = first === 'select-organization';
    const onInvite = first === 'invite';

    if (status === 'signed-out') {
      if (onInvite && typeof params.token === 'string' && params.token !== '') holdInvite(params.token);
      if (!onSignIn) router.replace('/sign-in');
      return;
    }
    if (onInvite) return;
    if (pendingInvite !== null) {
      router.replace({ pathname: '/invite', params: { token: pendingInvite } });
      return;
    }
    if (activeTenantId === null) {
      if (!onPicker) router.replace('/select-organization');
      return;
    }
    // Signed in with a claim: sign-in is no longer a destination. The picker stays reachable —
    // it is also the bakery switcher — and returns home itself once a choice is made.
    if (onSignIn) router.replace('/');
  }, [status, activeTenantId, segments, router, params.token, pendingInvite, holdInvite]);

  return null;
}

/*
 * Push/pop: the prototype slides the incoming screen in from the right while the outgoing one
 * drifts 22% left and dims (360ms on its navigation curve). `ios_from_right` is that motion on
 * Android; on iOS it resolves to the system push, which is the same parallax slide.
 *
 * PORT-NOTE: native-stack does not accept a custom easing curve, and on iOS the push duration
 * is system-controlled (~350ms against the prototype's 360ms). Keeping the native transition
 * preserves the interactive edge-swipe back gesture, which a JS re-implementation would lose.
 */
export default function RootLayout(): React.JSX.Element {
  return (
    <AppProviders>
      <NavigationGate />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'ios_from_right',
          contentStyle: { backgroundColor: 'transparent' },
        }}
      />
    </AppProviders>
  );
}
