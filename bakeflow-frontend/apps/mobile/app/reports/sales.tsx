import { getSupabaseClient } from '@bakeflow/auth';
import { useSalesBreakdown } from '@bakeflow/hooks';
import type { SalesBreakdownMethod } from '@bakeflow/types';
import { Card, Chips, EmptyState, IconTile, List, ListRow, ScreenScroll, Skeleton, Text } from '@bakeflow/ui';
import { formatNaira, formatNairaShort } from '@bakeflow/utils';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ErrorState, NoOrganizationState } from '../../components/ScreenState';
import { useBranchOptions } from '../../features/branch/hooks/useBranchOptions';
import { HBar } from '../../features/reports/components/HBar';
import { useSessionStore } from '../../stores/session';

const METHOD: Record<SalesBreakdownMethod, string> = {
  cash: 'Cash',
  transfer: 'Transfer',
  pos: 'POS',
  card: 'Card',
  credit: 'Credit',
};
const FILTERS = ['All', 'cash', 'transfer', 'pos'] as const;
type Filter = (typeof FILTERS)[number];

const clock = new Intl.DateTimeFormat('en-NG', { hour: 'numeric', minute: '2-digit' });

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <View className="mt-6">
      <Text variant="subtitle" accessibilityRole="header" className="mb-3">{title}</Text>
      {children}
    </View>
  );
}

/**
 * Sales monitoring — the prototype's `sales-monitor`: today's takings by salesperson and by payment
 * method, then the recent transactions, filterable by method.
 *
 * `get_sales_breakdown()` (P9.9 Q4) decides what the caller may see (owner decision 2026-09-17):
 * owner, admin and the branch's manager see every salesperson; a supervisor sees the method split and
 * transactions without names; a cashier or driver sees only their own sales. Every figure and share is
 * computed server-side; bar widths are display proportions only.
 *
 * PORT-NOTE: payment tiles show money collected by method (after refunds), the figure that
 * reconciles with the till; Card and Credit tiles appear only when used. A sale paid in two ways lists
 * both methods. Tapping a transaction opens the order.
 */
export default function SalesMonitorScreen(): React.JSX.Element {
  const router = useRouter();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const branches = useBranchOptions();
  const [branchIndex, setBranchIndex] = useState(0);
  const [filter, setFilter] = useState<Filter>('All');
  const branch = branches.options[branchIndex] ?? branches.options[0] ?? null;
  const report = useSalesBreakdown(getSupabaseClient(), tenantId, branch?.branchId ?? null, 'today');

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const data = report.data;
  const staff = data?.by_staff ?? null;
  const leader = staff !== null && staff[0] !== undefined ? Number(staff[0].gross_sales) : 0;
  const tiles = (data?.by_method ?? []).filter(
    (m) => m.method === 'cash' || m.method === 'transfer' || m.method === 'pos' || m.payments > 0,
  );
  const recent = (data?.recent ?? []).filter((r) => filter === 'All' || r.methods.includes(filter));
  const sub =
    data === undefined
      ? branch?.label
      : `Today · ${formatNaira(data.totals.gross_sales)} · ${data.totals.completed_tickets} ${data.totals.completed_tickets === 1 ? 'sale' : 'sales'}`;

  return (
    <ScreenScroll
      title={data?.scope === 'own' ? 'Your sales' : 'Sales monitoring'}
      sub={sub}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/reports'))}
      refreshing={report.isRefetching}
      onRefresh={() => void report.refetch()}
    >
      {branches.isLoading ? (
        <Skeleton variant="chart" className="mt-4 h-[200px]" />
      ) : branch === null ? (
        <EmptyState icon="store" title="No branch available" text="A branch needs a stockroom before it has sales." />
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

          {report.isError ? (
            <View className="mt-4">
              <ErrorState error={report.error} onRetry={() => void report.refetch()} />
            </View>
          ) : data === undefined ? (
            <View className="mt-4 gap-3">
              <Skeleton variant="chart" className="h-[120px]" />
              <Skeleton variant="row" />
            </View>
          ) : (
            <>
              {staff !== null && (
                <Section title={data.scope === 'own' ? 'Your sales today' : 'By salesperson'}>
                  <Card className="px-4 py-2">
                    {staff.length === 0 ? (
                      <Text variant="meta" className="py-3">No completed sales yet today.</Text>
                    ) : (
                      staff.map((s, i) => (
                        <HBar
                          key={s.profile_id ?? `unknown-${i}`}
                          label={s.full_name?.split(' ')[0] ?? 'Unnamed'}
                          ratio={leader > 0 ? Number(s.gross_sales) / leader : 0}
                          value={formatNairaShort(s.gross_sales)}
                          lead={i === 0}
                        />
                      ))
                    )}
                  </Card>
                </Section>
              )}

              <Section title="By payment method">
                <View className="flex-row flex-wrap gap-2">
                  {tiles.map((m) => (
                    <View
                      key={m.method}
                      className="min-w-[30%] flex-1 rounded-md bg-white p-3.5 shadow-e2"
                      accessible
                      accessibilityLabel={`${METHOD[m.method]}: ${formatNaira(m.net_collected)} collected`}
                    >
                      <Text variant="meta">{METHOD[m.method]}</Text>
                      <Text tabular className="mt-2 text-title-3 font-bold tracking-[-0.4px] text-cocoa" numberOfLines={1}>
                        {formatNairaShort(m.net_collected)}
                      </Text>
                    </View>
                  ))}
                </View>
              </Section>

              <Section title="Recent transactions">
                <Chips
                  accessibilityLabel="Payment method"
                  options={FILTERS.map((f) => ({ key: f, label: f === 'All' ? 'All' : METHOD[f] }))}
                  value={filter}
                  onChange={setFilter}
                />
                <View className="mt-3">
                  {recent.length === 0 ? (
                    <EmptyState icon="receipt" title="No sales match" text={filter === 'All' ? 'Completed sales today appear here.' : `No ${METHOD[filter]} sales today.`} />
                  ) : (
                    <List>
                      {recent.map((r) => (
                        <ListRow
                          key={r.ticket_id}
                          leading={<IconTile icon="receipt" size="sm" />}
                          title={r.ticket_number}
                          sub={[r.customer_name ?? 'Walk-in', data.scope === 'full' ? r.seller_name : null, clock.format(new Date(r.completed_at))]
                            .filter(Boolean)
                            .join(' · ')}
                          end={formatNaira(r.total_amount)}
                          endSub={r.methods.length === 0 ? 'Unpaid' : r.methods.map((x) => METHOD[x]).join(' + ')}
                          onPress={() => router.push(`/order/${r.ticket_id}`)}
                        />
                      ))}
                    </List>
                  )}
                </View>
              </Section>
            </>
          )}
        </>
      )}
    </ScreenScroll>
  );
}
