// dispatch-push — P9.9 Q5. Sends queued notifications to phones through Expo's push service.
//
// Called by the app (fire-and-forget) after an action that can create notifications. It takes no input:
// with the service role it claims pending rows (`claim_push_batch`), sends one Expo message per device
// token, then records the outcome (`complete_push_batch`) — marking each notification sent or failed and
// revoking tokens Expo reports as no longer registered. A caller can only make queued pushes go out
// sooner; it cannot choose what is sent or to whom. JWT verification stays on (signed-in callers only).
//
// Requires on the project: nothing beyond the default SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Delivery
// to real phones additionally needs push credentials in the Expo project (FCM for Android, APNs for iOS).

import { createClient } from 'npm:@supabase/supabase-js@2.110.9';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_CHUNK = 100;

interface Claimed {
  notification_id: string;
  title: string;
  body: string | null;
  route: string | null;
  kind: string;
  tokens: string[];
  badge: number;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: { code: 'method_not_allowed' } }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: { code: 'misconfigured' } }, 500);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data, error } = await admin.rpc('claim_push_batch', { p_limit: 100 });
  if (error) {
    console.error(JSON.stringify({ fn: 'dispatch-push', event: 'claim_failed', message: error.message }));
    return json({ error: { code: 'claim_failed' } }, 500);
  }
  const batch = (Array.isArray(data) ? data : []) as Claimed[];
  if (batch.length === 0) return json({ claimed: 0, sent: 0, failed: 0 });

  // One message per (notification, token), remembering which is which.
  const messages: { notificationId: string; token: string; payload: Record<string, unknown> }[] = [];
  for (const n of batch) {
    for (const token of n.tokens ?? []) {
      messages.push({
        notificationId: n.notification_id,
        token,
        payload: {
          to: token,
          title: n.title,
          body: n.body ?? undefined,
          sound: 'default',
          badge: n.badge,
          priority: 'high',
          channelId: 'default',
          data: { route: n.route, notificationId: n.notification_id, kind: n.kind },
        },
      });
    }
  }

  const delivered = new Map<string, boolean>();
  const dead = new Map<string, Set<string>>();
  for (let i = 0; i < messages.length; i += EXPO_CHUNK) {
    const chunk = messages.slice(i, i + EXPO_CHUNK);
    let tickets: ExpoTicket[] = [];
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk.map((m) => m.payload)),
      });
      const body = await res.json();
      tickets = Array.isArray(body?.data) ? body.data : [];
    } catch (e) {
      console.error(JSON.stringify({ fn: 'dispatch-push', event: 'expo_request_failed', message: String(e) }));
    }
    chunk.forEach((m, j) => {
      const t = tickets[j];
      const ok = t?.status === 'ok';
      delivered.set(m.notificationId, (delivered.get(m.notificationId) ?? false) || ok);
      if (t?.status === 'error' && t.details?.error === 'DeviceNotRegistered') {
        const set = dead.get(m.notificationId) ?? new Set<string>();
        set.add(m.token);
        dead.set(m.notificationId, set);
      }
    });
  }

  const results = batch.map((n) => ({
    notification_id: n.notification_id,
    ok: delivered.get(n.notification_id) ?? false,
    dead_tokens: [...(dead.get(n.notification_id) ?? [])],
  }));
  const { error: completeError } = await admin.rpc('complete_push_batch', { p_results: results });
  if (completeError) {
    console.error(JSON.stringify({ fn: 'dispatch-push', event: 'complete_failed', message: completeError.message }));
    return json({ error: { code: 'complete_failed' } }, 500);
  }

  const sent = results.filter((r) => r.ok).length;
  // Counts only — never titles, bodies or tokens in logs.
  console.log(JSON.stringify({ fn: 'dispatch-push', event: 'dispatched', claimed: batch.length, sent, failed: batch.length - sent }));
  return json({ claimed: batch.length, sent, failed: batch.length - sent });
});
