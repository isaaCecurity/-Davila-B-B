import { getSupabaseClient, rolesFromSession } from '@bakeflow/auth';
import { BakeflowApiError } from '@bakeflow/api';
import {
  useCurrentDriverTrip,
  useDepartDriverTrip,
  useReturnDriverTrip,
  useStartDriverTrip,
  useWarehouses,
} from '@bakeflow/hooks';
import { driverTripPhase, driverTripPhaseLabel, type DriverTrip, type Warehouse } from '@bakeflow/types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, LoadingState, NoOrganizationState } from '../../components/ScreenState';
import { useSessionStore } from '../../stores/session';

/**
 * Driver Home — ADR-001 Phase 5, first slice.
 *
 * ## The one screen ADR-001 §14 names first, and the one rule that governs it
 *
 * "The driver's UI should remain essentially: Load → Go → Sell → Record Payment →
 * Repeat → Return → Reconcile. The state machine can be complex underneath while the
 * driver's interaction remains simple." This screen never renders a raw `driver_trips`
 * status — `driverTripPhase()`/`driverTripPhaseLabel()` (`@bakeflow/types`) are the one
 * translation from the seven backend states to driver-facing language, so no other screen
 * has to invent its own copy for a status value.
 *
 * ## Two phases are load-bearing but not this screen's to act on
 *
 * `loading` (a supervisor/manager/baker verifies what was loaded) and `reconciled`
 * (management closes the trip out) are both real states this trip passes through, but
 * `verify_trip_loading()` and `complete_driver_trip()` are not callable by the driver at
 * all — see `mutations/driver-trips.ts`'s module header. This screen renders those as
 * passive "waiting on someone else" states rather than offering a button that would only
 * ever come back `insufficient_role`.
 *
 * ## What this slice does not include yet
 *
 * "Sell" now has its own screen (`app/driver/sell.tsx`) — cart from the catalog, create a
 * `draft` roadside ticket, record a payment. It deliberately stops at `draft`: see that
 * screen's header and `BLOCKERS.md` BLOCKER-021 for why no driver-facing "confirm" exists.
 * "Return" here only covers the common case ADR-001 §10 names explicitly ("a driver may
 * sell everything") — returning specific items needs a manifest-entry screen, not yet built.
 */
export default function DriverHomeScreen(): React.JSX.Element {
  const client = getSupabaseClient();
  const router = useRouter();
  const session = useSessionStore((s) => s.session);
  const activeTenantId = useSessionStore((s) => s.activeTenantId);
  const userId = useSessionStore((s) => s.userId);

  const trip = useCurrentDriverTrip(client, activeTenantId, userId);

  if (activeTenantId === null) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <NoOrganizationState onChoose={() => router.push('/select-organization')} />
      </SafeAreaView>
    );
  }

  const roles = rolesFromSession(session);
  if (!roles.includes('driver')) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <EmptyState
          title="Not a driver"
          detail="This screen is for the driver role. Ask a manager if you should have it."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="gap-1 border-b border-neutral-200 p-6 pb-4">
        <Text className="text-2xl font-bold text-neutral-900">Today</Text>
        <Text className="text-sm text-neutral-500">Your route, one step at a time</Text>
      </View>

      {trip.isPending ? (
        <LoadingState label="Checking your trip…" />
      ) : trip.isError ? (
        <ErrorState error={trip.error} onRetry={() => void trip.refetch()} />
      ) : trip.data === null ? (
        <NoActiveTrip tenantId={activeTenantId} />
      ) : (
        <ActiveTrip tenantId={activeTenantId} trip={trip.data} />
      )}
    </SafeAreaView>
  );
}

/* -------------------------------------------------------------------------- */
/* No trip yet — start one                                                    */
/* -------------------------------------------------------------------------- */

function NoActiveTrip({ tenantId }: { tenantId: string }): React.JSX.Element {
  const client = getSupabaseClient();
  const warehouses = useWarehouses(client, tenantId);
  const start = useStartDriverTrip(client, tenantId);
  const [selected, setSelected] = useState<Warehouse | null>(null);

  if (warehouses.isPending) return <LoadingState label="Loading vehicles…" />;
  if (warehouses.isError) {
    return <ErrorState error={warehouses.error} onRetry={() => void warehouses.refetch()} />;
  }
  if (warehouses.data.length === 0) {
    return (
      <EmptyState
        title="No vehicle set up"
        detail="Ask a manager to add a warehouse for your vehicle before you can start a trip."
      />
    );
  }

  return (
    <ScrollView contentContainerClassName="gap-4 p-6">
      <Text className="text-lg font-semibold text-neutral-900">Ready to load?</Text>
      <Text className="text-sm text-neutral-500">Pick your vehicle to start today&apos;s trip.</Text>

      <View className="gap-2">
        {warehouses.data.map((warehouse) => (
          <Pressable
            key={warehouse.id}
            accessibilityRole="button"
            accessibilityState={{ selected: selected?.id === warehouse.id }}
            onPress={() => setSelected(warehouse)}
            className={`rounded-lg border px-4 py-3 active:opacity-70 ${
              selected?.id === warehouse.id
                ? 'border-neutral-900 bg-neutral-50'
                : 'border-neutral-300'
            }`}
          >
            <Text className="text-base font-medium text-neutral-900">{warehouse.name}</Text>
          </Pressable>
        ))}
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={selected === null || start.isPending}
        onPress={() => {
          if (selected === null) return;
          start.mutate({ branchId: selected.branch_id, warehouseId: selected.id });
        }}
        className={`flex-row items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-3 active:opacity-70 ${
          selected === null || start.isPending ? 'opacity-40' : ''
        }`}
      >
        {start.isPending && <ActivityIndicator size="small" color="white" />}
        <Text className="text-base font-medium text-white">Start trip</Text>
      </Pressable>

      {start.isError && (
        <View className="gap-1 rounded-lg bg-red-50 p-3">
          <Text className="text-sm text-red-900">{describeError(start.error)}</Text>
        </View>
      )}
    </ScrollView>
  );
}

