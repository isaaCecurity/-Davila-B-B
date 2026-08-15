import { getSupabaseClient } from '@bakeflow/auth';
import {
  useAllProductVariants,
  useIngredientStockLevels,
  useIngredients,
  useProductStockLevels,
  useWarehouses,
} from '@bakeflow/hooks';
import {
  compareDecimalStrings,
  isNegativeDecimalString,
  type Quantity,
} from '@bakeflow/types';
import { formatQuantity } from '@bakeflow/utils';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
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
 * Stock on hand in one warehouse — the P9.4 read path.
 *
 * ## Read-only, and structurally so
 *
 * There is no adjust control here. Stock levels are trigger-maintained from the immutable
 * `stock_movements` ledger and are never written directly (`CLAUDE.md` rule 7), so an
 * "edit quantity" affordance would be a lie about how the system works. Adjusting stock
 * means inserting a movement with a reason, which is P9.4's write half and is not in this
 * milestone.
 *
 * ## Quantities are strings all the way to the screen
 *
 * `quantity_on_hand` is `NUMERIC(18,4)` carried as an exact decimal string. Nothing here
 * parses it: `formatQuantity` prints it, `compareDecimalStrings` orders it, and
 * `isNegativeDecimalString` tests its sign — all digit-wise. `Number('12345678901234.5678')`
 * is already wrong at the fourth decimal, and a rounding bug in a stock figure is the kind
 * that is only noticed at a stock count months later.
 *
 * ## Negative is displayed, not hidden
 *
 * `apply_stock_movement()` refuses to drive stock negative through `production_consume` or
 * `sale` under any circumstances, and through `waste`/`adjustment` unless the organization
 * sets `allow_negative_stock` (all three branches verified against the live trigger). So a
 * negative level is not a glitch to hide: it means this bakery opted in and wrote off more
 * than it held. It is shown and marked rather than clamped, because clamping would conceal
 * exactly the discrepancy a stock count is meant to find.
 */
