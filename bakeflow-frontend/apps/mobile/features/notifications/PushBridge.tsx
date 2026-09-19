import { registerPushToken, unregisterPushToken } from '@bakeflow/api';
import { getSupabaseClient } from '@bakeflow/auth';
import { useQueryClient } from '@tanstack/react-query';
import { isRunningInExpoGo } from 'expo';
import Constants from 'expo-constants';
import type * as NotificationsType from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { useSessionStore } from '../../stores/session';

/** Only routes a notification may open — anything else from a payload is ignored. */
const SAFE_ROUTE = /^\/(order|product)\/[0-9a-f-]{36}$|^\/(staff|cash|inventory|alerts)$/;

let currentToken: string | null = null;

/**
 * `expo-notifications` throws the moment it is imported, on Android, under Expo Go — a module-level
 * side effect in its own auto-registration code (`DevicePushTokenAutoRegistration.fx.js` calls
 * `addPushTokenListener()` at load time, which calls Expo's own `warnOfExpoGoPushUsage()`, which
 * `throw`s on Android there). That crash happens at import time, before any of our code runs, so it
 * cannot be try/caught — the only fix is to never `require` the module in Expo Go at all. A plain
 * `import` is hoisted and always evaluated; `require()` behind this runtime check is not.
 */
const Notifications: typeof NotificationsType | null =
  Platform.OS === 'web' || isRunningInExpoGo()
    ? null
    : // eslint-disable-next-line @typescript-eslint/no-require-imports -- must be conditional, see comment above; a static `import` is hoisted and would always run.
      (require('expo-notifications') as typeof NotificationsType);

if (Notifications !== null) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });
}

/** Stop pushes to this device for the person signing out. Safe to call anywhere; never throws. */
export async function unregisterCurrentPushToken(): Promise<void> {
  if (currentToken === null) return;
  const token = currentToken;
  currentToken = null;
  try {
    await unregisterPushToken(getSupabaseClient(), token);
  } catch {
    // Best effort: the dispatcher also drops tokens Expo reports as unregistered.
  }
}

/**
 * P9.9 Q5 phone push. On a phone, once someone is signed in to an organization: ask permission (the
 * system asks once; a refusal is respected), get this device's Expo push token and register it for
 * that organization. A tapped notification opens its screen. Renders nothing; does nothing on web
 * or under Expo Go (the library cannot do push there at all — see the `Notifications` guard above
 * — a development build is required; in-app notifications work everywhere regardless).
 *
 * Needs push credentials in the Expo project (FCM for Android, APNs for iOS) before phones receive
 * anything; until then registration still succeeds and pushes are recorded as failed.
 */
export function PushBridge(): null {
  const router = useRouter();
  const queryClient = useQueryClient();
  const userId = useSessionStore((s) => s.userId);
  const tenantId = useSessionStore((s) => s.activeTenantId);

  useEffect(() => {
    if (Notifications === null || userId === null || tenantId === null) return;
    let cancelled = false;
    void (async () => {
      try {
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', {
            name: 'BakeFlow',
            importance: Notifications.AndroidImportance.HIGH,
          });
        }
        const existing = await Notifications.getPermissionsAsync();
        const status = existing.granted ? existing : await Notifications.requestPermissionsAsync();
        if (!status.granted || cancelled) return;
        const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
        const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
        if (cancelled) return;
        await registerPushToken(getSupabaseClient(), token, Platform.OS === 'ios' ? 'ios' : 'android');
        currentToken = token;
      } catch {
        // Simulators, missing credentials or no network: in-app notifications still work.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, tenantId]);

  useEffect(() => {
    if (Notifications === null) return;
    const received = Notifications.addNotificationReceivedListener(() => {
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey.includes('notifications') || q.queryKey.includes('notifications-unread') });
    });
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      const route = (response.notification.request.content.data as { route?: unknown } | undefined)?.route;
      router.push(typeof route === 'string' && SAFE_ROUTE.test(route) ? (route as Href) : '/alerts');
    });
    return () => {
      received.remove();
      tapped.remove();
    };
  }, [router, queryClient]);

  return null;
}
