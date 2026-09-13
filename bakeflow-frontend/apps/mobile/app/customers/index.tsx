import { getSupabaseClient } from '@bakeflow/auth';
import { useCustomerPages, useCustomersByPhone } from '@bakeflow/hooks';
import type { Customer } from '@bakeflow/types';
import { Avatar, EmptyState, Icon, ListRow, ScreenList, SearchBar, Skeleton, Text } from '@bakeflow/ui';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ErrorState, NoOrganizationState } from '../../components/ScreenState';
import { useSessionStore } from '../../stores/session';

/** A query that is only digits, spaces, `+` and dashes is a phone number. */
const looksLikePhone = (q: string): boolean => /^[+\d][\d\s-]{5,}$/.test(q);

/**
 * Customers — the prototype's `customers` directory.
 *
 * Named customers only: walk-in rows are counter-sale placeholders and would bury the
 * directory (see `CustomerFilters.isWalkIn`). A phone-shaped query searches the server by exact
 * number; anything else filters the names loaded so far.
 *
 * PORT-NOTE: the prototype ranks customers by lifetime spend and shows orders, last visit and
 * spend per row. Those are aggregates over tickets and payments with no read endpoint, and
 * summing money on the device is not allowed here — rows show contact details, ordered by name.
 * "Add customer" waits for a create-customer endpoint.
 */
export default function CustomersScreen(): React.JSX.Element {
  const router = useRouter();
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const [query, setQuery] = useState('');
  const q = query.trim();
  const phoneSearch = looksLikePhone(q);

  const pages = useCustomerPages(client, tenantId, { isWalkIn: false });
  const byPhone = useCustomersByPhone(client, tenantId, phoneSearch ? q : '');

  const loaded = useMemo(() => pages.data?.pages.flatMap((p) => p.rows) ?? [], [pages.data]);
  const rows: Customer[] = phoneSearch
    ? (byPhone.data ?? [])
    : q === ''
      ? loaded
      : loaded.filter((c) => c.full_name.toLowerCase().includes(q.toLowerCase()));

  const loading = pages.isLoading || (phoneSearch && byPhone.isLoading);

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  return (
    <ScreenList
      title="Customers"
      sub={pages.isLoading ? undefined : `${loaded.length}${pages.hasNextPage === true ? '+' : ''} customers`}
      onBack={() => router.back()}
      data={loading || pages.isError ? [] : rows}
      keyExtractor={(c) => c.id}
      refreshing={pages.isRefetching && !pages.isFetchingNextPage}
      onRefresh={() => void pages.refetch()}
      onEndReached={() => {
        if (!phoneSearch && pages.hasNextPage === true && !pages.isFetchingNextPage) void pages.fetchNextPage();
      }}
      ListHeaderComponent={
        <View className="gap-2 pb-4">
          <SearchBar value={query} onChangeText={setQuery} placeholder="Name or phone number" />
          {phoneSearch && (
            <View className="flex-row items-center gap-1.5 px-0.5">
              <Icon name="phone" size={12} color="textMuted" />
              <Text variant="caption">Searching every customer by exact phone number</Text>
            </View>
          )}
        </View>
      }
      renderItem={({ item, index }) => (
        <View
          className={`bg-white ${index === 0 ? 'rounded-t-md' : ''} ${index === rows.length - 1 ? 'rounded-b-md' : ''}`}
        >
          {index > 0 && <View className="absolute left-4 right-0 top-0 z-10 h-px bg-border" />}
          <ListRow
            leading={<Avatar name={item.full_name} />}
            title={item.full_name}
            sub={[item.phone, item.address_line].filter(Boolean).join(' · ') || 'No contact details'}
            onPress={() => router.push(`/customer/${item.id}`)}
          />
        </View>
      )}
      ListEmptyComponent={
        loading ? (
          <View className="gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} variant="row" />
            ))}
          </View>
        ) : pages.isError ? (
          <ErrorState error={pages.error} onRetry={() => void pages.refetch()} />
        ) : (
          <EmptyState
            icon="users"
            title={q === '' ? 'No customers yet' : 'No customer found'}
            text={
              q === ''
                ? 'Customers you record on orders will build up here.'
                : phoneSearch
                  ? 'No customer has that exact number. Check the digits and try again.'
                  : 'Try a different name, or search by phone number.'
            }
          />
        )
      }
      ListFooterComponent={pages.isFetchingNextPage ? <ActivityIndicator className="py-5" /> : null}
    />
  );
}
