/**
 * Notification writes — P9.9 Q5. Marking read and registering this device for push go through
 * RPCs (the client holds SELECT only on `notifications` and `push_tokens`).
 */

import type { Uuid } from '@bakeflow/types';

import type { BakeflowClient } from '../client';
import { run } from '../internal/read';

/** Mark the given notifications read, or all of them when `ids` is omitted. Returns how many changed. */
export async function markNotificationsRead(client: BakeflowClient, ids?: readonly Uuid[]): Promise<number> {
  const payload = await run(client.rpc('mark_notifications_read', { p_ids: ids === undefined ? null : [...ids] }));
  return typeof payload === 'number' ? payload : 0;
}

/** Register this device's Expo push token for the signed-in person in the active organization. */
export async function registerPushToken(client: BakeflowClient, token: string, platform: 'ios' | 'android'): Promise<void> {
  await run(client.rpc('register_push_token', { p_token: token, p_platform: platform }));
}

/** Stop sending pushes for this token to the signed-in person (sign-out). */
export async function unregisterPushToken(client: BakeflowClient, token: string): Promise<void> {
  await run(client.rpc('unregister_push_token', { p_token: token }));
}

/**
 * Ask the `dispatch-push` Edge Function to send any queued pushes now. Fire-and-forget: it takes no
 * input and a failure only delays delivery until the next call, so errors are swallowed.
 */
export function requestPushDispatch(client: BakeflowClient): void {
  void client.functions.invoke('dispatch-push', { body: {} }).catch(() => undefined);
}
