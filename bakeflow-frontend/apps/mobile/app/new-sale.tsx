import { BakeflowApiError, errorReason, type CounterSaleMethod, type CounterSaleResult } from '@bakeflow/api';
import { getSupabaseClient } from '@bakeflow/auth';
import {
  useAllProductVariants,
  useCashSessions,
  useCompleteCounterSale,
  useCustomerPages,
  useCustomersByPhone,
  useProductCategories,
  useProducts,
  useWarehouses,
} from '@bakeflow/hooks';
import { isNegativeDecimalString, isZeroDecimalString, type Money } from '@bakeflow/types';
import {
  Avatar,
  Button,
  Callout,
  Card,
  Chips,
  ConfirmRing,
  CountUp,
  Dock,
  Field,
  Icon,
  IconButton,
  PressableScale,
  ScreenScroll,
  SearchBar,
  Sheet,
  Skeleton,
  Text,
  type IconName,
} from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NoOrganizationState } from '../components/ScreenState';
import { useBranchOptions } from '../features/branch/hooks/useBranchOptions';
import { useWarehouseStock } from '../features/driverTrip/hooks/useWarehouseStock';
import { lineTotal, saleTotal } from '../features/sales/saleMath';
import { SaleTile } from '../features/sales/components/SaleTile';
import { useCounterSaleStore } from '../stores/ui/counterSale.store';
import { useSessionStore } from '../stores/session';
import { toast } from '../stores/ui/toast.store';

type Step = 1 | 2 | 3;

const STEP_ENTER = FadeIn.duration(215).reduceMotion(ReduceMotion.System);
const PAGE = { limit: 200 } as const;

const METHODS: readonly { key: CounterSaleMethod; label: string; icon: IconName }[] = [
  { key: 'cash', label: 'Cash', icon: 'cash' },
  { key: 'transfer', label: 'Transfer', icon: 'bank' },
  { key: 'pos', label: 'POS', icon: 'card' },
];

interface CatalogLine {
  variantId: string;
  label: string;
  category: string;
  categoryId: string | null;
  price: Money;
  unit: string;
  onHand: string | null;
}

function describe(error: Error): string {
  const code = error instanceof BakeflowApiError ? error.code : 'unexpected_error';
  const reason = errorReason(error);
  if (reason === 'no_open_till') return 'No till is open at this branch. Open a cash session, or take Transfer or POS.';
  if (code === 'insufficient_stock') return 'There is not enough stock for one of these products. Check the bag and try again.';
  if (reason === 'variant_unavailable') return 'One of these products is no longer on sale. Remove it and try again.';
  if (code === 'insufficient_role') return 'Your role cannot record counter sales at this branch.';
  if (code === 'network_unavailable') return 'No connection. The sale was not recorded — nothing was charged.';
  return 'The sale was not recorded. Nothing has been charged — try again.';
}

/**
 * New sale — the prototype's cashier `new-sale`, in its exact format and workflow (AD-024):
 *
 * 1. **Products.** Customer picker (walk-in by default, or search a saved customer), search,
 *    category chips, and the two-column sale grid — each tile adds on tap, shows "N in bag" (tap to
 *    set a quantity) and grows a −1 button. The dock carries the running **Total** and
 *    "N items · tap to review", which opens the bag.
 * 2. **Payment.** The items with line totals and the total, then Cash / Transfer / POS.
 *    **Confirm sale** records it.
 * 3. **Sale recorded.** The receipt: reference and customer, the total, each line, the payment
 *    method — then New sale, Today's sales, or Back to home.
 *
 * `complete_counter_sale()` does the whole sale in one transaction: ticket, lines priced from the
 * catalogue, completion, invoice, stock out of the branch stockroom, and the full payment. A
 * refusal (no open till for cash, oversold stock) records nothing.
 *
 * The running total and line totals are an exact preview (`features/sales/saleMath.ts`, BigInt,
 * no floats); the receipt shows the **server's** total. The basket lives in
 * `counterSale.store` so leaving the screen keeps it, like the prototype's `APP.sale`.
 *
 * PORT-NOTE: stock comes from the branch's default stockroom; a product with no stock row is shown
 * as out of stock, since the database refuses to sell what it does not hold. Card is accepted by
 * the database but not offered, matching the prototype's three methods.
 */
