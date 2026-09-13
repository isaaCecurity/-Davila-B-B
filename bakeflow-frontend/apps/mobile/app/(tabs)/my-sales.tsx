import { Badge, EmptyState, IconTile, ListRow, ScreenList, SearchBar, Skeleton } from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ErrorState, NoOrganizationState } from '../../components/ScreenState';
import { useOrderRows } from '../../features/tickets/hooks/useOrderRows';
import { STATUS_META, TODAY_FILTER, ticketTime } from '../../features/tickets/ticketDisplay';
import { useSessionStore } from '../../stores/session';

/**
 * My sales — the prototype's cashier `my-sales` tab: the orders this person rang up today.
 *
 * Filtered on `tickets.created_by`. The read policy is branch-scoped, not creator-scoped, so
 * without this filter a cashier would see the whole branch's sales under "My sales".
 *
 * PORT-NOTE: the prototype header totals the day's takings and its chips filter by payment
 * method. The total is a sum over money (not done on the device), and payment method lives on
 * payments, which have no read yet — the header counts sales and search covers order number,
 * customer and items. A row opens the full order rather than a bottom sheet, so payment and
 * status actions are one tap away.
 */
export default function MySalesScreen(): React.JSX.Element {
  const router = useRouter();
  const userId = useSessionStore((s) => s.userId);
  const [query, setQuery] = useState('');

  const filters = useMemo(
    () => ({ ...TODAY_FILTER.filters(), ...(userId !== null ? { createdBy: userId } : {}) }),
    [userId]
  );
  const list = useOrderRows(filters);

  const q = query.trim().toLowerCase();
  const rows =
    q === ''
      ? list.rows
      : list.rows.filter(
          (r) =>
            r.ticket.ticket_number.toLowerCase().includes(q) ||
            r.customerName.toLowerCase().includes(q) ||
            (r.itemLine ?? '').toLowerCase().includes(q)
        );

  if (list.tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const count = `${list.rows.length}${list.hasNextPage === true ? '+' : ''}`;

  return (
    <ScreenList
      title="Today's sales"
      sub={list.isLoading ? undefined : `${count} sale${count === '1' ? '' : 's'}`}
      data={list.isLoading || list.isError ? [] : rows}
      keyExtractor={(r) => r.ticket.id}
      refreshing={list.isRefetching && !list.isFetchingNextPage}
      onRefresh={() => void list.refetch()}
      onEndReached={() => {
        if (list.hasNextPage === true && !list.isFetchingNextPage) void list.fetchNextPage();
      }}
      ListHeaderComponent={
        <View className="pb-4">
          <SearchBar value={query} onChangeText={setQuery} placeholder="Order number, customer or item" />
        </View>
      }
      renderItem={({ item, index }) => {
        const status = STATUS_META[item.ticket.status];
        return (
          <View
            className={`bg-white ${index === 0 ? 'rounded-t-md' : ''} ${index === rows.length - 1 ? 'rounded-b-md' : ''}`}
          >
            {index > 0 && <View className="absolute left-4 right-0 top-0 z-10 h-px bg-border" />}
            <ListRow
              leading={<IconTile icon="receipt" size="sm" />}
              title={item.ticket.ticket_number}
              sub={`${item.customerName} · ${ticketTime(item.ticket.created_at)}`}
              end={formatNaira(item.ticket.total_amount)}
              trailing={<Badge label={status.label} tone={status.tone} />}
              chevron={false}
              onPress={() => router.push(`/order/${item.ticket.id}`)}
            />
          </View>
        );
      }}
      ListEmptyComponent={
        list.isLoading ? (
          <View className="gap-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} variant="row" />
            ))}
          </View>
        ) : list.isError ? (
          <ErrorState error={list.error ?? new Error('Could not load your sales.')} onRetry={() => void list.refetch()} />
        ) : q !== '' ? (
          <EmptyState icon="search" title="No sales match" text="Try an order number, a customer name, or an item." />
        ) : (
          <EmptyState
            icon="receipt"
            title="No sales yet today"
            text="Orders you ring up today will be listed here as you go."
          />
        )
      }
      ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator className="py-5" /> : null}
    />
  );
}
