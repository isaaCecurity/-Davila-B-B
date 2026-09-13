import { getSupabaseClient } from '@bakeflow/auth';
import { useCancelTicket } from '@bakeflow/hooks';
import type { Ticket } from '@bakeflow/types';
import { Button, Callout, Field, Sheet, Text } from '@bakeflow/ui';
import { useState } from 'react';
import { View } from 'react-native';

import { useSessionStore } from '../../../stores/session';
import { toast } from '../../../stores/ui/toast.store';

/**
 * Cancels a ticket with a required reason.
 *
 * Destructive, so it always sits behind this sheet — never a swipe or a one-tap button.
 * Manager-only and refused while money is held without a matching refund; both come back
 * from the database and are shown as written.
 */
export function CancelTicketSheet({
  ticket,
  visible,
  onClose,
}: {
  ticket: Ticket;
  visible: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const cancel = useCancelTicket(getSupabaseClient(), tenantId);
  const [reason, setReason] = useState('');

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        cancel.reset();
        onClose();
      }}
      title="Cancel this order"
      foot={
        <View className="gap-2.5">
          <Button
            label="Cancel order"
            tone="danger"
            busy={cancel.isPending}
            disabled={reason.trim() === ''}
            onPress={() =>
              cancel.mutate(
                { ticketId: ticket.id, reason },
                {
                  onSuccess: () => {
                    setReason('');
                    onClose();
                    toast({ title: `${ticket.ticket_number} cancelled`, text: reason.trim() });
                  },
                }
              )
            }
            block
          />
          <Button label="Keep order" tone="secondary" onPress={onClose} block />
        </View>
      }
    >
      <View className="gap-4">
        <Text variant="meta">
          {ticket.ticket_number} will be kept for the record, marked cancelled. This cannot be
          reversed.
        </Text>
        <Field
          label="Reason"
          value={reason}
          onChangeText={setReason}
          placeholder="e.g. Customer called to cancel"
          hint="Required. Shown on the order's history."
        />
        {cancel.isError && (
          <Callout tone="error" title="Order not cancelled" detail={cancel.error.message} />
        )}
      </View>
    </Sheet>
  );
}
