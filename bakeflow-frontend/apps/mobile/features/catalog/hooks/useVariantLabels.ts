import { getSupabaseClient } from '@bakeflow/auth';
import { useAllProductVariants, useProducts } from '@bakeflow/hooks';
import { useMemo } from 'react';

import { useSessionStore } from '../../../stores/session';

export interface VariantLabel {
  /** "Agege Bread", or "Celebration Cake (Large)" when the product has several variants. */
  label: string;
  sku: string;
  productId: string;
}

/*
 * PORT-NOTE: names come from the first 200 products and variants (the API's page ceiling). A
 * bakery catalogue is far smaller; beyond that a row falls back to a generic label rather than
 * a wrong name. A by-id variant lookup would lift the limit.
 */
const NAME_PAGE = { limit: 200 } as const;

/** Variant id → the name people use for it, joined from products and variants. */
export function useVariantLabels() {
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const variants = useAllProductVariants(client, tenantId, NAME_PAGE);
  const products = useProducts(client, tenantId, NAME_PAGE);

  const labels = useMemo(() => {
    const productName = new Map((products.data?.rows ?? []).map((p) => [p.id, p.name]));
    const perProduct = new Map<string, number>();
    for (const v of variants.data?.rows ?? []) {
      perProduct.set(v.product_id, (perProduct.get(v.product_id) ?? 0) + 1);
    }
    return new Map<string, VariantLabel>(
      (variants.data?.rows ?? []).map((v) => {
        const product = productName.get(v.product_id) ?? v.name;
        const many = (perProduct.get(v.product_id) ?? 1) > 1;
        return [v.id, { label: many ? `${product} (${v.name})` : product, sku: v.sku, productId: v.product_id }];
      })
    );
  }, [variants.data, products.data]);

  return { labels, isLoading: variants.isLoading || products.isLoading };
}
