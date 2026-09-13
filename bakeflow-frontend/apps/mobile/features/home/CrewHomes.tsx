import { getSupabaseClient } from '@bakeflow/auth';
import { useCurrentDriverTrip } from '@bakeflow/hooks';
import { Badge, Button, Card, Icon, IconTile, List, ListRow, Menu, MenuItem, PressableScale, Skeleton, Text } from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { useSessionStore } from '../../stores/session';
import { useBranchOptions } from '../branch/hooks/useBranchOptions';
import { DELIVERY_META } from '../delivery/deliveryDisplay';
import { useDeliveryBoard } from '../delivery/hooks/useDeliveryBoard';
import { TRIP_STAGE, tripTime } from '../driverTrip/tripDisplay';
import { useRevenueWeek } from '../reports/hooks/useRevenueWeek';
import { STATUS_META, startOfToday, ticketTime } from '../tickets/ticketDisplay';
import { HomeScaffold, SectionHead } from './components/HomeParts';
import { useTicketCount } from './hooks/useHomeData';

/**
 * Cashier home — the prototype's `HOME.staff`: task-led, no financial complexity they do not
 * need. Today's branch sales, the one action, and their recent tickets.
 *
 * PORT-NOTE: "Record sale" (the one-tap counter sale) waits on BLOCKER-030; "New customer order"
 * is the working path. The hero is the branch's net revenue from the server — the prototype's
 * "my sales" total is a sum, so the cashier's own count sits beneath it.
 */
export function CashierHome(): React.JSX.Element {
  const router = useRouter();
  const userId = useSessionStore((s) => s.userId);
  const branches = useBranchOptions();
  const branch = branches.options[0] ?? null;
  const week = useRevenueWeek(branch?.branchId ?? null);
  const mine = useTicketCount({ since: startOfToday(), ...(userId === null ? {} : { createdBy: userId }) });
  const today = week.today?.data;

  return (
    <HomeScaffold context={branch?.label} refreshing={mine.isRefetching} onRefresh={() => { week.refetch(); void mine.refetch(); }}>
      <Card tone="ink" className="mt-2 rounded-lg p-5">
        <Text className="text-caption font-semibold uppercase tracking-[1.2px] text-white/60">Today&apos;s sales</Text>
        {today === undefined ? (
          <Skeleton variant="figure" className="mt-2 w-40 bg-white/10" />
        ) : (
          <Text tabular className="mt-1.5 text-display font-bold tracking-[-1.2px] text-white">{formatNaira(today.net_revenue)}</Text>
        )}
        <Text className="mt-1 text-foot text-white/55">
          {branch?.label ?? 'Branch'} · {mine.label} ticket{mine.count === 1 ? '' : 's'} by you
        </Text>
      </Card>

      <View className="mt-6 gap-3">
        <Button label="New customer order" onPress={() => router.push('/new-order')} block />
        <Button label="Cash session" tone="secondary" onPress={() => router.push('/my-cash')} block />
      </View>

      <SectionHead title="Recent sales" link={{ label: 'All', href: '/my-sales' }} />
      {mine.isLoading ? (
        <Skeleton variant="row" />
      ) : mine.rows.length === 0 ? (
        <Card tone="recessed" className="items-center gap-2 p-6">
          <Icon name="receipt" size={22} color="textMuted" />
          <Text variant="meta" className="text-center">No sales yet today.</Text>
        </Card>
      ) : (
        <List>
          {mine.rows.slice(0, 5).map((t) => (
            <ListRow
              key={t.id}
              leading={<IconTile icon="receipt" size="sm" />}
              title={t.ticket_number}
              sub={`${STATUS_META[t.status].label} · ${ticketTime(t.created_at)}`}
              end={formatNaira(t.total_amount)}
              onPress={() => router.push(`/order/${t.id}`)}
            />
          ))}
        </List>
      )}
    </HomeScaffold>
  );
}

/**
 * Baker home — the prototype's `HOME.baker`: open, see today, act, done.
 *
 * PORT-NOTE: "units recorded · batches" counts production records, which are out of MVP scope
 * (AD-022). The hero counts orders to make, and the one action opens the production queue.
 */
export function BakerHome(): React.JSX.Element {
  const router = useRouter();
  const branches = useBranchOptions();
  const branch = branches.options[0] ?? null;
  const scope = branch === null ? {} : { branchId: branch.branchId };
  const toMake = useTicketCount({ statuses: ['scheduled', 'in_production'], ...scope });
  const ready = useTicketCount({ status: 'ready', ...scope });

  return (
    <HomeScaffold context={branch?.label} refreshing={toMake.isRefetching} onRefresh={() => { void toMake.refetch(); void ready.refetch(); }}>
      <Card tone="ink" className="mt-2 rounded-lg p-5">
        <Text className="text-caption font-semibold uppercase tracking-[1.2px] text-white/60">Today&apos;s production</Text>
        <Text tabular className="mt-1.5 text-display font-bold tracking-[-1.2px] text-white">{toMake.label}</Text>
        <Text className="mt-1 text-foot text-white/55">orders to make · {ready.label} ready</Text>
      </Card>
      <Button className="mt-6" label="Open production queue" onPress={() => router.push('/production')} block />
      <Button className="mt-3" label="Record waste" tone="secondary" onPress={() => router.push('/inventory')} block />
    </HomeScaffold>
  );
}

/**
 * Driver home — the prototype's `HOME.driver`: the trip, one enormous action, the route.
 *
 * PORT-NOTE: "held by you" and stop amounts are money; offline queueing is P10. The route
 * timeline shows each stop's status from `deliveries`.
 */
