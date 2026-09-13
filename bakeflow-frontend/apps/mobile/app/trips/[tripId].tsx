import { getSupabaseClient } from '@bakeflow/auth';
import {
  useCashSessions,
  useCompleteDriverTrip,
  useDriverTrip,
  useDriverTripTickets,
  useDrivers,
  useReconcileDriverTrip,
  useStockMovementPages,
  useVerifyTripLoading,
  useWarehouses,
} from '@bakeflow/hooks';
import type { DriverTrip } from '@bakeflow/types';
import { isZeroDecimalString } from '@bakeflow/types';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  Chips,
  EmptyState,
  Field,
  GroupLabel,
  IconTile,
  List,
  ListRow,
  ScreenScroll,
  Skeleton,
  Text,
} from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import { nonNegativeMoneySchema } from '@bakeflow/validation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';

import { ErrorState, NoOrganizationState } from '../../components/ScreenState';
import { useVariantLabels } from '../../features/catalog/hooks/useVariantLabels';
import { CountStepper } from '../../features/driverTrip/components/CountStepper';
import { useWarehouseStock } from '../../features/driverTrip/hooks/useWarehouseStock';
import { isPositiveQuantity, sumQuantities } from '../../features/driverTrip/quantity';
import { describeTripError, TRIP_STAGE, tripTime } from '../../features/driverTrip/tripDisplay';
import { varianceView, when } from '../../features/finance/financeDisplay';
import { STATUS_META, trimQuantity } from '../../features/tickets/ticketDisplay';
import { useSessionStore } from '../../stores/session';
import { toast } from '../../stores/ui/toast.store';

const STEP_ENTER = FadeIn.duration(215).reduceMotion(ReduceMotion.System);

/**
 * One driver trip, from the bakery's side — the prototype's `trip-verify` and `trip-reconcile`.
 *
 * - `created` → count and verify the load (`verify_trip_loading`, from the branch's default
 *   stockroom). Owner, admin, manager, supervisor or baker; never the driver.
 * - `returning` → the inventory ledger for the trip and the cash count (`reconcile_driver_trip`).
 *   The server computes expected cash from the trip's own payments and the variance.
 * - `reconciled` → choose the open till the cash settles into (`complete_driver_trip`).
 * - otherwise a read-only review.
 *
 * Who may take each step is each RPC's decision; refusals are shown as returned.
 *
 * PORT-NOTE: the prototype requires a variance note when *returned stock* differs from
 * expected and flags a completed reconciliation for correction. Live, only a *cash* variance
 * needs a note (`driver_trips_variance_needs_note`) and a completed trip is terminal — so stock
 * is shown line by line for the reviewer, and there is no reopen. Per-method cash totals and
 * "customer credit created" are money sums; the server's expected cash stands in for them.
 */
export default function DriverTripDetailScreen(): React.JSX.Element {
  const router = useRouter();
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  const id = typeof tripId === 'string' && tripId !== '' ? tripId : null;
  const trip = useDriverTrip(client, tenantId, id);
  const drivers = useDrivers(client, tenantId);
  const warehouses = useWarehouses(client, tenantId);

  const back = (): void => (router.canGoBack() ? router.back() : router.replace('/trips'));

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const row = trip.data ?? null;
  const driver = row === null ? null : (drivers.data?.find((d) => d.profile_id === row.driver_id)?.full_name ?? 'Driver');
  const vehicleName = row === null ? null : (warehouses.data?.find((w) => w.id === row.warehouse_id)?.name ?? 'Vehicle');

  return (
    <ScreenScroll
      title={driver ?? 'Driver trip'}
      sub={row === null ? undefined : TRIP_STAGE[row.status].label}
      onBack={back}
      refreshing={trip.isRefetching}
      onRefresh={() => void trip.refetch()}
    >
      {trip.isLoading ? (
        <View className="mt-2 gap-3">
          <Skeleton variant="row" className="h-[88px]" />
          <Skeleton variant="row" className="h-[200px]" />
        </View>
      ) : trip.isError ? (
        <ErrorState error={trip.error} onRetry={() => void trip.refetch()} />
      ) : row === null ? (
        <EmptyState icon="truck" title="Trip not found" text="It may belong to a branch you cannot see." />
      ) : (
        <>
          <Card className="mt-2 flex-row items-center gap-[13px]">
            <Avatar name={driver ?? 'Driver'} size="lg" />
            <View className="min-w-0 flex-1">
              <Text variant="subtitle" numberOfLines={1}>{driver}</Text>
              <Text variant="meta" numberOfLines={1}>
                {vehicleName} · started {tripTime(row.created_at)}
              </Text>
            </View>
            <Badge label={TRIP_STAGE[row.status].label.split(' · ')[0] ?? ''} tone={TRIP_STAGE[row.status].tone} icon={TRIP_STAGE[row.status].icon} />
          </Card>

          <Animated.View key={row.status} entering={STEP_ENTER}>
            {row.status === 'created' || row.status === 'loading' ? (
              <VerifyLoad trip={row} />
            ) : row.status === 'returning' ? (
              <Reconcile trip={row} />
            ) : row.status === 'reconciled' ? (
              <Settle trip={row} />
            ) : (
              <Review trip={row} />
            )}
          </Animated.View>
        </>
      )}
    </ScreenScroll>
  );
}

