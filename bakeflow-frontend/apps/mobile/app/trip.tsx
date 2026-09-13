import { getSupabaseClient } from '@bakeflow/auth';
import {
  useCurrentDriverTrip,
  useDepartDriverTrip,
  useDriverTripTickets,
  useReturnDriverTrip,
  useStartDriverTrip,
  useWarehouses,
} from '@bakeflow/hooks';
import type { DriverTrip } from '@bakeflow/types';
import {
  Badge,
  Button,
  Callout,
  Card,
  Chips,
  EmptyState,
  GroupLabel,
  Icon,
  IconTile,
  List,
  ListRow,
  PressableScale,
  ScreenScroll,
  Skeleton,
  Text,
} from '@bakeflow/ui';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';

import { ErrorState, NoOrganizationState } from '../components/ScreenState';
import { useActivePersona } from '../features/auth/hooks/useActivePersona';
import { CountStepper } from '../features/driverTrip/components/CountStepper';
import { useWarehouseStock, type StockLine } from '../features/driverTrip/hooks/useWarehouseStock';
import { isPositiveQuantity } from '../features/driverTrip/quantity';
import { describeTripError, TRIP_STAGE, tripTime } from '../features/driverTrip/tripDisplay';
import { trimQuantity } from '../features/tickets/ticketDisplay';
import { useSessionStore } from '../stores/session';
import { toast } from '../stores/ui/toast.store';

const STEP_ENTER = FadeIn.duration(215).reduceMotion(ReduceMotion.System);

/** The prototype's ink stage card. */
function StageHero({ trip, eyebrow, title, sub }: { trip: DriverTrip | null; eyebrow: string; title: string; sub?: string }): React.JSX.Element {
  const stage = trip === null ? null : TRIP_STAGE[trip.status];
  return (
    <Card tone="ink" className="mt-2 rounded-lg p-5">
      <View className="flex-row items-start gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-caption font-semibold uppercase tracking-[1.2px] text-white/50">{eyebrow}</Text>
          <Text className="mt-1.5 text-title-1 font-bold tracking-[-0.6px] text-white">{title}</Text>
          {sub !== undefined && <Text className="mt-1 text-foot text-white/60">{sub}</Text>}
        </View>
        <View className="h-11 w-11 items-center justify-center rounded-[14px] bg-white/10">
          <Icon name={stage?.icon ?? 'truck'} size={21} color="white" />
        </View>
      </View>
    </Card>
  );
}

function StockList({ lines, empty }: { lines: StockLine[]; empty: string }): React.JSX.Element {
  if (lines.length === 0) return <Text variant="meta">{empty}</Text>;
  return (
    <List>
      {lines.map((l) => (
        <ListRow
          key={l.variantId}
          leading={<IconTile icon="box" size="sm" />}
          title={l.label}
          sub={l.sku ?? undefined}
          end={trimQuantity(l.quantity)}
          chevron={false}
        />
      ))}
    </List>
  );
}

/**
 * Trip — the prototype's driver `trip`: Load → Go → Sell → Return, one stage at a time.
 *
 * Each stage is the live `driver_trips` status; each step is its RPC — `start_driver_trip`,
 * `depart_driver_trip`, `return_driver_trip` — and the steps a driver may not take (verifying the
 * load, reconciling, settling) render as "waiting on someone" rather than as buttons that could
 * only be refused. "Stock with you" is the vehicle warehouse's own product levels, which the
 * ledger keeps exact through loading, sales and return.
 *
 * PORT-NOTE: in the prototype the driver enters the load and picks a verifier. Live, loading is
 * one-party (ADR-001 §23 item 5): the verifier records and verifies it on their own device
 * (`/trip-verify`). "Held by you" cash and sold-per-product counts are sums over payments and
 * sales; the hero shows sale count instead, and cash is reconciled server-side.
 */
