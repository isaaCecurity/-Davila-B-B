import { getSupabaseClient } from '@bakeflow/auth';
import { BakeflowApiError, type DeliveryTransition } from '@bakeflow/api';
import { useTransitionDelivery } from '@bakeflow/hooks';
import type { Delivery, DeliveryStatus, Uuid } from '@bakeflow/types';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { DriverPicker } from './DriverPicker';

/**
 * The transition controls on a delivery — P9.6 write path.
 *
 * ## The button set is the database's graph, transcribed
 *
 * `NEXT_ACTIONS` below mirrors `guard_delivery_transition()`, read live 2026-08-21. It
 * decides what to *offer*; it decides nothing about what is *allowed*. The trigger
 * re-evaluates every hop, and a stale screen offering an illegal one gets
 * `invalid_transition` back rather than performing it.
 *
 * That distinction matters more here than on most screens: a delivery is acted on from a
 * phone that has been in a bag between two addresses, so the row on screen is routinely
 * behind the row in the database.
 *
 * ## Two hops need a value the CHECK constraints require
 *
 * `delivered` needs a `proof_url` or a `recipient_name`, and `failed` needs a
 * `failure_reason` — both standing table CHECKs, not UI conventions. Rather than let the
 * tap fail at the database, each opens a small form first and the button stays disabled
 * until the field is non-blank. The database still enforces it; this only avoids a round
 * trip that could only ever come back `23514`.
 *
 * ## `pending -> assigned` — the one hop with a picker instead of a button
 *
 * Every other hop in `NEXT_ACTIONS` needs at most a text field; this one needs a driver.
 * `DriverPicker` owns fetching `listDrivers()` and rendering the choice; this component
 * only turns a tap into `{ to: 'assigned', driverId }`. See `DriverPicker`'s header for why
 * the list it offers is tenant-wide rather than filtered to this delivery's branch.
 */

interface ActionSpec {
  /**
   * Narrower than `DeliveryStatus` on purpose. `pending` is nothing's target, and
   * `assigned` is absent because this component never offers it — see the header. Keeping
   * the union tight is what lets `run` build a `DeliveryTransition` with no cast.
   */
  to: 'in_transit' | 'delivered' | 'failed' | 'returned';
  label: string;
  /** A destructive-looking hop gets a quieter treatment than the happy path. */
  tone: 'primary' | 'neutral';
  /** The field the database will require for this hop, if any. */
  needs?: 'proof' | 'reason';
}

/**
 * Legal next hops per status, transcribed from `guard_delivery_transition()`.
 *
 * `delivered` and `returned` are terminal and map to an empty list. `failed` does **not**:
 * its exit is `returned`, and until that runs the goods are out of the branch and
 * unaccounted for. That is exactly the row someone has to chase, so it keeps a button.
 */
const NEXT_ACTIONS: Readonly<Record<DeliveryStatus, readonly ActionSpec[]>> = {
  pending: [],
  assigned: [{ to: 'in_transit', label: 'Start delivery', tone: 'primary' }],
  in_transit: [
    { to: 'delivered', label: 'Mark delivered', tone: 'primary', needs: 'proof' },
    { to: 'failed', label: 'Could not deliver', tone: 'neutral', needs: 'reason' },
    { to: 'returned', label: 'Return to bakery', tone: 'neutral' },
  ],
  delivered: [],
  failed: [{ to: 'returned', label: 'Return to bakery', tone: 'primary' }],
  returned: [],
};

/**
 * User-facing copy per machine code.
 *
 * `API-CONTRACT.md` §3: the server's own message is never rendered. `code` is the only
 * thing branched on, and anything unmapped gets neutral wording rather than a raw string
 * from Postgres.
 */
function describe(error: Error): string {
  const code = error instanceof BakeflowApiError ? error.code : 'unexpected_error';
  switch (code) {
    case 'invalid_transition':
      return 'That is no longer possible — this delivery has moved on, or its ticket is not ready to dispatch. Pull to refresh.';
    case 'insufficient_role':
      return 'Only the assigned driver or a manager can do this.';
    case 'session_expired':
      return 'Your session has expired. Sign in again.';
    case 'network_unavailable':
      return 'No connection. This has not been saved.';
    case 'invalid_request':
      return 'Something in that request was not accepted. Check the details and try again.';
    default:
      return 'That did not work. Nothing has been changed.';
  }
}

