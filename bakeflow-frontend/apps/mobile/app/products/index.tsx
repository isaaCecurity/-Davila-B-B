import { getSupabaseClient } from '@bakeflow/auth';
import { useProductCategories, useProducts } from '@bakeflow/hooks';
import type { Product } from '@bakeflow/types';
import {
  Badge,
  Chips,
  EmptyState,
  ListRow,
  ScreenList,
  SearchBar,
  Skeleton,
  Text,
} from '@bakeflow/ui';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { ErrorState, NoOrganizationState } from '../../components/ScreenState';
import { useSessionStore } from '../../stores/session';

/**
 * Products — the prototype's `products` screen, over the P8.1 catalog read.
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
 *
 * PORT-NOTE: the prototype row shows price, units left and margin. Price is per variant (see
 * above); stock is per warehouse and lives on the Stock screen; margin needs recipe cost
 * arithmetic. Rows show name, category and status. Category chips and search filter the page
 * of products already loaded. "Add product" waits for a create-product endpoint.
 */
export default function ProductsScreen(): React.JSX.Element {
  const client = getSupabaseClient();
  const router = useRouter();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');

  const products = useProducts(client, tenantId, { limit: 200 });
  const categories = useProductCategories(client, tenantId);

  const categoryName = useMemo(
    () => new Map((categories.data ?? []).map((c) => [c.id, c.name])),
    [categories.data]
  );

  const q = query.trim().toLowerCase();
  const rows: Product[] = (products.data?.rows ?? []).filter(
    (p) =>
      (category === 'all' || p.category_id === category) &&
      (q === '' || p.name.toLowerCase().includes(q))
  );

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const total = products.data?.rows.length ?? 0;
  const inactive = (products.data?.rows ?? []).filter((p) => !p.is_active).length;

  return (
    <ScreenList
      title="Products"
      sub={products.isPending ? undefined : `${total} item${total === 1 ? '' : 's'}${inactive > 0 ? ` · ${inactive} inactive` : ''}`}
      onBack={() => router.back()}
      data={products.isPending || products.isError ? [] : rows}
      keyExtractor={(p) => p.id}
      refreshing={products.isRefetching}
      onRefresh={() => void products.refetch()}
      ListHeaderComponent={
        <View className="gap-3 pb-4">
          <SearchBar value={query} onChangeText={setQuery} placeholder="Search products" />
          <Chips
            accessibilityLabel="Filter by category"
            options={[
              { key: 'all', label: 'All' },
              ...(categories.data ?? []).map((c) => ({ key: c.id, label: c.name })),
            ]}
            value={category}
            onChange={setCategory}
          />
        </View>
      }
      renderItem={({ item, index }) => (
        <View
          className={`bg-white ${index === 0 ? 'rounded-t-md' : ''} ${index === rows.length - 1 ? 'rounded-b-md' : ''}`}
        >
          {index > 0 && <View className="absolute left-4 right-0 top-0 z-10 h-px bg-border" />}
          <ListRow
            leading={
              <View className="h-11 w-11 items-center justify-center rounded-xl bg-cream-deep">
                <Text className="text-foot font-bold text-cocoa">
                  {item.name
                    .split(/\s+/)
                    .map((w) => w[0] ?? '')
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </Text>
              </View>
            }
            title={item.name}
            sub={item.category_id === null ? 'No category' : (categoryName.get(item.category_id) ?? 'Category')}
            trailing={!item.is_active ? <Badge label="Inactive" tone="neutral" /> : undefined}
            onPress={() => router.push(`/product/${item.id}`)}
          />
        </View>
      )}
      ListEmptyComponent={
        products.isPending ? (
          <View className="gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} variant="row" />
            ))}
          </View>
        ) : products.isError ? (
          <ErrorState error={products.error} onRetry={() => void products.refetch()} />
        ) : total === 0 ? (
          <EmptyState icon="box" title="No products yet" text="Products added to this bakery will appear here." />
        ) : (
          <EmptyState icon="box" title="No product matches" text="Try another name, or clear the category filter." />
        )
      }
    />
  );
}
