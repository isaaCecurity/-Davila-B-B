import { Button, Card, Chips, CountUp, Icon, IconTile, List, ListRow, Skeleton, Text } from '@bakeflow/ui';
import { getSupabaseClient } from '@bakeflow/auth';
import { useDriverTrips } from '@bakeflow/hooks';
import { formatNaira } from '@bakeflow/utils';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { useSessionStore } from '../../stores/session';
import { useBranchOptions } from '../branch/hooks/useBranchOptions';
import { useRevenueWeek } from '../reports/hooks/useRevenueWeek';
import { OrderCard } from '../tickets/components/OrderCard';
import { useOrderRows } from '../tickets/hooks/useOrderRows';
import { HomeScaffold, QuickActions, SectionHead, StatTile, TileGrid } from './components/HomeParts';
import { useOpenTill } from './hooks/useHomeData';

const OPEN_STATUSES = ['submitted', 'confirmed', 'scheduled', 'in_production', 'ready'] as const;

function Dot({ tone, label }: { tone: string; label: string }): React.JSX.Element {
  return (
    <View className="flex-row items-center justify-end gap-[7px]">
      <View className={`h-2 w-2 rounded-full ${tone}`} />
      <Text className="text-foot text-white">{label}</Text>
    </View>
  );
}

/**
 * Manager home — the prototype's `HOME.manager`: what is open right now, what to pick up next,
 * the till and trips that need a manager.
 *
 * PORT-NOTE: "Needs a decision" insights and the daily financial audit (submit/confirm) have no
 * backend. The cash drawer tile shows whether a till is open rather than a computed difference;
 * "Low stock" needs reorder levels (AD-022) and becomes a link to Stock. "Out" deliveries are
 * counted on the Delivery board, not here.
 */
export function ManagerHome(): React.JSX.Element {
  const router = useRouter();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const branches = useBranchOptions();
  const [branchIndex, setBranchIndex] = useState(0);
  const branch = branches.options[branchIndex] ?? branches.options[0] ?? null;

  const filters = useMemo(() => ({ statuses: [...OPEN_STATUSES], ...(branch === null ? {} : { branchId: branch.branchId }) }), [branch]);
  const open = useOrderRows(filters);
  const week = useRevenueWeek(branch?.branchId ?? null);
  const till = useOpenTill(branch?.branchId);
  const trips = useDriverTrips(getSupabaseClient(), tenantId, { activeOnly: true, ...(branch === null ? {} : { branchId: branch.branchId }) });

  const pending = open.rows.filter((r) => r.ticket.status === 'submitted').length;
  const ready = open.rows.filter((r) => r.ticket.status === 'ready').length;
  const inKitchen = open.rows.filter((r) => r.ticket.status === 'in_production').length;
  const tripsWaiting = (trips.data?.rows ?? []).filter((t) => t.status === 'created' || t.status === 'returning' || t.status === 'reconciled').length;
  const today = week.today?.data;
  const nextUp = [...open.rows].sort((a, b) => (a.ticket.due_at ?? '9999').localeCompare(b.ticket.due_at ?? '9999')).slice(0, 3);

  return (
    <HomeScaffold
      context={branch?.label}
      refreshing={open.isRefetching}
      onRefresh={() => {
        void open.refetch();
        week.refetch();
        void till.refetch();
        void trips.refetch();
      }}
    >
      {branches.options.length > 1 && (
        <Chips
          className="mt-2"
          accessibilityLabel="Branch"
          options={branches.options.map((b, i) => ({ key: String(i), label: b.label }))}
          value={String(branchIndex)}
          onChange={(k) => setBranchIndex(Number(k))}
        />
      )}

      <Card tone="ink" className="mt-4 rounded-lg p-5" accessibilityLabel="Open work right now">
        <View className="flex-row items-start">
          <View className="flex-1">
            <Text className="text-caption font-semibold uppercase tracking-[1.2px] text-white/50">Open right now</Text>
            {open.isLoading ? (
              <Skeleton variant="figure" className="mt-2 w-16 bg-white/10" />
            ) : (
              <CountUp format="integer" to={open.rows.length} text={`${open.rows.length}${open.hasNextPage === true ? '+' : ''}`} className="mt-1.5 text-display font-bold tracking-[-1.2px] text-white" />
            )}
            <Text className="mt-1 text-foot text-white/60">orders across {branch?.label ?? 'the bakery'}</Text>
          </View>
          <View className="gap-1.5 pt-1">
            <Dot tone="bg-warning" label={`${pending} pending`} />
            <Dot tone="bg-apricot" label={`${inKitchen} preparing`} />
            <Dot tone="bg-success" label={`${ready} ready`} />
          </View>
        </View>
        <Button className="mt-4" label="Work the queue" onPress={() => router.push('/orders')} block />
      </Card>

      <SectionHead title="Next up" link={{ label: 'All orders', href: '/orders' }} />
      {open.isLoading ? (
        <Skeleton variant="row" className="h-[132px]" />
      ) : nextUp.length === 0 ? (
        <Card tone="recessed" className="items-center gap-2 p-6">
          <Icon name="checkCircle" size={22} color="textMuted" />
          <Text variant="meta" className="text-center">Nothing open. New orders appear here as they come in.</Text>
        </Card>
      ) : (
        <View className="gap-3">
          {nextUp.map((row) => (
            <OrderCard key={row.ticket.id} row={row} onPress={() => router.push(`/order/${row.ticket.id}`)} />
          ))}
        </View>
      )}

      <QuickActions
        actions={[
          { label: 'New order', icon: 'plus', tone: 'ink', href: '/new-order' },
          { label: 'Add expense', icon: 'receipt', tone: 'accent', href: '/add-expense' },
          { label: 'Cash session', icon: 'cash', tone: 'ok', href: '/cash' },
        ]}
      />

      <View className="mt-8">
        <TileGrid>
          <StatTile index={0} icon="sales" label="Sales today" value={today === undefined ? '—' : formatNaira(today.net_revenue)} sub="Net revenue" href="/sales" />
          <StatTile index={1} icon="cash" label="Cash drawer" value={till.isLoading ? '—' : till.open === null ? 'Closed' : 'Open'} sub={till.open === null ? 'Open a till to take cash' : 'Till is running'} attention={!till.isLoading && till.open === null} href="/cash" />
        </TileGrid>
      </View>

      <SectionHead title="Driver trips" />
      <List>
        <ListRow
          leading={<IconTile icon="truck" tone={tripsWaiting > 0 ? 'warn' : 'neutral'} size="sm" />}
          title={tripsWaiting > 0 ? `${tripsWaiting} trip${tripsWaiting === 1 ? '' : 's'} waiting on the bakery` : 'No trip needs you'}
          sub="Verify loading and reconcile trips"
          onPress={() => router.push('/trips')}
        />
        <ListRow leading={<IconTile icon="layers" size="sm" />} title="Stock" sub="Out of stock and below zero" onPress={() => router.push('/inventory')} />
      </List>
    </HomeScaffold>
  );
}
