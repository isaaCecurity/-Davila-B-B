import { getSupabaseClient } from '@bakeflow/auth';
import { useDrivers } from '@bakeflow/hooks';
import type { Uuid } from '@bakeflow/types';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

/**
 * The "assign a driver" control for a `pending` delivery — P9.6.
 *
 * `listDrivers()` (`packages/api/queries/staff.ts`) is a new read path this component is
 * the first and only consumer of: every tenant member holding the `driver` role, which is
 * exactly the set `transition_delivery()` itself will accept for `p_driver_id`. See that
 * module's header for why the list is tenant-wide rather than narrowed to this delivery's
 * branch — the RPC checks nothing narrower, so filtering here would invent a rule the
 * database does not have.
 *
 * Collapsed-by-default, matching `AdjustStockAction`: the driver list is fetched only once
 * the dispatcher actually intends to assign someone, not on every render of a pending
 * delivery's card.
 */
export function DriverPicker({
  tenantId,
  busy,
  onAssign,
}: {
  tenantId: string | null;
  /** Whether the parent's `transition_delivery('assigned', …)` call is in flight. */
  busy: boolean;
  onAssign: (driverId: Uuid) => void;
}): React.JSX.Element {
  const client = getSupabaseClient();
  const [open, setOpen] = useState(false);
  const drivers = useDrivers(client, tenantId);

  if (!open) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        className="items-center rounded-lg bg-neutral-900 px-4 py-3 active:opacity-70"
      >
        <Text className="text-base font-medium text-white">Assign a driver</Text>
      </Pressable>
    );
  }

  return (
    <View className="gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-neutral-900">Choose a driver</Text>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => setOpen(false)}>
          <Text className="text-sm text-neutral-500">Cancel</Text>
        </Pressable>
      </View>

      {drivers.isPending && <ActivityIndicator size="small" />}

      {drivers.isError && (
        <Text className="text-sm text-red-900">
          Could not load the driver list. Pull to refresh and try again.
        </Text>
      )}

      {drivers.isSuccess && drivers.data.length === 0 && (
        <Text className="text-sm text-neutral-500">
          Nobody holds the driver role in this bakery yet. Add one from the back office.
        </Text>
      )}

      {drivers.isSuccess &&
        drivers.data.map((driver) => (
          <Pressable
            key={driver.profile_id}
            accessibilityRole="button"
            disabled={busy}
            onPress={() => onAssign(driver.profile_id)}
            className={`flex-row items-center justify-between rounded-lg border border-neutral-300 bg-white px-3 py-2.5 active:opacity-70 ${
              busy ? 'opacity-40' : ''
            }`}
          >
            <Text className="text-base text-neutral-900">{driver.full_name}</Text>
            {busy && <ActivityIndicator size="small" />}
          </Pressable>
        ))}
    </View>
  );
}