export function DeliveryActions({
  delivery,
  tenantId,
}: {
  delivery: Delivery;
  tenantId: string | null;
}): React.JSX.Element | null {
  const client = getSupabaseClient();
  const transition = useTransitionDelivery(client, tenantId);

  /** Which action has opened its form, if any. */
  const [openForm, setOpenForm] = useState<'proof' | 'reason' | null>(null);
  const [recipientName, setRecipientName] = useState('');
  const [reason, setReason] = useState('');

  const actions = NEXT_ACTIONS[delivery.status];
  const busy = transition.isPending;

  function reset(): void {
    setOpenForm(null);
    setRecipientName('');
    setReason('');
  }

  function run(spec: ActionSpec): void {
    if (spec.needs !== undefined && openForm !== spec.needs) {
      setOpenForm(spec.needs);
      return;
    }

    const requested: DeliveryTransition =
      spec.to === 'delivered'
        ? { to: 'delivered', recipientName }
        : spec.to === 'failed'
          ? { to: 'failed', reason }
          : spec.to === 'in_transit'
            ? { to: 'in_transit' }
            : { to: 'returned' };

    transition.mutate({ deliveryId: delivery.id, transition: requested }, { onSuccess: reset });
  }

  function assign(driverId: Uuid): void {
    transition.mutate(
      { deliveryId: delivery.id, transition: { to: 'assigned', driverId } },
      { onSuccess: reset },
    );
  }

  if (delivery.status === 'pending') {
    return (
      <View className="gap-2 rounded-xl border border-neutral-200 p-4">
        <Text className="text-lg font-semibold text-neutral-900">Not assigned yet</Text>
        <Text className="text-sm text-neutral-500">
          A delivery has to go to a driver before it can leave.
        </Text>
        <DriverPicker tenantId={tenantId} busy={busy} onAssign={assign} />
        {transition.isError && (
          <View className="gap-1 rounded-lg bg-red-50 p-3">
            <Text className="text-sm text-red-900">{describe(transition.error)}</Text>
          </View>
        )}
      </View>
    );
  }

  if (actions.length === 0) {
    return (
      <View className="gap-2 rounded-xl border border-neutral-200 p-4">
        <Text className="text-lg font-semibold text-neutral-900">Finished</Text>
        <Text className="text-sm text-neutral-500">
          {delivery.status === 'delivered'
            ? 'This delivery is done. Its ticket can now be completed.'
            : 'These goods came back. Nothing further happens to this delivery.'}
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-3 rounded-xl border border-neutral-200 p-4">
      <Text className="text-lg font-semibold text-neutral-900">What happened?</Text>

      {openForm === 'proof' && (
        <View className="gap-1">
          <Text className="text-sm text-neutral-500">Who received it?</Text>
          <TextInput
            value={recipientName}
            onChangeText={setRecipientName}
            placeholder="Name of the person who took it"
            editable={!busy}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-base text-neutral-900"
          />
          <Text className="text-xs text-neutral-400">
            A name or a photo is required before a delivery counts as delivered.
          </Text>
        </View>
      )}

      {openForm === 'reason' && (
        <View className="gap-1">
          <Text className="text-sm text-neutral-500">Why not?</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Nobody home, wrong address…"
            editable={!busy}
            multiline
            className="rounded-lg border border-neutral-300 px-3 py-2 text-base text-neutral-900"
          />
          <Text className="text-xs text-neutral-400">
            A failed delivery still has to be returned afterwards.
          </Text>
        </View>
      )}

      <View className="gap-2">
        {actions.map((spec) => {
          const armed = spec.needs === undefined || openForm === spec.needs;
          const value = spec.needs === 'proof' ? recipientName : reason;
          const disabled = busy || (armed && spec.needs !== undefined && value.trim() === '');

          return (
            <Pressable
              key={spec.to}
              accessibilityRole="button"
              disabled={disabled}
              onPress={() => run(spec)}
              className={`flex-row items-center justify-center gap-2 rounded-lg px-4 py-3 active:opacity-70 ${
                spec.tone === 'primary'
                  ? 'bg-neutral-900'
                  : 'border border-neutral-300 bg-white'
              } ${disabled ? 'opacity-40' : ''}`}
            >
              {busy && <ActivityIndicator size="small" />}
              <Text
                className={`text-base font-medium ${
                  spec.tone === 'primary' ? 'text-white' : 'text-neutral-900'
                }`}
              >
                {armed ? spec.label : `${spec.label}…`}
              </Text>
            </Pressable>
          );
        })}

        {openForm !== null && (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={reset}
            className="items-center px-4 py-2 active:opacity-70"
          >
            <Text className="text-sm text-neutral-500">Cancel</Text>
          </Pressable>
        )}
      </View>

      {transition.isError && (
        <View className="gap-1 rounded-lg bg-red-50 p-3">
          <Text className="text-sm text-red-900">{describe(transition.error)}</Text>
        </View>
      )}
    </View>
  );
}
