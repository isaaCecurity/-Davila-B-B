import { getSupabaseClient } from '@bakeflow/auth';
import { useDailyRevenueSummary, useWarehouses } from '@bakeflow/hooks';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, LoadingState, NoOrganizationState } from '../../components/ScreenState';
import { useSessionStore } from '../../stores/session';

/**
 * P9.8 — the revenue/cash half of P5.8's reporting model. One card, one branch, "today"
 * in the organization's own timezone (server-resolved — see
 * `getDailyRevenueSummary()`'s header). No COGS/gross-profit/margin: BLOCKER-018
 * (`stock_movements.unit_cost` is 100% NULL live) blocks weighted-average costing, so
 * this screen only shows what `get_daily_revenue_summary()` can compute without it.
 */
export default function ReportsScreen(): React.JSX.Element {
  const client = getSupabaseClient();
  const router = useRouter();
  const tenantId = useSessionStore((state) => state.activeTenantId);
  const warehouses = useWarehouses(client, tenantId);
  const [branchIndex, setBranchIndex] = useState(0);

  const branchOptions = useMemo(() => {
    const seen = new Set<string>();
    return (warehouses.data ?? []).filter((warehouse) => {
      if (seen.has(warehouse.branch_id)) return false;
      seen.add(warehouse.branch_id);
      return true;
    });
  }, [warehouses.data]);

  const branchId = branchOptions[branchIndex]?.branch_id ?? null;
  const summary = useDailyRevenueSummary(client, tenantId, branchId);

  if (tenantId === null) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <NoOrganizationState onChoose={() => router.push('/select-organization')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center justify-between border-b border-neutral-200 p-6 pb-4">
        <View className="flex-1 gap-1 pr-3">
          <Text className="text-2xl font-bold text-neutral-900">Reports</Text>
          <Text className="text-sm text-neutral-500">Today&apos;s revenue and cash, by branch</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/')}
          className="rounded-lg border border-neutral-300 px-4 py-2 active:opacity-70"
        >
          <Text className="text-sm font-medium text-neutral-900">Catalog</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerClassName="gap-4 p-6">
        {branchOptions.length === 0 ? (
          <EmptyState title="No branch available" detail="A branch needs a stockroom before it has reports." />
        ) : (
          <>
            {branchOptions.length > 1 && (
              <View className="flex-row flex-wrap gap-2">
                {branchOptions.map((warehouse, index) => (
                  <Pressable
                    key={warehouse.branch_id}
                    accessibilityRole="button"
                    onPress={() => setBranchIndex(index)}
                    className={`rounded-lg border px-3 py-2 ${index === branchIndex ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300'}`}
                  >
                    <Text className={index === branchIndex ? 'text-white' : 'text-neutral-900'}>
                      {warehouse.name}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            {summary.isPending ? (
              <LoadingState label="Loading today's numbers…" />
            ) : summary.isError ? (
              <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
            ) : (
              <View className="gap-4">
                <Text className="text-sm text-neutral-500">
                  {summary.data.reporting_date} · {summary.data.timezone}
                </Text>

                <SummaryCard title="Revenue">
                  <SummaryRow label="Gross revenue" value={summary.data.gross_revenue} />
                  <SummaryRow label="Refunds" value={summary.data.recognized_refunds} negative />
                  <SummaryRow label="Net revenue" value={summary.data.net_revenue} emphasize />
                </SummaryCard>

                <SummaryCard title="Cash collected">
                  <SummaryRow label="Gross collected" value={summary.data.gross_collected} />
                  <SummaryRow label="Refunds paid" value={summary.data.refunds_paid} negative />
                  <SummaryRow label="Net collected" value={summary.data.net_collected} emphasize />
                </SummaryCard>

                <Text className="text-xs text-neutral-400">
                  Cost of goods, gross profit and margin are not shown yet — ingredient purchase
                  cost is not captured anywhere in the system today, so those figures cannot be
                  computed correctly.
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryCard({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <View className="gap-2 rounded-xl border border-neutral-200 p-4">
      <Text className="text-base font-semibold text-neutral-900">{title}</Text>
      {children}
    </View>
  );
}

function SummaryRow({
  label,
  value,
  negative,
  emphasize,
}: {
  label: string;
  value: string;
  negative?: boolean;
  emphasize?: boolean;
}): React.JSX.Element {
  return (
    <View className="flex-row items-center justify-between">
      <Text className={emphasize ? 'text-base font-semibold text-neutral-900' : 'text-sm text-neutral-500'}>
        {label}
      </Text>
      <Text
        className={
          emphasize
            ? 'text-base font-semibold text-neutral-900'
            : negative === true
              ? 'text-sm text-red-700'
              : 'text-sm text-neutral-900'
        }
      >
        {negative === true ? `-${value}` : value}
      </Text>
    </View>
  );
}
