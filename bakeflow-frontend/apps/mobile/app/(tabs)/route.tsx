import { getSupabaseClient } from '@bakeflow/auth';
import { useCurrentDriverTrip } from '@bakeflow/hooks';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Fab,
  GroupLabel,
  Icon,
  IconTile,
  PressableScale,
  ScreenScroll,
  Skeleton,
  Text,
  timing,
} from '@bakeflow/ui';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ErrorState, NoOrganizationState } from '../../components/ScreenState';
import { DeliveryActionSheet } from '../../features/delivery/components/DeliveryActionSheet';
import { DELIVERY_META, NEXT_ACTIONS, type DeliveryAction } from '../../features/delivery/deliveryDisplay';
import { useDeliveryBoard, type DeliveryRow } from '../../features/delivery/hooks/useDeliveryBoard';
import { TRIP_STAGE, tripTime } from '../../features/driverTrip/tripDisplay';
import { PAY_META, payStateOf } from '../../features/tickets/ticketDisplay';
import { useOffBarBack } from '../../navigation/useOffBarBack';
import { useSessionStore } from '../../stores/session';

/** The prototype's `.track`: route progress, eased on the UI thread. */
function Track({ done, total }: { done: number; total: number }): React.JSX.Element {
  const width = useSharedValue(0);
  useEffect(() => {
    width.value = withTiming(total === 0 ? 0 : done / total, timing('slow'));
  }, [done, total, width]);
  const fill = useAnimatedStyle(() => ({ width: `${width.value * 100}%` }));
  return (
    <View
      className="mt-5 h-1.5 overflow-hidden rounded-pill bg-white/15"
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: total, now: done }}
    >
      <Animated.View className="h-full rounded-pill bg-apricot" style={fill} />
    </View>
  );
}