/* ------------------------------------------------------------------ verify --- */

function VerifyLoad({ trip }: { trip: DriverTrip }): React.JSX.Element {
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const warehouses = useWarehouses(client, tenantId, trip.branch_id);
  const source = (warehouses.data ?? []).find((w) => w.is_default) ?? null;
  const stock = useWarehouseStock(source?.id ?? null, { inStockOnly: true });
  const verify = useVerifyTripLoading(client, tenantId);
  const [counts, setCounts] = useState<Record<string, string>>({});

  const items = Object.entries(counts)
    .filter(([, q]) => q !== '' && q !== '0')
    .map(([itemId, quantity]) => ({ itemType: 'product' as const, itemId, quantity }));
  const invalid = items.some((i) => !isPositiveQuantity(i.quantity));

  return (
    <>
      <GroupLabel>Load stock for this trip</GroupLabel>
      <Text variant="meta" className="mb-3">
        Count what goes on the vehicle{source === null ? '' : ` from ${source.name}`}. Saving records the load and verifies it in one step.
      </Text>
      {warehouses.isLoading || stock.isLoading ? (
        <Skeleton variant="row" className="h-[160px]" />
      ) : source === null ? (
        <Callout tone="warning" title="No default stockroom" detail="This branch needs a default stockroom to load trips from." />
      ) : stock.lines.length === 0 ? (
        <Callout tone="warning" title="Nothing in stock" detail={`${source.name} has no product stock to load.`} />
      ) : (
        <List>
          {stock.lines.map((l) => (
            <View key={l.variantId} className="flex-row items-center gap-3 px-4 py-2.5">
              <View className="min-w-0 flex-1">
                <Text className="text-callout font-semibold text-cocoa" numberOfLines={1}>{l.label}</Text>
                <Text variant="caption">{trimQuantity(l.quantity)} in bakery stock</Text>
              </View>
              <CountStepper
                label={l.label}
                value={counts[l.variantId] ?? '0'}
                step={10}
                onChange={(v) => setCounts((c) => ({ ...c, [l.variantId]: v }))}
              />
            </View>
          ))}
        </List>
      )}
      {invalid && <Callout className="mt-3" tone="warning" title="Check the counts" detail="Use whole numbers or up to 4 decimal places." />}
      {verify.isError && <Callout className="mt-3" tone="error" title="Load not verified" detail={describeTripError(verify.error)} />}
      <Button
        className="mt-5"
        label={items.length === 0 ? 'Confirm loading' : `Confirm loading · ${items.length} product${items.length === 1 ? '' : 's'}`}
        disabled={items.length === 0 || invalid}
        busy={verify.isPending}
        onPress={() =>
          verify.mutate(
            { tripId: trip.id, input: source === null ? { items } : { items, sourceWarehouseId: source.id } },
            { onSuccess: () => toast({ tone: 'success', title: 'Stock loaded', text: 'Verified — the driver can depart' }) }
          )
        }
        block
      />
    </>
  );
}

/* -------------------------------------------------------------- inventory --- */

interface LedgerLine {
  variantId: string;
  loaded: string;
  sold: string;
  returned: string;
}

/**
 * The trip's movements in its vehicle stockroom, per product. Quantities are added exactly
 * (`sumQuantities`); money never is.
 */
function useTripLedger(trip: DriverTrip) {
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const moves = useStockMovementPages(client, tenantId, { warehouseId: trip.warehouse_id, since: trip.created_at }, { limit: 200 });

  const lines = useMemo<LedgerLine[]>(() => {
    const rows = (moves.data?.pages ?? []).flatMap((p) => p.rows).filter(
      // Bounded to this trip: its own window in the vehicle stockroom.
      (m) => m.product_variant_id !== null && (trip.returned_at === null || m.created_at <= trip.returned_at)
    );
    const by = new Map<string, { loaded: string[]; sold: string[]; returned: string[] }>();
    for (const m of rows) {
      const key = m.product_variant_id as string;
      const bucket = by.get(key) ?? { loaded: [], sold: [], returned: [] };
      if (m.reason === 'transfer_in') bucket.loaded.push(m.quantity_delta);
      else if (m.reason === 'sale') bucket.sold.push(m.quantity_delta.replace(/^-/, ''));
      else if (m.reason === 'transfer_out') bucket.returned.push(m.quantity_delta.replace(/^-/, ''));
      by.set(key, bucket);
    }
    return [...by.entries()].map(([variantId, b]) => ({
      variantId,
      loaded: sumQuantities(b.loaded),
      sold: sumQuantities(b.sold),
      returned: sumQuantities(b.returned),
    }));
  }, [moves.data, trip.returned_at]);

  return {
    lines,
    isLoading: moves.isLoading,
    isError: moves.isError,
    error: moves.error,
    truncated: moves.hasNextPage === true,
    refetch: () => void moves.refetch(),
  };
}

