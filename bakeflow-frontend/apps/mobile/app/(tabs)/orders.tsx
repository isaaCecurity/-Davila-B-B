import { nextTicketStatus } from '@bakeflow/api';
import {
  Button,
  Chips,
  EmptyState,
  Fab,
  Icon,
  IconButton,
  ScreenList,
  SearchBar,
  Skeleton,
  SwipeRow,
  Text,
} from '@bakeflow/ui';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ErrorState, NoOrganizationState } from '../../components/ScreenState';
import { useActivePersona } from '../../features/auth/hooks/useActivePersona';
import { AdvanceTicketSheet } from '../../features/tickets/components/AdvanceTicketSheet';
import { OrderCard } from '../../features/tickets/components/OrderCard';
import { useOrderRows, type OrderRow } from '../../features/tickets/hooks/useOrderRows';
import {
  ADVANCE_VERB,
  ORDER_FILTERS,
  TODAY_FILTER,
  type OrderFilterKey,
} from '../../features/tickets/ticketDisplay';

/**
 * Orders — the prototype's `orders` screen, on live tickets.
 *
 * Filter chips, search, swipe-to-advance for owners and managers on Today, virtualised list
 * with keyset paging and pull-to-refresh.
 *
 * PORT-NOTE: the prototype footer sums every visible order ("7 orders · ₦428,500"). Money here
 * is an exact `NUMERIC(19,4)` string and this app does no client-side money arithmetic (see
 * app/products/index.tsx), so the footer counts orders only; a server-side total is the fix.
 * Counts appear on the active chip only — a count per chip would be six extra queries on
 * mobile data. Search filters what has loaded; there is no server search endpoint yet.
 */
export default function OrdersScreen(): React.JSX.Element {
  const router = useRouter();
  const persona = useActivePersona();
  const [filter, setFilter] = useState<OrderFilterKey>('today');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [advancing, setAdvancing] = useState<OrderRow | null>(null);

  const active = ORDER_FILTERS.find((f) => f.key === filter) ?? TODAY_FILTER;
  // Recomputed per filter change only, so "today" keeps a stable midnight for the query key.
  const filters = useMemo(() => active.filters(), [active]);
  const list = useOrderRows(filters);

  const q = query.trim().toLowerCase();
  const rows = q === ''
    ? list.rows
    : list.rows.filter(
        (r) =>
          r.ticket.ticket_number.toLowerCase().includes(q) ||
          r.customerName.toLowerCase().includes(q) ||
          (r.itemLine ?? '').toLowerCase().includes(q)
      );

  const canSwipe = filter === 'today' && (persona === 'owner' || persona === 'manager');
  const loadedCount = `${list.rows.length}${list.hasNextPage === true ? '+' : ''}`;

  if (list.tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  return (
    <>
      <ScreenList
        title="Orders"
        sub={list.isLoading ? undefined : `${loadedCount} ${active.label.toLowerCase()}`}
        right={
          <IconButton
            icon={searching ? 'close' : 'search'}
            label={searching ? 'Close search' : 'Search orders'}
            tinted
            onPress={() => {
              setSearching((s) => !s);
              setQuery('');
            }}
          />
        }
        overlay={
          persona !== 'driver' && persona !== 'baker' ? (
            <Fab label="New order" onPress={() => router.push('/new-order')} />
          ) : undefined
        }
        data={list.isLoading || list.isError ? [] : rows}
        keyExtractor={(r) => r.ticket.id}
        refreshing={list.isRefetching && !list.isFetchingNextPage}
        onRefresh={() => void list.refetch()}
        onEndReached={() => {
          if (list.hasNextPage === true && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        ListHeaderComponent={
          <View className="gap-4 pb-4">
            {searching && (
              <SearchBar
                value={query}
                onChangeText={setQuery}
                placeholder="Customer, order number or product"
                autoFocus
              />
            )}
            <Chips
              accessibilityLabel="Filter orders"
              options={ORDER_FILTERS.map((f) => ({
                key: f.key,
                label: f.label,
                count: f.key === filter && !list.isLoading ? loadedCount : undefined,
              }))}
              value={filter}
              onChange={setFilter}
            />
            {canSwipe && rows.length > 0 && (
              <View className="flex-row items-center gap-[7px] py-0.5">
                <Icon name="info" size={13} color="textMuted" />
                <Text variant="caption">Swipe an order left to move it to its next step.</Text>
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => {
          const to = nextTicketStatus(item.ticket.status);
          return (
            <View className="mb-3">
              <SwipeRow
                enabled={canSwipe && to !== null}
                action={{
                  label: to === null ? '' : (ADVANCE_VERB[to]?.split(' ')[0] ?? 'Advance'),
                  icon: 'check',
                  tone: 'advance',
                  onPress: () => setAdvancing(item),
                }}
              >
                <OrderCard row={item} onPress={() => router.push(`/order/${item.ticket.id}`)} />
              </SwipeRow>
            </View>
          );
        }}
        ListEmptyComponent={
          list.isLoading ? (
            <View className="gap-3">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} variant="row" className="h-[132px]" />
              ))}
            </View>
          ) : list.isError ? (
            <ErrorState error={list.error ?? new Error('Could not load orders.')} onRetry={() => void list.refetch()} />
          ) : q !== '' ? (
            <EmptyState
              icon="search"
              title={`Nothing matches “${query.trim()}”`}
              text="Try a customer name, an order number, or a product."
            />
          ) : (
            <EmptyState
              icon="orders"
              title={active.empty[0]}
              text={active.empty[1]}
              action={
                filter !== 'today' ? (
                  <Button label="See today's orders" tone="secondary" onPress={() => setFilter('today')} />
                ) : undefined
              }
            />
          )
        }
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <ActivityIndicator className="py-5" />
          ) : rows.length > 0 ? (
            <Text variant="meta" className="mt-2 text-center">
              {rows.length} order{rows.length === 1 ? '' : 's'}
              {list.hasNextPage === true ? ' · scroll for more' : ''}
            </Text>
          ) : null
        }
      />
      <AdvanceTicketSheet
        ticket={advancing?.ticket ?? null}
        customerName={advancing?.customerName ?? ''}
        onClose={() => setAdvancing(null)}
      />
    </>
  );
}
