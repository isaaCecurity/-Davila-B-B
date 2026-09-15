import { getSupabaseClient } from '@bakeflow/auth';
import { useRevenueReport } from '@bakeflow/hooks';
import { isZeroDecimalString, type ReportPeriod } from '@bakeflow/types';
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
import { PERIOD_LABEL, rangeLabel, revenueChartPoints } from '../../features/reports/reportDisplay';
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

const STATEMENT_PERIODS: readonly ReportPeriod[] = ['today', '7d', 'month', 'last_month'];

/**
 * Reports — the prototype's `reports` (and supervisor `supervisor-reports`) screen: a hero over the
 * month so far, a statement for a chosen period, then the reports you can open.
 *
 * Both the hero and the statement are `get_revenue_report()` (P9.9 Q1): the server resolves each
 * period in the organization's timezone and sums every figure; the screen shows the exact strings.
 *
 * PORT-NOTE: the prototype's hero also shows net profit and a month-on-month delta. Profit and cost
 * of goods are out of MVP scope (AD-022), and a delta would be arithmetic on money done here, so the
 * hero is net revenue with the order count. Profit & Loss and Branch performance have no endpoint
 * yet; PDF/spreadsheet export and scheduled e-mail have no backend. None are shown as if available.
 * Whether a role may read reports is the RPC's decision (supervisors are refused today, as for the
 * daily summary); a refusal is shown as returned.
 */
export default function ReportsScreen(): React.JSX.Element {
  const router = useRouter();
  const client = getSupabaseClient();
  const persona = useActivePersona();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const branches = useBranchOptions();
  const [branchIndex, setBranchIndex] = useState(0);
  const [statementPeriod, setStatementPeriod] = useState<ReportPeriod>('today');
  const branch = branches.options[branchIndex] ?? branches.options[0] ?? null;

  const month = useRevenueReport(client, tenantId, branch?.branchId ?? null, 'month');
  const statement = useRevenueReport(client, tenantId, branch?.branchId ?? null, statementPeriod);

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const hero = month.data;
  // Judged on the exact strings, not the plot numbers.
  const quietMonth = hero !== undefined && hero.days.every((d) => isZeroDecimalString(d.net_revenue));
  const figures = statement.data?.totals;
  const moneyRoles = persona === 'owner' || persona === 'manager' || persona === 'admin';
  const reportRoles = moneyRoles || persona === 'cashier';

  return (
    <ScreenScroll
      title="Reports"
      sub={branch?.label}
      onBack={() => router.back()}
      refreshing={month.isRefetching || statement.isRefetching}
      onRefresh={() => {
        void month.refetch();
        void statement.refetch();
      }}
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

          {month.isError ? (
            <View className="mt-5">
              <ErrorState error={month.error} onRetry={() => void month.refetch()} />
            </View>
          ) : (
            <Card tone="ink" className="mt-5 overflow-hidden rounded-lg px-0 pb-3 pt-5">
              <View className="px-5">
                <Text className="text-caption font-semibold uppercase tracking-[1.2px] text-white/50">
                  This month so far
                </Text>
                {hero === undefined ? (
                  <Skeleton variant="figure" className="mt-2 w-44 bg-white/10" />
                ) : (
                  <Text tabular className="mt-1.5 text-title-1 font-bold tracking-[-0.8px] text-white">
                    {formatNaira(hero.totals.net_revenue)}
                  </Text>
                )}
                <Text className="mt-1 text-foot text-white/60">
                  {hero === undefined
                    ? ' '
                    : `Net revenue · ${hero.totals.completed_tickets} ${hero.totals.completed_tickets === 1 ? 'order' : 'orders'} · ${rangeLabel(hero.start_date, hero.end_date)}`}
                </Text>
              </View>
              <View className="mt-3">
                <TrendChart
                  points={revenueChartPoints(hero?.days ?? [])}
                  onDark
                  accessibilityLabel={`Net revenue by day this month at ${branch.label}`}
                />
                {quietMonth && (
                  <View pointerEvents="none" className="absolute left-0 right-0 top-8 items-center">
                    <Text className="text-foot text-white/45">No revenue recorded this month</Text>
                  </View>
                )}
              </View>
            </Card>
          )}

          <GroupLabel>Statement</GroupLabel>
          <Chips
            accessibilityLabel="Statement period"
            options={STATEMENT_PERIODS.map((k) => ({ key: k, label: PERIOD_LABEL[k].chip }))}
            value={statementPeriod}
            onChange={setStatementPeriod}
          />
          <Card className="mt-3 px-4 py-2">
            {statement.isError ? (
              <View className="py-2">
                <ErrorState error={statement.error} onRetry={() => void statement.refetch()} />
              </View>
            ) : figures === undefined || statement.data === undefined ? (
              <View className="gap-2 py-2">
                <Skeleton variant="row" className="h-6" />
                <Skeleton variant="row" className="h-6" />
                <Skeleton variant="row" className="h-6" />
              </View>
            ) : (
              <>
                <Text variant="caption" className="pb-1 pt-2">
                  {rangeLabel(statement.data.start_date, statement.data.end_date)} · {statement.data.timezone} ·{' '}
                  {figures.completed_tickets} {figures.completed_tickets === 1 ? 'order' : 'orders'} completed
                </Text>
                <Text variant="label" className="pt-2">Revenue</Text>
                <Line label="Gross revenue" value={formatNaira(figures.gross_revenue)} />
                <Line label="Refunds" value={formatNaira(figures.recognized_refunds)} minus />
                <Line label="Net revenue" value={formatNaira(figures.net_revenue)} total />
                <Text variant="label" className="pt-4">Cash collected</Text>
                <Line label="Gross collected" value={formatNaira(figures.gross_collected)} />
                <Line label="Refunds paid" value={formatNaira(figures.refunds_paid)} minus />
                <Line label="Net collected" value={formatNaira(figures.net_collected)} total />
                {isZeroDecimalString(figures.gross_revenue) && isZeroDecimalString(figures.gross_collected) && (
                  <Text variant="meta" className="pb-2 pt-1">Nothing was sold or collected in this period.</Text>
                )}
              </>
            )}
          </Card>

          <GroupLabel>Available reports</GroupLabel>
          <Menu>
            {reportRoles && (
              <MenuItem
                icon="box"
                tone="accent"
                title="Product performance"
                sub="Best and worst sellers"
                onPress={() => router.push('/reports/products')}
              />
            )}
            <MenuItem icon="sales" title="Sales" sub="Today's take and orders" onPress={() => router.push('/sales')} />
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
            Profit & loss and branch performance arrive in a later version.
          </Text>
        </>
      )}
    </ScreenScroll>
  );
}
