import { nextTicketStatus } from '@bakeflow/api';
import { getSupabaseClient } from '@bakeflow/auth';
import { useAdvanceTicket } from '@bakeflow/hooks';
import type { Ticket } from '@bakeflow/types';
import { Badge, Button, Callout, Row, Sheet, Text } from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import { View } from 'react-native';

import { useSessionStore } from '../../../stores/session';
import { toast } from '../../../stores/ui/toast.store';
import { ADVANCE_VERB, STATUS_META } from '../ticketDisplay';

/**
 * Confirms moving a ticket one step, then does it.
 *
 * PORT-NOTE: the prototype advances instantly and offers a five-second Undo. The live
 * lifecycle has no backward hops — `guard_ticket_status_transition()` refuses them — so an
 * Undo could not actually undo. The action asks first instead, which is the prototype's own
 * README guidance for irreversible mutations.
 */
export function AdvanceTicketSheet({
  ticket,
  customerName,
  onClose,
}: {
  ticket: Ticket | null;
  customerName: string;
  onClose: () => void;
}): React.JSX.Element {
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const advance = useAdvanceTicket(getSupabaseClient(), tenantId);

  const to = ticket === null ? null : nextTicketStatus(ticket.status);
  const verb = to === null ? '' : (ADVANCE_VERB[to] ?? 'Advance');

  function confirm(): void {
    if (ticket === null || to === null) return;
    advance.mutate(
      { ticketId: ticket.id, from: ticket.status },
      {
        onSuccess: (result) => {
          onClose();
          toast({
            tone: 'success',
            title: `${ticket.ticket_number} → ${STATUS_META[result.status].label}`,
            text: `${customerName} · ${formatNaira(ticket.total_amount)}`,
          });
        },
      }
    );
  }

  return (
    <Sheet
      visible={ticket !== null}
      onClose={() => {
        advance.reset();
        onClose();
      }}
      title={verb}
      foot={
        <View className="gap-2.5">
          <Button label={verb} busy={advance.isPending} onPress={confirm} block />
          <Button label="Not now" tone="secondary" onPress={onClose} block />
        </View>
      }
    >
      {ticket !== null && to !== null && (
        <View className="gap-4">
          <View className="gap-1">
            <Text variant="subtitle">
              {ticket.ticket_number} · {customerName}
            </Text>
            <Text variant="meta">{formatNaira(ticket.total_amount)}</Text>
          </View>
          <Row>
            <Badge {...STATUS_META[ticket.status]} />
            <Text variant="meta">→</Text>
            <Badge {...STATUS_META[to]} />
          </Row>
          {to === 'completed' && (
            <Callout
              tone="info"
              title="Stock will be deducted"
              detail="Completing records the sale and takes each item out of this branch's default store."
            />
          )}
          {advance.isError && (
            <Callout tone="error" title="Could not update this order" detail={advance.error.message} />
          )}
        </View>
      )}
    </Sheet>
  );
}
