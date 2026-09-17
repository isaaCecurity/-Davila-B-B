import { getSupabaseClient } from '@bakeflow/auth';
import { useBranchPerformance } from '@bakeflow/hooks';
import { isNegativeDecimalString } from '@bakeflow/types';
import { Card, CountUp, EmptyState, IconTile, ScreenScroll, Skeleton, Sparkline, Text } from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { ErrorState, NoOrganizationState } from '../../components/ScreenState';
import { useSessionStore } from '../../stores/session';

/**
 * Branch performance — the prototype's `report-branches`: today's revenue across branches, then one
 * card per branch with orders, staff, revenue, its share of the day, a 7-day sparkline and a bar
 * against the leading branch.
 *
 * `get_branch_performance()` (P9.9 Q3; owner decision 2026-09-17): owners and admins see every branch,
 * a branch manager only the branches they manage. Shares and totals are computed server-side; the
 * sparkline and bar widths are display proportions only.
 *
 * PORT-NOTE: the prototype's delta chips ("+12.4%") and its insight card compare against an earlier
 * period and would need arithmetic on money here — omitted. "You are here" marks the primary branch,
 * since a person is not tied to one branch.
 */
export default function BranchPerformanceScreen(): React.JSX.Element {
  const router = useRouter();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const report = useBranchPerformance(getSupabaseClient(), tenantId, 'today');

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const data = report.data;
  const rows = data?.branches ?? [];
  const leader = rows.reduce((max, b) => Math.max(max, Number(b.net_revenue)), 0);

  return (
    <ScreenScroll
      title="Branch performance"
      sub={data === undefined ? undefined : `Today · ${data.scope === 'all' ? 'all branches' : 'your branches'}`}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/reports'))}
      refreshing={report.isRefetching}
      onRefresh={() => void report.refetch()}
    >
      {report.isError ? (
        <View className="mt-4">
          <ErrorState error={report.error} onRetry={() => void report.refetch()} />
        </View>
      ) : data === undefined ? (
        <View className="mt-4 gap-3">
          <Skeleton variant="chart" className="h-[140px]" />
          <Skeleton variant="chart" className="h-[150px]" />
        </View>
      ) : rows.length === 0 ? (
        <EmptyState icon="store" title="No branches to compare" text="Branches you manage appear here." />
      ) : (
        <>
          <Card tone="ink" className="mt-2 rounded-lg px-5 pb-5 pt-5">
            <Text className="text-caption font-semibold uppercase tracking-[1.2px] text-white/50">Revenue today</Text>
            <CountUp
              to={Number(data.totals.net_revenue)}
              text={formatNaira(data.totals.net_revenue)}
              className="mt-1.5 text-display font-bold tracking-[-1.2px] text-white"
            />
            <Text className="mt-1.5 text-foot text-white/60">
              Across {data.totals.branch_count} {data.totals.branch_count === 1 ? 'branch' : 'branches'} · {data.totals.completed_tickets}{' '}
              {data.totals.completed_tickets === 1 ? 'order' : 'orders'}
            </Text>
          </Card>

          <View className="mt-5 gap-3">
            {rows.map((b) => {
              const down = isNegativeDecimalString(b.net_revenue);
              return (
                <Card
                  key={b.branch_id}
                  className={`px-4 py-4 ${b.is_primary && rows.length > 1 ? 'border-[1.5px] border-apricot' : ''}`}
                >
                  <View className="flex-row items-start gap-3">
                    <IconTile icon="store" tone={b.is_primary ? 'accent' : 'neutral'} />
                    <View className="min-w-0 flex-1">
                      <Text className="text-callout font-semibold text-cocoa" numberOfLines={1}>
                        {b.name}
                        {b.is_primary && rows.length > 1 ? ' · main branch' : ''}
                      </Text>
                      <Text variant="meta">
                        {b.completed_tickets} {b.completed_tickets === 1 ? 'order' : 'orders'} · {b.staff_count} staff
                      </Text>
                    </View>
                  </View>
                  <View className="mt-4 flex-row items-end">
                    <View className="min-w-0 flex-1">
                      <Text tabular className="text-title-2 font-semibold tracking-[-0.5px] text-cocoa" numberOfLines={1}>
                        {formatNaira(b.net_revenue)}
                      </Text>
                      <Text variant="meta" className="mt-0.5">{b.share_pct}% of today&apos;s revenue</Text>
                    </View>
                    <Sparkline
                      values={b.trend.map((t) => Number(t.net_revenue))}
                      color={down ? 'error' : 'success'}
                      accessibilityLabel={`${b.name}, net revenue over the last 7 days`}
                    />
                  </View>
                  <View className="mt-3 h-1 overflow-hidden rounded-[3px] bg-cream-deep">
                    <View
                      className={`h-1 rounded-[3px] ${down ? 'bg-warning' : 'bg-cocoa'}`}
                      style={{ width: `${leader > 0 ? Math.max(2, Math.round((Math.max(Number(b.net_revenue), 0) / leader) * 100)) : 0}%` }}
                    />
                  </View>
                </Card>
              );
            })}
          </View>
        </>
      )}
    </ScreenScroll>
  );
}
