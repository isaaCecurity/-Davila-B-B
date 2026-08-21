import { getSupabaseClient } from '@bakeflow/auth';
import { useDelivery, useTicketsByIds } from '@bakeflow/hooks';
import { isDeliveryVerified } from '@bakeflow/types';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DeliveryActions } from '../../components/DeliveryActions';
import { DeliveryStatusBadge } from '../../components/DeliveryStatusBadge';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NoOrganizationState,
} from '../../components/ScreenState';
import { useSessionStore } from '../../stores/session';

/**
 * One delivery — the P9.6 detail.
 *
 * ## The proof panel reports the gate; it is not the gate
 *
 * `STATE-MACHINES.md` §1 lets a ticket move `ready → delivered` only when its
 * `fulfilment_type` is `pickup` **or** the linked delivery's own status is `delivered`, and
 * a guard trigger performs that lookup itself. `isDeliveryVerified` mirrors the condition
 * for display and nothing else. A driver's phone is the device most likely to be holding
 * stale state at the moment it matters, so this screen states what the database would say
 * rather than deciding anything.
 *
 * ## Proof is shown as recorded, never inferred
 *
 * `deliveries_delivered_needs_proof` is a standing table CHECK — read live, not assumed —
 * requiring a `proof_url` **or** a `recipient_name` on a delivered row. So exactly one of
 * the two can legitimately be absent, and the screen shows whichever exists rather than
 * implying both were captured.
 *
 * ## Controls
 *
 * `authenticated` holds `INSERT, SELECT` and no UPDATE on `deliveries` (grants read live),
 * so every transition goes through `transition_delivery()`, a SECURITY DEFINER RPC.
 * `DeliveryActions` renders the hops that are legal from the current status; the trigger
 * remains the authority on whether any of them actually is.
 */
export default function DeliveryDetailScreen(): React.JSX.Element {
  const client = getSupabaseClient();
  const router = useRouter();
  const { deliveryId } = useLocalSearchParams<{ deliveryId: string }>();
  const activeTenantId = useSessionStore((s) => s.activeTenantId);

  const id = typeof deliveryId === 'string' && deliveryId !== '' ? deliveryId : null;

  const delivery = useDelivery(client, activeTenantId, id);

  const ticketIds = useMemo(
    () => (delivery.data == null ? [] : [delivery.data.ticket_id]),
    [delivery.data],
  );
  const tickets = useTicketsByIds(client, activeTenantId, ticketIds);

  if (activeTenantId === null) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <NoOrganizationState onChoose={() => router.push('/select-organization')} />
      </SafeAreaView>
    );
  }

  if (delivery.isPending) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <LoadingState label="Loading delivery…" />
      </SafeAreaView>
    );
  }

  if (delivery.isError) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ErrorState error={delivery.error} onRetry={() => void delivery.refetch()} />
      </SafeAreaView>
    );
  }

  if (delivery.data === null) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <EmptyState
          title="Delivery not found"
          detail="It may have been removed, or it belongs to a bakery or branch you cannot see."
        />
      </SafeAreaView>
    );
  }

  const row = delivery.data;
  const ticket = tickets.data?.find((t) => t.id === row.ticket_id) ?? null;
  const verified = isDeliveryVerified(row.status);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView contentContainerClassName="p-6 gap-6">
        <View className="gap-2">
          <View className="flex-row items-start justify-between gap-3">
            <Text className="flex-1 text-2xl font-bold text-neutral-900">{row.address_line}</Text>
            <DeliveryStatusBadge status={row.status} />
          </View>
          <Text className="text-sm text-neutral-500">
            {ticket === null ? 'Ticket unavailable' : ticket.ticket_number}
          </Text>
        </View>

        <DeliveryActions delivery={row} tenantId={activeTenantId} />

        {row.status === 'failed' && row.failure_reason !== null && (
          <View className="gap-1 rounded-xl bg-amber-50 p-4">
            <Text className="text-xs font-semibold uppercase text-amber-800">Why it failed</Text>
            <Text className="text-base text-amber-900">{row.failure_reason}</Text>
            <Text className="pt-1 text-sm text-amber-800">
              A failed delivery is not finished. The goods are still out until it is returned.
            </Text>
          </View>
        )}

        <View className="gap-3 rounded-xl border border-neutral-200 p-4">
          <Field label="Contact" value={row.contact_phone ?? '—'} />
          <Field label="Driver" value={row.driver_id ?? 'Not assigned'} />
          <Field label="Scheduled" value={formatTimestamp(row.scheduled_at)} />
          <Field label="Dispatched" value={formatTimestamp(row.dispatched_at)} />
          <Field label="Delivered" value={formatTimestamp(row.delivered_at)} />
        </View>

        <View className="gap-3 rounded-xl border border-neutral-200 p-4">
          <Text className="text-lg font-semibold text-neutral-900">Proof of delivery</Text>
          {verified ? (
            <>
              <Field label="Received by" value={row.recipient_name ?? '—'} />
              <Field label="Photo or signature" value={row.proof_url ?? '—'} />
              <Text className="text-sm text-green-800">
                This delivery is verified, so its ticket may be completed.
              </Text>
            </>
          ) : (
            <Text className="text-sm text-neutral-500">
              Nothing recorded yet. A ticket cannot be completed on a delivery that is not
              delivered — the database enforces that, not this screen.
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="text-sm text-neutral-500">{label}</Text>
      <Text className="flex-1 text-right text-base font-medium text-neutral-900">{value}</Text>
    </View>
  );
}

/**
 * `null` renders as an em dash rather than a sentence.
 *
 * A null `delivered_at` on a pending delivery means "not yet"; on a returned one it means
 * "never happened". The screen cannot tell which, and the status badge above already says
 * it, so it prints the absence instead of narrating it wrongly.
 */
function formatTimestamp(value: string | null): string {
  if (value === null) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
