import type { TicketFilters } from '@bakeflow/api';
import { getSupabaseClient } from '@bakeflow/auth';
import { useCurrentDriverTrip } from '@bakeflow/hooks';
import { Chips, EmptyState, Fab, IconButton, ScreenList, SearchBar, Skeleton } from '@bakeflow/ui';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { ErrorState, NoOrganizationState } from '../../components/ScreenState';
import { OrderCard } from '../../features/tickets/components/OrderCard';
import { useOrderRows } from '../../features/tickets/hooks/useOrderRows';
import { startOfToday } from '../../features/tickets/ticketDisplay';
import { useOffBarBack } from '../../navigation/useOffBarBack';
import { useSessionStore } from '../../stores/session';

type TicketFilterKey = 'today' | 'trip' | 'draft' | 'completed';

const FILTERS: readonly { key: TicketFilterKey; label: string; empty: [string, string] }[] = [
  { key: 'today', label: 'Today', empty: ['No tickets yet today', 'Tickets you create appear here as you sell.'] },
  { key: 'trip', label: 'This trip', empty: ['No sales on this trip', 'Sales you make on the road appear here.'] },
  { key: 'draft', label: 'Not finished', empty: ['Nothing unfinished', 'Every ticket you started has been completed.'] },
  { key: 'completed', label: 'Completed', empty: ['No completed tickets', 'Completed sales appear here.'] },
];

/**
 * Tickets — the prototype's driver `tickets` tab: every ticket this driver has written, newest
 * first, searchable.
 *
 * Scoped by `created_by` (the read policy is branch-wide, so without it a driver would see the
 * whole branch). "This trip" narrows to `driver_trip_id`.
 *
 * PORT-NOTE: the prototype's "Out for delivery" and "Failed" filters describe delivery tickets;
 * a driver's own tickets are roadside sales with no delivery, so those filters are replaced by
 * "This trip" and "Not finished". The header total is a money sum and is not shown. Offline
 * queueing ("Working offline") waits for the sync layer (P10).
 */
export default function TicketsScreen(): React.JSX.Element {
  const router = useRouter();
  const onBack = useOffBarBack('tickets');
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const userId = useSessionStore((s) => s.userId);
  const trip = useCurrentDriverTrip(getSupabaseClient(), tenantId, userId);
  const [filter, setFilter] = useState<TicketFilterKey>('today');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');

  const filters = useMemo<TicketFilters>(() => {
    const mine = userId === null ? {} : { createdBy: userId };
    switch (filter) {
      case 'today':
        return { ...mine, since: startOfToday() };
      case 'trip':
        // An impossible id keeps the list empty (not everything) when no trip is active.
        return { ...mine, driverTripId: trip.data?.id ?? '00000000-0000-0000-0000-000000000000' };
      case 'draft':
        return { ...mine, status: 'draft' };
      case 'completed':
        return { ...mine, status: 'completed' };
    }
  }, [filter, userId, trip.data]);

  const list = useOrderRows(filters);
  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const q = query.trim().toLowerCase();
  const rows = q === ''
    ? list.rows
    : list.rows.filter(
        (r) =>
          r.ticket.ticket_number.toLowerCase().includes(q) ||
          r.customerName.toLowerCase().includes(q) ||
          (r.itemLine ?? '').toLowerCase().includes(q)
      );
  const count = `${list.rows.length}${list.hasNextPage === true ? '+' : ''}`;

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  return (
    <ScreenList
      title="Tickets"
      sub={list.isLoading ? undefined : `${count} ${active?.label.toLowerCase() ?? ''}`}
      onBack={onBack}
      right={
        <IconButton
          icon={searching ? 'close' : 'search'}
          label={searching ? 'Close search' : 'Search tickets'}
          tinted
          onPress={() => {
            setSearching((s) => !s);
            setQuery('');
          }}
        />
      }
      overlay={<Fab label="New ticket" onPress={() => router.push('/driver/sell')} />}
      data={list.isLoading || list.isError ? [] : rows}
      keyExtractor={(r) => r.ticket.id}
      refreshing={list.isRefetching && !list.isFetchingNextPage}
      onRefresh={() => void list.refetch()}
      onEndReached={() => {
        if (list.hasNextPage === true && !list.isFetchingNextPage) void list.fetchNextPage();
      }}
      ListHeaderComponent={
        <View className="gap-4 pb-4">
          {searching && <SearchBar value={query} onChangeText={setQuery} placeholder="Ticket number, customer or product" autoFocus />}
          <Chips
            accessibilityLabel="Filter tickets"
            options={FILTERS.map((f) => ({ key: f.key, label: f.label, count: f.key === filter && !list.isLoading ? count : undefined }))}
            value={filter}
            onChange={setFilter}
          />
        </View>
      }
      renderItem={({ item }) => (
        <View className="mb-3">
          <OrderCard row={item} onPress={() => router.push(`/order/${item.ticket.id}`)} />
        </View>
      )}
      ListEmptyComponent={
        list.isLoading ? (
          <View className="gap-3">
            <Skeleton variant="row" className="h-[132px]" />
            <Skeleton variant="row" className="h-[132px]" />
          </View>
        ) : list.isError ? (
          <ErrorState error={list.error ?? new Error('Could not load tickets.')} onRetry={() => void list.refetch()} />
        ) : (
          <EmptyState
            icon="ticket"
            title={q === '' ? (active?.empty[0] ?? '') : 'No tickets match'}
            text={q === '' ? (active?.empty[1] ?? '') : 'Try a ticket number, a customer or a product.'}
          />
        )
      }
      ListFooterComponent={<View className="h-20" />}
    />
  );
}
