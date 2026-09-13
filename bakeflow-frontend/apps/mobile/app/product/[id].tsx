import { getSupabaseClient } from '@bakeflow/auth';
import { useProduct, useProductVariants } from '@bakeflow/hooks';
import { Badge, Button, Card, List, ListRow, ScreenScroll, Skeleton, Text } from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';

import { EmptyState, ErrorState } from '../../components/ScreenState';
import { useSessionStore } from '../../stores/session';

/**
 * Product detail — the prototype's `product-detail`, over the P9.1 product read.
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
 *
 * PORT-NOTE: the prototype hero shows one selling price with cost, margin, profit, units sold
 * and revenue; its "Bakery pricing" card derives wholesale and contract prices from the base
 * price. A product has a set of prices (above), cost and sales are aggregates with no read
 * endpoint, and deriving tier prices would invent a pricing rule — a blocker, not a port
 * decision. The hero names the product; prices are listed per variant. Per-warehouse stock
 * lives on the Stock screen. The "Last 7 days" chart needs a per-product sales series.
 */
export default function ProductDetailScreen(): React.JSX.Element {
  const client = getSupabaseClient();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const tenantId = useSessionStore((s) => s.activeTenantId);

  const productId = typeof id === 'string' && id !== '' ? id : null;
  const product = useProduct(client, tenantId, productId);
  const variants = useProductVariants(client, tenantId, productId);

  const back = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  if (product.isPending) {
    return (
      <ScreenScroll title="Product" onBack={back}>
        <View className="gap-3 pt-5">
          <Skeleton variant="chart" />
          <Skeleton variant="row" className="h-[140px]" />
        </View>
      </ScreenScroll>
    );
  }
  if (product.isError) {
    return (
      <ScreenScroll title="Product" onBack={back}>
        <ErrorState error={product.error} onRetry={() => void product.refetch()} />
      </ScreenScroll>
    );
  }
  if (product.data === null) {
    // Not-found, wrong-organization and soft-deleted are one state on purpose:
    // distinguishing them would confirm that another bakery's product id exists.
    return (
      <ScreenScroll title="Product" onBack={back}>
        <EmptyState title="Product not available" detail="It may have been removed, or it belongs to another bakery." />
      </ScreenScroll>
    );
  }

  const p = product.data;
  const count = variants.data?.length ?? 0;

  return (
    <ScreenScroll
      title={p.name}
      sub={variants.isPending ? undefined : `${count} variant${count === 1 ? '' : 's'}`}
      onBack={back}
      refreshing={product.isRefetching || variants.isRefetching}
      onRefresh={() => {
        void product.refetch();
        void variants.refetch();
      }}
    >
      <Card tone="ink" className="mt-5 rounded-lg p-5">
        <Text className="text-caption font-semibold uppercase tracking-[1.2px] text-white/50">Product</Text>
        <Text className="mt-1.5 text-title-1 font-bold tracking-[-0.9px] text-white">{p.name}</Text>
        {p.description !== null && <Text className="mt-1.5 text-foot text-white/60">{p.description}</Text>}
        <View className="mt-4 flex-row gap-2">
          <Badge label={p.is_active ? 'Active' : 'Inactive'} tone={p.is_active ? 'ok' : 'neutral'} onDark />
        </View>
      </Card>

      <View className="mt-8">
        <View className="mb-3 flex-row items-baseline">
          <Text variant="subtitle" accessibilityRole="header" className="flex-1">Prices</Text>
          <Text variant="meta">per variant</Text>
        </View>
        {variants.isPending ? (
          <Skeleton variant="row" className="h-[120px]" />
        ) : variants.isError ? (
          <Card tone="recessed" className="items-center gap-3 p-5">
            <Text variant="meta">{variants.error.message}</Text>
            <Button label="Retry loading prices" tone="secondary" onPress={() => void variants.refetch()} />
          </Card>
        ) : count === 0 ? (
          <Card tone="recessed" className="items-center p-6">
            <Text variant="meta">This product has no variants yet, so it has no price.</Text>
          </Card>
        ) : (
          <List>
            {(variants.data ?? []).map((v) => (
              <ListRow
                key={v.id}
                title={v.name}
                sub={v.sku}
                end={formatNaira(v.unit_price)}
                trailing={!v.is_active ? <Badge label="Inactive" tone="neutral" /> : undefined}
              />
            ))}
          </List>
        )}
      </View>

      <View className="mt-8">
        <Button label="See stock levels" tone="secondary" onPress={() => router.push('/inventory')} block />
      </View>
    </ScreenScroll>
  );
}
