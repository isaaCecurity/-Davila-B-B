import { getSupabaseClient } from '@bakeflow/auth';
import {
  useAllProductVariants,
  useCreateTicket,
  useCustomer,
  useCustomerPages,
  useProducts,
} from '@bakeflow/hooks';
import type { Customer, ProductVariant, TicketFulfilmentType } from '@bakeflow/types';
import {
  Avatar,
  Button,
  Callout,
  Chips,
  Dock,
  Icon,
  IconButton,
  List,
  ListRow,
  PressableScale,
  ScreenScroll,
  SearchBar,
  Sheet,
  Skeleton,
  Text,
} from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';

import { NoOrganizationState } from '../components/ScreenState';
import { useBranchOptions } from '../features/branch/hooks/useBranchOptions';
import { FULFILMENT_LABEL } from '../features/tickets/ticketDisplay';
import { useSessionStore } from '../stores/session';
import { toast } from '../stores/ui/toast.store';

type Step = 1 | 2 | 3;
type Buyer = { kind: 'walk-in' } | { kind: 'customer'; customer: Customer };

const STEP_ENTER = FadeIn.duration(215).reduceMotion(ReduceMotion.System);

function Stepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }): React.JSX.Element {
  return (
    <View className="flex-row items-center gap-1">
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`One fewer ${label}`}
        disabled={value === 0}
        onPress={() => onChange(Math.max(0, value - 1))}
        scaleTo={0.9}
        className={`h-9 w-9 items-center justify-center rounded-pill ${value === 0 ? 'bg-cream-deep opacity-40' : 'bg-cream-deep'}`}
      >
        <Icon name="minus" size={16} strokeWidth={2.2} />
      </PressableScale>
      <Text tabular className="min-w-[28px] text-center text-body font-bold text-cocoa" accessibilityLabel={`${value} ${label}`}>
        {value}
      </Text>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`One more ${label}`}
        onPress={() => onChange(value + 1)}
        scaleTo={0.9}
        className="h-9 w-9 items-center justify-center rounded-pill bg-ink"
      >
        <Icon name="plus" size={16} color="white" strokeWidth={2.2} />
      </PressableScale>
    </View>
  );
}

/**
 * New order — the prototype's three-step `new-ticket` flow: who, what, review.
 *
 * Creates a **draft** customer order (see `createTicket`). It then opens the order, where the
 * server-computed total appears and Submit → Confirm → Record payment follow from the dock.
 *
 * PORT-NOTE: the prototype dock keeps a running money total and its review step takes payment
 * and works out customer credit. Those are sums over prices on the device, which this app does
 * not do — the database computes the subtotal from the lines on insert, so the dock counts
 * items and the total is shown on the created order. Taking payment at creation, and the
 * one-tap counter sale that completes on the spot, are BLOCKER-030. Order notes have no column.
 */
