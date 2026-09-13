import { getSupabaseClient } from '@bakeflow/auth';
import { useDeliveries, useDriverTrips } from '@bakeflow/hooks';
import { Icon, IconTile, PressableScale, ScreenScroll, Text, type IconName, type TileTone } from '@bakeflow/ui';
import { useRouter, type Href } from 'expo-router';
import { View } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';

import { NoOrganizationState } from '../../components/ScreenState';
import { useBranchOptions } from '../../features/branch/hooks/useBranchOptions';
import { useTicketCount } from '../../features/home/hooks/useHomeData';
import { TRIP_STAGE } from '../../features/driverTrip/tripDisplay';
import { TODAY_FILTER } from '../../features/tickets/ticketDisplay';
import { useOffBarBack } from '../../navigation/useOffBarBack';
import { useSessionStore } from '../../stores/session';

/**
 * Operations — the prototype's supervisor `operations` hub: monitoring, not managing. One card
 * per area with a live count, each opening the screen for it.
 *
 * PORT-NOTE: "Sales monitoring" (by salesperson and payment method) needs per-staff and
 * per-method aggregates with no endpoint, so Sales opens the orders list; "Inventory monitoring"
 * and "Production monitoring" are the ported Stock and Production screens.
 */
export default function OperationsScreen(): React.JSX.Element {
  const router = useRouter();
  const onBack = useOffBarBack('operations');
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const branches = useBranchOptions();
  const branch = branches.options[0] ?? null;
  const scope = branch === null ? {} : { branchId: branch.branchId };

  const today = useTicketCount({ ...TODAY_FILTER.filters(), ...scope });
  const kitchen = useTicketCount({ statuses: ['scheduled', 'in_production'], ...scope });
  const deliveries = useDeliveries(client, tenantId, { openOnly: true, ...scope }, { limit: 200 });
  const trips = useDriverTrips(client, tenantId, { activeOnly: true, ...scope });

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const active = (deliveries.data?.rows ?? []).filter((d) => d.status === 'in_transit' || d.status === 'assigned').length;
  const firstTrip = trips.data?.rows[0];

  const tiles: { icon: IconName; tone: TileTone; title: string; sub: string; href: Href }[] = [
    { icon: 'sales', tone: 'ok', title: 'Sales', sub: `${today.label} orders today`, href: '/orders' },
    { icon: 'box', tone: 'neutral', title: 'Inventory', sub: 'Stock on the shelf, out and below zero', href: '/inventory' },
    { icon: 'flame', tone: 'accent', title: 'Production', sub: `${kitchen.label} in the kitchen`, href: '/production' },
    { icon: 'truck', tone: 'info', title: 'Delivery', sub: deliveries.isLoading ? '—' : `${active} active`, href: '/delivery' },
    { icon: 'receipt', tone: 'neutral', title: 'Expenses', sub: 'What was spent, by day', href: '/expenses' },
    { icon: 'doc', tone: 'neutral', title: 'Reports', sub: 'Daily revenue and cash', href: '/reports' },
    { icon: 'truck', tone: 'neutral', title: 'Driver trips', sub: firstTrip === undefined ? 'No active trip' : TRIP_STAGE[firstTrip.status].label, href: '/trips' },
  ];

  return (
    <ScreenScroll
      title="Operations"
      sub={branch?.label}
      onBack={onBack}
      refreshing={today.isRefetching}
      onRefresh={() => {
        void today.refetch();
        void kitchen.refetch();
        void deliveries.refetch();
        void trips.refetch();
      }}
    >
      <View className="mt-2 gap-3">
        {tiles.map((t, i) => (
          <Animated.View key={t.title} entering={FadeInDown.duration(420).delay(60 + i * 55).reduceMotion(ReduceMotion.System)}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={`${t.title}, ${t.sub}`}
              onPress={() => router.push(t.href)}
              scaleTo={0.98}
              className="flex-row items-center gap-[13px] rounded-md bg-white p-4 shadow-e2"
            >
              <IconTile icon={t.icon} tone={t.tone} />
              <View className="min-w-0 flex-1">
                <Text className="text-callout font-semibold text-cocoa">{t.title}</Text>
                <Text variant="meta" numberOfLines={1}>{t.sub}</Text>
              </View>
              <Icon name="chevRight" size={18} color="textMuted" />
            </PressableScale>
          </Animated.View>
        ))}
      </View>
    </ScreenScroll>
  );
}
