import { getSupabaseClient } from '@bakeflow/auth';
import { useDriverTrips, useDrivers, useWarehouses } from '@bakeflow/hooks';
import type { DriverTrip } from '@bakeflow/types';
import { Avatar, Badge, Chips, EmptyState, GroupLabel, List, ListRow, ScreenScroll, Skeleton } from '@bakeflow/ui';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { ErrorState, NoOrganizationState } from '../../components/ScreenState';
import { useBranchOptions } from '../../features/branch/hooks/useBranchOptions';
import { TRIP_STAGE, tripTime } from '../../features/driverTrip/tripDisplay';
import { startOfToday } from '../../features/tickets/ticketDisplay';
import { useSessionStore } from '../../stores/session';

const PAGE = { limit: 100 } as const;

/** What someone at the bakery has to do next, per stage. */
const NEXT_STEP: Partial<Record<DriverTrip['status'], string>> = {
  created: 'Verify the load',
  returning: 'Reconcile cash',
  reconciled: 'Settle into the till',
};

/**
 * Driver trips — the prototype's supervisor `trip-verify` hub, for everyone who verifies loads
 * or closes trips: which trips need a person at the bakery, and which are on the road.
 *
 * PORT-NOTE: the prototype follows a single hard-coded trip. Live, several drivers can be out at
 * once, so this lists every active trip at the branch plus today's completed ones; each opens its
 * stage-specific screen.
 */
export default function DriverTripsScreen(): React.JSX.Element {
  const router = useRouter();
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const branches = useBranchOptions();
  const [branchIndex, setBranchIndex] = useState(0);
  const branch = branches.options[branchIndex] ?? branches.options[0] ?? null;
  const since = useMemo(() => startOfToday(), []);

  const branchFilter = branch === null ? {} : { branchId: branch.branchId };
  const active = useDriverTrips(client, tenantId, { activeOnly: true, ...branchFilter }, PAGE);
  const today = useDriverTrips(client, tenantId, { status: 'completed', since, ...branchFilter }, PAGE);
  const drivers = useDrivers(client, tenantId);
  const warehouses = useWarehouses(client, tenantId);

  const name = useMemo(() => new Map((drivers.data ?? []).map((d) => [d.profile_id, d.full_name])), [drivers.data]);
  const vehicle = useMemo(() => new Map((warehouses.data ?? []).map((w) => [w.id, w.name])), [warehouses.data]);

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const rows = active.data?.rows ?? [];
  const needsYou = rows.filter((t) => NEXT_STEP[t.status] !== undefined);
  const out = rows.filter((t) => NEXT_STEP[t.status] === undefined);

  const row = (t: DriverTrip): React.JSX.Element => {
    const stage = TRIP_STAGE[t.status];
    const driver = name.get(t.driver_id) ?? 'Driver';
    return (
      <ListRow
        key={t.id}
        leading={<Avatar name={driver} />}
        title={driver}
        sub={[vehicle.get(t.warehouse_id), NEXT_STEP[t.status] ?? stage.label, tripTime(t.departed_at ?? t.created_at)].filter(Boolean).join(' · ')}
        trailing={<Badge label={NEXT_STEP[t.status] !== undefined ? 'Your turn' : stage.label} tone={NEXT_STEP[t.status] !== undefined ? 'pending' : stage.tone} />}
        onPress={() => router.push(`/trips/${t.id}`)}
      />
    );
  };

  return (
    <ScreenScroll
      title="Driver trips"
      sub={active.isLoading ? branch?.label : `${rows.length} active · ${needsYou.length} need you`}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/more'))}
      refreshing={active.isRefetching || today.isRefetching}
      onRefresh={() => {
        void active.refetch();
        void today.refetch();
      }}
    >
      {branches.options.length > 1 && (
        <Chips
          className="mt-2"
          accessibilityLabel="Branch"
          options={branches.options.map((b, i) => ({ key: String(i), label: b.label }))}
          value={String(branchIndex)}
          onChange={(k) => setBranchIndex(Number(k))}
        />
      )}

      {active.isLoading || branches.isLoading ? (
        <View className="mt-4 gap-2">
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </View>
      ) : active.isError ? (
        <ErrorState error={active.error} onRetry={() => void active.refetch()} />
      ) : rows.length === 0 && (today.data?.rows.length ?? 0) === 0 ? (
        <EmptyState
          icon="truck"
          title="No trips today"
          text="When a driver starts a trip it appears here, ready for you to verify the load."
        />
      ) : (
        <>
          {needsYou.length > 0 && (
            <>
              <GroupLabel>Needs you</GroupLabel>
              <List>{needsYou.map(row)}</List>
            </>
          )}
          {out.length > 0 && (
            <>
              <GroupLabel>On the road</GroupLabel>
              <List>{out.map(row)}</List>
            </>
          )}
          {(today.data?.rows.length ?? 0) > 0 && (
            <>
              <GroupLabel>Completed today</GroupLabel>
              <List>{(today.data?.rows ?? []).map(row)}</List>
            </>
          )}
        </>
      )}
    </ScreenScroll>
  );
}
