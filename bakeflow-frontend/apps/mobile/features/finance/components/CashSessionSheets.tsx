import { getSupabaseClient } from '@bakeflow/auth';
import { useCloseCashSession, useOpenCashSession } from '@bakeflow/hooks';
import type { CashSession } from '@bakeflow/types';
import { Button, Callout, Field, Sheet, Text } from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import { nonNegativeMoneySchema } from '@bakeflow/validation';
import { useState } from 'react';
import { View } from 'react-native';

import { useSessionStore } from '../../../stores/session';
import { toast } from '../../../stores/ui/toast.store';

const AMOUNT_HINT = 'Enter an amount like 20000 or 20000.50';

/** Opens a till with its starting float. The float is kept as the exact string typed. */
export function OpenSessionSheet({
  branchId,
  branchLabel,
  visible,
  onClose,
}: {
  branchId: string;
  branchLabel: string;
  visible: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const open = useOpenCashSession(getSupabaseClient(), tenantId);
  const [float, setFloat] = useState('');
  const parsed = nonNegativeMoneySchema.safeParse(float.trim());
  const error = float.trim() === '' || parsed.success ? null : AMOUNT_HINT;

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        open.reset();
        onClose();
      }}
      title="Open a cash session"
      foot={
        <Button
          label="Open session"
          busy={open.isPending}
          disabled={!parsed.success}
          onPress={() => {
            if (!parsed.success) return;
            const opening = parsed.data;
            open.mutate(
              { input: { branchId, openingFloat: opening } },
              {
                onSuccess: () => {
                  setFloat('');
                  onClose();
                  toast({ tone: 'success', title: 'Cash session opened', text: `${branchLabel} · float ${formatNaira(opening)}` });
                },
              }
            );
          }}
          block
        />
      }
    >
      <View className="gap-4">
        <Text variant="meta">{branchLabel}. Count the cash already in the drawer before you start.</Text>
        <Field
          label="Opening float (₦)"
          value={float}
          onChangeText={setFloat}
          keyboardType="decimal-pad"
          inputMode="decimal"
          placeholder="e.g. 20000"
          error={error}
        />
        {open.isError && <Callout tone="error" title="Session not opened" detail={open.error.message} />}
      </View>
    </Sheet>
  );
}

/**
 * Closes a till with the physically counted cash. The server computes what was expected and
 * the variance; this sheet only sends the count and an optional note.
 */
export function CloseSessionSheet({
  session,
  visible,
  onClose,
}: {
  session: CashSession;
  visible: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const close = useCloseCashSession(getSupabaseClient(), tenantId);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const parsed = nonNegativeMoneySchema.safeParse(counted.trim());
  const error = counted.trim() === '' || parsed.success ? null : AMOUNT_HINT;

  return (
    <Sheet
      visible={visible}
      onClose={() => {
        close.reset();
        onClose();
      }}
      title="Close this session"
      foot={
        <Button
          label="Close session"
          busy={close.isPending}
          disabled={!parsed.success}
          onPress={() => {
            if (!parsed.success) return;
            close.mutate(
              { input: { sessionId: session.id, countedAmount: parsed.data, note: note.trim() === '' ? null : note.trim() } },
              {
                onSuccess: () => {
                  setCounted('');
                  setNote('');
                  onClose();
                  toast({ tone: 'success', title: 'Cash session closed', text: 'Expected and variance are on the session.' });
                },
              }
            );
          }}
          block
        />
      }
    >
      <View className="gap-4">
        <Text variant="meta">
          Opened with {formatNaira(session.opening_float)}. Count every note and coin in the drawer — the
          expected amount and any gap are worked out when you close.
        </Text>
        <Field
          label="Cash counted (₦)"
          value={counted}
          onChangeText={setCounted}
          keyboardType="decimal-pad"
          inputMode="decimal"
          placeholder="e.g. 44200"
          error={error}
        />
        <Field
          label="Note"
          value={note}
          onChangeText={setNote}
          placeholder="e.g. counted twice, ₦2,500 short — change given"
          hint="Optional. Explain any gap so the record is clear."
        />
        {close.isError && <Callout tone="error" title="Session not closed" detail={close.error.message} />}
      </View>
    </Sheet>
  );
}
