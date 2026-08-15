import { getSupabaseClient } from '@bakeflow/auth';
import { useProduct, useProductVariants } from '@bakeflow/hooks';
import type { ProductVariant } from '@bakeflow/types';
import { formatNaira } from '@bakeflow/utils';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, LoadingState } from '../../components/ScreenState';
import { useSessionStore } from '../../stores/session';

/**
 * Product detail — P9.1. Shows a product and the variants that carry its prices.
 *
 * ## `unit_price` lives on the variant, and this screen is the reason that matters
 *
 * `products` has no price column. A bakery sells "Agege Bread — small / large", and each
 * size is a `product_variants` row with its own `unit_price NUMERIC(19,4)` and `sku`. So a
 * product has *a set of prices*, never one.
 *
 * **No price is summarised.** No "from ₦X", no average, no range. Each would be arithmetic
 * or comparison over money, and money here is an exact decimal string that must not become
 * a double (`@bakeflow/types` `scalars.ts`). Comparing two of them needs a decimal library
 * that is not a dependency, and picking a minimum by string comparison is wrong the moment
 * two prices differ in digit count — `"900.0000" > "1000.0000"` lexicographically.
 *
 * Every price is rendered by `formatNaira`, which **truncates** and never rounds: the
 * settlement rounding rule is unspecified (BLOCKER-003), and a rounding helper reachable
 * from a screen is a rounding helper that eventually feeds a stored value.
 */
export default function ProductDetailScreen(): React.JSX.Element {
  const client = getSupabaseClient();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const activeTenantId = useSessionStore((s) => s.activeTenantId);

  const productId = typeof id === 'string' && id !== '' ? id : null;
  const product = useProduct(client, activeTenantId, productId);
  const variants = useProductVariants(client, activeTenantId, productId);

  const back = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-row items-center gap-3 border-b border-neutral-200 p-6 pb-4">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={back}
          className="rounded-lg border border-neutral-300 px-3 py-2 active:opacity-70"
        >
          <Text className="text-sm font-medium text-neutral-900">Back</Text>
        </Pressable>
        <Text className="flex-1 text-xl font-bold text-neutral-900" numberOfLines={1}>
          {product.data?.name ?? 'Product'}
        </Text>
      </View>

      {product.isPending ? (
        <LoadingState label="Loading product…" />
      ) : product.isError ? (
        <ErrorState error={product.error} onRetry={() => void product.refetch()} />
      ) : product.data === null ? (
        // Not-found, wrong-organization and soft-deleted are one state on purpose:
        // distinguishing them would confirm that another bakery's product id exists.
        <EmptyState
          title="Product not available"
          detail="It may have been removed, or it belongs to another bakery."
        />
      ) : (
        <FlatList
          data={variants.data ?? []}
          keyExtractor={(item) => item.id}
          contentContainerClassName="p-6 gap-3"
          ListHeaderComponent={
            <View className="gap-2 pb-2">
              {product.data.description !== null && (
                <Text className="text-base text-neutral-600">{product.data.description}</Text>
              )}
              <View className="flex-row items-center gap-2">
                <Text className="text-sm text-neutral-500">
                  {product.data.is_active ? 'Active' : 'Inactive'}
                </Text>
              </View>
              <Text className="pt-2 text-lg font-semibold text-neutral-900">Variants</Text>
              {variants.isError && (
                <Text className="text-base text-red-600">{variants.error.message}</Text>
              )}
            </View>
          }
          ListEmptyComponent={
            variants.isPending ? (
              <Text className="py-6 text-center text-base text-neutral-500">
                Loading variants…
              </Text>
            ) : variants.isError ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => void variants.refetch()}
                className="items-center py-6 active:opacity-70"
              >
                <Text className="text-base font-medium text-neutral-900">
                  Retry loading variants
                </Text>
              </Pressable>
            ) : (
              <Text className="py-6 text-center text-base text-neutral-500">
                This product has no variants yet, so it has no price.
              </Text>
            )
          }
          refreshing={variants.isRefetching}
          onRefresh={() => void variants.refetch()}
          renderItem={({ item }) => <VariantRow variant={item} />}
        />
      )}
    </SafeAreaView>
  );
}

/**
 * One variant: name, SKU, price, and pack size where the schema records one.
 *
 * `unit_price` is rendered at 2 decimals — the stored value keeps all four, and an audit
 * view would pass `fractionDigits: 4` to see them. A bakery owner reading a price list
 * wants kobo, not ten-thousandths.
 */
function VariantRow({ variant }: { variant: ProductVariant }): React.JSX.Element {
  return (
    <View className="gap-1 rounded-xl border border-neutral-200 p-4">
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="flex-1 text-base font-semibold text-neutral-900">{variant.name}</Text>
        <Text className="text-base font-semibold text-neutral-900">
          {formatNaira(variant.unit_price)}
        </Text>
      </View>
      <View className="flex-row items-center justify-between gap-3">
        <Text className="text-sm text-neutral-500">{variant.sku}</Text>
        {!variant.is_active && (
          <Text className="text-xs font-medium uppercase text-neutral-400">Inactive</Text>
        )}
      </View>
    </View>
  );
}