/* -------------------------------------------------------------------------- */
/* An active trip, rendered by driver-facing phase                            */
/* -------------------------------------------------------------------------- */

function ActiveTrip({ tenantId, trip }: { tenantId: string; trip: DriverTrip }): React.JSX.Element {
  const phase = driverTripPhase(trip.status);
  const label = driverTripPhaseLabel(phase);

  return (
    <ScrollView contentContainerClassName="gap-6 p-6">
      <View className="gap-1 rounded-xl border border-neutral-200 p-4">
        <Text className="text-xs font-semibold uppercase text-neutral-400">Trip status</Text>
        <Text className="text-xl font-bold text-neutral-900">{label}</Text>
      </View>

      {phase === 'starting' && (
        <Passive
          title="Waiting for loading"
          detail="A supervisor, manager, or baker needs to verify what's going in the vehicle before you can go."
        />
      )}

      {phase === 'loading' && trip.status === 'ready_to_depart' && (
        <DepartAction tenantId={tenantId} tripId={trip.id} />
      )}
      {phase === 'loading' && trip.status === 'loading' && (
        <Passive title="Loading" detail="Verification is in progress." />
      )}

      {phase === 'selling' && <OnTheRoad tenantId={tenantId} tripId={trip.id} />}

      {phase === 'returning' && (
        <Passive
          title="Waiting for reconciliation"
          detail="A manager will check your returned cash and stock against what you took out."
        />
      )}

      {phase === 'reconciling' && (
        <Passive
          title="Reconciled"
          detail="A manager still needs to close this trip out and settle your cash into the till."
        />
      )}
    </ScrollView>
  );
}

function Passive({ title, detail }: { title: string; detail: string }): React.JSX.Element {
  return (
    <View className="gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      <Text className="text-lg font-semibold text-neutral-900">{title}</Text>
      <Text className="text-sm text-neutral-500">{detail}</Text>
    </View>
  );
}

function DepartAction({ tenantId, tripId }: { tenantId: string; tripId: string }): React.JSX.Element {
  const client = getSupabaseClient();
  const depart = useDepartDriverTrip(client, tenantId);

  return (
    <View className="gap-3 rounded-xl border border-neutral-200 p-4">
      <Text className="text-lg font-semibold text-neutral-900">Loaded and verified</Text>
      <Text className="text-sm text-neutral-500">You&apos;re clear to leave the bakery.</Text>
      <Pressable
        accessibilityRole="button"
        disabled={depart.isPending}
        onPress={() => depart.mutate({ tripId })}
        className={`flex-row items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-3 active:opacity-70 ${
          depart.isPending ? 'opacity-40' : ''
        }`}
      >
        {depart.isPending && <ActivityIndicator size="small" color="white" />}
        <Text className="text-base font-medium text-white">Go</Text>
      </Pressable>
      {depart.isError && (
        <View className="gap-1 rounded-lg bg-red-50 p-3">
          <Text className="text-sm text-red-900">{describeError(depart.error)}</Text>
        </View>
      )}
    </View>
  );
}

function OnTheRoad({ tenantId, tripId }: { tenantId: string; tripId: string }): React.JSX.Element {
  const client = getSupabaseClient();
  const router = useRouter();
  const returnTrip = useReturnDriverTrip(client, tenantId);

  return (
    <View className="gap-4">
      <View className="gap-3 rounded-xl border border-neutral-200 p-4">
        <Text className="text-lg font-semibold text-neutral-900">On the road</Text>
        <Text className="text-sm text-neutral-500">
          Sell from the truck and record what customers hand over.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/driver/sell')}
          className="flex-row items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-3 active:opacity-70"
        >
          <Text className="text-base font-medium text-white">Sell</Text>
        </Pressable>
      </View>

      <View className="gap-3 rounded-xl border border-neutral-200 p-4">
        <Text className="text-lg font-semibold text-neutral-900">Back at the bakery?</Text>
        <Text className="text-sm text-neutral-500">
          If you sold everything, return the trip with nothing left over. Returning specific
          items isn&apos;t built yet — ask a manager if you&apos;re bringing stock back.
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={returnTrip.isPending}
          onPress={() => returnTrip.mutate({ tripId, input: { items: [] } })}
          className={`flex-row items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-3 active:opacity-70 ${
            returnTrip.isPending ? 'opacity-40' : ''
          }`}
        >
          {returnTrip.isPending && <ActivityIndicator size="small" />}
          <Text className="text-base font-medium text-neutral-900">
            Return trip (nothing left)
          </Text>
        </Pressable>
        {returnTrip.isError && (
          <View className="gap-1 rounded-lg bg-red-50 p-3">
            <Text className="text-sm text-red-900">{describeError(returnTrip.error)}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * User-facing copy per machine code, same discipline as `DeliveryActions.tsx`'s
 * `describe()`: `code` is the only thing branched on, server text is never rendered.
 */
function describeError(error: Error): string {
  const code = error instanceof BakeflowApiError ? error.code : 'unexpected_error';
  switch (code) {
    case 'invalid_transition':
      return 'That is no longer possible — this trip has moved on. Pull to refresh.';
    case 'insufficient_role':
      return 'You are not able to do that.';
    case 'session_expired':
      return 'Your session has expired. Sign in again.';
    case 'network_unavailable':
      return 'No connection. This has not been saved.';
    case 'invalid_request':
      return 'Something in that request was not accepted.';
    default:
      return 'That did not work. Nothing has been changed.';
  }
}
