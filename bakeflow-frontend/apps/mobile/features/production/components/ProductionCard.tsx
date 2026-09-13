import { Badge, Button, IconTile, PressableScale, Text, type TileTone } from '@bakeflow/ui';
import type { TicketStatus } from '@bakeflow/types';
import Animated, { FadeIn, LinearTransition, ReduceMotion } from 'react-native-reanimated';
import { View } from 'react-native';

import type { OrderRow } from '../../tickets/hooks/useOrderRows';
import { STATUS_META, ticketTime } from '../../tickets/ticketDisplay';

const ENTER = FadeIn.duration(215).reduceMotion(ReduceMotion.System);
const MOVE = LinearTransition.duration(260).reduceMotion(ReduceMotion.System);

const TILE: Partial<Record<TicketStatus, TileTone>> = {
  confirmed: 'neutral',
  scheduled: 'neutral',
  in_production: 'accent',
  ready: 'ok',
};

/**
 * The prototype's `batchCard`, for an order: what to make first, then whose it is and when
 * it is due, with the one next step a baker takes.
 *
 * Money is deliberately absent — the production floor needs quantities, not totals.
 */
export function ProductionCard({
  row,
  status,
  action,
  busy,
  onAction,
  onPress,
}: {
  row: OrderRow;
  /** The status to present — the optimistic one while a move is in flight. */
  status: TicketStatus;
  action: string | null;
  busy: boolean;
  onAction: () => void;
  onPress: () => void;
}): React.JSX.Element {
  const { ticket, customerName, itemLine } = row;
  const meta = STATUS_META[status];
  const due = ticket.due_at === null ? null : `due ${ticketTime(ticket.due_at)}`;

  return (
    <Animated.View entering={ENTER} layout={MOVE}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`${itemLine ?? 'Order'}, ${ticket.ticket_number}, ${customerName}, ${meta.label}${due === null ? '' : `, ${due}`}`}
        onPress={onPress}
        scaleTo={0.98}
        className="rounded-md bg-white px-4 py-3.5 shadow-e2"
      >
        <View className="flex-row items-start gap-3">
          <IconTile icon="flame" tone={TILE[status] ?? 'neutral'} size="sm" />
          <View className="min-w-0 flex-1">
            <Text className="text-callout font-semibold text-cocoa" numberOfLines={3}>
              {itemLine ?? ' '}
            </Text>
            <Text variant="meta" className="mt-0.5" numberOfLines={1}>
              {[ticket.ticket_number, customerName, due].filter(Boolean).join(' · ')}
            </Text>
          </View>
          {action === null && <Badge label={meta.label} tone={meta.tone} icon={meta.icon} />}
        </View>
        {action !== null && (
          <View className="mt-3 flex-row items-center justify-between gap-3 border-t border-border pt-3">
            <Badge label={meta.label} tone={meta.tone} icon={meta.icon} />
            <Button label={action} tone={status === 'in_production' ? 'primary' : 'secondary'} busy={busy} onPress={onAction} />
          </View>
        )}
      </PressableScale>
    </Animated.View>
  );
}
