import { getSupabaseClient } from '@bakeflow/auth';
import { useProductPerformance } from '@bakeflow/hooks';
import type { ProductPerformanceOrder, ProductPerformanceRow, ReportPeriod } from '@bakeflow/types';
import { Card, Chips, GroupLabel, List, ListRow, ScreenScroll, Skeleton, Text } from '@bakeflow/ui';
import { formatNaira, formatNairaShort } from '@bakeflow/utils';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { EmptyState, ErrorState, NoOrganizationState } from '../../components/ScreenState';
import { HBar } from '../../features/reports/components/HBar';
import { useBranchOptions } from '../../features/branch/hooks/useBranchOptions';
import { PERIOD_LABEL, rangeLabel } from '../../features/reports/reportDisplay';
import { trimQuantity } from '../../features/tickets/ticketDisplay';
import { useSessionStore } from '../../stores/session';

const PERIODS: readonly ReportPeriod[] = ['7d', '30d', 'month', 'last_month'];
const ORDERS: readonly { key: ProductPerformanceOrder; label: string }[] = [
  { key: 'value', label: 'Sales value' },
  { key: 'units', label: 'Units sold' },
];

function productLabel(row: ProductPerformanceRow): string {
  return row.variant_name === '' ? row.product_name : `${row.product_name} · ${row.variant_name}`;
}

/**
 * Product performance — the prototype's `report-products`: which products make the money, and
 * which move the most, for one branch over a period.
 *
 * `get_product_performance()` (P9.9 Q2) ranks the variants and computes every sum and share
 * server-side, resolving the period in the organization's timezone.
 *
 * PORT-NOTE: the prototype's "Margin" switch and "Margin leaders" list need product cost, which is
 * out of MVP scope (AD-022) — omitted. Its insight card ("sells out every day by 1 PM") needs
 * stock-out history that nothing records — omitted. "Sales value" is quantity × price before
 * order-level discounts and tax, so it can differ from gross revenue; refunds are recorded per order
 * and are not attributed to products. The screen says both.
 */
export default function ProductPerformanceScreen(): React.JSX.Element {
  const router = useRouter();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const branches = useBranchOptions();
  const [branchIndex, setBranchIndex] = useState(0);
  const [period, setPeriod] = useState<ReportPeriod>('month');
  const [order, setOrder] = useState<ProductPerformanceOrder>('value');
  const branch = branches.options[branchIndex] ?? branches.options[0] ?? null;
  const report = useProductPerformance(getSupabaseClient(), tenantId, branch?.branchId ?? null, period, order);

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const data = report.data;
  const rows = data?.rows ?? [];
  const top = rows.slice(0, 8);
  const metric = (r: ProductPerformanceRow): string => (order === 'units' ? r.units : r.line_value);
  const leader = top[0] === undefined ? 0 : Number(metric(top[0]));
  const shown = (r: ProductPerformanceRow): string => (order === 'units' ? trimQuantity(r.units) : formatNairaShort(r.line_value));

  return (
    <ScreenScroll
      title="Product performance"
      sub={`${order === 'units' ? 'By units' : 'By sales value'} · ${PERIOD_LABEL[period].phrase}${branch === null ? '' : ` · ${branch.label}`}`}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/reports'))}
      refreshing={report.isRefetching}
      onRefresh={() => void report.refetch()}
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
          <View className="mt-3 gap-2">
            <Chips accessibilityLabel="Rank by" options={ORDERS} value={order} onChange={setOrder} />
            <Chips
              accessibilityLabel="Period"
              options={PERIODS.map((k) => ({ key: k, label: PERIOD_LABEL[k].chip }))}
              value={period}
              onChange={setPeriod}
            />
          </View>

          {report.isError ? (
            <View className="mt-5">
              <ErrorState error={report.error} onRetry={() => void report.refetch()} />
            </View>
          ) : data === undefined ? (
            <View className="mt-5 gap-3">
              <Skeleton variant="chart" className="h-[220px]" />
              <Skeleton variant="row" />
              <Skeleton variant="row" />
            </View>
          ) : rows.length === 0 ? (
            <View className="mt-5">
              <EmptyState
                title="Nothing sold in this period"
                detail={`No completed orders at ${branch.label} between ${rangeLabel(data.start_date, data.end_date)}.`}
              />
            </View>
          ) : (
            <>
              <Card tone="ink" className="mt-5 rounded-lg p-5">
                <Text className="text-caption font-semibold uppercase tracking-[1.2px] text-white/50">Sales value</Text>
                <Text tabular className="mt-1.5 text-title-1 font-bold tracking-[-0.8px] text-white">
                  {formatNaira(data.total_line_value)}
                </Text>
                <Text className="mt-1 text-foot text-white/60">
                  {data.products_sold} {data.products_sold === 1 ? 'product' : 'products'} sold · {rangeLabel(data.start_date, data.end_date)}
                </Text>
              </Card>

              <Card className="mt-4 px-4 py-3">
                <Text variant="subtitle" accessibilityRole="header" className="mb-1">
                  {order === 'units' ? 'Which products move the most?' : 'Which products make the money?'}
                </Text>
                {top.map((r, i) => (
                  <HBar
                    key={r.product_variant_id}
                    label={productLabel(r)}
                    ratio={leader > 0 ? Number(metric(r)) / leader : 0}
                    value={shown(r)}
                    lead={i === 0}
                  />
                ))}
              </Card>

              <GroupLabel>All products sold</GroupLabel>
              <List>
                {rows.map((r) => (
                  <ListRow
                    key={r.product_variant_id}
                    title={productLabel(r)}
                    sub={`${trimQuantity(r.units)} sold · ${r.orders} ${r.orders === 1 ? 'order' : 'orders'}${r.category_name === null ? '' : ` · ${r.category_name}`}`}
                    end={formatNaira(r.line_value)}
                    endSub={`${r.value_share_pct}% of sales`}
                    onPress={() => router.push(`/product/${r.product_id}`)}
                  />
                ))}
              </List>
              {data.products_sold > rows.length && (
                <Text variant="caption" className="mt-2">
                  Showing the top {rows.length} of {data.products_sold} products.
                </Text>
              )}
            </>
          )}

          <Text variant="caption" className="mt-4">
            Sales value is quantity × price before order discounts and tax, so it can differ from revenue. Refunds are
            recorded per order, not per product. Cost and margin arrive in a later version.
          </Text>
        </>
      )}
    </ScreenScroll>
  );
}
