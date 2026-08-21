import { getSupabaseClient } from '@bakeflow/auth';
import { BakeflowApiError } from '@bakeflow/api';
import {
  useCancelProductionBatch,
  useCompleteProductionBatch,
  useFailProductionBatch,
  useStartProductionBatch,
} from '@bakeflow/hooks';
import type { ProductionBatch, ProductionBatchStatus } from '@bakeflow/types';
import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

/**
 * The transition controls on a production batch — P9.5 write path.
 *
 * ## Two different mechanisms behind one set of buttons
 *
 * `scheduled -> in_progress` and `scheduled -> cancelled` are plain updates
 * (`useStartProductionBatch` / `useCancelProductionBatch`), policed entirely by
 * `guard_production_batch_transition()`. `in_progress -> completed` and
 * `in_progress -> failed` each have to write `stock_movements` atomically with the status
 * change, so they go through `complete_production_batch()` / `fail_production_batch()` —
 * see `packages/api/mutations/production.ts`. The screen does not need to know which is
 * which; both surface the same way, as a mutation that either succeeds or comes back with
 * a `BakeflowApiError` whose `code` this component branches on.
 *
 * ## Two hops need a value
 *
 * `completed` needs a whole-batch `actualQuantity` (`production_batches_completed_needs_
 * quantity`, a standing CHECK) and `failed` needs a non-blank `failure_reason`. Each opens
 * a small form first, same as `DeliveryActions`.
 *
 * ## What is not offered here
 *
 * Per-ingredient actuals and waste are not collected — `completeProductionBatch` /
 * `failProductionBatch` omit `p_ingredient_actuals`, so every line defaults to its planned
 * quantity (waste 0 on completion, waste = actual on failure). A baker correcting an
 * individual ingredient's actual usage needs a line-item form this screen does not have
 * yet; recording the whole-batch yield is what ships now.
 */

interface ActionSpec {
  to: 'in_progress' | 'cancelled' | 'completed' | 'failed';
  label: string;
  tone: 'primary' | 'neutral';
  needs?: 'quantity' | 'reason';
}

const NEXT_ACTIONS: Readonly<Record<ProductionBatchStatus, readonly ActionSpec[]>> = {
  scheduled: [
    { to: 'in_progress', label: 'Start batch', tone: 'primary' },
    { to: 'cancelled', label: 'Cancel', tone: 'neutral' },
  ],
  in_progress: [
    { to: 'completed', label: 'Mark completed', tone: 'primary', needs: 'quantity' },
    { to: 'failed', label: 'Mark failed', tone: 'neutral', needs: 'reason' },
  ],
  completed: [],
  failed: [],
  cancelled: [],
};

