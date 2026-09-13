import { getSupabaseClient } from '@bakeflow/auth';
import { useCustomer } from '@bakeflow/hooks';
import { Avatar, Button, Card, Icon, ScreenScroll, Skeleton, Text } from '@bakeflow/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { EmptyState, ErrorState } from '../../components/ScreenState';
import { OrderCard } from '../../features/tickets/components/OrderCard';
import { useOrderRows } from '../../features/tickets/hooks/useOrderRows';
import { useSessionStore } from '../../stores/session';

function Detail({ icon, label, value }: { icon: 'phone' | 'mail' | 'pin' | 'doc'; label: string; value: string }): React.JSX.Element {
  return (
    <View className="flex-row items-start gap-3 py-2">
      <Icon name={icon} size={16} color="textSecondary" />
      <View className="min-w-0 flex-1">
        <Text variant="caption">{label}</Text>
        <Text className="text-callout text-cocoa">{value}</Text>
      </View>
    </View>
  );
}

/**
 * Customer — the prototype's `customer` profile: who they are, and every order they have placed.
 *
 * PORT-NOTE: the prototype's lifetime spend, average order, outstanding-credit panel, credit
 * ledger and "What they buy" chart are aggregates over tickets and payments. There is no
 * endpoint for them and money is not summed on the device, so they are not shown; the order
 * history below is the underlying record they would summarise. "Statement" waits for an
 * endpoint.
 */
export default function CustomerScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const customer = useCustomer(getSupabaseClient(), tenantId, id ?? null);
  const filters = useMemo(() => ({ customerId: id }), [id]);
  const orders = useOrderRows(filters);
  const back = (): void => router.back();

  if (customer.isLoading) {
    return (
      <ScreenScroll title="Customer" onBack={back}>
        <View className="gap-3 pt-5">
          <Skeleton variant="row" className="h-[120px]" />
          <Skeleton variant="row" className="h-[132px]" />
        </View>
      </ScreenScroll>
    );
  }
  if (customer.isError) {
    return (
      <ScreenScroll title="Customer" onBack={back}>
        <ErrorState error={customer.error} onRetry={() => void customer.refetch()} />
      </ScreenScroll>
    );
  }
  const c = customer.data;
  if (c == null) {
    return (
      <ScreenScroll title="Customer" onBack={back}>
        <EmptyState title="Customer not found" detail="They may have been removed, or belong to another bakery." />
      </ScreenScroll>
    );
  }

  const orderCount = `${orders.rows.length}${orders.hasNextPage === true ? '+' : ''}`;

  return (
    <ScreenScroll
      title={c.full_name}
      sub={c.phone ?? undefined}
      onBack={back}
      refreshing={customer.isRefetching || orders.isRefetching}
      onRefresh={() => {
        void customer.refetch();
        void orders.refetch();
      }}
    >
      <Card className="mt-5">
        <View className="flex-row items-center gap-3">
          <Avatar name={c.full_name} size="lg" />
          <View className="min-w-0 flex-1">
            <Text className="text-title-3 font-bold text-cocoa" numberOfLines={1}>{c.full_name}</Text>
            <Text variant="meta">{orders.isLoading ? 'Loading orders…' : `${orderCount} order${orderCount === '1' ? '' : 's'}`}</Text>
          </View>
        </View>
        <View className="mt-4 border-t border-border pt-2">
          {c.phone !== null && <Detail icon="phone" label="Phone" value={c.phone} />}
          {c.email !== null && <Detail icon="mail" label="Email" value={c.email} />}
          {c.address_line !== null && <Detail icon="pin" label="Address" value={c.address_line} />}
          {c.notes !== null && <Detail icon="doc" label="Notes" value={c.notes} />}
          {c.phone === null && c.email === null && c.address_line === null && (
            <Text variant="meta" className="py-2">No contact details recorded.</Text>
          )}
        </View>
      </Card>

      <View className="mt-4">
        <Button label="New order" onPress={() => router.push({ pathname: '/new-order', params: { customerId: c.id } })} block />
      </View>

      <View className="mt-8">
        <View className="mb-3 flex-row items-baseline">
          <Text variant="subtitle" accessibilityRole="header" className="flex-1">Orders</Text>
          {!orders.isLoading && <Text variant="meta">{orderCount} shown</Text>}
        </View>
        {orders.isLoading ? (
          <View className="gap-3">
            <Skeleton variant="row" className="h-[132px]" />
            <Skeleton variant="row" className="h-[132px]" />
          </View>
        ) : orders.rows.length === 0 ? (
          <Card tone="recessed" className="items-center p-6">
            <Text variant="meta">No orders from this customer yet.</Text>
          </Card>
        ) : (
          <View className="gap-3">
            {orders.rows.map((row) => (
              <OrderCard key={row.ticket.id} row={row} onPress={() => router.push(`/order/${row.ticket.id}`)} />
            ))}
            {orders.hasNextPage === true && (
              <Button
                label="Show more orders"
                tone="secondary"
                busy={orders.isFetchingNextPage}
                onPress={() => void orders.fetchNextPage()}
                block
              />
            )}
          </View>
        )}
      </View>
    </ScreenScroll>
  );
}
