import { getSupabaseClient } from '@bakeflow/auth';
import { useDeliveries, useDriverTrips, useProductStockLevels, useWarehouses } from '@bakeflow/hooks';
import { isNegativeDecimalString, isZeroDecimalString } from '@bakeflow/types';
import { EmptyState, GroupLabel, IconTile, List, ListRow, ScreenScroll, Skeleton, Text, type IconName, type TileTone } from '@bakeflow/ui';
import { useRouter, type Href } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { NoOrganizationState } from '../../components/ScreenState';
import { useActivePersona } from '../../features/auth/hooks/useActivePersona';
import { useBranchOptions } from '../../features/branch/hooks/useBranchOptions';
import { useVariantLabels } from '../../features/catalog/hooks/useVariantLabels';
import { useOpenTill, useTicketCount } from '../../features/home/hooks/useHomeData';
import { startOfToday, ticketTime } from '../../features/tickets/ticketDisplay';
import { useOffBarBack } from '../../navigation/useOffBarBack';
import { useSessionStore } from '../../stores/session';

interface Alert {
  key: string;
  icon: IconName;
  tone: TileTone;
  title: string;
  sub: string;
  href: Href;
}

/**
 * Alerts — the prototype's `notifications`: the things that need someone, grouped by area.
 *
 * Every alert is derived from live rows this person's role can read — orders waiting,
 * stock that ran out, deliveries that failed, trips waiting on the bakery, no till open — and
 * each opens the screen where it is handled. Pull to refresh re-derives them.
 *
 * PORT-NOTE: the prototype shows an event history ("Order BF-2045 confirmed", "Password
 * changed") with read/unread and "mark all read". There is no notifications table or push
 * channel yet, so this is a live to-do list rather than a history, and there is nothing to mark
 * read. Payment/invoice, insight and sign-in events have no source.
 */
