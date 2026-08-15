import { getSupabaseClient } from '@bakeflow/auth';
import { useWarehouses } from '@bakeflow/hooks';
import type { Warehouse } from '@bakeflow/types';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  EmptyState,
  ErrorState,
  LoadingState,
  NoOrganizationState,
} from '../../components/ScreenState';
import { useSessionStore } from '../../stores/session';

/**
 * Stockroom picker — the entry point of the P9.4 inventory read path.
 *
 * A warehouse has to be chosen before any quantity can be shown, because stock levels are
 * per warehouse: `stock_levels` is keyed `(warehouse_id, ingredient_id)` live, and the read
 * API is deliberately single-warehouse so a single-column cursor stays safe. Summing across
 * stockrooms would be a different, unspecified question ("what does this bakery have?"), so
 * this screen asks which one rather than inventing an answer.
 *
 * ## Empty here means something specific
 *
 * `warehouses` is branch-scoped as well as tenant-scoped, so RLS narrows it by the caller's
 * branch access. A baker at one branch legitimately sees fewer rows than the owner, and
 * someone with no branch assignment sees none at all. The empty copy says "none you can
 * see" rather than "none exist", which is the only claim the data supports.
 */
export default function WarehouseListScreen(): React.JSX.Element {
  const client = getSupabaseClient();
  const router = useRouter();
  const activeTenantId = useSessionStore((s) => s.activeTenantId);

  const warehouses = useWarehouses(client, activeTenantId);

  if (activeTenantId === null) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <NoOrganizationState onChoose={() => router.push('/select-organization')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center justify-between border-b border-neutral-200 p-6 pb-4">
        <View className="flex-1 gap-1 pr-3">
          <Text className="text-2xl font-bold text-neutral-900">Inventory</Text>
          <Text className="text-sm text-neutral-500">Choose a stockroom</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/')}
          className="rounded-lg border border-neutral-300 px-4 py-2 active:opacity-70"
        >
          <Text className="text-sm font-medium text-neutral-900">Catalog</Text>
        </Pressable>
      </View>

      {warehouses.isPending ? (
        <LoadingState label="Loading stockrooms…" />
      ) : warehouses.isError ? (
        <ErrorState error={warehouses.error} onRetry={() => void warehouses.refetch()} />
      ) : warehouses.data.length === 0 ? (
        <EmptyState
          title="No stockrooms you can see"
          detail="Stockrooms belong to a branch. You will see the ones for branches you have access to."
        />
      ) : (
        <FlatList
          data={warehouses.data}
          keyExtractor={(item) => item.id}
          contentContainerClassName="p-6 gap-3"
          refreshing={warehouses.isRefetching}
          onRefresh={() => void warehouses.refetch()}
          renderItem={({ item }) => (
            <WarehouseRow
              warehouse={item}
              onPress={() => router.push(`/inventory/${item.id}`)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function WarehouseRow({
  warehouse,
  onPress,
}: {
  warehouse: Warehouse;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center justify-between gap-3 rounded-xl border border-neutral-200 p-4 active:opacity-70"
    >
      <Text className="flex-1 text-lg font-semibold text-neutral-900">{warehouse.name}</Text>
      {warehouse.is_default && (
        <Text className="text-xs font-medium uppercase text-neutral-400">Default</Text>
      )}
    </Pressable>
  );
}
