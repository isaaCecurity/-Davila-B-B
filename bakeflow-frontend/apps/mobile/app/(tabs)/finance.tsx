import { getSupabaseClient } from '@bakeflow/auth';
import { useCashSessions, useExpenses } from '@bakeflow/hooks';
import { isZeroDecimalString } from '@bakeflow/types';
import {
  Badge,
  Callout,
  Card,
  Chips,
  Icon,
  IconButton,
  IconTile,
  List,
  ListRow,
  PressableScale,
  ScreenScroll,
  Skeleton,
  Text,
  TrendChart,
  type BadgeTone,
  type IconName,
} from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import { useRouter, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { EmptyState, ErrorState, NoOrganizationState } from '../../components/ScreenState';
import { useBranchOptions } from '../../features/branch/hooks/useBranchOptions';
import { CATEGORY_META, METHOD_LABEL, varianceView, when } from '../../features/finance/financeDisplay';
import { useRevenueWeek } from '../../features/reports/hooks/useRevenueWeek';
import { useSessionStore } from '../../stores/session';

const clock = new Intl.DateTimeFormat('en-NG', { hour: 'numeric', minute: '2-digit' });

function FootStat({ value, label }: { value: string; label: string }): React.JSX.Element {
  return (
    <View className="min-w-0 flex-1">
      <Text tabular className="text-callout font-semibold text-white" numberOfLines={1}>{value}</Text>
      <Text className="mt-0.5 text-caption text-white/50" numberOfLines={1}>{label}</Text>
    </View>
  );
}

/** The prototype's `.stat` drill-in tile. */
function DrillTile({
  icon,
  label,
  value,
  sub,
  badge,
  href,
}: {
  icon: IconName;
  label: string;
  value: string;
  sub?: string;
  badge?: { label: string; tone: BadgeTone };
  href: Href;
}): React.JSX.Element {
  const router = useRouter();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={[label, value, badge?.label, sub].filter(Boolean).join(', ')}
      onPress={() => router.push(href)}
      scaleTo={0.97}
      className="w-[48.5%] rounded-md bg-white p-4 shadow-e2"
    >
      <View className="flex-row items-center gap-2">
        <View className="h-7 w-7 items-center justify-center rounded-[9px] bg-cream-deep">
          <Icon name={icon} size={15} color="cocoa" />
        </View>
        <Text variant="meta" numberOfLines={1} className="flex-1">{label}</Text>
      </View>
      <Text tabular className="mt-3 text-title-3 font-bold tracking-[-0.4px] text-cocoa" numberOfLines={1}>
        {value}
      </Text>
      {badge !== undefined ? (
        <Badge label={badge.label} tone={badge.tone} className="mt-2 self-start" />
      ) : (
        <Text variant="caption" numberOfLines={1} className="mt-1">{sub ?? ' '}</Text>
      )}
    </PressableScale>
  );
}

/**
 * Finance — the prototype's owner `finance` tab: the money that came in, where it went, and a
 * way into each ledger.
 *
 * Every figure is an exact string from the server: today's summary from
 * `get_daily_revenue_summary()`, the till state from `cash_sessions`, and individual expenses.
 * Nothing is added, subtracted or divided on the device.
 *
 * The record-payment, open/close-till and add-expense forms this tab used to carry now live
 * where the prototype puts them: payment on the order, the till on Cash sessions, and Add
 * expense.
 *
 * PORT-NOTE: the prototype's hero is net profit with a margin, a "how revenue divides" flow bar
 * (cost of goods fixed at 40% of revenue), a gross-margin tile, an expense donut and period
 * totals. Profit and margin need cost of goods, which is blocked on ingredient costs
 * (BLOCKER-018: `stock_movements.unit_cost` is empty live); the fixed ratios are invented; and
 * period and category totals are sums over money that belong to a server report. So the hero is
 * money collected today, the chart is the server's net revenue by day, and expense composition
 * becomes the latest expenses themselves. The 7/30/90-day switch waits for a ranged report —
 * the daily summary is the only aggregate endpoint.
 */
