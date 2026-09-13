import { getSupabaseClient } from '@bakeflow/auth';
import { useProductStockLevels, useStockMovementPages, useWarehouses } from '@bakeflow/hooks';
import type { ProductStockLevel } from '@bakeflow/types';
import {
  Badge,
  Button,
  Callout,
  Chips,
  EmptyState,
  GroupLabel,
  Icon,
  IconTile,
  List,
  ListRow,
  ScreenScroll,
  SearchBar,
  Skeleton,
  Text,
} from '@bakeflow/ui';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { ErrorState, NoOrganizationState } from '../../../components/ScreenState';
import { useSessionStore } from '../../../stores/session';
import { useVariantLabels } from '../../catalog/hooks/useVariantLabels';
import { ticketTime, trimQuantity } from '../../tickets/ticketDisplay';
import { levelView, REASON_LABEL, signedDelta } from '../stockDisplay';
import { AdjustStockSheet, type AdjustTarget } from './AdjustStockSheet';

/** Stock levels are read in one page at the API's ceiling; see the PORT-NOTE below. */
const LEVEL_PAGE = { limit: 200 } as const;
const MOVEMENTS_SHOWN = 8;

interface LevelRow {
  level: ProductStockLevel;
  label: string;
  sku: string | null;
}

/**
 * Stock — the prototype's `inventory-monitor`, with the product screen's "Adjust" folded in:
 * what is out, what is on the shelf, and what just moved.
 *
 * Quantities are per stockroom, so one is always chosen (the branch default first). Levels are
 * trigger-maintained from the `stock_movements` ledger and never edited directly (CLAUDE.md
 * rule 7): tapping a row opens `AdjustStockSheet`, which calls `adjust_stock()` and lets the
 * ledger recompute the level. Both the level list and the movement feed refresh afterwards.
 *
 * PORT-NOTE: "Running low" needs a reorder level, which product variants do not have (AD-022),
 * so only out-of-stock and below-zero are flagged. Levels load in one page of 200 per stockroom;
 * a stockroom with more shows a notice rather than silently truncating. Items that have never
 * had a movement have no level row and are not listed. Ingredient stock is deactivated for MVP.
 */