export default function NewSaleScreen(): React.JSX.Element {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const counts = useCounterSaleStore((s) => s.counts);
  const customer = useCounterSaleStore((s) => s.customer);
  const add = useCounterSaleStore((s) => s.add);
  const removeOne = useCounterSaleStore((s) => s.removeOne);
  const setCount = useCounterSaleStore((s) => s.setCount);
  const setCustomer = useCounterSaleStore((s) => s.setCustomer);
  const resetSale = useCounterSaleStore((s) => s.reset);

  const branches = useBranchOptions();
  const [branchIndex, setBranchIndex] = useState(0);
  const branch = branches.options[branchIndex] ?? branches.options[0] ?? null;
  const warehouses = useWarehouses(client, tenantId, branch?.branchId);
  const stockroom = (warehouses.data ?? []).find((w) => w.is_default) ?? null;
  const stock = useWarehouseStock(stockroom?.id ?? null);
  const products = useProducts(client, tenantId, PAGE);
  const variants = useAllProductVariants(client, tenantId, PAGE);
  const categories = useProductCategories(client, tenantId);
  const sessions = useCashSessions(client, tenantId, branch?.branchId);
  const sell = useCompleteCounterSale(client, tenantId);

  const [step, setStep] = useState<Step>(1);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [method, setMethod] = useState<CounterSaleMethod>('cash');
  const [sheet, setSheet] = useState<'customer' | 'cart' | 'discard' | null>(null);
  const [editing, setEditing] = useState<CatalogLine | null>(null);
  const [receipt, setReceipt] = useState<{ result: CounterSaleResult; lines: { line: CatalogLine; count: number }[]; customer: string } | null>(null);

  const catalog = useMemo<CatalogLine[]>(() => {
    const productById = new Map((products.data?.rows ?? []).map((p) => [p.id, p]));
    const categoryName = new Map((categories.data ?? []).map((c) => [c.id, c.name]));
    const onHand = new Map(stock.lines.map((l) => [l.variantId, l.quantity]));
    const perProduct = new Map<string, number>();
    for (const v of variants.data?.rows ?? []) perProduct.set(v.product_id, (perProduct.get(v.product_id) ?? 0) + 1);
    return (variants.data?.rows ?? [])
      .filter((v) => v.is_active && productById.get(v.product_id)?.is_active !== false)
      .map((v) => {
        const product = productById.get(v.product_id);
        const name = product?.name ?? v.name;
        return {
          variantId: v.id,
          label: (perProduct.get(v.product_id) ?? 1) > 1 ? `${name} (${v.name})` : name,
          category: product?.category_id != null ? (categoryName.get(product.category_id) ?? 'Other') : 'Other',
          categoryId: product?.category_id ?? null,
          price: v.unit_price,
          unit: v.name,
          onHand: onHand.get(v.id) ?? null,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [products.data, variants.data, categories.data, stock.lines]);

  const inBag = catalog.filter((c) => (counts[c.variantId] ?? 0) > 0);
  const units = inBag.reduce((n, c) => n + (counts[c.variantId] ?? 0), 0);
  const total = saleTotal(inBag.map((c) => ({ unitPrice: c.price, count: counts[c.variantId] ?? 0 })));
  const q = query.trim().toLowerCase();
  const visible = catalog.filter(
    (c) => (category === 'all' || c.categoryId === category) && (q === '' || c.label.toLowerCase().includes(q))
  );
  const openTill = (sessions.data ?? []).find((s) => s.status === 'open') ?? null;
  const cashBlocked = method === 'cash' && !sessions.isLoading && openTill === null;
  const loadingCatalog = products.isLoading || variants.isLoading || warehouses.isLoading || stock.isLoading;

  const isOut = (c: CatalogLine): boolean =>
    c.onHand === null || isZeroDecimalString(c.onHand) || isNegativeDecimalString(c.onHand);

  const leave = (): void => (router.canGoBack() ? router.back() : router.replace('/'));

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  function confirmSale(): void {
    if (branch === null || inBag.length === 0) return;
    const lines = inBag.map((c) => ({ line: c, count: counts[c.variantId] ?? 0 }));
    const customerName = customer?.name ?? 'Walk-in customer';
    sell.mutate(
      {
        branchId: branch.branchId,
        customerId: customer?.id ?? null,
        paymentMethod: method,
        lines: lines.map((l) => ({ productVariantId: l.line.variantId, quantity: String(l.count) })),
      },
      {
        onSuccess: (result) => {
          setReceipt({ result, lines, customer: customerName });
          resetSale();
          setStep(3);
          toast({ tone: 'success', title: 'Sale recorded', text: `${result.ticketNumber} · ${formatNaira(result.totalAmount)}` });
        },
      }
    );
  }

  // ── Step 3 — Sale recorded ─────────────────────────────────────────────────
  if (step === 3 && receipt !== null) {
    return (
      <View className="flex-1 bg-cream px-gutter" style={{ paddingTop: insets.top + 72, paddingBottom: Math.max(insets.bottom, 24) }}>
        <View className="items-center">
          <ConfirmRing />
          <Text variant="title" className="mt-4 text-center">Sale recorded</Text>
          <Text variant="meta" className="mt-1.5 text-center">{receipt.result.ticketNumber} · {receipt.customer}</Text>
          <CountUp
            to={Number(receipt.result.totalAmount)}
            text={formatNaira(receipt.result.totalAmount)}
            className="mt-4 text-display font-bold tracking-[-1.2px] text-cocoa"
          />
        </View>
        <Card className="mt-5 px-4 py-2">
          {receipt.lines.map(({ line, count }) => (
            <View key={line.variantId} className="flex-row items-center py-2">
              <Text className="flex-1 text-foot text-warm-gray" numberOfLines={1}>{count} × {line.label}</Text>
              <Text tabular className="text-foot font-semibold text-cocoa">{formatNaira(lineTotal(line.price, count))}</Text>
            </View>
          ))}
          <View className="my-1 h-px bg-border" />
          <View className="flex-row items-center py-2">
            <Text className="flex-1 text-foot text-warm-gray">Payment method</Text>
            <Text className="text-foot font-semibold text-cocoa">{METHODS.find((m) => m.key === receipt.result.paymentMethod)?.label}</Text>
          </View>
          <View className="flex-row items-center border-t border-border py-3">
            <Text className="flex-1 text-callout font-semibold text-cocoa">Total</Text>
            <Text tabular className="text-callout font-bold text-cocoa">{formatNaira(receipt.result.totalAmount)}</Text>
          </View>
        </Card>
        <View className="flex-1" />
        <View className="gap-2.5">
          <Button
            label="New sale"
            onPress={() => {
              setReceipt(null);
              setMethod('cash');
              setQuery('');
              setCategory('all');
              sell.reset();
              setStep(1);
            }}
            block
          />
          <Button label="Today's sales" tone="secondary" onPress={() => router.replace('/my-sales')} block />
          <Button label="Back to home" tone="secondary" onPress={() => router.replace('/')} block />
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-cream">
      <ScreenScroll
        title="New sale"
        sub={branch?.label}
        onBack={step === 2 ? () => setStep(1) : undefined}
        right={<IconButton icon="close" label="Discard sale" onPress={() => (inBag.length === 0 ? leave() : setSheet('discard'))} />}
      >
        <View className="flex-row gap-1.5 pb-4 pt-1" accessibilityLabel={`Step ${step} of 3`}>
          {[1, 2, 3].map((n) => (
            <View key={n} className={`h-[3px] flex-1 rounded-[2px] ${n <= step ? 'bg-apricot' : 'bg-border'}`} />
          ))}
        </View>

        <Animated.View key={step} entering={STEP_ENTER}>
          {step === 1 && (
            <View>
              {branches.options.length > 1 && (
                <Chips
                  className="mb-3"
                  accessibilityLabel="Branch"
                  options={branches.options.map((b, i) => ({ key: String(i), label: b.label }))}
                  value={String(branchIndex)}
                  onChange={(k) => setBranchIndex(Number(k))}
                />
              )}

              {/* The prototype's `.picker.-filled`. */}
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={`Customer: ${customer?.name ?? 'Walk-in customer'}. Tap to change`}
                onPress={() => setSheet('customer')}
                scaleTo={0.99}
                className="mb-3 min-h-[54px] flex-row items-center gap-3 rounded-sm border-[1.5px] border-cocoa/10 bg-white px-3.5 py-2.5"
              >
                <Icon name="user" size={18} color="textMuted" />
                <View className="min-w-0 flex-1">
                  <Text className="text-callout font-medium text-cocoa" numberOfLines={1}>{customer?.name ?? 'Walk-in customer'}</Text>
                  <Text variant="caption">Tap to change</Text>
                </View>
                <Icon name="chevRight" size={15} color="textMuted" />
              </PressableScale>

              <SearchBar value={query} onChangeText={setQuery} placeholder="Search products" />
              <Chips
                className="my-3"
                accessibilityLabel="Category"
                options={[
                  { key: 'all', label: 'All' },
                  ...[...(categories.data ?? [])].sort((a, b) => a.sort_order - b.sort_order).map((c) => ({ key: c.id, label: c.name })),
                ]}
                value={category}
                onChange={setCategory}
              />

              {loadingCatalog ? (
                <View className="flex-row flex-wrap justify-between gap-y-3">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} variant="row" className="h-[150px] w-[48.4%]" />
                  ))}
                </View>
              ) : stockroom === null ? (
                <Callout tone="warning" title="No stockroom at this branch" detail="A branch needs a default stockroom before it can sell from the counter." />
              ) : visible.length === 0 ? (
                <View className="items-center gap-2 py-10">
                  <Icon name="box" size={30} color="textMuted" />
                  <Text variant="subtitle">No product matches</Text>
                </View>
              ) : (
                <View className="flex-row flex-wrap justify-between gap-y-3">
                  {visible.map((c) => (
                    <SaleTile
                      key={c.variantId}
                      label={c.label}
                      category={c.category}
                      price={c.price}
                      count={counts[c.variantId] ?? 0}
                      outOfStock={isOut(c)}
                      onAdd={() => add(c.variantId)}
                      onRemove={() => removeOne(c.variantId)}
                      onEditCount={() => setEditing(c)}
                    />
                  ))}
                </View>
              )}
            </View>
          )}

          {step === 2 && (
            <View>
              <View className="mb-3 mt-2 flex-row items-center">
                <Text variant="subtitle" accessibilityRole="header" className="flex-1">Items</Text>
                <PressableScale accessibilityRole="link" onPress={() => setStep(1)} className="min-h-tap justify-center px-1">
                  <Text className="text-foot font-semibold text-apricot-deep">Edit</Text>
                </PressableScale>
              </View>
              <Card className="px-4 py-1.5">
                {inBag.map((c, i) => {
                  const n = counts[c.variantId] ?? 0;
                  return (
                    <View key={c.variantId} className={`flex-row items-center gap-3 py-2.5 ${i > 0 ? 'border-t border-border' : ''}`}>
                      <View className="h-[30px] min-w-[30px] items-center justify-center rounded-[10px] bg-cream-deep px-1">
                        <Text className="text-[11px] font-bold text-cocoa">{n}×</Text>
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="text-callout font-medium text-cocoa" numberOfLines={1}>{c.label}</Text>
                        <Text variant="caption">{formatNaira(c.price)} per {c.unit.toLowerCase()}</Text>
                      </View>
                      <Text tabular className="text-callout font-semibold text-cocoa">{formatNaira(lineTotal(c.price, n))}</Text>
                    </View>
                  );
                })}
                <View className="mt-1 flex-row items-center border-t border-border py-3">
                  <Text className="flex-1 text-callout font-semibold text-cocoa">Total</Text>
                  <Text tabular className="text-callout font-bold text-cocoa">{formatNaira(total)}</Text>
                </View>
              </Card>

              <Text variant="subtitle" accessibilityRole="header" className="mb-3 mt-8">Payment method</Text>
              <View accessibilityRole="radiogroup" className="flex-row gap-2">
                {METHODS.map((m) => {
                  const on = method === m.key;
                  return (
                    <PressableScale
                      key={m.key}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      aria-selected={on}
                      accessibilityLabel={m.label}
                      onPress={() => setMethod(m.key)}
                      scaleTo={0.96}
                      className={`flex-1 items-center gap-2.5 rounded-[15px] bg-white p-[13px] shadow-e2 ${on ? 'border-[1.5px] border-ink' : ''}`}
                    >
                      <View className={`h-8 w-8 items-center justify-center rounded-[10px] ${on ? 'bg-ink' : 'bg-cream-deep'}`}>
                        <Icon name={m.icon} size={17} color={on ? 'white' : 'cocoa'} />
                      </View>
                      <Text className="text-foot font-semibold text-cocoa">{m.label}</Text>
                    </PressableScale>
                  );
                })}
              </View>
              {cashBlocked && (
                <Callout
                  className="mt-4"
                  tone="warning"
                  title="No till is open"
                  detail="Cash goes into the till, and none is open at this branch. Open a cash session, or take Transfer or POS."
                />
              )}
              {sell.isError && <Callout className="mt-4" tone="error" title="Sale not recorded" detail={describe(sell.error)} />}
            </View>
          )}
        </Animated.View>
        <View className="h-32" />
      </ScreenScroll>

      <Dock key={step}>
        <View className="flex-row items-center gap-4">
          <View className="min-w-0 flex-1">
            <Text className="text-caption font-semibold uppercase tracking-[1px] text-warm-gray-soft">Total</Text>
            <Text tabular className="mt-px text-title-2 font-bold tracking-[-0.5px] text-cocoa">{formatNaira(total)}</Text>
          </View>
          <Button
            label={step === 2 ? 'Confirm sale' : 'Continue'}
            busy={sell.isPending}
            disabled={inBag.length === 0 || (step === 2 && (cashBlocked || branch === null))}
            onPress={() => (step === 1 ? setStep(2) : confirmSale())}
          />
        </View>
        {inBag.length > 0 && (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`${units} items. Tap to review`}
            onPress={() => setSheet('cart')}
            className="mt-2 min-h-[28px] flex-row items-center gap-[7px]"
          >
            <Icon name="bag" size={13} color="textMuted" />
            <Text variant="caption">{units} item{units === 1 ? '' : 's'} · tap to review</Text>
          </PressableScale>
        )}
      </Dock>

      <CustomerSheet
        visible={sheet === 'customer'}
        onClose={() => setSheet(null)}
        onPick={(c) => {
          setCustomer(c);
          setSheet(null);
        }}
      />

      <Sheet
        visible={sheet === 'cart'}
        onClose={() => setSheet(null)}
        title="This sale"
        foot={
          <View className="flex-row items-center gap-4">
            <View className="min-w-0 flex-1">
              <Text className="text-caption font-semibold uppercase tracking-[1px] text-warm-gray-soft">Total</Text>
              <Text tabular className="text-title-2 font-bold text-cocoa">{formatNaira(total)}</Text>
            </View>
            <Button label="Done" onPress={() => setSheet(null)} />
          </View>
        }
      >
        <Card className="px-4 py-1">
          {inBag.length === 0 ? (
            <Text variant="meta" className="py-3">The bag is empty.</Text>
          ) : (
            inBag.map((c, i) => {
              const n = counts[c.variantId] ?? 0;
              return (
                <View key={c.variantId} className={`flex-row items-center gap-3 py-2.5 ${i > 0 ? 'border-t border-border' : ''}`}>
                  <View className="min-w-0 flex-1">
                    <Text className="text-callout font-medium text-cocoa" numberOfLines={1}>{c.label}</Text>
                    <Text variant="caption">
                      {formatNaira(c.price)} per {c.unit.toLowerCase()} · {formatNaira(lineTotal(c.price, n))}
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-1">
                    <PressableScale
                      accessibilityRole="button"
                      accessibilityLabel={n === 1 ? `Remove ${c.label}` : `One fewer ${c.label}`}
                      onPress={() => {
                        removeOne(c.variantId);
                        if (inBag.length === 1 && n === 1) setSheet(null);
                      }}
                      scaleTo={0.9}
                      className="h-9 w-9 items-center justify-center rounded-[11px] bg-cream-deep"
                    >
                      <Icon name={n === 1 ? 'trash' : 'minus'} size={14} color="cocoa" />
                    </PressableScale>
                    <Text tabular className="min-w-[32px] text-center text-callout font-semibold text-cocoa">{n}</Text>
                    <PressableScale
                      accessibilityRole="button"
                      accessibilityLabel={`One more ${c.label}`}
                      onPress={() => add(c.variantId)}
                      scaleTo={0.9}
                      className="h-9 w-9 items-center justify-center rounded-[11px] bg-ink"
                    >
                      <Icon name="plus" size={14} color="white" />
                    </PressableScale>
                  </View>
                </View>
              );
            })
          )}
        </Card>
      </Sheet>

      <QuantitySheet
        line={editing}
        current={editing === null ? 0 : (counts[editing.variantId] ?? 0)}
        onClose={() => setEditing(null)}
        onSave={(n) => {
          if (editing !== null) setCount(editing.variantId, n);
          setEditing(null);
        }}
      />

      <Sheet
        visible={sheet === 'discard'}
        onClose={() => setSheet(null)}
        title="Discard this sale?"
        foot={
          <View className="gap-2.5">
            <Button
              label="Discard"
              tone="danger"
              onPress={() => {
                resetSale();
                setSheet(null);
                leave();
              }}
              block
            />
            <Button label="Keep editing" tone="secondary" onPress={() => setSheet(null)} block />
          </View>
        }
      >
        <Text variant="meta">Nothing has been recorded yet.</Text>
      </Sheet>
    </View>
  );
}

