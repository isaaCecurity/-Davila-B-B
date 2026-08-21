import { getSupabaseClient } from '@bakeflow/auth';
import { BakeflowApiError, type AdjustableStockReason } from '@bakeflow/api';
import { useAdjustStock } from '@bakeflow/hooks';
import type { Quantity, StockItemType, Uuid } from '@bakeflow/types';
import { formatQuantity } from '@bakeflow/utils';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

/**
 * The stock-correction control on one warehouse row — P9.4 write path.
 *
 * ## An absolute target, not a delta — the one thing this form has to get right
 *
 * `adjust_stock()`'s contract (`packages/api/mutations/inventory.ts`) is: the number typed
 * here is what the item should have **after** saving, not how much to add or remove. The
 * field is pre-filled with the current quantity for exactly that reason — editing it in
 * place reads as "correct this number," which is what the RPC actually does, rather than
 * "add this many," which it does not.
 *
 * ## Reason is a real choice, not a formality
 *
 * `adjustment`, `waste` and `opening_balance` are the three reasons `adjust_stock` accepts
 * (`ADJUSTABLE_STOCK_REASONS`), and each is a different business event: a miscount, spoiled
 * stock, or a first-time balance. Role requirements differ per reason server-side —
 * `adjustment`/`opening_balance` need owner/admin/branch_manager, `waste` also allows
 * `baker` — and none of that is re-checked here; an inadequate role comes back as
 * `insufficient_role` and is shown, not guessed at in advance.
 */

const REASONS: readonly { value: AdjustableStockReason; label: string }[] = [
  { value: 'adjustment', label: 'Correction' },
  { value: 'waste', label: 'Waste' },
  { value: 'opening_balance', label: 'Opening balance' },
];

/** Mirrors `QUANTITY_INPUT` in `mutations/inventory.ts`, applied to the raw field value. */
const QUANTITY_INPUT = /^\d{1,14}(\.\d{1,4})?$/;

function describe(error: Error): string {
  const code = error instanceof BakeflowApiError ? error.code : 'unexpected_error';
  switch (code) {
    case 'insufficient_stock':
      return 'This bakery does not allow stock to go negative that way. Check the count and try again.';
    case 'insufficient_role':
      return 'You do not have permission to record this.';
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

export function AdjustStockAction({
  warehouseId,
  itemType,
  itemId,
  currentQuantity,
  unit,
  tenantId,
}: {
  warehouseId: Uuid;
  itemType: StockItemType;
  itemId: Uuid;
  currentQuantity: Quantity;
  unit: string | null;
  tenantId: string | null;
}): React.JSX.Element {
  const client = getSupabaseClient();
  const adjust = useAdjustStock(client, tenantId);

  const [open, setOpen] = useState(false);
  const [newQuantity, setNewQuantity] = useState('');
  const [reason, setReason] = useState<AdjustableStockReason>('adjustment');
  const [note, setNote] = useState('');

  const trimmed = newQuantity.trim();
  const validQuantity = QUANTITY_INPUT.test(trimmed);

  function openForm(): void {
    setNewQuantity(currentQuantity);
    setReason('adjustment');
    setNote('');
    setOpen(true);
  }

  function submit(): void {
    if (!validQuantity) return;
    adjust.mutate(
      { warehouseId, itemType, itemId, newQuantity: trimmed, reason, note: note.trim() === '' ? null : note.trim() },
      { onSuccess: () => setOpen(false) },
    );
  }

  if (!open) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={openForm}
        className="rounded-lg border border-neutral-300 px-3 py-1.5 active:opacity-70"
      >
        <Text className="text-xs font-medium text-neutral-900">Adjust</Text>
      </Pressable>
    );
  }

  return (
    <View className="mt-3 w-full gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      <View className="gap-1">
        <Text className="text-sm text-neutral-500">
          Set quantity to (currently {formatQuantity(currentQuantity)}
          {unit === null ? '' : ` ${unit}`})
        </Text>
        <TextInput
          value={newQuantity}
          onChangeText={setNewQuantity}
          keyboardType="decimal-pad"
          editable={!adjust.isPending}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900"
        />
      </View>

      <View className="gap-1">
        <Text className="text-sm text-neutral-500">Why</Text>
        <View className="flex-row flex-wrap gap-2">
          {REASONS.map((r) => (
            <Pressable
              key={r.value}
              accessibilityRole="button"
              accessibilityState={{ selected: reason === r.value }}
              disabled={adjust.isPending}
              onPress={() => setReason(r.value)}
              className={`rounded-lg px-3 py-1.5 ${
                reason === r.value ? 'bg-neutral-900' : 'border border-neutral-300 bg-white'
              }`}
            >
              <Text
                className={`text-xs font-medium ${
                  reason === r.value ? 'text-white' : 'text-neutral-900'
                }`}
              >
                {r.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View className="gap-1">
        <Text className="text-sm text-neutral-500">Note (optional)</Text>
        <TextInput
          value={note}
          onChangeText={setNote}
          placeholder="What happened?"
          editable={!adjust.isPending}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900"
        />
      </View>

      <View className="flex-row gap-2">
        <Pressable
          accessibilityRole="button"
          disabled={!validQuantity || adjust.isPending}
          onPress={submit}
          className={`flex-1 flex-row items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 active:opacity-70 ${
            !validQuantity || adjust.isPending ? 'opacity-40' : ''
          }`}
        >
          {adjust.isPending && <ActivityIndicator size="small" color="white" />}
          <Text className="text-sm font-medium text-white">Save</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={adjust.isPending}
          onPress={() => setOpen(false)}
          className="rounded-lg border border-neutral-300 px-4 py-2.5 active:opacity-70"
        >
          <Text className="text-sm font-medium text-neutral-900">Cancel</Text>
        </Pressable>
      </View>

      {adjust.isError && (
        <View className="gap-1 rounded-lg bg-red-50 p-3">
          <Text className="text-sm text-red-900">{describe(adjust.error)}</Text>
        </View>
      )}
    </View>
  );
}