export function StockScreen({ warehouseId }: { warehouseId?: string }): React.JSX.Element {
  const router = useRouter();
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const warehouses = useWarehouses(client, tenantId);
  const { labels } = useVariantLabels();

  const ordered = useMemo(
    // Default stockrooms first, then as the API orders them (branch, name).
    () => [...(warehouses.data ?? [])].sort((a, b) => Number(b.is_default) - Number(a.is_default)),
    [warehouses.data]
  );
  const [chosenId, setChosenId] = useState<string | null>(warehouseId ?? null);
  const warehouse = ordered.find((w) => w.id === chosenId) ?? ordered[0] ?? null;

  const levels = useProductStockLevels(client, tenantId, warehouse?.id ?? null, LEVEL_PAGE);
  const movements = useStockMovementPages(
    client,
    tenantId,
    { warehouseId: warehouse?.id, itemType: 'product' },
    { enabled: warehouse !== null, limit: 20 }
  );

  const [query, setQuery] = useState('');
  const [adjusting, setAdjusting] = useState<AdjustTarget | null>(null);
  const [showAll, setShowAll] = useState(false);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows: LevelRow[] = (levels.data?.rows ?? [])
      .map((level) => {
        const name = labels.get(level.product_variant_id);
        return { level, label: name?.label ?? 'Unnamed product', sku: name?.sku ?? null };
      })
      .filter((r) => q === '' || r.label.toLowerCase().includes(q) || (r.sku ?? '').toLowerCase().includes(q))
      .sort((a, b) => a.label.localeCompare(b.label));
    return {
      total: levels.data?.rows.length ?? 0,
      negative: rows.filter((r) => levelView(r.level.quantity_on_hand).state === 'negative'),
      out: rows.filter((r) => levelView(r.level.quantity_on_hand).state === 'out'),
      inStock: rows.filter((r) => levelView(r.level.quantity_on_hand).state === 'in'),
      outCount: (levels.data?.rows ?? []).filter((l) => levelView(l.quantity_on_hand).state !== 'in').length,
    };
  }, [levels.data, labels, query]);

  const moves = useMemo(() => movements.data?.pages.flatMap((p) => p.rows) ?? [], [movements.data]);

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const open = (r: LevelRow): void => {
    if (warehouse === null) return;
    setAdjusting({
      warehouseId: warehouse.id,
      variantId: r.level.product_variant_id,
      label: r.label,
      quantity: r.level.quantity_on_hand,
    });
  };

  const renderRows = (rows: LevelRow[]): React.JSX.Element => (
    <List>
      {rows.map((r) => {
        const v = levelView(r.level.quantity_on_hand);
        return (
          <ListRow
            key={r.level.id}
            leading={<IconTile icon={v.icon} tone={v.tile} size="sm" />}
            title={r.label}
            sub={v.state === 'negative' ? `${r.sku ?? ''} · ${trimQuantity(r.level.quantity_on_hand)} on hand` : (r.sku ?? undefined)}
            end={v.label === null ? trimQuantity(r.level.quantity_on_hand) : undefined}
            endSub={v.label === null ? 'on hand' : undefined}
            trailing={v.label !== null ? <Badge label={v.label} tone={v.tone} icon="alert" /> : undefined}
            onPress={() => open(r)}
          />
        );
      })}
    </List>
  );

  const loading = warehouses.isLoading || (warehouse !== null && levels.isLoading);

  return (
    <ScreenScroll
      title="Stock"
      sub={
        warehouse === null
          ? undefined
          : levels.isLoading
            ? warehouse.name
            : `${warehouse.name} · ${groups.total} product${groups.total === 1 ? '' : 's'}${groups.outCount > 0 ? ` · ${groups.outCount} out` : ''}`
      }
      onBack={router.canGoBack() ? () => router.back() : undefined}
      refreshing={levels.isRefetching || movements.isRefetching}
      onRefresh={() => {
        void levels.refetch();
        void movements.refetch();
      }}
    >
      {ordered.length > 1 && (
        <Chips
          className="mt-2"
          accessibilityLabel="Stockroom"
          options={ordered.map((w) => ({ key: w.id, label: w.name }))}
          value={warehouse?.id ?? ''}
          onChange={(id) => {
            setChosenId(id);
            setShowAll(false);
          }}
        />
      )}

      {loading ? (
        <View className="mt-5 gap-2">
          <Skeleton variant="row" />
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </View>
      ) : warehouses.isError ? (
        <View className="mt-5">
          <ErrorState error={warehouses.error} onRetry={() => void warehouses.refetch()} />
        </View>
      ) : warehouse === null ? (
        <EmptyState
          icon="layers"
          title="No stockrooms you can see"
          text="Stockrooms belong to a branch. You will see the ones for branches you have access to."
        />
      ) : levels.isError ? (
        <View className="mt-5">
          <ErrorState error={levels.error} onRetry={() => void levels.refetch()} />
        </View>
      ) : groups.total === 0 ? (
        <EmptyState
          icon="box"
          title="Nothing counted here yet"
          text="Quantities appear once stock has been baked, sold or counted in this stockroom."
        />
      ) : (
        <>
          <View className="mt-3">
            <SearchBar value={query} onChangeText={setQuery} placeholder="Product or SKU" />
          </View>

          {levels.data?.nextCursor != null && (
            <Callout
              className="mt-3"
              tone="warning"
              title="Showing the first 200 products"
              detail="This stockroom holds more. Search narrows what is shown here."
            />
          )}

          {groups.negative.length > 0 && (
            <>
              <GroupLabel>Below zero</GroupLabel>
              {renderRows(groups.negative)}
            </>
          )}
          {groups.out.length > 0 && (
            <>
              <GroupLabel>Out of stock</GroupLabel>
              {renderRows(groups.out)}
            </>
          )}
          {groups.inStock.length > 0 && (
            <>
              <GroupLabel>On the shelf</GroupLabel>
              {renderRows(groups.inStock)}
            </>
          )}
          {groups.negative.length + groups.out.length + groups.inStock.length === 0 && (
            <Text variant="meta" className="mt-6 text-center">No product matches “{query.trim()}”.</Text>
          )}
        </>
      )}

      {warehouse !== null && !loading && (
        <View className="mt-8">
          <Text variant="subtitle" accessibilityRole="header" className="mb-3">Recent stock movements</Text>
          {movements.isLoading ? (
            <Skeleton variant="row" />
          ) : movements.isError ? (
            <ErrorState error={movements.error} onRetry={() => void movements.refetch()} />
          ) : moves.length === 0 ? (
            <Text variant="meta">No movements recorded in this stockroom yet.</Text>
          ) : (
            <>
              <List>
                {(showAll ? moves : moves.slice(0, MOVEMENTS_SHOWN)).map((m) => {
                  const delta = signedDelta(m.quantity_delta);
                  const up = delta.startsWith('+');
                  return (
                    <ListRow
                      key={m.id}
                      leading={<IconTile icon={up ? 'arrowDown' : 'arrowUp'} tone={up ? 'ok' : 'neutral'} size="sm" />}
                      title={m.product_variant_id === null ? 'Item' : (labels.get(m.product_variant_id)?.label ?? 'Unnamed product')}
                      sub={[REASON_LABEL[m.reason], m.note, ticketTime(m.created_at)].filter(Boolean).join(' · ')}
                      trailing={
                        <Text tabular className={`text-callout font-semibold ${up ? 'text-success-ink' : 'text-cocoa'}`}>
                          {delta}
                        </Text>
                      }
                      chevron={false}
                    />
                  );
                })}
              </List>
              {(moves.length > MOVEMENTS_SHOWN || movements.hasNextPage) && (
                <Button
                  className="mt-3"
                  label={showAll && movements.hasNextPage ? 'Load older movements' : showAll ? 'Show fewer' : 'Show all recent'}
                  tone="secondary"
                  busy={movements.isFetchingNextPage}
                  onPress={() => {
                    if (!showAll) setShowAll(true);
                    else if (movements.hasNextPage) void movements.fetchNextPage();
                    else setShowAll(false);
                  }}
                  block
                />
              )}
            </>
          )}
          <View className="mt-4 flex-row items-start gap-2 px-0.5">
            <Icon name="shield" size={14} color="textMuted" />
            <Text variant="caption" className="flex-1">
              Stock changes only through sales, production or a recorded adjustment — never edited directly.
            </Text>
          </View>
        </View>
      )}

      <AdjustStockSheet target={adjusting} onClose={() => setAdjusting(null)} />
    </ScreenScroll>
  );
}