/** The prototype's `saleCustomerSheet` + `customerSheet`: walk-in, or search a saved customer. */
function CustomerSheet({
  visible,
  onClose,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (customer: { id: string; name: string; phone: string | null } | null) => void;
}): React.JSX.Element {
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const [query, setQuery] = useState('');
  const q = query.trim();
  const phone = /^[+\d][\d\s-]{5,}$/.test(q);
  const pages = useCustomerPages(client, visible ? tenantId : null, { isWalkIn: false });
  const byPhone = useCustomersByPhone(client, tenantId, phone ? q : '');
  const loaded = pages.data?.pages.flatMap((p) => p.rows) ?? [];
  const rows = phone ? (byPhone.data ?? []) : loaded.filter((c) => q === '' || c.full_name.toLowerCase().includes(q.toLowerCase()));

  return (
    <Sheet visible={visible} onClose={onClose} title="Customer">
      <View className="gap-3">
        <PressableScale
          accessibilityRole="button"
          onPress={() => onPick(null)}
          scaleTo={0.98}
          className="min-h-tap flex-row items-center gap-3 rounded-md bg-white px-4 py-3 shadow-e1"
        >
          <View className="h-8 w-8 items-center justify-center rounded-[10px] bg-cream-deep">
            <Icon name="user" size={16} color="cocoa" />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-callout font-semibold text-cocoa">Walk-in customer</Text>
            <Text variant="caption">No record needed</Text>
          </View>
        </PressableScale>
        <SearchBar value={query} onChangeText={setQuery} placeholder="Search customer by name or phone" />
        {pages.isLoading ? (
          <Skeleton variant="row" />
        ) : rows.length === 0 ? (
          <Text variant="meta" className="px-1">{q === '' ? 'No saved customers yet.' : 'No customer matches.'}</Text>
        ) : (
          <View className="gap-1.5">
            {rows.slice(0, 20).map((c) => (
              <PressableScale
                key={c.id}
                accessibilityRole="button"
                onPress={() => onPick({ id: c.id, name: c.full_name, phone: c.phone })}
                scaleTo={0.98}
                className="min-h-tap flex-row items-center gap-3 rounded-md bg-white px-4 py-2.5"
              >
                <Avatar name={c.full_name} size="sm" />
                <View className="min-w-0 flex-1">
                  <Text className="text-callout font-medium text-cocoa" numberOfLines={1}>{c.full_name}</Text>
                  {c.phone !== null && <Text variant="caption">{c.phone}</Text>}
                </View>
              </PressableScale>
            ))}
          </View>
        )}
      </View>
    </Sheet>
  );
}

/** The prototype's "N in bag" quantity sheet. */
function QuantitySheet({
  line,
  current,
  onClose,
  onSave,
}: {
  line: CatalogLine | null;
  current: number;
  onClose: () => void;
  onSave: (count: number) => void;
}): React.JSX.Element {
  const [value, setValue] = useState('');
  const [shown, setShown] = useState<CatalogLine | null>(null);
  if (line !== null && line !== shown) {
    setShown(line);
    setValue(String(current));
  }
  const n = /^\d{1,4}$/.test(value.trim()) ? Number(value.trim()) : NaN;
  return (
    <Sheet
      visible={line !== null}
      onClose={onClose}
      title={shown?.label ?? ''}
      foot={<Button label="Save" disabled={!Number.isFinite(n) || n < 1} onPress={() => onSave(n)} block />}
    >
      <Field
        label="Quantity"
        value={value}
        onChangeText={setValue}
        keyboardType="number-pad"
        inputMode="numeric"
        autoFocus
        error={value.trim() === '' || (Number.isFinite(n) && n >= 1) ? null : 'Enter a whole number, 1 or more'}
      />
    </Sheet>
  );
}
