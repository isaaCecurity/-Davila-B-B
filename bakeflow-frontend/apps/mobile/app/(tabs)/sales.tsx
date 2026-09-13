import { isZeroDecimalString } from '@bakeflow/types';
import {
  Button,
  Card,
  Chips,
  CountUp,
  Icon,
  ScreenScroll,
  Skeleton,
  Text,
  TrendChart,
} from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { EmptyState, ErrorState, NoOrganizationState } from '../../components/ScreenState';
import { useBranchOptions } from '../../features/branch/hooks/useBranchOptions';
import { useRevenueWeek } from '../../features/reports/hooks/useRevenueWeek';
import { OrderCard } from '../../features/tickets/components/OrderCard';
import { useOrderRows } from '../../features/tickets/hooks/useOrderRows';
import { TODAY_FILTER } from '../../features/tickets/ticketDisplay';
import { useSessionStore } from '../../stores/session';
import { useOffBarBack } from '../../navigation/useOffBarBack';

function Stat({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <View className="min-w-0 flex-1">
      <Text tabular className="text-callout font-semibold text-white" numberOfLines={1}>{value}</Text>
      <Text className="mt-0.5 text-caption text-white/50" numberOfLines={1}>{label}</Text>
    </View>
  );
}

/**
 * Sales — the prototype's owner `sales` tab: today's take, the week's shape, and what sold.
 *
 * Every money figure is the server's `get_daily_revenue_summary()` output, formatted from its
 * exact string. The week chart positions its line from those same values (see `TrendChart`)
 * but never displays or adds them.
 *
 * PORT-NOTE: the prototype's delta chip ("+12.4% vs last week"), average ticket, per-method
 * split and the grouped payment transaction feed all need either money arithmetic or a
 * payments read that does not exist. In their place: revenue vs collected vs refunds (all
 * server-computed) and today's actual orders.
 */
export default function SalesScreen(): React.JSX.Element {
  const router = useRouter();
  const onBack = useOffBarBack('sales');
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const branches = useBranchOptions();
  const [branchIndex, setBranchIndex] = useState(0);
  const branch = branches.options[branchIndex] ?? branches.options[0] ?? null;

  const week = useRevenueWeek(branch?.branchId ?? null);
  const todayFilters = useMemo(() => TODAY_FILTER.filters(), []);
  const orders = useOrderRows(branch === null ? todayFilters : { ...todayFilters, branchId: branch.branchId });

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const today = week.today?.data;
  const points = week.days.map((d) => ({
    value: d.summary === undefined ? 0 : Number(d.summary.net_revenue),
    label: d.label,
  }));
  // Judged on the exact strings, not the plot numbers.
  const quietWeek =
    !week.isLoading && week.days.every((d) => d.summary !== undefined && isZeroDecimalString(d.summary.net_revenue));

  return (
    <ScreenScroll
      title="Sales"
      onBack={onBack}
      sub={branch !== null ? `${branch.label} · today` : 'Today'}
      refreshing={week.isRefetching || orders.isRefetching}
      onRefresh={() => {
        week.refetch();
        void orders.refetch();
      }}
    >
      {branches.isLoading ? (
        <Skeleton variant="chart" className="mt-5 h-[260px]" />
      ) : branch === null ? (
        <EmptyState title="No branch available" detail="A branch needs a stockroom before it has sales reports." />
      ) : (
        <>
          {branches.options.length > 1 && (
            <Chips
              className="mt-2"
              accessibilityLabel="Branch"
              options={branches.options.map((b, i) => ({ key: String(i), label: b.label }))}
              value={String(branchIndex)}
              onChange={(k) => setBranchIndex(Number(k))}
            />
          )}

          {week.isError ? (
            <View className="mt-5">
              <ErrorState error={week.error ?? new Error('Could not load sales.')} onRetry={week.refetch} />
            </View>
          ) : (
            <Card tone="ink" className="mt-5 overflow-hidden rounded-lg px-0 pb-4 pt-5">
              <View className="px-5">
                <Text className="text-caption font-semibold uppercase tracking-[1.2px] text-white/50">Sales today</Text>
                {today === undefined ? (
                  <Skeleton variant="figure" className="mt-2 w-44 bg-white/10" />
                ) : (
                  <CountUp to={Number(today.net_revenue)} text={formatNaira(today.net_revenue)} className="mt-1.5 text-display font-bold tracking-[-1.2px] text-white" />
                )}
                <Text className="mt-1.5 text-foot text-white/60">
                  {today === undefined ? ' ' : `Collected ${formatNaira(today.net_collected)} · ${today.timezone}`}
                </Text>
              </View>

              <View className="mt-3">
                <TrendChart
                  points={points}
                  onDark
                  accessibilityLabel={`Net revenue over the last seven days at ${branch.label}`}
                />
                {quietWeek && (
                  <View pointerEvents="none" className="absolute left-0 right-0 top-8 items-center">
                    <Text className="text-foot text-white/45">No sales recorded in the last 7 days</Text>
                  </View>
                )}
              </View>

              {today !== undefined && (
                <View className="mx-5 mt-3 flex-row gap-5 border-t border-white/10 pt-3">
                  <Stat value={formatNaira(today.gross_revenue)} label="Gross revenue" />
                  <View className="w-px bg-white/10" />
                  <Stat value={formatNaira(today.gross_collected)} label="Collected" />
                  {!isZeroDecimalString(today.recognized_refunds) && (
                    <>
                      <View className="w-px bg-white/10" />
                      <Stat value={formatNaira(today.recognized_refunds)} label="Refunds" />
                    </>
                  )}
                </View>
              )}
            </Card>
          )}

          <View className="mt-8">
            <View className="mb-3 flex-row items-baseline">
              <Text variant="subtitle" accessibilityRole="header" className="flex-1">Today&apos;s orders</Text>
              {!orders.isLoading && (
                <Text variant="meta">{orders.rows.length}{orders.hasNextPage === true ? '+' : ''}</Text>
              )}
            </View>
            {orders.isLoading ? (
              <Skeleton variant="row" className="h-[132px]" />
            ) : orders.rows.length === 0 ? (
              <Card tone="recessed" className="items-center gap-2 p-6">
                <Icon name="receipt" size={22} color="textMuted" />
                <Text variant="meta" className="text-center">No orders yet today. Sales appear here as orders come in.</Text>
              </Card>
            ) : (
              <View className="gap-3">
                {orders.rows.slice(0, 5).map((row) => (
                  <OrderCard key={row.ticket.id} row={row} onPress={() => router.push(`/order/${row.ticket.id}`)} />
                ))}
                <Button label="See all orders" tone="secondary" onPress={() => router.push('/orders')} block />
              </View>
            )}
          </View>
        </>
      )}
    </ScreenScroll>
  );
}
