/**
 * Notifications — P9.9 Q5. The signed-in person's own history for the active organization
 * (`notifications_select_own`: recipient and organization both match). Rows are written by
 * database triggers only; the client reads them and marks them read through an RPC.
 */

import type { AppNotification } from '@bakeflow/types';
import { appNotificationSchema } from '@bakeflow/validation';

import type { BakeflowClient } from '../client';
import { normalizePostgrestError } from '../errors';
import { parseRows, run } from '../internal/read';

/** Newest first, at most `limit` (1–200). */
export async function listMyNotifications(client: BakeflowClient, limit = 100): Promise<AppNotification[]> {
  const data = await run(
    client
      .from('notifications')
      .select('id,kind,title,body,route,entity_type,entity_id,branch_id,read_at,created_at')
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(Math.trunc(limit), 1), 200)),
  );
  return parseRows(appNotificationSchema, data, 'listMyNotifications');
}

/** How many of the signed-in person's notifications are unread (a head count, no rows). */
export async function countUnreadNotifications(client: BakeflowClient): Promise<number> {
  const { count, error } = await client.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null);
  if (error) throw normalizePostgrestError(error);
  return count ?? 0;
}