export default function TripScreen(): React.JSX.Element {
  const router = useRouter();
  const client = getSupabaseClient();
  const persona = useActivePersona();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const userId = useSessionStore((s) => s.userId);
  const trip = useCurrentDriverTrip(client, tenantId, userId);
  const current = trip.data ?? null;

  const back = (): void => (router.canGoBack() ? router.back() : router.replace('/'));

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  return (
    <ScreenScroll
      title="Trip"
      sub={current === null ? (trip.isLoading ? undefined : 'No trip today yet') : TRIP_STAGE[current.status].label}
      onBack={back}
      refreshing={trip.isRefetching}
      onRefresh={() => void trip.refetch()}
    >
      {persona !== 'driver' && (
        <Callout
          className="mt-2"
          tone="info"
          title="This is the driver's view"
          detail="Verifying loads and reconciling trips happen under Driver trips."
        />
      )}
      {trip.isLoading ? (
        <View className="mt-2 gap-3">
          <Skeleton variant="row" className="h-[120px]" />
          <Skeleton variant="row" />
        </View>
      ) : trip.isError ? (
        <ErrorState error={trip.error} onRetry={() => void trip.refetch()} />
      ) : (
        <Animated.View key={current?.status ?? 'none'} entering={STEP_ENTER}>
          {current === null ? (
            <StartTrip />
          ) : current.status === 'created' || current.status === 'loading' ? (
            <>
              <StageHero trip={current} eyebrow="Load stock" title="Waiting for loading" sub={`Started ${tripTime(current.created_at) ?? ''}`} />
              <Card tone="recessed" className="mt-4 flex-row items-start gap-3 p-4">
                <IconTile icon="users" tone="warn" size="sm" />
                <Text variant="meta" className="flex-1">
                  A supervisor, manager or baker counts what goes on the vehicle and verifies it on their phone. You can leave once it is verified.
                </Text>
              </Card>
            </>
          ) : current.status === 'ready_to_depart' ? (
            <Depart trip={current} />
          ) : current.status === 'in_transit' ? (
            <OnTheRoad trip={current} />
          ) : (
            <>
              <StageHero
                trip={current}
                eyebrow="Back at the bakery"
                title={current.status === 'returning' ? 'Reconciling' : 'Settling cash'}
                sub={`Returned ${tripTime(current.returned_at) ?? ''}`}
              />
              <Card tone="recessed" className="mt-4 items-center gap-2 p-6">
                <IconTile icon="clock" tone="accent" />
                <Text variant="subtitle" className="text-center">
                  {current.status === 'returning' ? 'A manager is checking your trip' : 'Almost done'}
                </Text>
                <Text variant="meta" className="text-center">
                  {current.status === 'returning'
                    ? 'They count the cash you brought back against your sales.'
                    : 'A manager still needs to settle your cash into the till to close the trip.'}
                </Text>
              </Card>
            </>
          )}
        </Animated.View>
      )}
    </ScreenScroll>
  );
}

function StartTrip(): React.JSX.Element {
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const warehouses = useWarehouses(client, tenantId);
  const start = useStartDriverTrip(client, tenantId);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const vehicle = (warehouses.data ?? []).find((w) => w.id === vehicleId) ?? null;

  if (warehouses.isLoading) return <Skeleton variant="row" className="mt-2 h-[120px]" />;
  if (warehouses.isError) return <ErrorState error={warehouses.error} onRetry={() => void warehouses.refetch()} />;
  if ((warehouses.data ?? []).length === 0) {
    return <EmptyState icon="truck" title="No vehicle set up" text="Ask a manager to add a stockroom for your vehicle before you start a trip." />;
  }

  return (
    <>
      <StageHero trip={null} eyebrow="Today" title="Ready to load?" sub="Pick your vehicle to start the trip." />
      <GroupLabel>Your vehicle</GroupLabel>
      <Chips
        accessibilityLabel="Vehicle"
        options={(warehouses.data ?? []).map((w) => ({ key: w.id, label: w.name }))}
        value={vehicleId ?? ''}
        onChange={setVehicleId}
      />
      {start.isError && <Callout className="mt-4" tone="error" title="Trip not started" detail={describeTripError(start.error)} />}
      <Button
        className="mt-5"
        label="Start trip"
        disabled={vehicle === null}
        busy={start.isPending}
        onPress={() => {
          if (vehicle === null) return;
          start.mutate(
            { branchId: vehicle.branch_id, warehouseId: vehicle.id },
            { onSuccess: () => toast({ tone: 'success', title: 'Trip started', text: `${vehicle.name} · waiting for loading` }) }
          );
        }}
        block
      />
    </>
  );
}

function Depart({ trip }: { trip: DriverTrip }): React.JSX.Element {
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const depart = useDepartDriverTrip(client, tenantId);
  const stock = useWarehouseStock(trip.warehouse_id, { inStockOnly: true });

  return (
    <>
      <StageHero trip={trip} eyebrow="Ready to depart" title="Loaded and verified" sub={`Verified ${tripTime(trip.loading_verified_at) ?? ''}`} />
      <GroupLabel>Loaded stock</GroupLabel>
      {stock.isLoading ? <Skeleton variant="row" /> : <StockList lines={stock.lines} empty="Nothing is recorded on the vehicle." />}
      {depart.isError && <Callout className="mt-4" tone="error" title="Could not depart" detail={describeTripError(depart.error)} />}
      <Button
        className="mt-5"
        label="Confirm departure"
        busy={depart.isPending}
        onPress={() =>
          depart.mutate(
            { tripId: trip.id },
            { onSuccess: () => toast({ tone: 'success', title: 'Trip started', text: 'Loaded stock is now with you on the road' }) }
          )
        }
        block
      />
    </>
  );
}

