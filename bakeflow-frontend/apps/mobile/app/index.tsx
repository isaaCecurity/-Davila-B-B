import { getSupabaseClient, rolesFromSession } from '@bakeflow/auth';
import { useMyOrganizations, useProductCategories, useProducts } from '@bakeflow/hooks';
import type { Product } from '@bakeflow/types';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  EmptyState,
  ErrorState,
  LoadingState,
  NoOrganizationState,
} from '../components/ScreenState';
import { useSessionStore } from '../stores/session';

/**
 * Catalog list — the far end of the P8.1 vertical slice.
 *
 * Renders products for the organization the **token** says is active, with its category
 * name resolved client-side from a second query.
 *
 * ## Money is displayed, never computed
 *
 * `unit_price` lives on `product_variants` rather than `products`, so no price appears on
 * this screen. That is not an omission to fix by summing or averaging variants: money is
 * `NUMERIC(19,4)` carried end-to-end as an exact decimal string, and arithmetic on it needs
 * a decimal library that is not a dependency yet (`@bakeflow/types` `scalars.ts`). A price
 * belongs on the product detail screen, printed from the variant that owns it.
 *
 * ## Empty vs. denied
 *
 * A revoked membership and an empty catalog both arrive as `[]` — RLS filters rather than
 * raising. They are told apart before the query runs: with a null claim the hook is
 * disabled and `NoOrganizationState` renders instead of "no products yet".
 */
export default function CatalogScreen(): React.JSX.Element {
  const client = getSupabaseClient();
  const router = useRouter();
  const activeTenantId = useSessionStore((s) => s.activeTenantId);
  const userId = useSessionStore((s) => s.userId);
  const session = useSessionStore((s) => s.session);
  const isDriver = rolesFromSession(session).includes('driver');

  const products = useProducts(client, activeTenantId);
  const categories = useProductCategories(client, activeTenantId);
  const organizations = useMyOrganizations(client, userId);

  const activeName = useMemo(
    () => organizations.data?.find((o) => o.id === activeTenantId)?.name ?? null,
    [organizations.data, activeTenantId],
  );

  const categoryNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of categories.data ?? []) map.set(category.id, category.name);
    return map;
  }, [categories.data]);

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
          <Text className="text-2xl font-bold text-neutral-900">Catalog</Text>
          <Text className="text-sm text-neutral-500">{activeName ?? 'Your bakery'}</Text>
        </View>
        <View className="flex-row gap-2">
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/inventory')}
            className="rounded-lg border border-neutral-300 px-4 py-2 active:opacity-70"
          >
            <Text className="text-sm font-medium text-neutral-900">Stock</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/production')}
            className="rounded-lg border border-neutral-300 px-4 py-2 active:opacity-70"
          >
            <Text className="text-sm font-medium text-neutral-900">Batches</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/delivery')}
            className="rounded-lg border border-neutral-300 px-4 py-2 active:opacity-70"
          >
            <Text className="text-sm font-medium text-neutral-900">Drops</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/finance' as never)}
            className="rounded-lg border border-neutral-300 px-4 py-2 active:opacity-70"
          >
            <Text className="text-sm font-medium text-neutral-900">Finance</Text>
          </Pressable>
          {isDriver && (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/driver/home')}
              className="rounded-lg border border-neutral-300 px-4 py-2 active:opacity-70"
            >
              <Text className="text-sm font-medium text-neutral-900">My Trip</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/select-organization')}
            className="rounded-lg border border-neutral-300 px-4 py-2 active:opacity-70"
          >
            <Text className="text-sm font-medium text-neutral-900">Switch</Text>
          </Pressable>
        </View>
      </View>

      {products.isPending ? (
        <LoadingState label="Loading catalog…" />
      ) : products.isError ? (
        <ErrorState error={products.error} onRetry={() => void products.refetch()} />
      ) : products.data.rows.length === 0 ? (
        <EmptyState
          title="No products yet"
          detail="Products added to this bakery will appear here."
        />
      ) : (
        <FlatList
          data={products.data.rows}
          keyExtractor={(item) => item.id}
          contentContainerClassName="p-6 gap-3"
          refreshing={products.isRefetching}
          onRefresh={() => void products.refetch()}
          renderItem={({ item }) => (
            <ProductRow
              product={item}
              categoryName={
                item.category_id === null ? null : (categoryNames.get(item.category_id) ?? null)
              }
              onPress={() => router.push(`/product/${item.id}`)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

function ProductRow({
  product,
  categoryName,
  onPress,
}: {
  product: Product;
  categoryName: string | null;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className="gap-1 rounded-xl border border-neutral-200 p-4 active:opacity-70"
    >
      <View className="flex-row items-center justify-between gap-3">
        <Text className="flex-1 text-lg font-semibold text-neutral-900">{product.name}</Text>
        {!product.is_active && (
          <Text className="text-xs font-medium uppercase text-neutral-400">Inactive</Text>
        )}
      </View>
      {categoryName !== null && (
        <Text className="text-sm text-neutral-500">{categoryName}</Text>
      )}
    </Pressable>
  );
}
