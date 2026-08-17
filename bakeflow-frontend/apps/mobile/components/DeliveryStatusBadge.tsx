import { isTerminalDeliveryStatus, type DeliveryStatus } from '@bakeflow/types';
import { Text, View } from 'react-native';

/**
 * The status of a delivery, as a badge.
 *
 * Shared by the board and the detail screen so one status can never be styled two ways.
 *
 * ## `failed` is amber, not red, and it is not an end state
 *
 * A failed delivery is a recorded business outcome — nobody was home, the address was
 * wrong. `STATE-MACHINES.md` §3 gives it exactly one exit, `failed → returned`, and that hop
 * writes a return stock movement. Styling it as a terminal red error would tell a dispatcher
 * the row is finished when it is the one row still holding goods that are unaccounted for in
 * the ledger. Amber says "act on this", which is the truth.
 *
 * `returned` is the state that closes that loop, so it reads as neutral-complete rather than
 * as a failure: the goods are back and the ledger balances.
 */
const STYLES: Record<DeliveryStatus, { label: string; background: string; text: string }> = {
  pending: { label: 'Pending', background: 'bg-neutral-100', text: 'text-neutral-700' },
  assigned: { label: 'Assigned', background: 'bg-indigo-100', text: 'text-indigo-800' },
  in_transit: { label: 'In transit', background: 'bg-blue-100', text: 'text-blue-800' },
  delivered: { label: 'Delivered', background: 'bg-green-100', text: 'text-green-800' },
  failed: { label: 'Failed', background: 'bg-amber-100', text: 'text-amber-800' },
  returned: { label: 'Returned', background: 'bg-neutral-200', text: 'text-neutral-600' },
};

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }): React.JSX.Element {
  const style = STYLES[status];
  return (
    <View className={`rounded-full px-3 py-1 ${style.background}`}>
      <Text className={`text-xs font-semibold uppercase ${style.text}`}>{style.label}</Text>
    </View>
  );
}

/** The human label for a status, for use outside a badge (filter chips, empty states). */
export function deliveryStatusLabel(status: DeliveryStatus): string {
  return STYLES[status].label;
}

/**
 * True when a delivery still needs someone to do something.
 *
 * Re-exported through this module rather than inlined at each call site so that "open"
 * means one thing across the UI, and so it stays anchored to
 * `isTerminalDeliveryStatus` — which deliberately counts `failed` as **not** terminal.
 */
export function isOpenDelivery(status: DeliveryStatus): boolean {
  return !isTerminalDeliveryStatus(status);
}