export default function WarehouseStockScreen(): React.JSX.Element {
  const client = getSupabaseClient();
  const router = useRouter();
  const { warehouseId } = useLocalSearchParams<{ warehouseId: string }>();
  const activeTenantId = useSessionStore((s) => s.activeTenantId);
  const [tab, setTab] = useState<'ingredients' | 'products'>('ingredients');

  const id = typeof warehouseId === 'string' && warehouseId !== '' ? warehouseId : null;

  const warehouses = useWarehouses(client, activeTenantId);
  const ingredientLevels = useIngredientStockLevels(client, activeTenantId, id);
  const productLevels = useProductStockLevels(client, activeTenantId, id);
  const ingredients = useIngredients(client, activeTenantId);
  const variants = useAllProductVariants(client, activeTenantId);

  const warehouseName = useMemo(
    () => warehouses.data?.find((w) => w.id === id)?.name ?? null,
    [warehouses.data, id],
  );

  /**
   * Names and reorder levels, resolved client-side from the catalog.
   *
   * A stock level row carries only ids, so the alternative was a PostgREST embed. Two plain
   * queries are used instead for the same reason `getProductWithVariants` avoids embeds: an
   * embed needs its own nested `deleted_at` filter, and getting that wrong fails *open*.
   * The catalog is small enough per bakery that the extra round trip is not the cost that
   * matters here.
   */
  const ingredientInfo = useMemo(() => {
    const map = new Map<string, { name: string; unit: string; reorder: Quantity }>();
    for (const row of ingredients.data?.rows ?? []) {
      map.set(row.id, {
        name: row.name,
        unit: row.unit_of_measure,
        reorder: row.reorder_level,
      });
    }
    return map;
  }, [ingredients.data]);

  const variantNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of variants.data?.rows ?? []) map.set(row.id, `${row.name} · ${row.sku}`);
    return map;
  }, [variants.data]);

  if (activeTenantId === null) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <NoOrganizationState onChoose={() => router.push('/select-organization')} />
      </SafeAreaView>
    );
  }

  const active = tab === 'ingredients' ? ingredientLevels : productLevels;

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="gap-4 border-b border-neutral-200 p-6 pb-4">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text className="text-2xl font-bold text-neutral-900">
              {warehouseName ?? 'Stock on hand'}
            </Text>
            <Text className="text-sm text-neutral-500">Read-only · from the movement ledger</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/inventory')}
            className="rounded-lg border border-neutral-300 px-4 py-2 active:opacity-70"
          >
            <Text className="text-sm font-medium text-neutral-900">Change</Text>
          </Pressable>
        </View>

        <View className="flex-row gap-2">
          <Tab label="Ingredients" selected={tab === 'ingredients'} onPress={() => setTab('ingredients')} />
          <Tab label="Finished goods" selected={tab === 'products'} onPress={() => setTab('products')} />
        </View>
      </View>

      {active.isPending ? (
        <LoadingState label="Loading stock…" />
      ) : active.isError ? (
        <ErrorState error={active.error} onRetry={() => void active.refetch()} />
      ) : active.data.rows.length === 0 ? (
        <EmptyState
          title="Nothing recorded here yet"
          detail="Quantities appear once stock movements have been recorded for this stockroom."
        />
      ) : tab === 'ingredients' ? (
        <FlatList
          data={ingredientLevels.data?.rows ?? []}
          keyExtractor={(item) => item.id}
          contentContainerClassName="p-6 gap-3"
          refreshing={ingredientLevels.isRefetching}
          onRefresh={() => void ingredientLevels.refetch()}
          renderItem={({ item }) => {
            const info = ingredientInfo.get(item.ingredient_id);
            return (
              <StockRow
                name={info?.name ?? 'Unknown ingredient'}
                detail={info === undefined ? null : info.unit}
                quantity={item.quantity_on_hand}
                reorderLevel={info?.reorder ?? null}
              />
            );
          }}
        />
      ) : (
        <FlatList
          data={productLevels.data?.rows ?? []}
          keyExtractor={(item) => item.id}
          contentContainerClassName="p-6 gap-3"
          refreshing={productLevels.isRefetching}
          onRefresh={() => void productLevels.refetch()}
          renderItem={({ item }) => (
            <StockRow
              name={variantNames.get(item.product_variant_id) ?? 'Unknown variant'}
              detail={null}
              quantity={item.quantity_on_hand}
              reorderLevel={null}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function Tab({
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
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      className={`rounded-lg px-4 py-2 active:opacity-70 ${
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
 * One item's quantity.
 *
 * The "Low" marker is a **display cue over an existing column**, not a new business rule:
 * it reads `ingredients.reorder_level`, which already exists live with a `>= 0` check. It
 * appears only when a reorder level has actually been set — flagging every item whose level
 * is the default `0` would mark every never-stocked ingredient and train users to ignore
 * the badge. Both numbers are always printed, so the underlying comparison stays visible
 * and the cue carries no information the user cannot check.
 */
function StockRow({
  name,
  detail,
  quantity,
  reorderLevel,
}: {
  name: string;
  detail: string | null;
  quantity: Quantity;
  reorderLevel: Quantity | null;
}): React.JSX.Element {
  const negative = isNegativeDecimalString(quantity);
  const low =
    reorderLevel !== null &&
    compareDecimalStrings(reorderLevel, '0') > 0 &&
    compareDecimalStrings(quantity, reorderLevel) <= 0;

  return (
    <View className="flex-row items-center justify-between gap-3 rounded-xl border border-neutral-200 p-4">
      <View className="flex-1 gap-1">
        <Text className="text-base font-semibold text-neutral-900">{name}</Text>
        {reorderLevel !== null && compareDecimalStrings(reorderLevel, '0') > 0 && (
          <Text className="text-xs text-neutral-500">
            Reorder at {formatQuantity(reorderLevel)}
            {detail === null ? '' : ` ${detail}`}
          </Text>
        )}
      </View>
      <View className="items-end gap-1">
        <Text
          className={`text-lg font-semibold ${negative ? 'text-red-600' : 'text-neutral-900'}`}
        >
          {formatQuantity(quantity)}
          {detail === null ? '' : ` ${detail}`}
        </Text>
        {negative ? (
          <Text className="text-xs font-medium uppercase text-red-600">Negative</Text>
        ) : low ? (
          <Text className="text-xs font-medium uppercase text-amber-600">Low</Text>
        ) : null}
      </View>
    </View>
  );
}
