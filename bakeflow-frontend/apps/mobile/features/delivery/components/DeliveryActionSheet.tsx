import type { DeliveryTransition } from '@bakeflow/api';
import { getSupabaseClient } from '@bakeflow/auth';
import { useDrivers, useTransitionDelivery } from '@bakeflow/hooks';
import type { Delivery } from '@bakeflow/types';
import { Avatar, Button, Callout, Field, Icon, PressableScale, Sheet, Skeleton, Text } from '@bakeflow/ui';
import { useState } from 'react';
import { View } from 'react-native';

import { useSessionStore } from '../../../stores/session';
import { toast } from '../../../stores/ui/toast.store';
import { DELIVERY_META, describeDeliveryError, type DeliveryAction } from '../deliveryDisplay';

/** The prototype's quick reasons; "Other" asks for words. Stored as the text chosen. */
const FAIL_REASONS = ['Customer unavailable', 'Wrong address', 'Customer refused delivery', 'Unable to reach customer', 'Payment issue', 'Other'] as const;

/**
 * One sheet for every delivery step: pick a driver, confirm a dispatch or return, name who
 * received it, or say why it failed. Each field the database requires (a driver, a recipient
 * or proof, a failure reason) keeps the button disabled until it is filled.
 *
 * PORT-NOTE: proof of delivery is a recipient name only — photo or signature capture needs an
 * upload flow and a camera dependency, neither of which exists yet.
 */
export function DeliveryActionSheet({
  delivery,
  action,
  onClose,
}: {
  delivery: Delivery;
  action: DeliveryAction | null;
  onClose: () => void;
}): React.JSX.Element {
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const client = getSupabaseClient();
  const transition = useTransitionDelivery(client, tenantId);
  const drivers = useDrivers(client, action?.to === 'assigned' ? tenantId : null);

  const [driverId, setDriverId] = useState<string | null>(null);
  const [recipient, setRecipient] = useState('');
  const [reason, setReason] = useState('');
  const [preset, setPreset] = useState<(typeof FAIL_REASONS)[number] | null>(null);

  // Keep the last action while the sheet animates out.
  const [shown, setShown] = useState<DeliveryAction | null>(null);
  if (action !== null && action !== shown) {
    setShown(action);
    setDriverId(null);
    setRecipient('');
    setReason('');
    setPreset(null);
  }
  const failureText = preset === null ? '' : preset === 'Other' ? reason.trim() : preset;

  const request: DeliveryTransition | null =
    shown === null
      ? null
      : shown.to === 'assigned'
        ? driverId === null
          ? null
          : { to: 'assigned', driverId }
        : shown.to === 'delivered'
          ? recipient.trim() === ''
            ? null
            : { to: 'delivered', recipientName: recipient.trim() }
          : shown.to === 'failed'
            ? failureText === ''
              ? null
              : { to: 'failed', reason: failureText }
            : { to: shown.to };

  function close(): void {
    transition.reset();
    onClose();
  }

  function submit(): void {
    if (request === null) return;
    transition.mutate(
      { deliveryId: delivery.id, transition: request },
      {
        onSuccess: (row) => {
          onClose();
          toast({ tone: 'success', title: DELIVERY_META[row.status].label, text: delivery.address_line });
        },
      }
    );
  }

  return (
    <Sheet
      visible={action !== null}
      onClose={close}
      title={shown?.label ?? ''}
      foot={
        <Button
          label={shown?.label ?? 'Save'}
          tone={shown?.to === 'failed' ? 'danger' : 'primary'}
          busy={transition.isPending}
          disabled={request === null}
          onPress={submit}
          block
        />
      }
    >
      {shown !== null && (
        <View className="gap-4">
          <View className="flex-row items-center gap-2.5 rounded-md bg-cream-deep px-3.5 py-3">
            <Icon name="pin" size={16} color="cocoa" />
            <Text variant="label" className="flex-1" numberOfLines={2}>{delivery.address_line}</Text>
          </View>

          {shown.to === 'assigned' &&
            (drivers.isLoading ? (
              <View className="gap-2">
                <Skeleton variant="row" />
                <Skeleton variant="row" />
              </View>
            ) : drivers.isError ? (
              <Callout tone="error" title="Drivers did not load" detail={describeDeliveryError(drivers.error)} />
            ) : (drivers.data ?? []).length === 0 ? (
              <Callout tone="warning" title="No drivers yet" detail="Invite someone with the driver role, then assign them here." />
            ) : (
              <View accessibilityRole="radiogroup" className="gap-2">
                {(drivers.data ?? []).map((d) => {
                  const on = d.profile_id === driverId;
                  return (
                    <PressableScale
                      key={d.profile_id}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      aria-selected={on}
                      accessibilityLabel={d.full_name}
                      onPress={() => setDriverId(d.profile_id)}
                      scaleTo={0.98}
                      className={`min-h-tap flex-row items-center gap-3 rounded-md px-3.5 py-2.5 ${on ? 'bg-ink' : 'bg-white shadow-e2'}`}
                    >
                      <Avatar name={d.full_name} size="sm" />
                      <View className="min-w-0 flex-1">
                        <Text className={`text-callout font-semibold ${on ? 'text-white' : 'text-cocoa'}`} numberOfLines={1}>{d.full_name}</Text>
                        {d.phone !== null && (
                          <Text className={`text-caption ${on ? 'text-white/60' : 'text-warm-gray'}`}>{d.phone}</Text>
                        )}
                      </View>
                      {on && <Icon name="check" size={16} color="white" />}
                    </PressableScale>
                  );
                })}
              </View>
            ))}

          {shown.to === 'in_transit' && (
            <Text variant="meta">The order must be ready before it leaves. The dispatch time is recorded now.</Text>
          )}

          {shown.to === 'delivered' && (
            <Field
              label="Received by"
              value={recipient}
              onChangeText={setRecipient}
              placeholder="Name of the person who took it"
              hint="A name is required before a delivery counts as delivered."
            />
          )}

          {shown.to === 'failed' && (
            <View className="gap-3">
              <Text variant="label">What happened?</Text>
              <View accessibilityRole="radiogroup" className="flex-row flex-wrap gap-2">
                {FAIL_REASONS.map((r) => {
                  const on = preset === r;
                  return (
                    <PressableScale
                      key={r}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      aria-selected={on}
                      accessibilityLabel={r}
                      onPress={() => setPreset(r)}
                      scaleTo={0.95}
                      className={`min-h-[36px] justify-center rounded-pill px-3.5 ${on ? 'bg-ink' : 'bg-white shadow-e1'}`}
                    >
                      <Text className={`text-foot font-medium ${on ? 'text-white' : 'text-cocoa'}`}>{r}</Text>
                    </PressableScale>
                  );
                })}
              </View>
              {preset === 'Other' && (
                <Field label="Describe it" value={reason} onChangeText={setReason} placeholder="What went wrong" multiline />
              )}
              <Text variant="caption">A failed delivery still has to be returned to the bakery afterwards.</Text>
            </View>
          )}

          {shown.to === 'returned' && (
            <Text variant="meta">Confirm the goods are back at the bakery. This closes the delivery.</Text>
          )}

          {transition.isError && (
            <Callout tone="error" title="Delivery not updated" detail={describeDeliveryError(transition.error)} />
          )}
        </View>
      )}
    </Sheet>
  );
}