/** `API-CONTRACT.md` §3: the server's own message is never rendered. */
function describe(error: Error): string {
  const code = error instanceof BakeflowApiError ? error.code : 'unexpected_error';
  switch (code) {
    case 'invalid_transition':
      return 'That is no longer possible — this batch has moved on. Pull to refresh.';
    case 'insufficient_stock':
      return 'Completing this would take an ingredient below zero. Check stock before trying again.';
    case 'insufficient_role':
      return 'You do not have permission to do this.';
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

/** Decimal string, any scale up to `NUMERIC(18,4)` — mirrors the pattern in
 *  `mutations/inventory.ts`'s `QUANTITY_INPUT`, applied to a raw text field's value. */
const QUANTITY_INPUT = /^\d{1,14}(\.\d{1,4})?$/;

export function ProductionBatchActions({
  batch,
  tenantId,
}: {
  batch: ProductionBatch;
  tenantId: string | null;
}): React.JSX.Element | null {
  const client = getSupabaseClient();
  const start = useStartProductionBatch(client, tenantId);
  const cancel = useCancelProductionBatch(client, tenantId);
  const complete = useCompleteProductionBatch(client, tenantId);
  const fail = useFailProductionBatch(client, tenantId);

  const [openForm, setOpenForm] = useState<'quantity' | 'reason' | null>(null);
  const [actualQuantity, setActualQuantity] = useState('');
  const [reason, setReason] = useState('');

  const actions = NEXT_ACTIONS[batch.status];
  const busy = start.isPending || cancel.isPending || complete.isPending || fail.isPending;
  const activeError = complete.error ?? fail.error ?? start.error ?? cancel.error ?? null;

  function reset(): void {
    setOpenForm(null);
    setActualQuantity('');
    setReason('');
  }

  function run(spec: ActionSpec): void {
    if (spec.needs !== undefined && openForm !== spec.needs) {
      setOpenForm(spec.needs);
      return;
    }

    switch (spec.to) {
      case 'in_progress':
        start.mutate({ batchId: batch.id });
        return;
      case 'cancelled':
        cancel.mutate({ batchId: batch.id });
        return;
      case 'completed':
        complete.mutate(
          { batchId: batch.id, input: { actualQuantity: actualQuantity.trim() } },
          { onSuccess: reset },
        );
        return;
      case 'failed':
        fail.mutate({ batchId: batch.id, input: { reason } }, { onSuccess: reset });
        return;
    }
  }

  if (actions.length === 0) {
    return (
      <View className="gap-2 rounded-xl border border-neutral-200 p-4">
        <Text className="text-lg font-semibold text-neutral-900">Finished</Text>
        <Text className="text-sm text-neutral-500">
          {batch.status === 'completed'
            ? 'This batch is done. Its stock has been recorded.'
            : batch.status === 'failed'
              ? 'This batch failed. Its ingredients were consumed and recorded as used.'
              : 'This batch was cancelled before it started. Nothing was consumed.'}
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-3 rounded-xl border border-neutral-200 p-4">
      <Text className="text-lg font-semibold text-neutral-900">What happened?</Text>

      {openForm === 'quantity' && (
        <View className="gap-1">
          <Text className="text-sm text-neutral-500">How much did this batch actually make?</Text>
          <TextInput
            value={actualQuantity}
            onChangeText={setActualQuantity}
            placeholder="e.g. 24"
            keyboardType="decimal-pad"
            editable={!busy}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-base text-neutral-900"
          />
          <Text className="text-xs text-neutral-400">
            Cannot be zero or more than the planned quantity.
          </Text>
        </View>
      )}

      {openForm === 'reason' && (
        <View className="gap-1">
          <Text className="text-sm text-neutral-500">Why did it fail?</Text>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Oven fault, dough did not rise…"
            editable={!busy}
            multiline
            className="rounded-lg border border-neutral-300 px-3 py-2 text-base text-neutral-900"
          />
          <Text className="text-xs text-neutral-400">
            The ingredients used are still recorded as consumed.
          </Text>
        </View>
      )}

      <View className="gap-2">
        {actions.map((spec) => {
          const armed = spec.needs === undefined || openForm === spec.needs;
          const value = spec.needs === 'quantity' ? actualQuantity : reason;
          const validQuantity =
            spec.needs !== 'quantity' || QUANTITY_INPUT.test(actualQuantity.trim());
          const disabled =
            busy || (armed && spec.needs !== undefined && (value.trim() === '' || !validQuantity));

          return (
            <Pressable
              key={spec.to}
              accessibilityRole="button"
              disabled={disabled}
              onPress={() => run(spec)}
              className={`flex-row items-center justify-center gap-2 rounded-lg px-4 py-3 active:opacity-70 ${
                spec.tone === 'primary'
                  ? 'bg-neutral-900'
                  : 'border border-neutral-300 bg-white'
              } ${disabled ? 'opacity-40' : ''}`}
            >
              {busy && <ActivityIndicator size="small" />}
              <Text
                className={`text-base font-medium ${
                  spec.tone === 'primary' ? 'text-white' : 'text-neutral-900'
                }`}
              >
                {armed ? spec.label : `${spec.label}…`}
              </Text>
            </Pressable>
          );
        })}

        {openForm !== null && (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={reset}
            className="items-center px-4 py-2 active:opacity-70"
          >
            <Text className="text-sm text-neutral-500">Cancel</Text>
          </Pressable>
        )}
      </View>

      {activeError !== null && (
        <View className="gap-1 rounded-lg bg-red-50 p-3">
          <Text className="text-sm text-red-900">{describe(activeError)}</Text>
        </View>
      )}
    </View>
  );
}