export function DriverHome(): React.JSX.Element {
  const router = useRouter();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const userId = useSessionStore((s) => s.userId);
  const trip = useCurrentDriverTrip(getSupabaseClient(), tenantId, userId);
  const board = useDeliveryBoard(userId === null ? {} : { driverId: userId });
  const tickets = useTicketCount({ since: startOfToday(), ...(userId === null ? {} : { createdBy: userId }) });
  const current = trip.data ?? null;
  const needsAction = current === null || ['created', 'ready_to_depart', 'returning', 'reconciled'].includes(current.status);
  const stops = useMemo(() => [...board.rows].sort((a, b) => a.delivery.created_at.localeCompare(b.delivery.created_at)), [board.rows]);

  return (
    <HomeScaffold
      context={`${stops.length} stop${stops.length === 1 ? '' : 's'} today`}
      refreshing={board.isRefetching || trip.isRefetching}
      onRefresh={() => {
        board.refetch();
        void trip.refetch();
        void tickets.refetch();
      }}
    >
      <PressableScale
        accessibilityRole="button"
        onPress={() => router.push('/trip')}
        scaleTo={0.98}
        className={`mt-2 flex-row items-center gap-3 rounded-md bg-white p-4 shadow-e2 ${needsAction ? 'border-[1.5px] border-apricot' : ''}`}
      >
        <IconTile icon={current === null ? 'truck' : TRIP_STAGE[current.status].icon} tone={current === null ? 'accent' : TRIP_STAGE[current.status].tile} />
        <View className="min-w-0 flex-1">
          <Text className="text-callout font-semibold text-cocoa">Trip · {current === null ? 'Not started' : TRIP_STAGE[current.status].label}</Text>
          <Text variant="meta">
            {current?.status === 'in_transit' ? `On the road since ${tripTime(current.departed_at) ?? ''}` : needsAction ? 'Tap to continue' : 'Waiting on the bakery'}
          </Text>
        </View>
        <Icon name="chevRight" size={18} color="textMuted" />
      </PressableScale>

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Create ticket"
        onPress={() => router.push('/driver/sell')}
        scaleTo={0.98}
        className="mt-3 flex-row items-center gap-3.5 rounded-lg bg-ink px-5 py-4 shadow-e2"
      >
        <View className="h-12 w-12 items-center justify-center rounded-[15px] bg-apricot">
          <Icon name="plus" size={26} color="white" />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-title-3 font-bold text-white">Create ticket</Text>
          <Text className="text-foot text-white/70">Products and payment</Text>
        </View>
        <Icon name="arrowRight" size={20} color="white" />
      </PressableScale>

      <SectionHead title="Your route" link={{ label: 'Stops', href: '/route' }} />
      {board.isLoading ? (
        <Skeleton variant="row" className="h-[120px]" />
      ) : stops.length === 0 ? (
        <Text variant="meta">No stops assigned yet.</Text>
      ) : (
        <Card className="px-4 py-3">
          {stops.slice(0, 6).map((r, i) => {
            const meta = DELIVERY_META[r.delivery.status];
            const done = r.delivery.status === 'delivered' || r.delivery.status === 'returned';
            return (
              <View key={r.delivery.id} className="flex-row gap-3">
                <View className="items-center">
                  <View className={`mt-1 h-3 w-3 rounded-full ${done ? 'bg-success' : r.delivery.status === 'in_transit' ? 'bg-apricot' : r.delivery.status === 'failed' ? 'bg-error' : 'bg-border'}`} />
                  {i < Math.min(stops.length, 6) - 1 && <View className="w-px flex-1 bg-border" />}
                </View>
                <View className="min-w-0 flex-1 pb-4">
                  <Text className="text-callout font-semibold text-cocoa" numberOfLines={1}>{r.customerName}</Text>
                  <Text variant="meta" numberOfLines={1}>{r.delivery.address_line}{r.itemLine === null ? '' : ` · ${r.itemLine}`}</Text>
                  <Badge className="mt-1.5 self-start" label={meta.label} tone={meta.tone} />
                </View>
              </View>
            );
          })}
        </Card>
      )}

      <SectionHead title="Tickets today" link={{ label: 'All', href: '/tickets' }} />
      <Card className="flex-row items-center gap-3 p-4">
        <IconTile icon="ticket" size="sm" />
        <Text variant="meta" className="flex-1">Created by you</Text>
        <Text tabular className="text-title-2 font-bold text-cocoa">{tickets.label}</Text>
      </Card>
    </HomeScaffold>
  );
}

/**
 * Admin home — the prototype's `HOME.admin`: an administration console, not a dashboard.
 *
 * PORT-NOTE: per `ROLES-AND-PERMISSIONS.md` organization/branch setup, staff CRUD, records
 * archiving, the audit log and system settings belong to the Web workspace. The mobile console
 * links what exists on mobile and says where the rest lives.
 */
export function AdminHome(): React.JSX.Element {
  const router = useRouter();
  return (
    <HomeScaffold context="Admin console">
      <Text variant="meta" className="mt-2">
        Organization-wide administration. Day-to-day monitoring lives with the owner and managers.
      </Text>
      <SectionHead title="Administration" />
      <Menu>
        <MenuItem icon="store" title="Organization" sub="Switch or review bakeries" onPress={() => router.push('/select-organization')} />
        <MenuItem icon="users" title="Staff & access" sub="Team, roles and invites" onPress={() => router.push('/staff')} />
        <MenuItem icon="mail" title="Invites" sub="Pending and accepted" onPress={() => router.push('/invites')} />
      </Menu>
      <Card tone="recessed" className="mt-4 p-4">
        <Text variant="meta">Branches, records archiving, the audit log and system settings are managed in the BakeFlow web workspace.</Text>
      </Card>
    </HomeScaffold>
  );
}
