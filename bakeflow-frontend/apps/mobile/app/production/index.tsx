import { getSupabaseClient } from '@bakeflow/auth';
import { useProductionBatches, useRecipesByIds } from '@bakeflow/hooks';
import {
  PRODUCTION_BATCH_STATUSES,
  type ProductionBatch,
  type ProductionBatchStatus,
} from '@bakeflow/types';
import { formatQuantity } from '@bakeflow/utils';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BatchStatusBadge } from '../../components/BatchStatusBadge';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NoOrganizationState,
} from '../../components/ScreenState';
import { useSessionStore } from '../../stores/session';

/**
 * Production batches — the P9.5 read path.
 *
 * ## Read-only, for a stronger reason than P9.4's
 *
 * There is no "start" or "complete" control here. `STATE-MACHINES.md` §2 requires
 * completion to be the single `complete_production_batch()` RPC, and reading it live
 * confirms why: in one transaction it writes one `production_consume` movement per
 * ingredient, one `production_output` movement for the finished variant, records each
 * line's actual and waste quantities, and sets the status. A client that assembled that
 * from separate calls would, on a partial failure, leave the flour consumed with no bread
 * recorded. So the mutation surface is deliberately absent rather than unfinished — see
 * `IMPLEMENTATION_LOG.md` for the signatures, now read from the database.
 *
 * ## Filtering happens in the query, not in the list
 *
 * The status filter is passed to `listProductionBatches` and travels into the cache key
 * with it. Filtering a fetched page client-side would silently under-report: the page is
 * bounded by the keyset limit, so "show me failed batches" would search only the first
 * page's worth of rows and confidently render "none".
 */
export default function ProductionScreen(): React.JSX.Element {
  const client = getSupabaseClient();
  const router = useRouter();
  const activeTenantId = useSessionStore((s) => s.activeTenantId);
  const [status, setStatus] = useState<ProductionBatchStatus | null>(null);

  const filters = useMemo(
    () => (status === null ? {} : { status }),
    [status],
  );
  const batches = useProductionBatches(client, activeTenantId, filters);

  const recipeIds = useMemo(
    () => (batches.data?.rows ?? []).map((batch) => batch.recipe_id),
    [batches.data],
  );
  const recipes = useRecipesByIds(client, activeTenantId, recipeIds);

  const recipeNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const recipe of recipes.data ?? []) map.set(recipe.id, recipe.name);
    return map;
  }, [recipes.data]);

  if (activeTenantId === null) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <NoOrganizationState onChoose={() => router.push('/select-organization')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="gap-4 border-b border-neutral-200 p-6 pb-4">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text className="text-2xl font-bold text-neutral-900">Production</Text>
            <Text className="text-sm text-neutral-500">Batches for your branches</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/')}
            className="rounded-lg border border-neutral-300 px-4 py-2 active:opacity-70"
          >
            <Text className="text-sm font-medium text-neutral-900">Catalog</Text>
          </Pressable>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-1">
          <View className="flex-row gap-2 px-1">
            <FilterChip label="All" selected={status === null} onPress={() => setStatus(null)} />
            {PRODUCTION_BATCH_STATUSES.map((value) => (
              <FilterChip
                key={value}
                label={LABELS[value]}
                selected={status === value}
                onPress={() => setStatus(value)}
              />
            ))}
          </View>
        </ScrollView>
      </View>

      {batches.isPending ? (
        <LoadingState label="Loading batches…" />
      ) : batches.isError ? (
        <ErrorState error={batches.error} onRetry={() => void batches.refetch()} />
      ) : batches.data.rows.length === 0 ? (
        <EmptyState
          title={status === null ? 'No batches yet' : `No ${LABELS[status].toLowerCase()} batches`}
          detail={
            status === null
              ? 'Batches belong to a branch. You will see the ones for branches you have access to.'
              : 'Try a different status.'
          }
        />
      ) : (
        <FlatList
          data={batches.data.rows}
          keyExtractor={(item) => item.id}
          contentContainerClassName="p-6 gap-3"
          refreshing={batches.isRefetching}
          onRefresh={() => void batches.refetch()}
          renderItem={({ item }) => (
            <BatchRow
              batch={item}
              recipeName={recipeNames.get(item.recipe_id) ?? null}
              onPress={() => router.push(`/production/${item.id}`)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const LABELS: Record<ProductionBatchStatus, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`rounded-full px-4 py-2 active:opacity-70 ${
        selected ? 'bg-neutral-900' : 'border border-neutral-300'
      }`}
    >
      <Text className={`text-sm font-medium ${selected ? 'text-white' : 'text-neutral-900'}`}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * One batch in the list.
 *
 * Shows `planned_quantity` and, once there is one, `actual_quantity` — never a variance
 * between them. Both are `NUMERIC(18,4)` exact decimal strings and subtracting them needs a
 * decimal library this project has deliberately not taken on (`@bakeflow/types`
 * `scalars.ts`); a float subtraction would put a wrong yield figure in front of a baker.
 */
function BatchRow({
  batch,
  recipeName,
  onPress,
}: {
  batch: ProductionBatch;
  recipeName: string | null;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="gap-2 rounded-xl border border-neutral-200 p-4 active:opacity-70"
    >
      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1 text-lg font-semibold text-neutral-900">
          {recipeName ?? 'Recipe unavailable'}
        </Text>
        <BatchStatusBadge status={batch.status} />
      </View>
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-sm text-neutral-500">{batch.batch_number}</Text>
        <Text className="text-sm text-neutral-700">
          {batch.actual_quantity === null
            ? `Planned ${formatQuantity(batch.planned_quantity)}`
            : `Made ${formatQuantity(batch.actual_quantity)} of ${formatQuantity(batch.planned_quantity)}`}
        </Text>
      </View>
    </Pressable>
  );
}
