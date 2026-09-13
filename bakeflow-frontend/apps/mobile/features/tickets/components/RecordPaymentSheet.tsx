import { PAYMENT_METHODS, type PaymentMethod } from '@bakeflow/api';
import { getSupabaseClient } from '@bakeflow/auth';
import { useCashSessions, useRecordPayment } from '@bakeflow/hooks';
import type { Ticket } from '@bakeflow/types';
import { Button, Callout, Chips, Field, Sheet, Text } from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import { positiveMoneySchema } from '@bakeflow/validation';
import { useState } from 'react';
import { View } from 'react-native';

import { useSessionStore } from '../../../stores/session';
import { toast } from '../../../stores/ui/toast.store';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  transfer: 'Transfer',
  pos: 'POS',
  card: 'Card',
};

/**
 * Records a payment against a ticket through `record_payment()`.
 *
 * The amount is kept as the exact decimal string the user typed and validated with the same
 * schema the API layer uses — never parsed to a float. A cash payment is attached to the
 * branch's open till, exactly as the finance screen already does; other methods carry no
 * cash session. Whether a payment is allowed at all is the database's decision.
 */
export function RecordPaymentSheet({
  ticket,
  visible,
  onClose,
}: {
  ticket: Ticket;
  visible: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const record = useRecordPayment(client, tenantId);
  const sessions = useCashSessions(client, tenantId);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');

  const openTill = (sessions.data ?? []).find(
    (s) => s.status === 'open' && s.branch_id === ticket.branch_id
  );
  const parsed = positiveMoneySchema.safeParse(amount.trim());
  const amountError = amount.trim() === '' || parsed.success ? null : 'Enter an amount like 5000 or 5000.50';
  const needsTill = method === 'cash' && openTill === undefined;

  function submit(): void {
    if (!parsed.success) return;
    const received = parsed.data; // already `Money` — the schema brands it
    record.mutate(
      {
        input: {
          ticketId: ticket.id,
          amount: received,
          method,
          cashSessionId: method === 'cash' ? (openTill?.id ?? null) : null,
        },
      },
      {
        onSuccess: (result) => {
          setAmount('');
          onClose();
          toast({
            tone: 'success',
            title: 'Payment recorded',
            text: `${formatNaira(received)} · ${METHOD_LABEL[result.method]} · ${ticket.ticket_number}`,
          });
        },
      }
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        record.reset();
        onClose();
      }}
      title="Record payment"
      foot={
        <Button
          label="Record payment"
          busy={record.isPending}
          disabled={!parsed.success || needsTill}
          onPress={submit}
          block
        />
      }
    >
      <View className="gap-4">
        <Text variant="meta">
          {ticket.ticket_number} · total {formatNaira(ticket.total_amount)} · paid so far{' '}
          {formatNaira(ticket.amount_paid)}
        </Text>
        <Field
          label="Amount received (₦)"
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          inputMode="decimal"
          placeholder="e.g. 5000"
          error={amountError}
        />
        <View className="gap-2">
          <Text variant="label">Method</Text>
          <Chips
            accessibilityLabel="Payment method"
            options={PAYMENT_METHODS.map((m) => ({ key: m, label: METHOD_LABEL[m] }))}
            value={method}
            onChange={setMethod}
          />
        </View>
        {needsTill && (
          <Callout
            tone="warning"
            title="No open till at this branch"
            detail="Open a cash session from Finance before taking cash, or choose another method."
          />
        )}
        {record.isError && (
          <Callout tone="error" title="Payment not recorded" detail={record.error.message} />
        )}
      </View>
    </Sheet>
  );
}
