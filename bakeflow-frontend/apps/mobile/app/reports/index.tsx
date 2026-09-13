import { isZeroDecimalString } from '@bakeflow/types';
import {
  Card,
  Chips,
  GroupLabel,
  Menu,
  MenuItem,
  ScreenScroll,
  Skeleton,
  Text,
  TrendChart,
} from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { EmptyState, ErrorState, NoOrganizationState } from '../../components/ScreenState';
import { useActivePersona } from '../../features/auth/hooks/useActivePersona';
import { useBranchOptions } from '../../features/branch/hooks/useBranchOptions';
import { useRevenueWeek } from '../../features/reports/hooks/useRevenueWeek';
import { useSessionStore } from '../../stores/session';

/** One ledger line: label left, exact figure right. */
function Line({
  label,
  value,
  total,
  minus,
}: {
  label: string;
  value: string;
  total?: boolean;
  minus?: boolean;
}): React.JSX.Element {
  return (
    <View
      className={`flex-row items-center py-2.5 ${total === true ? 'mt-1 border-t border-border pt-3' : ''}`}
      accessible
      accessibilityLabel={`${label}${minus === true ? ', deducted' : ''}: ${value}`}
    >
      <Text className="w-4 text-foot text-warm-gray-soft">{minus === true ? '−' : ''}</Text>
      <Text className={`flex-1 text-foot ${total === true ? 'font-semibold text-cocoa' : 'text-warm-gray'}`}>{label}</Text>
      <Text tabular className={`text-foot ${total === true ? 'font-bold text-cocoa' : 'font-semibold text-cocoa'}`}>
        {value}
      </Text>
    </View>
  );
}

/**
 * Reports — the prototype's `reports` (and supervisor `supervisor-reports`) screen: a hero over
 * the week, the day's statement, then the reports you can open.
 *
 * The statement is `get_daily_revenue_summary()` for the chosen day, shown line by line from
 * its exact strings. The week's days are one cached query each (`useRevenueWeek`), so switching
 * day costs no request.
 *
 * PORT-NOTE: the prototype's "This month so far" hero, monthly delta and net-profit line need a
 * ranged report and cost of goods (BLOCKER-018); the Profit & Loss, Product performance and
 * Branch performance reports have no endpoint yet; PDF/spreadsheet export and scheduled e-mail
 * have no backend. None are shown as if available — the menu lists only screens that exist.
 * Whether a role may read the summary is the RPC's decision (supervisors are refused
 * server-side today); a refusal is shown as returned.
 */
export default function ReportsScreen(): React.JSX.Element {
  const router = useRouter();
  const persona = useActivePersona();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const branches = useBranchOptions();
  const [branchIndex, setBranchIndex] = useState(0);
  const [dayIndex, setDayIndex] = useState(6);
  const branch = branches.options[branchIndex] ?? branches.options[0] ?? null;
  const week = useRevenueWeek(branch?.branchId ?? null);

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const day = week.days[dayIndex];
  const summary = day?.summary;
  const points = week.days.map((d) => ({
    value: d.summary === undefined ? 0 : Number(d.summary.net_revenue),
    label: d.label,
  }));
  const moneyRoles = persona === 'owner' || persona === 'manager' || persona === 'admin';

  return (
    <ScreenScroll
      title="Reports"
      sub={branch?.label}
      onBack={() => router.back()}
      refreshing={week.isRefetching}
      onRefresh={week.refetch}
    >
      {branches.isLoading ? (
        <Skeleton variant="chart" className="mt-5 h-[240px]" />
      ) : branch === null ? (
        <EmptyState title="No branch available" detail="A branch needs a stockroom before it has reports." />
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
              <ErrorState error={week.error ?? new Error('Could not load reports.')} onRetry={week.refetch} />
            </View>
          ) : (
            <>
              <Card tone="ink" className="mt-5 overflow-hidden rounded-lg px-0 pb-3 pt-5">
                <View className="px-5">
                  <Text className="text-caption font-semibold uppercase tracking-[1.2px] text-white/50">
                    Net revenue · last 7 days
                  </Text>
                  {week.today?.data === undefined ? (
                    <Skeleton variant="figure" className="mt-2 w-44 bg-white/10" />
                  ) : (
                    <Text tabular className="mt-1.5 text-title-1 font-bold tracking-[-0.8px] text-white">
                      {formatNaira(week.today.data.net_revenue)}
                    </Text>
                  )}
                  <Text className="mt-1 text-foot text-white/60">today · {week.today?.data?.timezone ?? ' '}</Text>
                </View>
                <View className="mt-3">
                  <TrendChart
                    points={points}
                    onDark
                    accessibilityLabel={`Net revenue over the last seven days at ${branch.label}`}
                  />
                </View>
              </Card>

              <GroupLabel>Daily statement</GroupLabel>
              <Chips
                accessibilityLabel="Day"
                options={week.days.map((d, i) => ({ key: String(i), label: i === 6 ? 'Today' : d.label }))}
                value={String(dayIndex)}
                onChange={(k) => setDayIndex(Number(k))}
              />
              <Card className="mt-3 px-4 py-2">
                {summary === undefined ? (
                  <View className="gap-2 py-2">
                    <Skeleton variant="row" className="h-6" />
                    <Skeleton variant="row" className="h-6" />
                    <Skeleton variant="row" className="h-6" />
                  </View>
                ) : (
                  <>
                    <Text variant="caption" className="pb-1 pt-2">
                      {summary.reporting_date} · {summary.timezone}
                    </Text>
                    <Text variant="label" className="pt-2">Revenue</Text>
                    <Line label="Gross revenue" value={formatNaira(summary.gross_revenue)} />
                    <Line label="Refunds" value={formatNaira(summary.recognized_refunds)} minus />
                    <Line label="Net revenue" value={formatNaira(summary.net_revenue)} total />
                    <Text variant="label" className="pt-4">Cash collected</Text>
                    <Line label="Gross collected" value={formatNaira(summary.gross_collected)} />
                    <Line label="Refunds paid" value={formatNaira(summary.refunds_paid)} minus />
                    <Line label="Net collected" value={formatNaira(summary.net_collected)} total />
                    {isZeroDecimalString(summary.gross_revenue) && isZeroDecimalString(summary.gross_collected) && (
                      <Text variant="meta" className="pb-2 pt-1">Nothing was sold or collected on this day.</Text>
                    )}
                  </>
                )}
              </Card>
            </>
          )}

          <GroupLabel>Available reports</GroupLabel>
          <Menu>
            <MenuItem icon="sales" tone="accent" title="Sales" sub="Today's take and orders" onPress={() => router.push('/sales')} />
            {moneyRoles && (
              <MenuItem icon="receipt" title="Expenses" sub="What was spent, by day" onPress={() => router.push('/expenses')} />
            )}
            {persona !== 'supervisor' && (
              <MenuItem icon="cash" tone="warn" title="Cash sessions" sub="Floats, counts and variance" onPress={() => router.push('/cash')} />
            )}
            {persona === 'supervisor' && (
              <MenuItem icon="history" title="Staff activity" sub="Shifts, sales and orders" onPress={() => router.push('/staff')} />
            )}
          </Menu>

          <Text variant="meta" className="mt-4">
            Profit & loss, product and branch performance arrive once ingredient costs and ranged reports are in place.
          </Text>
        </>
      )}
    </ScreenScroll>
  );
}
