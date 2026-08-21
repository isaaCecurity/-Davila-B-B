import { getSupabaseClient } from '@bakeflow/auth';
import { useIngredients, useProductionBatch, useRecipesByIds } from '@bakeflow/hooks';
import type { ProductionBatchIngredient, Quantity } from '@bakeflow/types';
import { formatQuantity } from '@bakeflow/utils';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BatchStatusBadge } from '../../components/BatchStatusBadge';
import { ProductionBatchActions } from '../../components/ProductionBatchActions';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NoOrganizationState,
} from '../../components/ScreenState';
import { useSessionStore } from '../../stores/session';

/**
 * One production batch and its ingredient lines — the P9.5 detail.
 *
 * ## The ingredient lines are not the recipe
 *
 * They look like a copy of the recipe and are not one. `copy_batch_planned_ingredients()`
 * fires AFTER INSERT and writes `round(recipe_quantity * (planned_quantity / yield), 4)`
 * per line — a snapshot, scaled to this batch's size and rounded at the database's four
 * decimals. So a later recipe edit does not rewrite what a past batch planned to use, and
 * this screen must read the batch's own lines rather than re-deriving them from the recipe.
 * The distinction is the difference between a record and a guess.
 *
 * ## Quantities are printed, never reconciled
 *
 * Planned, actual and waste are each `NUMERIC(18,4)` carried as exact decimal strings, and
 * all three are shown side by side without a computed variance. Subtracting them requires a
 * decimal library that is deliberately not a dependency (`@bakeflow/types` `scalars.ts`);
 * doing it in floating point would show a baker a yield figure that is wrong in the fourth
 * decimal, which is exactly the error a stock count surfaces months later.
 */
export default function ProductionBatchScreen(): React.JSX.Element {
  const client = getSupabaseClient();
  const router = useRouter();
  const { batchId } = useLocalSearchParams<{ batchId: string }>();
  const activeTenantId = useSessionStore((s) => s.activeTenantId);

  const id = typeof batchId === 'string' && batchId !== '' ? batchId : null;

  const batch = useProductionBatch(client, activeTenantId, id);
  const ingredients = useIngredients(client, activeTenantId);

  const recipeIds = useMemo(
    () => (batch.data == null ? [] : [batch.data.batch.recipe_id]),
    [batch.data],
  );
  const recipes = useRecipesByIds(client, activeTenantId, recipeIds);

  const ingredientInfo = useMemo(() => {
    const map = new Map<string, { name: string; unit: string }>();
    for (const row of ingredients.data?.rows ?? []) {
      map.set(row.id, { name: row.name, unit: row.unit_of_measure });
    }
    return map;
  }, [ingredients.data]);

  if (activeTenantId === null) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <NoOrganizationState onChoose={() => router.push('/select-organization')} />
      </SafeAreaView>
    );
  }

  if (batch.isPending) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <LoadingState label="Loading batch…" />
      </SafeAreaView>
    );
  }

  if (batch.isError) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ErrorState error={batch.error} onRetry={() => void batch.refetch()} />
      </SafeAreaView>
    );
  }

  if (batch.data === null) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <EmptyState
          title="Batch not found"
          detail="It may have been removed, or it belongs to a bakery or branch you cannot see."
        />
      </SafeAreaView>
    );
  }

  const { batch: row, ingredients: lines } = batch.data;
  const recipeName = recipes.data?.find((recipe) => recipe.id === row.recipe_id)?.name ?? null;

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView contentContainerClassName="p-6 gap-6">
        <View className="gap-2">
          <View className="flex-row items-start justify-between gap-3">
            <Text className="flex-1 text-2xl font-bold text-neutral-900">
              {recipeName ?? 'Recipe unavailable'}
            </Text>
            <BatchStatusBadge status={row.status} />
          </View>
          <Text className="text-sm text-neutral-500">{row.batch_number}</Text>
        </View>

        {row.status === 'failed' && row.failure_reason !== null && (
          <View className="gap-1 rounded-xl bg-amber-50 p-4">
            <Text className="text-xs font-semibold uppercase text-amber-800">Why it failed</Text>
            <Text className="text-base text-amber-900">{row.failure_reason}</Text>
          </View>
        )}

        <View className="gap-3 rounded-xl border border-neutral-200 p-4">
          <Field label="Planned" value={formatQuantity(row.planned_quantity)} />
          <Field
            label="Actually made"
            value={row.actual_quantity === null ? '—' : formatQuantity(row.actual_quantity)}
          />
          <Field label="Started" value={formatTimestamp(row.started_at)} />
          <Field label="Finished" value={formatTimestamp(row.completed_at)} />
          {row.ticket_id !== null && <Field label="For ticket" value={row.ticket_id} />}
        </View>

        <ProductionBatchActions batch={row} tenantId={activeTenantId} />

        <View className="gap-3">
          <Text className="text-lg font-semibold text-neutral-900">Ingredients</Text>
          {lines.length === 0 ? (
            <Text className="text-base text-neutral-500">
              No ingredient lines were recorded for this batch.
            </Text>
          ) : (
            lines.map((line) => (
              <IngredientLine
                key={line.id}
                line={line}
                name={ingredientInfo.get(line.ingredient_id)?.name ?? 'Unknown ingredient'}
                unit={ingredientInfo.get(line.ingredient_id)?.unit ?? null}
              />
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="text-sm text-neutral-500">{label}</Text>
      <Text className="flex-1 text-right text-base font-medium text-neutral-900">{value}</Text>
    </View>
  );
}

/**
 * `null` is rendered as an em dash rather than "not started".
 *
 * A null `completed_at` on a scheduled batch means "not yet"; on a cancelled batch it means
 * "never will". The screen does not know which sentence applies, and the status badge above
 * already says it, so it prints the absence rather than narrating it wrongly.
 */
function formatTimestamp(value: string | null): string {
  if (value === null) return '—';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function IngredientLine({
  line,
  name,
  unit,
}: {
  line: ProductionBatchIngredient;
  name: string;
  unit: string | null;
}): React.JSX.Element {
  const suffix = unit === null ? '' : ` ${unit}`;
  const print = (value: Quantity | null): string =>
    value === null ? '—' : `${formatQuantity(value)}${suffix}`;

  return (
    <View className="gap-2 rounded-xl border border-neutral-200 p-4">
      <Text className="text-base font-semibold text-neutral-900">{name}</Text>
      <View className="flex-row justify-between gap-3">
        <Metric label="Planned" value={print(line.planned_quantity)} />
        <Metric label="Used" value={print(line.actual_quantity)} />
        <Metric label="Wasted" value={print(line.waste_quantity)} />
      </View>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View className="gap-1">
      <Text className="text-xs uppercase text-neutral-400">{label}</Text>
      <Text className="text-sm font-medium text-neutral-900">{value}</Text>
    </View>
  );
}
