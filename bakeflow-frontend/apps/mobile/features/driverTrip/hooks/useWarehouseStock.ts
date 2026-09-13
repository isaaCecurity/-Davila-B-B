import { getSupabaseClient } from '@bakeflow/auth';
import { useProductStockLevels } from '@bakeflow/hooks';
import { isNegativeDecimalString, isZeroDecimalString } from '@bakeflow/types';
import { useMemo } from 'react';

import { useSessionStore } from '../../../stores/session';
import { useVariantLabels } from '../../catalog/hooks/useVariantLabels';

export interface StockLine {
  variantId: string;
  label: string;
  sku: string | null;
  /** Exact decimal string from `product_stock_levels`. */
  quantity: string;
}

const PAGE = { limit: 200 } as const;

/**
 * Named product levels in one warehouse, ordered by name, with zero and negative rows dropped when
 * `inStockOnly` is set.
 *
 * A driver's vehicle is an ordinary warehouse (`STATE-MACHINES.md` §6), so this is both "what
 * is on the truck" and "what the bakery can load from".
 */
export function useWarehouseStock(warehouseId: string | null, { inStockOnly = false } = {}) {
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const levels = useProductStockLevels(getSupabaseClient(), tenantId, warehouseId, PAGE);
  const { labels } = useVariantLabels();

  const lines = useMemo<StockLine[]>(
    () =>
      (levels.data?.rows ?? [])
        .filter((l) => !inStockOnly || (!isZeroDecimalString(l.quantity_on_hand) && !isNegativeDecimalString(l.quantity_on_hand)))
        .map((l) => {
          const name = labels.get(l.product_variant_id);
          return { variantId: l.product_variant_id, label: name?.label ?? 'Unnamed product', sku: name?.sku ?? null, quantity: l.quantity_on_hand };
        })
        .sort((a, b) => a.label.localeCompare(b.label)),
    [levels.data, labels, inStockOnly]
  );

  return {
    lines,
    truncated: levels.data?.nextCursor != null,
    isLoading: levels.isLoading,
    isError: levels.isError,
    error: levels.error,
    isRefetching: levels.isRefetching,
    refetch: levels.refetch,
  };
}
