import { Avatar, Card, EmptyState, GroupLabel, IconTile, List, ListRow, ScreenScroll, Skeleton, Text } from '@bakeflow/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Linking, View } from 'react-native';

import { ErrorState, NoOrganizationState } from '../../../components/ScreenState';
import { DELIVERY_META, DRIVER_GROUPS, deliveryWhen } from '../../../features/delivery/deliveryDisplay';
import { useDeliveryBoard } from '../../../features/delivery/hooks/useDeliveryBoard';

/**
 * One driver's day — the prototype's `driver-detail`: their stops, grouped by where each one
 * stands.
 *
 * PORT-NOTE: the prototype adds each stop's amount; money stays on the order, one tap away. Items
 * and a failure reason are shown in full, because they are what a dispatcher acts on.
 */
export default function DriverDetailScreen(): React.JSX.Element {
  const router = useRouter();
  const { driverId } = useLocalSearchParams<{ driverId: string }>();
  const board = useDeliveryBoard();
  const driver = board.byDriver.find((d) => d.driverId === driverId);

  if (board.tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  return (
    <ScreenScroll
      title={driver?.name ?? 'Driver'}
      sub={driver === undefined ? undefined : `${driver.rows.length} stop${driver.rows.length === 1 ? '' : 's'}`}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/delivery'))}
      refreshing={board.isRefetching}
      onRefresh={board.refetch}
    >
      {board.isLoading ? (
        <View className="mt-3 gap-3">
          <Skeleton variant="row" className="h-[76px]" />
          <Skeleton variant="row" />
        </View>
      ) : board.isError ? (
        <ErrorState error={board.error ?? new Error('Could not load deliveries.')} onRetry={board.refetch} />
      ) : driver === undefined ? (
        <EmptyState icon="user" title="Driver not found" text="They may no longer hold the driver role in this bakery." />
      ) : (
        <>
          <Card className="mt-2 flex-row items-center gap-[13px]">
            <Avatar name={driver.name} size="lg" />
            <View className="min-w-0 flex-1">
              <Text variant="subtitle" numberOfLines={1}>{driver.name}</Text>
              <Text variant="meta">Delivery · Field</Text>
            </View>
            {driver.phone !== null && (
              <Text
                accessibilityRole="link"
                accessibilityLabel={`Call ${driver.name}`}
                onPress={() => void Linking.openURL(`tel:${driver.phone ?? ''}`)}
                className="min-h-tap px-1 py-3 text-foot font-semibold text-apricot-deep"
              >
                Call
              </Text>
            )}
          </Card>

          {driver.rows.length === 0 ? (
            <EmptyState icon="truck" title="No stops today" text="Assign a delivery from the board and it appears here." />
          ) : (
            DRIVER_GROUPS.map((g) => {
              const rows = driver.rows.filter((r) => r.delivery.status === g.status);
              if (rows.length === 0) return null;
              const meta = DELIVERY_META[g.status];
              return (
                <View key={g.status}>
                  <GroupLabel>{g.label}</GroupLabel>
                  <List>
                    {rows.map((r) => (
                      <View key={r.delivery.id}>
                        <ListRow
                          leading={<IconTile icon="truck" tone={meta.tile} size="sm" />}
                          title={r.customerName}
                          sub={[r.delivery.address_line, r.itemLine, r.ticket?.ticket_number, deliveryWhen(r.delivery.delivered_at ?? r.delivery.dispatched_at ?? r.delivery.scheduled_at)]
                            .filter(Boolean)
                            .join(' · ')}
                          onPress={() => router.push(`/delivery/${r.delivery.id}`)}
                        />
                        {r.delivery.failure_reason !== null && r.delivery.failure_reason !== '' && (
                          <Text variant="meta" className="px-4 pb-3">{r.delivery.failure_reason}</Text>
                        )}
                      </View>
                    ))}
                  </List>
                </View>
              );
            })
          )}
        </>
      )}
    </ScreenScroll>
  );
}
