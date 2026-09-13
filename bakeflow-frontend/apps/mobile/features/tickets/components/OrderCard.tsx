import { Avatar, Badge, Icon, PressableScale, Text } from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import { View } from 'react-native';

import type { OrderRow } from '../hooks/useOrderRows';
import { FULFILMENT_LABEL, PAY_META, payStateOf, STATUS_META, ticketTime } from '../ticketDisplay';

/**
 * The prototype's `.order-card`: who, what, how much, and where it stands.
 *
 * A pending order gets a warning edge and a ready one an apricot edge, so the two states that
 * need someone to act stand out while scanning — each still carries its word badge too.
 */
export function OrderCard({ row, onPress }: { row: OrderRow; onPress: () => void }): React.JSX.Element {
  const { ticket, customerName, itemLine } = row;
  const status = STATUS_META[ticket.status];
  const pay = payStateOf(ticket);
  const edge =
    ticket.status === 'submitted' ? 'bg-warning' : ticket.status === 'ready' ? 'bg-apricot' : null;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`${ticket.ticket_number}, ${customerName}, ${status.label}, ${formatNaira(ticket.total_amount)}`}
      onPress={onPress}
      className="overflow-hidden rounded-md bg-white px-4 py-3.5 shadow-e2"
    >
      {edge !== null && <View className={`absolute bottom-0 left-0 top-0 w-[3px] ${edge}`} />}

      <View className="flex-row items-start gap-[11px]">
        <Avatar name={customerName} />
        <View className="min-w-0 flex-1">
          <Text variant="caption" className="font-medium tracking-[0.25px]" numberOfLines={1}>
            {ticket.ticket_number} · {FULFILMENT_LABEL[ticket.fulfilment_type]}
          </Text>
          <Text className="mt-px text-callout font-semibold text-cocoa" numberOfLines={1}>
            {customerName}
          </Text>
        </View>
        <Badge label={status.label} tone={status.tone} icon={status.icon} />
      </View>

      <Text className="mt-[9px] text-foot text-warm-gray" numberOfLines={2}>
        {itemLine ?? ' '}
      </Text>

      <View className="mt-[11px] flex-row items-center gap-3 border-t border-border pt-[11px]">
        <Text tabular className="text-title-3 font-bold tracking-[-0.37px] text-cocoa">
          {formatNaira(ticket.total_amount)}
        </Text>
        {pay !== null && pay !== 'paid' && (
          <Badge label={PAY_META[pay].label} tone={PAY_META[pay].tone} icon={PAY_META[pay].icon} />
        )}
        <View className="flex-1" />
        <View className="flex-row items-center gap-[5px]">
          <Icon name="clock" size={12} color="textMuted" />
          <Text variant="caption">{ticketTime(ticket.created_at)}</Text>
        </View>
      </View>
    </PressableScale>
  );
}
