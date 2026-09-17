import { Card, Chips, CountUp, IconTile, List, ListRow, Skeleton, Text, TrendChart } from '@bakeflow/ui';
import { isZeroDecimalString } from '@bakeflow/types';
import { formatNaira } from '@bakeflow/utils';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { useBranchOptions } from '../branch/hooks/useBranchOptions';
import { useRevenueWeek } from '../reports/hooks/useRevenueWeek';
import { ORDER_FILTERS, TODAY_FILTER } from '../tickets/ticketDisplay';
import { HomeScaffold, QuickActions, SectionHead, StatTile, TileGrid } from './components/HomeParts';
import { useOpenTill, useTicketCount } from './hooks/useHomeData';

function FootStat({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <View className="min-w-0 flex-1">
      <Text tabular className="text-callout font-semibold text-white" numberOfLines={1}>{value}</Text>
      <Text className="mt-0.5 text-caption text-white/50" numberOfLines={1}>{label}</Text>
    </View>
  );
}

/**
 * Owner home — the prototype's `HOME.owner`: today's money with the week behind it, the orders
 * that need attention, and a way into each branch.
 *
 * PORT-NOTE: "Where today's money went" (cost of goods, running costs, profit, margin) is out of
 * MVP scope (AD-022); expenses, net today and the yesterday delta are money arithmetic; "Worth
 * knowing" insights have no source. The hero is the server's net revenue with collected and
 * refunds beside it, and the branch bars become a list that switches the figures to that branch.
 */
export function OwnerHome(): React.JSX.Element {
  const branches = useBranchOptions();
  const [branchIndex, setBranchIndex] = useState(0);
  const branch = branches.options[branchIndex] ?? branches.options[0] ?? null;
  const week = useRevenueWeek(branch?.branchId ?? null);
  const today = week.today?.data;

  const todayFilters = useMemo(() => ({ ...TODAY_FILTER.filters(), ...(branch === null ? {} : { branchId: branch.branchId }) }), [branch]);
  const pendingFilters = useMemo(
    () => ({ ...(ORDER_FILTERS.find((f) => f.key === 'pending')?.filters() ?? {}), ...(branch === null ? {} : { branchId: branch.branchId }) }),
    [branch]
  );
  const ordersToday = useTicketCount(todayFilters);
  const completedToday = ordersToday.rows.filter((t) => t.status === 'completed').length;
  const pending = useTicketCount(pendingFilters);
  const till = useOpenTill(branch?.branchId);

  const points = week.days.map((d) => ({ value: d.summary === undefined ? 0 : Number(d.summary.net_revenue), label: d.label }));

  return (
    <HomeScaffold
      context={branch?.label}
      refreshing={week.isRefetching || ordersToday.isRefetching}
      onRefresh={() => {
        week.refetch();
        void ordersToday.refetch();
        void pending.refetch();
        void till.refetch();
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

      <Card tone="ink" className="mt-4 overflow-hidden rounded-lg px-0 pb-4 pt-5" accessibilityLabel="Today's revenue">
        <View className="px-5">
          <Text className="text-caption font-semibold uppercase tracking-[1.2px] text-white/50">Revenue today</Text>
          {today === undefined ? (
            <Skeleton variant="figure" className="mt-2 w-44 bg-white/10" />
          ) : (
            <CountUp to={Number(today.net_revenue)} text={formatNaira(today.net_revenue)} className="mt-1.5 text-display font-bold tracking-[-1.2px] text-white" />
          )}
          <Text className="mt-1.5 text-foot text-white/60">{today === undefined ? ' ' : `Net of refunds · ${today.timezone}`}</Text>
        </View>
        <View className="mt-3">
          <TrendChart points={points} onDark accessibilityLabel="Revenue across the last seven days" />
        </View>
        {today !== undefined && (
          <View className="mx-5 mt-3 flex-row gap-4 border-t border-white/10 pt-3">
            <FootStat value={formatNaira(today.net_collected)} label="Collected" />
            <View className="w-px bg-white/10" />
            <FootStat value={isZeroDecimalString(today.refunds_paid) ? '—' : formatNaira(today.refunds_paid)} label="Refunds paid" />
            <View className="w-px bg-white/10" />
            <FootStat value={till.isLoading ? '—' : till.open === null ? 'Closed' : 'Open'} label="Till" />
          </View>
        )}
      </Card>

      <SectionHead title="Your bakery today" link={{ label: 'Orders', href: '/orders' }} />
      <TileGrid>
        <StatTile index={0} icon="orders" label="Orders" value={ordersToday.label} sub={ordersToday.isLoading ? undefined : `${completedToday} completed`} href="/orders" />
        <StatTile index={1} icon="clock" label="Needs attention" value={pending.label} sub="Not yet ready" attention={pending.count > 0} href="/orders" />
        <StatTile index={2} icon="cash" label="Cash session" value={till.isLoading ? '—' : till.open === null ? 'Closed' : 'Open'} sub={till.open === null ? 'No till open' : 'Till is running'} href="/cash" />
        <StatTile index={3} icon="layers" label="Stock" value="Check" sub="Out and below zero" href="/inventory" />
      </TileGrid>

      <QuickActions
        actions={[
          { label: 'New order', icon: 'plus', tone: 'ink', href: '/new-order' },
          { label: 'Add expense', icon: 'receipt', tone: 'accent', href: '/add-expense' },
          { label: 'Reports', icon: 'chart', tone: 'plain', href: '/reports' },
        ]}
      />

      {branches.options.length > 1 && (
        <>
          <SectionHead title="Branches" link={{ label: 'Compare', href: '/reports/branches' }} />
          <List>
            {branches.options.map((b, i) => (
              <ListRow
                key={b.branchId}
                leading={<IconTile icon="store" tone={i === branchIndex ? 'accent' : 'neutral'} size="sm" />}
                title={b.label}
                sub={i === branchIndex ? 'Showing above' : 'Tap to show above'}
                chevron={false}
                onPress={() => setBranchIndex(i)}
              />
            ))}
          </List>
        </>
      )}
      {branches.options.length <= 1 && (
        <Text variant="caption" className="mt-6">
          Profit, cost of goods and margin arrive in a later version — revenue and cash are live.
        </Text>
      )}
    </HomeScaffold>
  );
}
