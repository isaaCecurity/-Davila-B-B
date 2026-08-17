import { getSupabaseClient } from '@bakeflow/auth';
import { useDeliveries, useTicketsByIds } from '@bakeflow/hooks';
import { DELIVERY_STATUSES, type Delivery, type DeliveryStatus } from '@bakeflow/types';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  DeliveryStatusBadge,
  deliveryStatusLabel,
} from '../../components/DeliveryStatusBadge';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NoOrganizationState,
} from '../../components/ScreenState';
import { useSessionStore } from '../../stores/session';

/**
 * The delivery board — the P9.6 read path.
 *
 * ## Read-only, and the reason is the ledger again
 *
 * There is no assign, dispatch or mark-delivered control here. Two hops —
 * `failed → returned` and `in_transit → returned` — each write a return stock movement, so
 * under `STATE-MACHINES.md` universal rule 4 they run in one transaction with the movement
 * they cause and are RPCs by construction. Beyond that, `authenticated` holds
 * `INSERT, SELECT` and **no UPDATE** on `deliveries` (grants read live), so a transition is
 * not merely inadvisable from the client — PostgREST would refuse it with a 42501. The
 * mutation surface is absent by design, not unfinished.
 *
 * ## "Open" defaults on, and deliberately includes `failed`
 *
 * A dispatcher opening this screen wants the work still outstanding. `failed` looks like an
 * end state and is not: its only exit is `returned`, and until that hop runs the goods are
 * out of the branch and unaccounted for in the ledger. A board that hid failed rows would
 * hide precisely the ones someone must chase.
 *
 * ## Filtering happens in the query
 *
 * Both the status filter and the open-only flag are passed to `listDeliveries` and travel
 * into the cache key with it. Filtering a fetched page client-side would under-report: the
 * page is bounded by the keyset limit, so a status filter would search only the first page's
 * worth of rows and then confidently render "none".
 */
export default function DeliveryScreen(): React.JSX.Element {
  const client = getSupabaseClient();
  const router = useRouter();
  const activeTenantId = useSessionStore((s) => s.activeTenantId);
  const [status, setStatus] = useState<DeliveryStatus | null>(null);
  const [openOnly, setOpenOnly] = useState(true);

  // An explicit status is more specific than "open", so it wins rather than intersecting —
  // otherwise picking "Delivered" while Open is on would query an empty set and look broken.
  const filters = useMemo(
    () => (status !== null ? { status } : openOnly ? { openOnly: true } : {}),
    [status, openOnly],
  );
  const deliveries = useDeliveries(client, activeTenantId, filters);

  const ticketIds = useMemo(
    () => (deliveries.data?.rows ?? []).map((row) => row.ticket_id),
    [deliveries.data],
  );
  const tickets = useTicketsByIds(client, activeTenantId, ticketIds);

  const ticketNumbers = useMemo(() => {
    const map = new Map<string, string>();
    for (const ticket of tickets.data ?? []) map.set(ticket.id, ticket.ticket_number);
    return map;
  }, [tickets.data]);

  if (activeTenantId === null) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <NoOrganizationState onChoose={() => router.push('/select-organization')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="gap-4 border-b border-neutral-200 p-6 pb-4">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text className="text-2xl font-bold text-neutral-900">Deliveries</Text>
            <Text className="text-sm text-neutral-500">Drops for your branches</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/')}
            className="rounded-lg border border-neutral-300 px-4 py-2 active:opacity-70"
          >
            <Text className="text-sm font-medium text-neutral-900">Catalog</Text>
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1">
          <View className="flex-row gap-2 px-1">
            <FilterChip
              label="Open"
              selected={status === null && openOnly}
              onPress={() => {
                setStatus(null);
                setOpenOnly(true);
              }}
            />
            <FilterChip
              label="All"
              selected={status === null && !openOnly}
              onPress={() => {
                setStatus(null);
                setOpenOnly(false);
              }}
            />
            {DELIVERY_STATUSES.map((value) => (
              <FilterChip
                key={value}
                label={deliveryStatusLabel(value)}
                selected={status === value}
                onPress={() => setStatus(status === value ? null : value)}
              />
            ))}
          </View>
        </ScrollView>
      </View>

      {deliveries.isPending ? (
        <LoadingState label="Loading deliveries…" />
      ) : deliveries.isError ? (
        <ErrorState error={deliveries.error} onRetry={() => void deliveries.refetch()} />
      ) : deliveries.data.rows.length === 0 ? (
        <EmptyState
          title={
            status !== null
              ? `No ${deliveryStatusLabel(status).toLowerCase()} deliveries`
              : openOnly
                ? 'Nothing out for delivery'
                : 'No deliveries yet'
          }
          detail={
            status !== null
              ? 'Try a different status.'
              : openOnly
                ? 'Every delivery has been delivered or returned.'
                : 'A delivery is raised against a ticket whose fulfilment type is delivery.'
          }
        />
      ) : (
        <FlatList
          data={deliveries.data.rows}
          keyExtractor={(item) => item.id}
          contentContainerClassName="p-6 gap-3"
          refreshing={deliveries.isRefetching}
          onRefresh={() => void deliveries.refetch()}
          renderItem={({ item }) => (
            <DeliveryRow
              delivery={item}
              ticketNumber={ticketNumbers.get(item.ticket_id) ?? null}
              onPress={() => router.push(`/delivery/${item.id}`)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`rounded-full px-4 py-2 active:opacity-70 ${
        selected ? 'bg-neutral-900' : 'border border-neutral-300'
      }`}
    >
      <Text className={`text-sm font-medium ${selected ? 'text-white' : 'text-neutral-900'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * One delivery in the board.
 *
 * Leads with the address rather than the ticket number: this screen is read while deciding
 * where a van goes next, and the destination is what distinguishes two rows at a glance.
 *
 * `ticketNumber` is null when the ticket is not visible to this caller — a soft-deleted
 * ticket, or one in a branch the delivery's driver clause reaches but the ticket policy does
 * not. That is a real state, not a loading artefact, so it renders as an explicit absence
 * rather than a blank.
 */
function DeliveryRow({
  delivery,
  ticketNumber,
  onPress,
}: {
  delivery: Delivery;
  ticketNumber: string | null;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="gap-2 rounded-xl border border-neutral-200 p-4 active:opacity-70"
    >
      <View className="flex-row items-start justify-between gap-3">
        <Text className="flex-1 text-lg font-semibold text-neutral-900" numberOfLines={2}>
          {delivery.address_line}
        </Text>
        <DeliveryStatusBadge status={delivery.status} />
      </View>
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-sm text-neutral-500">{ticketNumber ?? 'Ticket unavailable'}</Text>
        {delivery.driver_id === null ? (
          <Text className="text-sm text-neutral-400">No driver yet</Text>
        ) : null}
      </View>
    </Pressable>
  );
}