export default function FinanceScreen(): React.JSX.Element {
  const router = useRouter();
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const branches = useBranchOptions();
  const [branchIndex, setBranchIndex] = useState(0);
  const branch = branches.options[branchIndex] ?? branches.options[0] ?? null;

  const week = useRevenueWeek(branch?.branchId ?? null);
  const sessions = useCashSessions(client, tenantId, branch?.branchId);
  const expenses = useExpenses(client, tenantId, branch?.branchId);

  const cash = useMemo(() => {
    // ISO-8601 timestamps order correctly as strings; this sorts by time, not by money.
    const rows = [...(sessions.data ?? [])].sort((a, b) => b.opened_at.localeCompare(a.opened_at));
    return {
      open: rows.find((s) => s.status === 'open') ?? null,
      lastClosed: rows.find((s) => s.status === 'closed') ?? null,
    };
  }, [sessions.data]);

  const recentExpenses = useMemo(() => {
    const rows = [...(expenses.data ?? [])].sort((a, b) => b.incurred_at.localeCompare(a.incurred_at));
    const todayKey = new Date().toDateString();
    return {
      latest: rows.slice(0, 4),
      today: rows.filter((e) => new Date(e.incurred_at).toDateString() === todayKey).length,
    };
  }, [expenses.data]);

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const today = week.today?.data;
  const points = week.days.map((d) => ({
    value: d.summary === undefined ? 0 : Number(d.summary.net_revenue),
    label: d.label,
  }));
  const lastVariance = varianceView(cash.lastClosed?.variance_amount ?? null);

  return (
    <ScreenScroll
      title="Finance"
      sub={branch?.label ?? 'All branches'}
      right={<IconButton icon="doc" label="Reports" tinted onPress={() => router.push('/reports')} />}
      refreshing={week.isRefetching || sessions.isRefetching || expenses.isRefetching}
      onRefresh={() => {
        week.refetch();
        void sessions.refetch();
        void expenses.refetch();
      }}
    >
      {branches.isLoading ? (
        <Skeleton variant="chart" className="mt-5 h-[280px]" />
      ) : branch === null ? (
        <EmptyState title="No branch available" detail="A branch needs a stockroom before it has finance figures." />
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
              <ErrorState error={week.error ?? new Error('Could not load finance figures.')} onRetry={week.refetch} />
            </View>
          ) : (
            <Card tone="ink" className="mt-5 overflow-hidden rounded-lg px-0 pb-4 pt-5">
              <View className="px-5">
                <Text className="text-caption font-semibold uppercase tracking-[1.2px] text-white/50">
                  Money in today
                </Text>
                {today === undefined ? (
                  <Skeleton variant="figure" className="mt-2 w-44 bg-white/10" />
                ) : (
                  <Text tabular className="mt-1.5 text-display font-bold tracking-[-1.2px] text-white">
                    {formatNaira(today.net_collected)}
                  </Text>
                )}
                <Text className="mt-1.5 text-foot text-white/60">
                  {today === undefined ? ' ' : `Collected after refunds · ${today.reporting_date}`}
                </Text>
              </View>

              <View className="mt-3">
                <TrendChart
                  points={points}
                  onDark
                  accessibilityLabel={`Net revenue over the last seven days at ${branch.label}`}
                />
              </View>

              {today !== undefined && (
                <View className="mx-5 mt-3 flex-row gap-5 border-t border-white/10 pt-3">
                  <FootStat value={formatNaira(today.net_revenue)} label="Net revenue" />
                  <View className="w-px bg-white/10" />
                  <FootStat value={formatNaira(today.refunds_paid)} label="Refunds paid" />
                </View>
              )}
            </Card>
          )}

          <View className="mt-5 flex-row flex-wrap justify-between gap-y-3">
            <DrillTile
              icon="sales"
              label="Revenue"
              value={today === undefined ? '—' : formatNaira(today.gross_revenue)}
              sub="Gross, today"
              href="/sales"
            />
            <DrillTile
              icon="receipt"
              label="Expenses"
              value={expenses.isLoading ? '—' : String(recentExpenses.today)}
              sub="recorded today"
              href="/expenses"
            />
            <DrillTile
              icon="cash"
              label="Cash session"
              value={sessions.isLoading ? '—' : cash.open !== null ? 'Open' : 'Closed'}
              sub={cash.open !== null ? `since ${clock.format(new Date(cash.open.opened_at))}` : undefined}
              badge={
                cash.open === null && lastVariance !== null
                  ? {
                      label:
                        lastVariance.label === 'Balanced'
                          ? 'Last: balanced'
                          : `Last: ${lastVariance.label.toLowerCase()} ${lastVariance.amount}`,
                      tone: lastVariance.tone,
                    }
                  : undefined
              }
              href="/cash"
            />
            <DrillTile icon="chart" label="Reports" value="Daily" sub="Revenue & cash" href="/reports" />
          </View>

          <Callout
            className="mt-5"
            tone="info"
            title="Profit and margin are on the way"
            detail="They need what your ingredients cost. Once purchase costs are recorded, net profit, cost of goods and margin appear here."
          />

          <View className="mt-8">
            <View className="mb-3 flex-row items-center">
              <Text variant="subtitle" accessibilityRole="header" className="flex-1">Latest expenses</Text>
              <PressableScale
                accessibilityRole="link"
                accessibilityLabel="All expenses"
                onPress={() => router.push('/expenses')}
                className="min-h-tap justify-center px-1"
              >
                <Text className="text-foot font-semibold text-apricot-deep">Detail</Text>
              </PressableScale>
            </View>
            {expenses.isLoading ? (
              <Skeleton variant="row" />
            ) : expenses.isError ? (
              <ErrorState error={expenses.error} onRetry={() => void expenses.refetch()} />
            ) : recentExpenses.latest.length === 0 ? (
              <Card tone="recessed" className="items-center gap-2 p-6">
                <Icon name="receipt" size={22} color="textMuted" />
                <Text variant="meta" className="text-center">No expenses recorded at {branch.label} yet.</Text>
              </Card>
            ) : (
              <List>
                {recentExpenses.latest.map((e) => (
                  <ListRow
                    key={e.id}
                    leading={<IconTile icon={CATEGORY_META[e.category].icon} size="sm" />}
                    title={e.description ?? CATEGORY_META[e.category].label}
                    sub={[
                      CATEGORY_META[e.category].label,
                      e.paid_method === null ? null : METHOD_LABEL[e.paid_method],
                      when(e.incurred_at),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    end={formatNaira(e.amount)}
                    chevron={false}
                  />
                ))}
              </List>
            )}
          </View>

          {today !== undefined && !isZeroDecimalString(today.recognized_refunds) && (
            <Text variant="caption" className="mt-4">
              Refunds recognised today: {formatNaira(today.recognized_refunds)}
            </Text>
          )}
        </>
      )}
    </ScreenScroll>
  );
}
