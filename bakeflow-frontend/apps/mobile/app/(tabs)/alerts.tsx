import { getSupabaseClient } from '@bakeflow/auth';
import {
  useDeliveries,
  useDriverTrips,
  useMarkNotificationsRead,
  useMyNotifications,
  useProductStockLevels,
  useWarehouses,
} from '@bakeflow/hooks';
import { isNegativeDecimalString, isZeroDecimalString, type AppNotification, type NotificationKind } from '@bakeflow/types';
import {
  EmptyState,
  GroupLabel,
  Icon,
  IconButton,
  IconTile,
  List,
  ListRow,
  PressableScale,
  ScreenScroll,
  Skeleton,
  Text,
  type IconName,
  type TileTone,
} from '@bakeflow/ui';
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

/** How each notification kind presents: the prototype's groups, icons and tone strips. */
const KIND: Record<NotificationKind, { group: string; icon: IconName; tone: TileTone }> = {
  order_new: { group: 'Orders & production', icon: 'bag', tone: 'accent' },
  order_ready: { group: 'Orders & production', icon: 'box', tone: 'ok' },
  payment_received: { group: 'Payments & cash', icon: 'cash', tone: 'ok' },
  till_variance: { group: 'Payments & cash', icon: 'alert', tone: 'warn' },
  stock_out: { group: 'Inventory', icon: 'box', tone: 'bad' },
  invite_accepted: { group: 'Team & account', icon: 'user', tone: 'info' },
};
const GROUP_ORDER = ['Orders & production', 'Payments & cash', 'Inventory', 'Team & account'];
const STRIP: Record<string, string> = { accent: 'bg-apricot', ok: 'bg-success', warn: 'bg-warning', bad: 'bg-error', info: 'bg-info', neutral: 'bg-border' };

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** The prototype's notification row: a tone strip, tile, title and "time · detail", unread dot, chevron. */
function NotificationRow({ n, onOpen }: { n: AppNotification; onOpen: () => void }): React.JSX.Element {
  const k = KIND[n.kind];
  const unread = n.read_at === null;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${unread ? 'Unread. ' : ''}${n.title}. ${n.body ?? ''}`}
      onPress={onOpen}
      scaleTo={1}
      className="min-h-tap flex-row items-center gap-[13px] px-4 py-[13px] active:bg-cocoa/5"
    >
      <View className={`absolute bottom-0 left-0 top-0 w-[3px] ${STRIP[k.tone] ?? 'bg-border'}`} />
      <IconTile icon={k.icon} tone={k.tone} size="sm" />
      <View className="min-w-0 flex-1">
        <Text variant="body" className={unread ? 'font-semibold' : 'font-medium'}>{n.title}</Text>
        <Text variant="meta" numberOfLines={2}>{[ago(n.created_at), n.body].filter(Boolean).join(' · ')}</Text>
      </View>
      {unread && <View className="h-2 w-2 rounded-full bg-apricot" />}
      {n.route !== null && <Icon name="chevRight" size={17} color="textMuted" />}
    </PressableScale>
  );
}

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
 * Above the to-do list is the prototype's notification history (P9.9 Q5): events written by the
 * database for this person — new orders, orders ready, payments received, stock running out, invites
 * accepted, tills closing short or over — grouped, with unread dots and "mark all read" (✓ in the
 * header). Tapping one marks it read and opens its screen. The same events are pushed to phones.
 *
 * PORT-NOTE: the prototype's insight, invoice and sign-in events have no source and are not shown.
 * The live "needs attention" list is kept below the history — it covers states the history cannot
 * (a failed delivery, no till open) and was already the app's Alerts screen.
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
  const history = useMyNotifications(client, tenantId);
  const markRead = useMarkNotificationsRead(client, tenantId);
  const unread = (history.data ?? []).filter((n) => n.read_at === null).length;
  const historyGroups = useMemo(() => {
    const by = new Map<string, AppNotification[]>();
    for (const n of history.data ?? []) {
      const g = KIND[n.kind].group;
      by.set(g, [...(by.get(g) ?? []), n]);
    }
    return GROUP_ORDER.filter((g) => by.has(g)).map((g) => ({ label: g, items: by.get(g) ?? [] }));
  }, [history.data]);

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
      title="Notifications"
      sub={history.isLoading ? undefined : unread > 0 ? `${unread} unread` : total === 0 ? 'All clear' : `${total} need${total === 1 ? 's' : ''} attention`}
      onBack={onBack}
      right={unread > 0 ? <IconButton icon="check" label="Mark all as read" onPress={() => markRead.mutate({})} /> : undefined}
      refreshing={submitted.isRefetching || history.isRefetching}
      onRefresh={() => {
        void history.refetch();
        void submitted.refetch();
        void toMake.refetch();
        void ready.refetch();
        void till.refetch();
        void deliveries.refetch();
        void trips.refetch();
        void levels.refetch();
      }}
    >
      {historyGroups.map((g) => (
        <View key={g.label}>
          <GroupLabel>{g.label}</GroupLabel>
          <List>
            {g.items.map((n) => (
              <NotificationRow
                key={n.id}
                n={n}
                onOpen={() => {
                  if (n.read_at === null) markRead.mutate({ ids: [n.id] });
                  if (n.route !== null) router.push(n.route as Href);
                }}
              />
            ))}
          </List>
        </View>
      ))}
      {historyGroups.length > 0 && groups.length > 0 && <GroupLabel>Needs attention</GroupLabel>}
      {loading ? (
        <View className="mt-2 gap-2"><Skeleton variant="row" /><Skeleton variant="row" /></View>
      ) : groups.length === 0 ? (
        historyGroups.length > 0 ? null : 
        <EmptyState icon="checkCircle" title="Nothing needs you right now" text="New orders, payments, stock that runs out, failed deliveries and trips that need the bakery appear here." />
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
