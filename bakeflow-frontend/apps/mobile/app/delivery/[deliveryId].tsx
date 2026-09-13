import { getSupabaseClient } from '@bakeflow/auth';
import { useCustomersByIds, useDelivery, useDrivers, useTicketsByIds } from '@bakeflow/hooks';
import { isDeliveryVerified } from '@bakeflow/types';
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  GroupLabel,
  Icon,
  List,
  ListRow,
  ScreenScroll,
  Skeleton,
  Text,
} from '@bakeflow/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, View } from 'react-native';

import { ErrorState, NoOrganizationState } from '../../components/ScreenState';
import { DeliveryActionSheet } from '../../features/delivery/components/DeliveryActionSheet';
import { DELIVERY_META, NEXT_ACTIONS, deliveryWhen, type DeliveryAction } from '../../features/delivery/deliveryDisplay';
import { useSessionStore } from '../../stores/session';

function Line({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View className="flex-row items-center gap-3 py-2" accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="meta" className="w-[112px]">{label}</Text>
      <Text className="flex-1 text-right text-foot font-semibold text-cocoa">{value}</Text>
    </View>
  );
}

/**
 * One delivery — the stop a driver or dispatcher is acting on: where, for whom, where it stands,
 * and the next step.
 *
 * The steps offered transcribe `guard_delivery_transition()`; each opens
 * `DeliveryActionSheet`, which calls `transition_delivery()`. Who may take which step (a manager
 * assigns; the assigned driver or a manager moves it on) is the database's decision, shown as
 * returned.
 *
 * PORT-NOTE: BLOCKER-016 — a return does not restore stock in the live database. The return
 * step is still offered (it is the legal exit from a problem) and says only that the delivery
 * closes, never that stock was put back.
 */
export default function DeliveryDetailScreen(): React.JSX.Element {
  const router = useRouter();
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const { deliveryId } = useLocalSearchParams<{ deliveryId: string }>();
  const id = typeof deliveryId === 'string' && deliveryId !== '' ? deliveryId : null;

  const delivery = useDelivery(client, tenantId, id);
  const ticketIds = useMemo(() => (delivery.data == null ? [] : [delivery.data.ticket_id]), [delivery.data]);
  const tickets = useTicketsByIds(client, tenantId, ticketIds);
  const ticket = tickets.data?.[0] ?? null;
  const customers = useCustomersByIds(client, tenantId, ticket?.customer_id == null ? [] : [ticket.customer_id]);
  const drivers = useDrivers(client, delivery.data?.driver_id == null ? null : tenantId);
  const [action, setAction] = useState<DeliveryAction | null>(null);

  const back = (): void => (router.canGoBack() ? router.back() : router.replace('/delivery'));

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  if (delivery.isLoading) {
    return (
      <ScreenScroll title="Delivery" onBack={back}>
        <View className="mt-2 gap-3">
          <Skeleton variant="row" className="h-[150px]" />
          <Skeleton variant="row" className="h-[180px]" />
        </View>
      </ScreenScroll>
    );
  }

  if (delivery.isError || delivery.data == null) {
    return (
      <ScreenScroll title="Delivery" onBack={back}>
        {delivery.isError ? (
          <ErrorState error={delivery.error} onRetry={() => void delivery.refetch()} />
        ) : (
          <EmptyState
            icon="truck"
            title="Delivery not found"
            text="It may have been removed, or it belongs to a branch you cannot see."
          />
        )}
      </ScreenScroll>
    );
  }

  const row = delivery.data;
  const meta = DELIVERY_META[row.status];
  const actions = NEXT_ACTIONS[row.status];
  const driverName =
    row.driver_id === null ? 'Not assigned' : (drivers.data?.find((d) => d.profile_id === row.driver_id)?.full_name ?? 'Driver');
  const customerName =
    ticket === null ? '—' : ticket.customer_id === null ? 'Walk-in customer' : (customers.data?.[0]?.full_name ?? 'Customer');

  return (
    <ScreenScroll
      title={ticket?.ticket_number ?? 'Delivery'}
      sub={meta.label}
      onBack={back}
      refreshing={delivery.isRefetching}
      onRefresh={() => void delivery.refetch()}
    >
      {/* The prototype's ink hero: the address is the thing to get right. */}
      <Card tone="ink" className="mt-2 rounded-lg p-5">
        <View className="flex-row items-center justify-between gap-3">
          <Badge label={meta.label} tone={meta.tone} icon={meta.icon} onDark />
          <Text className="text-caption text-white/50">{deliveryWhen(row.scheduled_at) ?? 'Not scheduled'}</Text>
        </View>
        <Text className="mt-3 text-title-2 font-bold tracking-[-0.4px] text-white">{row.address_line}</Text>
        <Text className="mt-1 text-foot text-white/60">{customerName}</Text>
        {row.contact_phone !== null && (
          <Button
            className="mt-4"
            label={`Call ${row.contact_phone}`}
            tone="secondary"
            onPress={() => void Linking.openURL(`tel:${row.contact_phone ?? ''}`)}
            block
          />
        )}
      </Card>

      {row.status === 'failed' && row.failure_reason !== null && row.failure_reason !== '' && (
        <Callout
          className="mt-4"
          tone="warning"
          title="Could not deliver"
          detail={`${row.failure_reason}. The goods are still out until this is returned to the bakery.`}
        />
      )}

      {actions.length > 0 && (
        <View className="mt-4 gap-2.5">
          {actions.map((a, i) => (
            <Button
              key={a.to}
              label={a.label}
              tone={i === 0 ? 'primary' : a.to === 'failed' ? 'danger' : 'secondary'}
              onPress={() => setAction(a)}
              block
            />
          ))}
        </View>
      )}

      <GroupLabel>Details</GroupLabel>
      <Card className="gap-1 px-4 py-2">
        <Line label="Driver" value={driverName} />
        <Line label="Contact" value={row.contact_phone ?? '—'} />
        <Line label="Scheduled" value={deliveryWhen(row.scheduled_at) ?? '—'} />
        <Line label="Left the bakery" value={deliveryWhen(row.dispatched_at) ?? '—'} />
        <Line label="Delivered" value={deliveryWhen(row.delivered_at) ?? '—'} />
      </Card>

      <GroupLabel>Proof of delivery</GroupLabel>
      {isDeliveryVerified(row.status) ? (
        <Card className="gap-1 px-4 py-2">
          <Line label="Received by" value={row.recipient_name ?? '—'} />
          <View className="flex-row items-center gap-2 py-2">
            <Icon name="checkCircle" size={15} color="success" />
            <Text variant="caption" className="flex-1">Delivered, so its order can now be completed.</Text>
          </View>
        </Card>
      ) : (
        <Text variant="meta">Nothing recorded yet. An order cannot be completed until its delivery is delivered.</Text>
      )}

      {ticket !== null && (
        <>
          <GroupLabel>Order</GroupLabel>
          <List>
            <ListRow
              leading={<Icon name="receipt" size={18} color="cocoa" />}
              title={ticket.ticket_number}
              sub={customerName}
              onPress={() => router.push(`/order/${ticket.id}`)}
            />
          </List>
        </>
      )}

      <DeliveryActionSheet delivery={row} action={action} onClose={() => setAction(null)} />
    </ScreenScroll>
  );
}
