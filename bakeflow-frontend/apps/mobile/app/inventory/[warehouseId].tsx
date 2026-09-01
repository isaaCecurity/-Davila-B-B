import { getSupabaseClient } from '@bakeflow/auth';
import {
  useAllProductVariants,
  useProductStockLevels,
  useWarehouses,
} from '@bakeflow/hooks';
import { isNegativeDecimalString, type Quantity } from '@bakeflow/types';
import { formatQuantity } from '@bakeflow/utils';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdjustStockAction } from '../../components/AdjustStockAction';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NoOrganizationState,
} from '../../components/ScreenState';
import { useSessionStore } from '../../stores/session';

/**
 * Stock on hand in one warehouse — P9.4, read and write, finished-product stock only.
 *
 * Ingredient stock (raw materials) is deactivated for MVP (AD-022): the tab toggle this
 * screen used to have between "Ingredients" and "Finished goods" is gone, and only
 * product stock levels are fetched. `useIngredientStockLevels`/`useIngredients` and the
 * ingredient branch of `StockRow` were removed here, not just hidden behind a flag —
 * the backend RPC (`adjust_stock`) rejects `item_type='ingredient'` outright now, so
 * showing that tab would only present a UI users cannot act on.
 *
 * ## The row never edits its own number
 *
 * Stock levels are trigger-maintained from the immutable `stock_movements` ledger and are
 * never written directly (`CLAUDE.md` rule 7), so there is no inline "edit quantity" field
 * here — that would be a lie about how the system works. `AdjustStockAction` is what a row
 * actually offers: a form that calls `adjust_stock()`, which appends a movement with a
 * reason and lets the trigger recompute the level. See its own header for why the field it
 * shows is an absolute target, not a delta.
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

  const id = typeof warehouseId === 'string' && warehouseId !== '' ? warehouseId : null;

  const warehouses = useWarehouses(client, activeTenantId);
  const productLevels = useProductStockLevels(client, activeTenantId, id);
  const variants = useAllProductVariants(client, activeTenantId);

  const warehouseName = useMemo(
    () => warehouses.data?.find((w) => w.id === id)?.name ?? null,
    [warehouses.data, id],
  );

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

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="gap-4 border-b border-neutral-200 p-6 pb-4">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text className="text-2xl font-bold text-neutral-900">
              {warehouseName ?? 'Stock on hand'}
            </Text>
            <Text className="text-sm text-neutral-500">From the movement ledger</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/inventory')}
            className="rounded-lg border border-neutral-300 px-4 py-2 active:opacity-70"
          >
            <Text className="text-sm font-medium text-neutral-900">Change</Text>
          </Pressable>
        </View>
      </View>

      {productLevels.isPending ? (
        <LoadingState label="Loading stock…" />
      ) : productLevels.isError ? (
        <ErrorState error={productLevels.error} onRetry={() => void productLevels.refetch()} />
      ) : productLevels.data.rows.length === 0 ? (
        <EmptyState
          title="Nothing recorded here yet"
          detail="Quantities appear once stock movements have been recorded for this stockroom."
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
              quantity={item.quantity_on_hand}
              warehouseId={id ?? ''}
              itemId={item.product_variant_id}
              tenantId={activeTenantId}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

/**
 * One product's quantity.
 *
 * Ingredient-only concepts (the "Low" reorder-level marker, a unit-of-measure suffix) are
 * gone along with the ingredient tab this row used to also render for (AD-022) —
 * `reorder_level` lives on `ingredients`, which product variants never had a version of.
 */
function StockRow({
  name,
  quantity,
  warehouseId,
  itemId,
  tenantId,
}: {
  name: string;
  quantity: Quantity;
  warehouseId: string;
  itemId: string;
  tenantId: string | null;
}): React.JSX.Element {
  const negative = isNegativeDecimalString(quantity);

  return (
    <View className="gap-1 rounded-xl border border-neutral-200 p-4">
      <View className="flex-row items-center justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text className="text-base font-semibold text-neutral-900">{name}</Text>
        </View>
        <View className="items-end gap-1">
          <Text
            className={`text-lg font-semibold ${negative ? 'text-red-600' : 'text-neutral-900'}`}
          >
            {formatQuantity(quantity)}
          </Text>
          {negative && (
            <Text className="text-xs font-medium uppercase text-red-600">Negative</Text>
          )}
        </View>
      </View>
      <View className="flex-row justify-end">
        <AdjustStockAction
          warehouseId={warehouseId}
          itemType="product"
          itemId={itemId}
          currentQuantity={quantity}
          unit={null}
          tenantId={tenantId}
        />
      </View>
    </View>
  );
}