export default function AlertsScreen(): React.JSX.Element {
  const router = useRouter();
  const onBack = useOffBarBack('alerts');
  const client = getSupabaseClient();
  const persona = useActivePersona();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const branches = useBranchOptions();
  const branch = branches.options[0] ?? null;
  const scope = branch === null ? {} : { branchId: branch.branchId };
  const { labels } = useVariantLabels();

  const office = persona === 'owner' || persona === 'manager' || persona === 'admin' || persona === 'cashier' || persona === 'supervisor';
  const submitted = useTicketCount({ status: 'submitted', ...scope });
  const toMake = useTicketCount({ statuses: ['scheduled', 'in_production'], ...scope });
  const ready = useTicketCount({ status: 'ready', since: startOfToday(), ...scope });
  const till = useOpenTill(office ? branch?.branchId : undefined);
  const deliveries = useDeliveries(client, tenantId, { status: 'failed', ...scope }, { limit: 50 });
  const trips = useDriverTrips(client, persona === 'driver' || persona === 'cashier' ? null : tenantId, { activeOnly: true, ...scope });
  const warehouses = useWarehouses(client, tenantId, branch?.branchId);
  const stockroom = (warehouses.data ?? []).find((w) => w.is_default) ?? null;
  const levels = useProductStockLevels(client, tenantId, stockroom?.id ?? null, { limit: 200 });

  const groups = useMemo(() => {
    const orders: Alert[] = [];
    if (office && submitted.count > 0) {
      orders.push({ key: 'submitted', icon: 'bag', tone: 'accent', title: `${submitted.label} order${submitted.count === 1 ? '' : 's'} waiting to be confirmed`, sub: submitted.rows[0] === undefined ? '' : `Newest ${ticketTime(submitted.rows[0].created_at)}`, href: '/orders' });
    }
    if ((persona === 'baker' || persona === 'manager' || persona === 'owner' || persona === 'supervisor') && toMake.count > 0) {
      orders.push({ key: 'make', icon: 'flame', tone: 'warn', title: `${toMake.label} order${toMake.count === 1 ? '' : 's'} to make`, sub: 'Scheduled or preparing', href: '/production' });
    }
    if (office && ready.count > 0) {
      orders.push({ key: 'ready', icon: 'checkCircle', tone: 'ok', title: `${ready.label} order${ready.count === 1 ? '' : 's'} ready`, sub: 'For pickup or delivery', href: '/orders' });
    }

    const stock: Alert[] = (levels.data?.rows ?? [])
      .filter((l) => isZeroDecimalString(l.quantity_on_hand) || isNegativeDecimalString(l.quantity_on_hand))
      .slice(0, 6)
      .map((l) => ({
        key: l.id,
        icon: 'box' as IconName,
        tone: 'bad' as TileTone,
        title: `${labels.get(l.product_variant_id)?.label ?? 'A product'} is ${isZeroDecimalString(l.quantity_on_hand) ? 'out of stock' : 'below zero'}`,
        sub: stockroom?.name ?? '',
        href: '/inventory' as Href,
      }));

    const field: Alert[] = [
      ...(deliveries.data?.rows ?? []).slice(0, 5).map((d) => ({
        key: d.id,
        icon: 'truck' as IconName,
        tone: 'bad' as TileTone,
        title: `Delivery to ${d.address_line} failed`,
        sub: d.failure_reason ?? 'Needs to be returned',
        href: `/delivery/${d.id}` as Href,
      })),
      ...(trips.data?.rows ?? [])
        .filter((t) => t.status === 'created' || t.status === 'returning' || t.status === 'reconciled')
        .map((t) => ({
          key: t.id,
          icon: 'truck' as IconName,
          tone: 'warn' as TileTone,
          title: t.status === 'created' ? 'A trip is waiting for its load to be verified' : t.status === 'returning' ? 'A returned trip needs reconciling' : 'A reconciled trip needs settling into the till',
          sub: 'Driver trips',
          href: `/trips/${t.id}` as Href,
        })),
    ];

    const money: Alert[] =
      office && persona !== 'supervisor' && !till.isLoading && till.open === null
        ? [{ key: 'till', icon: 'cash', tone: 'warn', title: 'No till is open', sub: 'Open a cash session before taking cash', href: persona === 'cashier' ? '/my-cash' : '/cash' }]
        : [];

    return [
      { label: 'Orders & production', items: orders },
      { label: 'Stock', items: stock },
      { label: 'Deliveries & trips', items: field },
      { label: 'Cash', items: money },
    ].filter((g) => g.items.length > 0);
  }, [office, persona, submitted, toMake, ready, levels.data, labels, stockroom, deliveries.data, trips.data, till]);

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const loading = submitted.isLoading || toMake.isLoading || levels.isLoading;
  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <ScreenScroll
      title="Alerts"
      sub={loading ? undefined : total === 0 ? 'All clear' : `${total} need${total === 1 ? 's' : ''} attention`}
      onBack={onBack}
      refreshing={submitted.isRefetching}
      onRefresh={() => {
        void submitted.refetch();
        void toMake.refetch();
        void ready.refetch();
        void till.refetch();
        void deliveries.refetch();
        void trips.refetch();
        void levels.refetch();
      }}
    >
      {loading ? (
        <View className="mt-2 gap-2"><Skeleton variant="row" /><Skeleton variant="row" /></View>
      ) : groups.length === 0 ? (
        <EmptyState icon="checkCircle" title="Nothing needs you right now" text="Orders waiting, stock that runs out, failed deliveries and trips that need the bakery appear here." />
      ) : (
        groups.map((g) => (
          <View key={g.label}>
            <GroupLabel>{g.label}</GroupLabel>
            <List>
              {g.items.map((a) => (
                <ListRow key={a.key} leading={<IconTile icon={a.icon} tone={a.tone} size="sm" />} title={a.title} sub={a.sub} onPress={() => router.push(a.href)} />
              ))}
            </List>
          </View>
        ))
      )}
      {!loading && <Text variant="caption" className="mt-5 text-center">Pull down to check again.</Text>}
    </ScreenScroll>
  );
}
