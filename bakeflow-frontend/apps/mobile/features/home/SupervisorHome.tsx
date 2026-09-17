import { getSupabaseClient } from '@bakeflow/auth';
import { useDeliveries, useProductStockLevels, useWarehouses } from '@bakeflow/hooks';
import { isNegativeDecimalString, isZeroDecimalString } from '@bakeflow/types';
import { Card, CountUp, Icon, IconTile, List, ListRow, Text } from '@bakeflow/ui';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { useSessionStore } from '../../stores/session';
import { useBranchOptions } from '../branch/hooks/useBranchOptions';
import { TODAY_FILTER } from '../tickets/ticketDisplay';
import { HomeScaffold, SectionHead, StatTile, TileGrid } from './components/HomeParts';
import { useTicketCount } from './hooks/useHomeData';

/**
 * Supervisor home — the prototype's `HOME.supervisor`: is today running normally? Sales, stock,
 * the kitchen and deliveries at a glance, and what needs a look.
 *
 * Monitoring only, as in the prototype. Every figure is a count of rows the supervisor's RLS
 * already lets them read; where a read is refused the tile says so rather than showing zero.
 *
 * PORT-NOTE: the hero's sales total is a money sum (supervisors are also refused
 * `get_daily_revenue_summary`), so it counts today's orders. Production "batches running" is
 * the order queue (AD-022). The daily financial audit has no backend.
 */
export function SupervisorHome(): React.JSX.Element {
  const router = useRouter();
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const branches = useBranchOptions();
  const branch = branches.options[0] ?? null;
  const scope = useMemo(() => (branch === null ? {} : { branchId: branch.branchId }), [branch]);

  const ordersToday = useTicketCount({ ...TODAY_FILTER.filters(), ...scope });
  const kitchen = useTicketCount({ statuses: ['scheduled', 'in_production'], ...scope });
  const deliveries = useDeliveries(client, tenantId, { openOnly: true, ...scope }, { limit: 200 });
  const warehouses = useWarehouses(client, tenantId, branch?.branchId);
  const stockroom = (warehouses.data ?? []).find((w) => w.is_default) ?? warehouses.data?.[0] ?? null;
  const levels = useProductStockLevels(client, tenantId, stockroom?.id ?? null, { limit: 200 });

  const out = (levels.data?.rows ?? []).filter((l) => isZeroDecimalString(l.quantity_on_hand) || isNegativeDecimalString(l.quantity_on_hand)).length;
  const active = (deliveries.data?.rows ?? []).filter((d) => d.status === 'in_transit' || d.status === 'assigned').length;
  const failed = (deliveries.data?.rows ?? []).filter((d) => d.status === 'failed');

  return (
    <HomeScaffold
      context={branch?.label}
      refreshing={ordersToday.isRefetching}
      onRefresh={() => {
        void ordersToday.refetch();
        void kitchen.refetch();
        void deliveries.refetch();
        void levels.refetch();
      }}
    >
      <Card tone="ink" className="mt-2 rounded-lg p-5">
        <View className="flex-row items-start gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-caption font-semibold uppercase tracking-[1.2px] text-white/50">Today&apos;s operation</Text>
            <CountUp format="integer" to={ordersToday.count} text={ordersToday.label} className="mt-1.5 text-display font-bold tracking-[-1.2px] text-white" />
            <Text className="mt-1 text-foot text-white/60">
              orders · {kitchen.label} in the kitchen · {deliveries.isLoading ? '—' : active} deliveries out
            </Text>
          </View>
          <View className="h-11 w-11 items-center justify-center rounded-[14px] bg-white/10">
            <Icon name="layers" size={21} color="white" />
          </View>
        </View>
      </Card>

      <SectionHead title="Operations" />
      <TileGrid>
        <StatTile index={0} icon="sales" label="Orders today" value={ordersToday.label} sub="Sales by method" href="/reports/sales" />
        <StatTile index={1} icon="box" label="Stock warnings" value={levels.isError ? '—' : levels.isLoading ? '—' : String(out)} sub={levels.isError ? 'Not readable for your role' : 'Out or below zero'} attention={out > 0} href="/inventory" />
        <StatTile index={2} icon="flame" label="Kitchen" value={kitchen.label} sub="Scheduled or preparing" href="/production" />
        <StatTile index={3} icon="truck" label="Deliveries" value={deliveries.isLoading ? '—' : String(active)} sub="Active right now" href="/delivery" />
      </TileGrid>

      {(failed.length > 0 || out > 0) && (
        <>
          <SectionHead title="Needs attention" />
          <List>
            {out > 0 && (
              <ListRow leading={<IconTile icon="box" tone="warn" size="sm" />} title={`${out} product${out === 1 ? '' : 's'} out of stock`} sub={stockroom?.name} onPress={() => router.push('/inventory')} />
            )}
            {failed.slice(0, 3).map((d) => (
              <ListRow
                key={d.id}
                leading={<IconTile icon="truck" tone="bad" size="sm" />}
                title={`Delivery to ${d.address_line} failed`}
                sub={d.failure_reason ?? 'Needs follow-up'}
                onPress={() => router.push(`/delivery/${d.id}`)}
              />
            ))}
          </List>
        </>
      )}
    </HomeScaffold>
  );
}