function OnTheRoad({ trip }: { trip: DriverTrip }): React.JSX.Element {
  const router = useRouter();
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const stock = useWarehouseStock(trip.warehouse_id, { inStockOnly: true });
  const sales = useDriverTripTickets(client, tenantId, trip.id);
  const returnTrip = useReturnDriverTrip(client, tenantId);
  const [counting, setCounting] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});

  const saleCount = sales.data?.rows.length ?? 0;
  const items = useMemo(
    () =>
      stock.lines
        .map((l) => ({ itemType: 'product' as const, itemId: l.variantId, quantity: counts[l.variantId] ?? trimQuantity(l.quantity) }))
        .filter((i) => i.quantity !== '' && i.quantity !== '0'),
    [stock.lines, counts]
  );
  const invalid = items.some((i) => !isPositiveQuantity(i.quantity));

  if (counting) {
    return (
      <>
        <GroupLabel>Count what&apos;s left</GroupLabel>
        <Text variant="meta" className="mb-3">
          Enter the stock physically still on the vehicle. It starts at what the ledger says is there.
        </Text>
        {stock.lines.length === 0 ? (
          <Text variant="meta">Nothing is recorded on the vehicle — you sold everything.</Text>
        ) : (
          <List>
            {stock.lines.map((l) => (
              <View key={l.variantId} className="flex-row items-center gap-3 px-4 py-2.5">
                <View className="min-w-0 flex-1">
                  <Text className="text-callout font-semibold text-cocoa" numberOfLines={1}>{l.label}</Text>
                  <Text variant="caption">Expected {trimQuantity(l.quantity)}</Text>
                </View>
                <CountStepper
                  label={l.label}
                  value={counts[l.variantId] ?? trimQuantity(l.quantity)}
                  onChange={(v) => setCounts((c) => ({ ...c, [l.variantId]: v }))}
                />
              </View>
            ))}
          </List>
        )}
        {invalid && <Callout className="mt-3" tone="warning" title="Check the counts" detail="Use whole numbers or up to 4 decimal places." />}
        {returnTrip.isError && <Callout className="mt-3" tone="error" title="Return not recorded" detail={describeTripError(returnTrip.error)} />}
        <View className="mt-5 gap-2.5">
          <Button
            label="Submit return"
            disabled={invalid}
            busy={returnTrip.isPending}
            onPress={() =>
              returnTrip.mutate(
                { tripId: trip.id, input: { items } },
                { onSuccess: () => toast({ tone: 'success', title: 'Stock returned', text: 'Ready for reconciliation' }) }
              )
            }
            block
          />
          <Button label="Back to the road" tone="secondary" onPress={() => setCounting(false)} block />
        </View>
      </>
    );
  }

  return (
    <>
      <StageHero
        trip={trip}
        eyebrow="On the road since"
        title={tripTime(trip.departed_at) ?? '—'}
        sub={sales.isLoading ? ' ' : `${saleCount}${sales.data?.nextCursor != null ? '+' : ''} sale${saleCount === 1 ? '' : 's'} on this trip`}
      />

      {/* The prototype's `.drive-cta`: one enormous primary action. */}
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Create ticket. Customer, products, payment"
        onPress={() => router.push('/driver/sell')}
        scaleTo={0.98}
        className="mt-3 flex-row items-center gap-3.5 rounded-lg bg-apricot px-5 py-4 shadow-e2"
      >
        <View className="h-12 w-12 items-center justify-center rounded-[15px] bg-white/25">
          <Icon name="plus" size={26} color="white" />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-title-3 font-bold text-white">Create ticket</Text>
          <Text className="text-foot text-white/80">Products and payment</Text>
        </View>
        <Icon name="arrowRight" size={20} color="white" />
      </PressableScale>

      <GroupLabel>Stock with you</GroupLabel>
      {stock.isLoading ? (
        <Skeleton variant="row" />
      ) : stock.isError ? (
        <ErrorState error={stock.error ?? new Error('Could not load the vehicle stock.')} onRetry={() => void stock.refetch()} />
      ) : (
        <StockList lines={stock.lines} empty="Nothing left on the vehicle." />
      )}
      {!stock.isLoading && stock.lines.length > 0 && (
        <View className="mt-2 flex-row items-center gap-2 px-0.5">
          <Badge label="Live" tone="live" icon="refresh" />
          <Text variant="caption" className="flex-1">Counts drop as each sale completes.</Text>
        </View>
      )}

      <Button className="mt-6" label="Start return to bakery" tone="secondary" onPress={() => setCounting(true)} block />
    </>
  );
}