function Inventory({ trip }: { trip: DriverTrip }): React.JSX.Element {
  const ledger = useTripLedger(trip);
  const vehicle = useWarehouseStock(trip.warehouse_id);
  const { labels } = useVariantLabels();
  const leftOn = new Map(vehicle.lines.map((l) => [l.variantId, l.quantity]));

  return (
    <>
      <GroupLabel>Inventory</GroupLabel>
      {ledger.isLoading ? (
        <Skeleton variant="row" className="h-[120px]" />
      ) : ledger.isError ? (
        <ErrorState error={ledger.error ?? new Error('Could not load trip stock.')} onRetry={ledger.refetch} />
      ) : ledger.lines.length === 0 ? (
        <Text variant="meta">No stock movements recorded for this trip.</Text>
      ) : (
        <Card className="px-4 py-1">
          {ledger.lines.map((l, i) => {
            const remaining = leftOn.get(l.variantId);
            const unaccounted = remaining !== undefined && !isZeroDecimalString(remaining);
            return (
              <View key={l.variantId} className={`flex-row items-center gap-3 py-3 ${i > 0 ? 'border-t border-border' : ''}`}>
                <View className="min-w-0 flex-1">
                  <Text className="text-callout font-semibold text-cocoa" numberOfLines={1}>
                    {labels.get(l.variantId)?.label ?? 'Unnamed product'}
                  </Text>
                  <Text variant="caption">
                    Loaded {l.loaded} · sold {l.sold} · returned {l.returned}
                  </Text>
                </View>
                {unaccounted ? (
                  <Badge label={`${trimQuantity(remaining)} still on vehicle`} tone="pending" icon="alert" />
                ) : (
                  <Badge label="Balanced" tone="ok" />
                )}
              </View>
            );
          })}
        </Card>
      )}
      {ledger.truncated && <Text variant="caption" className="mt-2">Showing the first 200 movements of this trip.</Text>}
    </>
  );
}

function Sales({ trip }: { trip: DriverTrip }): React.JSX.Element {
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const router = useRouter();
  const tickets = useDriverTripTickets(getSupabaseClient(), tenantId, trip.id);
  const rows = tickets.data?.rows ?? [];
  return (
    <>
      <GroupLabel>Sales on this trip</GroupLabel>
      {tickets.isLoading ? (
        <Skeleton variant="row" />
      ) : rows.length === 0 ? (
        <Text variant="meta">No sales were recorded on this trip.</Text>
      ) : (
        <List>
          {rows.map((t) => (
            <ListRow
              key={t.id}
              leading={<IconTile icon="receipt" size="sm" />}
              title={t.ticket_number}
              sub={`${STATUS_META[t.status].label} · paid ${formatNaira(t.amount_paid)}`}
              end={formatNaira(t.total_amount)}
              onPress={() => router.push(`/order/${t.id}`)}
            />
          ))}
        </List>
      )}
    </>
  );
}

/* -------------------------------------------------------------- reconcile --- */

function Reconcile({ trip }: { trip: DriverTrip }): React.JSX.Element {
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const reconcile = useReconcileDriverTrip(client, tenantId);
  const [cash, setCash] = useState('');
  const [note, setNote] = useState('');
  const parsed = nonNegativeMoneySchema.safeParse(cash.trim());
  const hint = cash.trim() === '' || parsed.success ? null : 'Enter an amount like 45000 or 45000.50';
  const needsNote = reconcile.error !== null && describeTripError(reconcile.error).startsWith('The cash does not match');

  return (
    <>
      <Inventory trip={trip} />
      <Sales trip={trip} />

      <GroupLabel>Cash the driver brought back</GroupLabel>
      <View className="gap-3">
        <Field
          label="Counted cash (₦)"
          value={cash}
          onChangeText={setCash}
          keyboardType="decimal-pad"
          inputMode="decimal"
          placeholder="e.g. 45000"
          error={hint}
          hint="Count cash only. Transfers and POS are already recorded against each sale."
        />
        <Field
          label={needsNote ? 'Variance note (required)' : 'Variance note (if it does not match)'}
          value={note}
          onChangeText={setNote}
          placeholder="Why the cash differs"
          multiline
        />
        {reconcile.isError && <Callout tone={needsNote ? 'warning' : 'error'} title="Not reconciled" detail={describeTripError(reconcile.error)} />}
        <Button
          label="Reconcile trip"
          disabled={!parsed.success}
          busy={reconcile.isPending}
          onPress={() => {
            if (!parsed.success) return;
            reconcile.mutate(
              { tripId: trip.id, input: note.trim() === '' ? { physicalCash: parsed.data } : { physicalCash: parsed.data, varianceNote: note.trim() } },
              { onSuccess: () => toast({ tone: 'success', title: 'Trip reconciled', text: 'Settle its cash into the till to finish' }) }
            );
          }}
          block
        />
      </View>
    </>
  );
}

