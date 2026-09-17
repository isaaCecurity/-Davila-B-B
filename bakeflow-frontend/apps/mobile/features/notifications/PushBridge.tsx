import { registerPushToken, unregisterPushToken } from '@bakeflow/api';
import { getSupabaseClient } from '@bakeflow/auth';
import { useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { useSessionStore } from '../../stores/session';

/** Only routes a notification may open — anything else from a payload is ignored. */
const SAFE_ROUTE = /^\/(order|product)\/[0-9a-f-]{36}$|^\/(staff|cash|inventory|alerts)$/;

let currentToken: string | null = null;

if (Platform.OS !== 'web') {
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
 * that organization. A tapped notification opens its screen. Renders nothing; does nothing on web.
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
    if (Platform.OS === 'web' || userId === null || tenantId === null) return;
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
    if (Platform.OS === 'web') return;
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
