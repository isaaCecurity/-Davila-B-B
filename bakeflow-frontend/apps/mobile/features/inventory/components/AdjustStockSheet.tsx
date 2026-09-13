import { BakeflowApiError, type AdjustableStockReason } from '@bakeflow/api';
import { getSupabaseClient } from '@bakeflow/auth';
import { useAdjustStock } from '@bakeflow/hooks';
import type { Quantity } from '@bakeflow/types';
import { Button, Callout, Chips, Field, Sheet, Text } from '@bakeflow/ui';
import { nonNegativeQuantitySchema } from '@bakeflow/validation';
import { useState } from 'react';
import { View } from 'react-native';

import { useSessionStore } from '../../../stores/session';
import { toast } from '../../../stores/ui/toast.store';
import { trimQuantity } from '../../tickets/ticketDisplay';
import { ADJUST_REASONS, levelView } from '../stockDisplay';

export interface AdjustTarget {
  warehouseId: string;
  variantId: string;
  label: string;
  quantity: Quantity;
}

/** `adjust_stock` failures, said in the words of the person holding the count. */
function describe(error: Error): string {
  const code = error instanceof BakeflowApiError ? error.code : 'unexpected_error';
  switch (code) {
    case 'insufficient_stock':
      return 'This bakery does not allow stock to go below zero that way. Check the count and try again.';
    case 'insufficient_role':
      return 'Your role cannot record this kind of change. A manager can.';
    case 'session_expired':
      return 'Your session has expired. Sign in again.';
    case 'network_unavailable':
      return 'No connection. Nothing has been saved.';
    case 'invalid_request':
      return 'That quantity was not accepted. Use a whole number or up to 4 decimal places.';
    default:
      return error.message;
  }
}

/**
 * Correct one product's stock — the prototype's "Adjust" action, as a sheet.
 *
 * The field is an **absolute target**, pre-filled with the current count: `adjust_stock()`
 * appends the difference to the ledger itself (see `mutations/inventory.ts`). Typing "12"
 * means "there are 12", never "add 12". Which roles may use which reason is decided by the
 * function — a refusal is shown, not predicted.
 */
export function AdjustStockSheet({
  target,
  onClose,
}: {
  target: AdjustTarget | null;
  onClose: () => void;
}): React.JSX.Element {
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const adjust = useAdjustStock(getSupabaseClient(), tenantId);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState<AdjustableStockReason>('adjustment');
  const [note, setNote] = useState('');
  // Opening a row starts a fresh form. `shown` also outlives `target` so the sheet keeps its
  // content while it animates out.
  const [shown, setShown] = useState<AdjustTarget | null>(null);
  if (target !== null && target !== shown) {
    setShown(target);
    // A negative level cannot be a target; start the count from empty instead.
    setValue(levelView(target.quantity).state === 'negative' ? '' : trimQuantity(target.quantity));
    setReason('adjustment');
    setNote('');
  }

  const trimmed = value.trim();
  const parsed = nonNegativeQuantitySchema.safeParse(trimmed);
  const hint = trimmed === '' || parsed.success ? null : 'Enter a count like 24 or 2.5';
  const hintFor = ADJUST_REASONS.find((r) => r.key === reason)?.hint;

  function close(): void {
    adjust.reset();
    onClose();
  }

  function save(): void {
    if (target === null || !parsed.success) return;
    adjust.mutate(
      {
        warehouseId: target.warehouseId,
        itemType: 'product',
        itemId: target.variantId,
        newQuantity: trimmed,
        reason,
        note: note.trim() === '' ? null : note.trim(),
      },
      {
        onSuccess: (result) => {
          onClose();
          toast(
            result.unchanged
              ? { tone: 'neutral', title: 'No change', text: `${target.label} already shows ${trimmed}` }
              : { tone: 'success', title: 'Stock updated', text: `${target.label} · now ${trimmed}` }
          );
        },
      }
    );
  }

  return (
    <Sheet
      visible={target !== null}
      onClose={close}
      title="Adjust stock"
      foot={
        <Button label="Save count" busy={adjust.isPending} disabled={!parsed.success} onPress={save} block />
      }
    >
      {shown !== null && (
        <View className="gap-4">
          <View className="flex-row items-end justify-between rounded-md bg-cream-deep px-4 py-3.5">
            <View className="min-w-0 flex-1 pr-3">
              <Text variant="label" numberOfLines={2}>{shown.label}</Text>
              <Text variant="caption" className="mt-0.5">On the shelf now</Text>
            </View>
            <Text tabular className="text-title-2 font-bold text-cocoa">{trimQuantity(shown.quantity)}</Text>
          </View>

          <Field
            label="Count after this change"
            value={value}
            onChangeText={setValue}
            keyboardType="decimal-pad"
            inputMode="decimal"
            placeholder="e.g. 24"
            error={hint}
          />
          <Text variant="caption" className="-mt-2">
            Enter what is there now, not how many to add or remove.
          </Text>

          <View className="gap-2">
            <Text variant="label">Why</Text>
            <Chips
              accessibilityLabel="Reason"
              options={ADJUST_REASONS.map((r) => ({ key: r.key, label: r.label }))}
              value={reason}
              onChange={setReason}
            />
            {hintFor !== undefined && <Text variant="caption">{hintFor}</Text>}
          </View>

          <Field label="Note (optional)" value={note} onChangeText={setNote} placeholder="What happened?" />

          {adjust.isError && <Callout tone="error" title="Stock not changed" detail={describe(adjust.error)} />}
        </View>
      )}
    </Sheet>
  );
}