function CashSummary({ trip }: { trip: DriverTrip }): React.JSX.Element {
  const v = varianceView(trip.cash_variance);
  return (
    <Card className="px-4 py-2">
      {([
        ['Expected cash', trip.expected_cash],
        ['Counted cash', trip.physical_cash],
      ] as const).map(([k, val]) => (
        <View key={k} className="flex-row items-center py-2.5">
          <Text variant="meta" className="flex-1">{k}</Text>
          <Text tabular className="text-foot font-semibold text-cocoa">{val === null ? '—' : formatNaira(val)}</Text>
        </View>
      ))}
      <View className="flex-row items-center border-t border-border py-3">
        <Text className="flex-1 text-foot font-semibold text-cocoa">Variance</Text>
        {v === null ? <Text variant="meta">—</Text> : <Badge label={v.label === 'Balanced' ? 'Balanced' : `${v.label} ${v.amount}`} tone={v.tone} />}
      </View>
      {trip.cash_variance_note !== null && <Text variant="meta" className="pb-3">“{trip.cash_variance_note}”</Text>}
    </Card>
  );
}

function Settle({ trip }: { trip: DriverTrip }): React.JSX.Element {
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const sessions = useCashSessions(client, tenantId, trip.branch_id);
  const complete = useCompleteDriverTrip(client, tenantId);
  const open = (sessions.data ?? []).filter((s) => s.status === 'open');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const chosen = open.find((s) => s.id === sessionId) ?? (open.length === 1 ? open[0] : undefined);

  return (
    <>
      <GroupLabel>Cash reconciled</GroupLabel>
      <CashSummary trip={trip} />
      <Inventory trip={trip} />

      <GroupLabel>Settle into the till</GroupLabel>
      {sessions.isLoading ? (
        <Skeleton variant="row" />
      ) : open.length === 0 ? (
        <Callout tone="warning" title="No open till at this branch" detail="Open a cash session first — the trip's cash settles into it." />
      ) : (
        open.length > 1 && (
          <Chips
            accessibilityLabel="Till session"
            options={open.map((s) => ({ key: s.id, label: `Opened ${when(s.opened_at)}` }))}
            value={chosen?.id ?? ''}
            onChange={setSessionId}
          />
        )
      )}
      {chosen !== undefined && <Text variant="meta" className="mt-2">Settles into the till opened {when(chosen.opened_at)}.</Text>}
      {complete.isError && <Callout className="mt-3" tone="error" title="Trip not completed" detail={describeTripError(complete.error)} />}
      <Button
        className="mt-5"
        label="Settle & complete trip"
        disabled={chosen === undefined}
        busy={complete.isPending}
        onPress={() => {
          if (chosen === undefined) return;
          complete.mutate(
            { tripId: trip.id, input: { settlementCashSessionId: chosen.id } },
            { onSuccess: () => toast({ tone: 'success', title: 'Trip completed', text: 'Cash settled into the till' }) }
          );
        }}
        block
      />
    </>
  );
}

function Review({ trip }: { trip: DriverTrip }): React.JSX.Element {
  const onRoad = trip.status === 'ready_to_depart' || trip.status === 'in_transit';
  return (
    <>
      <GroupLabel>{onRoad ? 'Load verified' : 'Trip completed'}</GroupLabel>
      <Card tone="recessed" className="flex-row items-center gap-3 p-4">
        <IconTile icon={onRoad ? 'checkCircle' : 'check'} tone="ok" size="sm" />
        <Text variant="meta" className="flex-1">
          {onRoad
            ? `Verified ${tripTime(trip.loading_verified_at) ?? ''}${trip.departed_at === null ? ' · waiting for the driver to depart' : ` · departed ${tripTime(trip.departed_at) ?? ''}`}`
            : `Reconciled ${tripTime(trip.reconciled_at) ?? ''} · cash settled into the till`}
        </Text>
      </Card>
      {!onRoad && (
        <>
          <GroupLabel>Cash</GroupLabel>
          <CashSummary trip={trip} />
        </>
      )}
      <Inventory trip={trip} />
      <Sales trip={trip} />
    </>
  );
}