export default function NewOrderScreen(): React.JSX.Element {
  const router = useRouter();
  const { customerId } = useLocalSearchParams<{ customerId?: string }>();
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);

  const branches = useBranchOptions();
  const [branchIndex, setBranchIndex] = useState(0);
  const branch = branches.options[branchIndex] ?? branches.options[0] ?? null;

  const preset = useCustomer(client, tenantId, customerId ?? null);
  const [picked, setPicked] = useState<Buyer | null>(null);
  const buyer: Buyer | null =
    picked ?? (preset.data != null ? { kind: 'customer', customer: preset.data } : null);

  const [step, setStep] = useState<Step>(customerId !== undefined ? 2 : 1);
  const [query, setQuery] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [fulfilment, setFulfilment] = useState<TicketFulfilmentType>('pickup');
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const customers = useCustomerPages(client, tenantId, { isWalkIn: false });
  const variants = useAllProductVariants(client, tenantId, { limit: 200 });
  const products = useProducts(client, tenantId, { limit: 200 });
  const create = useCreateTicket(client, tenantId);

  const productName = useMemo(
    () => new Map((products.data?.rows ?? []).map((p) => [p.id, p.name])),
    [products.data]
  );
  const activeVariants = useMemo(
    () =>
      (variants.data?.rows ?? [])
        .filter((v) => v.is_active)
        .sort((a, b) =>
          `${productName.get(a.product_id) ?? ''} ${a.name}`.localeCompare(`${productName.get(b.product_id) ?? ''} ${b.name}`)
        ),
    [variants.data, productName]
  );

  const chosen: ProductVariant[] = activeVariants.filter((v) => (qty[v.id] ?? 0) > 0);
  const units = chosen.reduce((n, v) => n + (qty[v.id] ?? 0), 0);
  const dirty = buyer !== null || chosen.length > 0;
  const q = query.trim().toLowerCase();

  const leave = (): void => (router.canGoBack() ? router.back() : router.replace('/orders'));

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  function submit(): void {
    if (branch === null || buyer === null || chosen.length === 0) return;
    create.mutate(
      {
        branchId: branch.branchId,
        customerId: buyer.kind === 'customer' ? buyer.customer.id : null,
        fulfilmentType: fulfilment,
        lines: chosen.map((v) => ({ productVariantId: v.id, quantity: String(qty[v.id] ?? 0) })),
      },
      {
        onSuccess: (row) => {
          toast({ tone: 'success', title: `${row.ticket.ticket_number} created`, text: 'Saved as a draft — submit it when ready.' });
          router.replace(`/order/${row.ticket.id}`);
        },
      }
    );
  }

  const canContinue = step === 1 ? buyer !== null && branch !== null : step === 2 ? chosen.length > 0 : !create.isPending;
  const buyerName = buyer === null ? '' : buyer.kind === 'walk-in' ? 'Walk-in customer' : buyer.customer.full_name;

  return (
    <View className="flex-1 bg-cream">
      <ScreenScroll
        title="New order"
        sub={buyer !== null ? `${buyerName} · step ${step} of 3` : `Step ${step} of 3`}
        onBack={step > 1 ? () => setStep((s) => (s - 1) as Step) : undefined}
        right={
          <IconButton
            icon="close"
            label="Discard order"
            onPress={() => (dirty ? setConfirmDiscard(true) : leave())}
          />
        }
      >
        <View className="flex-row gap-1.5 pb-5 pt-1" accessibilityLabel={`Step ${step} of 3`}>
          {[1, 2, 3].map((n) => (
            <View key={n} className={`h-1 flex-1 rounded-pill ${n < step ? 'bg-cocoa' : n === step ? 'bg-apricot' : 'bg-border'}`} />
          ))}
        </View>

        <Animated.View key={step} entering={STEP_ENTER}>
          {step === 1 && (
            <View className="gap-4">
              {branches.options.length > 1 && (
                <View className="gap-2">
                  <Text variant="label">Branch</Text>
                  <Chips
                    accessibilityLabel="Branch"
                    options={branches.options.map((b, i) => ({ key: String(i), label: b.label }))}
                    value={String(branchIndex)}
                    onChange={(k) => setBranchIndex(Number(k))}
                  />
                </View>
              )}
              <Text variant="subtitle" accessibilityRole="header">Who is it for?</Text>
              <List>
                <ListRow
                  leading={<View className="h-10 w-10 items-center justify-center rounded-[13px] bg-cream-deep"><Icon name="bag" size={18} /></View>}
                  title="Walk-in customer"
                  sub="No customer record"
                  trailing={buyer?.kind === 'walk-in' ? <Icon name="check" size={18} color="success" /> : undefined}
                  chevron={false}
                  onPress={() => {
                    setPicked({ kind: 'walk-in' });
                    setStep(2);
                  }}
                />
              </List>
              <SearchBar value={query} onChangeText={setQuery} placeholder="Find a customer by name" />
              {customers.isLoading ? (
                <Skeleton variant="row" />
              ) : (
                (() => {
                  const list = (customers.data?.pages.flatMap((p) => p.rows) ?? []).filter(
                    (c) => q === '' || c.full_name.toLowerCase().includes(q)
                  );
                  return list.length === 0 ? (
                    <Text variant="meta" className="px-1">
                      {q === '' ? 'No saved customers yet — use walk-in.' : 'No saved customer matches.'}
                    </Text>
                  ) : (
                    <List>
                      {list.slice(0, 30).map((c) => (
                        <ListRow
                          key={c.id}
                          leading={<Avatar name={c.full_name} />}
                          title={c.full_name}
                          sub={c.phone ?? undefined}
                          chevron={false}
                          trailing={buyer?.kind === 'customer' && buyer.customer.id === c.id ? <Icon name="check" size={18} color="success" /> : undefined}
                          onPress={() => {
                            setPicked({ kind: 'customer', customer: c });
                            setStep(2);
                          }}
                        />
                      ))}
                    </List>
                  );
                })()
              )}
            </View>
          )}

          {step === 2 && (
            <View className="gap-4">
              <Text variant="subtitle" accessibilityRole="header">What are they ordering?</Text>
              <SearchBar value={query} onChangeText={setQuery} placeholder="Search products" />
              {variants.isLoading || products.isLoading ? (
                <View className="gap-2"><Skeleton variant="row" /><Skeleton variant="row" /></View>
              ) : activeVariants.length === 0 ? (
                <Callout tone="warning" title="No products to sell" detail="Add products with prices before creating orders." />
              ) : (
                <List>
                  {activeVariants
                    .filter((v) => q === '' || `${productName.get(v.product_id) ?? ''} ${v.name}`.toLowerCase().includes(q))
                    .map((v) => {
                      const name = productName.get(v.product_id) ?? v.name;
                      return (
                        <View key={v.id} className="min-h-tap flex-row items-center gap-3 px-4 py-3">
                          <View className="min-w-0 flex-1">
                            <Text className="text-callout font-medium text-cocoa" numberOfLines={1}>{name}</Text>
                            <Text variant="caption" numberOfLines={1}>{v.name} · {formatNaira(v.unit_price)} each</Text>
                          </View>
                          <Stepper
                            value={qty[v.id] ?? 0}
                            label={`${name} ${v.name}`}
                            onChange={(n) => setQty((prev) => ({ ...prev, [v.id]: n }))}
                          />
                        </View>
                      );
                    })}
                </List>
              )}
            </View>
          )}

          {step === 3 && (
            <View className="gap-4">
              <Text variant="subtitle" accessibilityRole="header">Check the order</Text>
              <List>
                <ListRow
                  leading={<Avatar name={buyerName} />}
                  title={buyerName}
                  sub={branch?.label}
                  onPress={() => setStep(1)}
                />
              </List>
              <View className="gap-2">
                <Text variant="label">How will they get it?</Text>
                <Chips
                  accessibilityLabel="Fulfilment"
                  options={(['pickup', 'delivery'] as const).map((k) => ({ key: k, label: FULFILMENT_LABEL[k] }))}
                  value={fulfilment}
                  onChange={setFulfilment}
                />
              </View>
              <List>
                {chosen.map((v) => (
                  <ListRow
                    key={v.id}
                    leading={
                      <View className="h-[30px] min-w-[30px] items-center justify-center rounded-[10px] bg-cream-deep px-1">
                        <Text className="text-[11px] font-bold text-cocoa">{qty[v.id]}×</Text>
                      </View>
                    }
                    title={productName.get(v.product_id) ?? v.name}
                    sub={`${v.name} · ${formatNaira(v.unit_price)} each`}
                    onPress={() => setStep(2)}
                  />
                ))}
              </List>
              <Callout
                tone="info"
                title="Saved as a draft"
                detail="The total is calculated from these items as soon as the order is saved. Submit and confirm it from the order screen."
              />
              {create.isError && <Callout tone="error" title="Order not created" detail={create.error.message} />}
            </View>
          )}
        </Animated.View>
        <View className="h-28" />
      </ScreenScroll>

      <Dock>
        <View className="flex-row items-center gap-3">
        <View className="min-w-0 flex-1">
          <Text variant="caption">{step === 3 ? 'Draft order' : 'In this order'}</Text>
          <Text className="text-title-3 font-bold text-cocoa">
            {units} item{units === 1 ? '' : 's'} · {chosen.length} product{chosen.length === 1 ? '' : 's'}
          </Text>
        </View>
        <Button
          label={step === 3 ? 'Create order' : 'Continue'}
          busy={create.isPending}
          disabled={!canContinue}
          onPress={() => (step === 3 ? submit() : setStep((s) => (s + 1) as Step))}
        />
        </View>
      </Dock>

      <Sheet
        visible={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title="Discard this order?"
        foot={
          <View className="gap-2.5">
            <Button label="Discard" tone="danger" onPress={() => { setConfirmDiscard(false); leave(); }} block />
            <Button label="Keep editing" tone="secondary" onPress={() => setConfirmDiscard(false)} block />
          </View>
        }
      >
        <Text variant="meta">Nothing has been saved yet.</Text>
      </Sheet>
    </View>
  );
}