function StopCard({ row, onAction }: { row: DeliveryRow; onAction: (a: DeliveryAction) => void }): React.JSX.Element {
  const { delivery, ticket } = row;
  const meta = DELIVERY_META[delivery.status];
  const terminal = delivery.status === 'delivered' || delivery.status === 'returned';
  const pay = ticket === null ? null : payStateOf(ticket);
  const actions = NEXT_ACTIONS[delivery.status].filter((a) => a.to !== 'assigned');
  const primary = actions.find((a) => a.to !== 'failed' && a.to !== 'returned') ?? actions.find((a) => a.to === 'returned');
  const failure = actions.find((a) => a.to === 'failed');

  return (
    <Card className={`gap-0 ${terminal ? 'opacity-60' : ''} ${delivery.status === 'in_transit' ? 'border-[1.5px] border-apricot' : ''}`}>
      <View className="flex-row items-start gap-3">
        <IconTile icon={meta.icon} tone={meta.tile} />
        <View className="min-w-0 flex-1">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="text-callout font-semibold text-cocoa" numberOfLines={1}>{row.customerName}</Text>
            <Badge label={meta.label} tone={meta.tone} />
          </View>
          <Text variant="meta" className="mt-0.5">{delivery.address_line}</Text>
          {row.itemLine !== null && <Text variant="meta" className="mt-1">{row.itemLine}</Text>}
          <View className="mt-1.5 flex-row flex-wrap gap-1.5">
            {ticket !== null && <Badge label={ticket.ticket_number} tone="neutral" />}
            {!terminal && pay !== null && <Badge label={pay === 'paid' ? 'Paid' : 'Collect on delivery'} tone={PAY_META[pay].tone} />}
          </View>
          {delivery.status === 'delivered' && delivery.recipient_name !== null && (
            <Text variant="meta" className="mt-1.5">Received by {delivery.recipient_name}</Text>
          )}
          {(delivery.status === 'failed' || delivery.status === 'returned') && delivery.failure_reason !== null && delivery.failure_reason !== '' && (
            <Text variant="meta" className="mt-1.5 text-error-ink">{delivery.failure_reason}</Text>
          )}
        </View>
      </View>

      {!terminal && (
        <>
          <View className="mt-4 flex-row gap-2">
            {delivery.contact_phone !== null && (
              <Button
                className="flex-1"
                label="Call"
                tone="secondary"
                onPress={() => void Linking.openURL(`tel:${(delivery.contact_phone ?? '').replace(/\s/g, '')}`)}
              />
            )}
            {delivery.status !== 'failed' && (
              <Button
                className="flex-1"
                label="Directions"
                tone="secondary"
                onPress={() => void Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent(delivery.address_line)}`)}
              />
            )}
            {primary !== undefined && (
              <Button className="flex-1" label={primary.to === 'delivered' ? 'Delivered' : primary.to === 'in_transit' ? 'Start' : 'Return'} onPress={() => onAction(primary)} />
            )}
          </View>
          {failure !== undefined && (
            <PressableScale
              accessibilityRole="button"
              onPress={() => onAction(failure)}
              className="mt-2 min-h-tap flex-row items-center justify-center gap-1.5"
            >
              <Icon name="alert" size={15} color="error-ink" />
              <Text className="text-foot font-semibold text-error-ink">Report a problem</Text>
            </PressableScale>
          )}
        </>
      )}
    </Card>
  );
}

/**
 * Your route — the prototype's driver `route` tab: the trip at a glance, then each stop with
 * the one thing to do next.
 *
 * Stops are the driver's own deliveries (today's plus any still open), and every step on them
 * is `transition_delivery()` through `DeliveryActionSheet`. The trip card opens `/trip`.
 *
 * PORT-NOTE: the prototype's hero is "Held by you" — a sum of the day's collected payments,
 * which this app does not add on the device; the hero shows route progress instead, and cash
 * custody is reconciled server-side at the end of the trip. "Assigned by" needs the assigner,
 * which deliveries do not record. Directions open the address in maps rather than an in-app map.
 */
export default function RouteScreen(): React.JSX.Element {
  const router = useRouter();
  const onBack = useOffBarBack('route');
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const userId = useSessionStore((s) => s.userId);
  const trip = useCurrentDriverTrip(getSupabaseClient(), tenantId, userId);
  const board = useDeliveryBoard(userId === null ? {} : { driverId: userId });
  // The row outlives the action so the sheet keeps its content while it animates closed.
  const [actingRow, setActingRow] = useState<DeliveryRow | null>(null);
  const [action, setAction] = useState<DeliveryAction | null>(null);

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const stops = [...board.rows].sort((a, b) => {
    // Active first, finished last; otherwise oldest first so the route reads in order.
    const rank = (r: DeliveryRow): number =>
      r.delivery.status === 'in_transit' ? 0 : r.delivery.status === 'failed' ? 1 : r.delivery.status === 'assigned' ? 2 : 3;
    return rank(a) - rank(b) || a.delivery.created_at.localeCompare(b.delivery.created_at);
  });
  const done = stops.filter((r) => r.delivery.status === 'delivered' || r.delivery.status === 'returned').length;
  const current = trip.data ?? null;

  return (
    <View className="flex-1 bg-cream">
      <ScreenScroll
        title="Your route"
        sub={board.isLoading ? undefined : `${done} of ${stops.length} stops done`}
        onBack={onBack}
        refreshing={board.isRefetching || trip.isRefetching}
        onRefresh={() => {
          board.refetch();
          void trip.refetch();
        }}
      >
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`Trip, ${current === null ? 'not started' : TRIP_STAGE[current.status].label}`}
          onPress={() => router.push('/trip')}
          scaleTo={0.98}
          className="mt-2 flex-row items-center gap-3 rounded-md bg-white p-4 shadow-e2"
        >
          <IconTile icon={current === null ? 'truck' : TRIP_STAGE[current.status].icon} tone={current === null ? 'accent' : TRIP_STAGE[current.status].tile} />
          <View className="min-w-0 flex-1">
            <Text className="text-callout font-semibold text-cocoa">
              Trip · {current === null ? (trip.isLoading ? '…' : 'Not started') : TRIP_STAGE[current.status].label}
            </Text>
            <Text variant="meta" numberOfLines={1}>
              {current?.status === 'in_transit' ? `On the road since ${tripTime(current.departed_at) ?? ''}` : 'Loading, departure, return and reconciliation'}
            </Text>
          </View>
          <Icon name="chevRight" size={17} color="textMuted" />
        </PressableScale>

        <Card tone="ink" className="mt-4 rounded-lg p-5">
          <View className="flex-row items-start gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-caption font-semibold uppercase tracking-[1.2px] text-white/50">Today&apos;s stops</Text>
              <Text tabular className="mt-1.5 text-display font-bold tracking-[-1.2px] text-white">
                {board.isLoading ? '—' : `${done}/${stops.length}`}
              </Text>
              <Text className="mt-1 text-foot text-white/60">
                {stops.length - done === 0 ? 'Nothing left to deliver' : `${stops.length - done} still to go`}
              </Text>
            </View>
            <View className="h-11 w-11 items-center justify-center rounded-[14px] bg-white/10">
              <Icon name="truck" size={21} color="white" />
            </View>
          </View>
          <Track done={done} total={stops.length} />
        </Card>

        <GroupLabel>Stops</GroupLabel>
        {board.isLoading ? (
          <View className="gap-3">
            <Skeleton variant="row" className="h-[150px]" />
            <Skeleton variant="row" className="h-[150px]" />
          </View>
        ) : board.isError ? (
          <ErrorState error={board.error ?? new Error('Could not load your stops.')} onRetry={board.refetch} />
        ) : stops.length === 0 ? (
          <EmptyState icon="pin" title="No stops assigned" text="Deliveries a manager assigns to you appear here." />
        ) : (
          <View className="gap-3">
            {stops.map((r) => (
              <StopCard key={r.delivery.id} row={r} onAction={(a) => {
                  setActingRow(r);
                  setAction(a);
                }} />
            ))}
          </View>
        )}
        <View className="h-20" />
      </ScreenScroll>

      <Fab label="New ticket" onPress={() => router.push('/driver/sell')} />
      {actingRow !== null && (
        <DeliveryActionSheet delivery={actingRow.delivery} action={action} onClose={() => setAction(null)} />
      )}
    </View>
  );
}
