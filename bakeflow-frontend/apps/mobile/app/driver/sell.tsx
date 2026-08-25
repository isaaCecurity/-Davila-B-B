import { getSupabaseClient, rolesFromSession } from '@bakeflow/auth';
import { BakeflowApiError, type DriverTripPaymentMethod } from '@bakeflow/api';
import {
  useCreateRoadsideTicket,
  useCurrentDriverTrip,
  useProductCategories,
  useProductVariants,
  useProducts,
  useRecordDriverTripPayment,
} from '@bakeflow/hooks';
import type { Product, ProductVariant, Uuid } from '@bakeflow/types';
import { formatNaira } from '@bakeflow/utils';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, LoadingState, NoOrganizationState } from '../../components/ScreenState';
import { useSessionStore } from '../../stores/session';

/**
 * Driver "Sell" — ADR-001 Phase 5, second slice.
 *
 * ## What this screen does, precisely
 *
 * Builds a cart from the catalog, creates a `draft` roadside ticket for it
 * (`createRoadsideTicket` — `@bakeflow/api` `mutations/sales.ts`), then records a payment
 * against it (`useRecordDriverTripPayment`, already live from the first Phase 5 slice). Two
 * real writes, both already scoped and tested; nothing here invents new backend behaviour.
 *
 * ## What it deliberately does not do
 *
 * **Never advances the ticket past `draft`.** `guard_ticket_status_transition()`'s actor
 * lists exclude `driver` at every hop — see `BLOCKERS.md` BLOCKER-021. This screen hands
 * off a `draft` ticket plus a recorded payment; the office advances it later. There is no
 * "confirm" or "complete" button here, and there should not be one until BLOCKER-021 is
 * resolved.
 *
 * **Never computes a cart total.** Money is an exact `NUMERIC(19,4)` decimal string and
 * arithmetic on it needs a decimal library that is not a dependency (`@bakeflow/types`
 * `scalars.ts`, the same constraint `product/[id].tsx` documents). Each line shows its own
 * quantity and unit price; the driver — collecting physical cash — is the one who sums
 * them, same as at any till without a calculator built in. The payment amount is typed by
 * the driver, not derived from the cart.
 *
 * ## Why customer selection is absent
 *
 * Every ticket created here is `sale_customer_type: 'ROADSIDE'`, `customer_id: null` — the
 * unblocked path `BLOCKERS.md` BLOCKER-021 names explicitly, since P9.2 (customer
 * create/select) is itself blocked on P3.7.
 */
export default function SellScreen(): React.JSX.Element {
  const client = getSupabaseClient();
  const router = useRouter();
  const session = useSessionStore((s) => s.session);
  const activeTenantId = useSessionStore((s) => s.activeTenantId);
  const userId = useSessionStore((s) => s.userId);

  const trip = useCurrentDriverTrip(client, activeTenantId, userId);

  const back = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace('/driver/home');
  };

  if (activeTenantId === null) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <NoOrganizationState onChoose={() => router.push('/select-organization')} />
      </SafeAreaView>
    );
  }
  if (!rolesFromSession(session).includes('driver')) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <EmptyState title="Not a driver" detail="This screen is for the driver role." />
      </SafeAreaView>
    );
  }

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
        <Text className="flex-1 text-xl font-bold text-neutral-900">Sell</Text>
      </View>

      {trip.isPending ? (
        <LoadingState label="Checking your trip…" />
      ) : trip.isError ? (
        <ErrorState error={trip.error} onRetry={() => void trip.refetch()} />
      ) : trip.data === null || trip.data.status !== 'in_transit' ? (
        <EmptyState
          title="No trip on the road"
          detail="You can only sell while a trip is in transit."
        />
      ) : (
        <SellFlow tenantId={activeTenantId} branchId={trip.data.branch_id} tripId={trip.data.id} />
      )}
    </SafeAreaView>
  );
}

/* -------------------------------------------------------------------------- */
/* The cart -> ticket -> payment flow, once a trip is confirmed in_transit    */
/* -------------------------------------------------------------------------- */

interface CartLine {
  variantId: Uuid;
  productName: string;
  variantName: string;
  sku: string;
  unitPrice: string;
  quantity: string;
}

function SellFlow({
  tenantId,
  branchId,
  tripId,
}: {
  tenantId: string;
  branchId: string;
  tripId: string;
}): React.JSX.Element {
  const client = getSupabaseClient();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [step, setStep] = useState<'cart' | 'payment' | 'done'>('cart');
  const [createdTicketId, setCreatedTicketId] = useState<string | null>(null);

  const createTicket = useCreateRoadsideTicket(client, tenantId);

  function addOrReplace(line: CartLine): void {
    setCart((prev) => {
      const withoutExisting = prev.filter((l) => l.variantId !== line.variantId);
      return [...withoutExisting, line];
    });
  }

  function removeLine(variantId: Uuid): void {
    setCart((prev) => prev.filter((l) => l.variantId !== variantId));
  }

  function checkout(): void {
    if (cart.length === 0) return;
    createTicket.mutate(
      {
        input: {
          branchId,
          driverTripId: tripId,
          lines: cart.map((l) => ({ productVariantId: l.variantId, quantity: l.quantity })),
        },
      },
      {
        onSuccess: (result) => {
          setCreatedTicketId(result.ticket.id);
          setCart([]);
          setStep('payment');
        },
      },
    );
  }

  if (step === 'done') {
    return (
      <View className="flex-1 items-center justify-center gap-4 p-6">
        <Text className="text-lg font-semibold text-neutral-900">Sale recorded</Text>
        <Text className="text-center text-base text-neutral-500">
          The ticket and payment are saved. The office will process it when you&apos;re back.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setCreatedTicketId(null);
            setStep('cart');
          }}
          className="rounded-lg bg-neutral-900 px-5 py-3 active:opacity-80"
        >
          <Text className="text-base font-medium text-white">Sell again</Text>
        </Pressable>
      </View>
    );
  }

  if (step === 'payment' && createdTicketId !== null) {
    return (
      <PaymentStep
        tenantId={tenantId}
        tripId={tripId}
        ticketId={createdTicketId}
        onDone={() => setStep('done')}
      />
    );
  }

  return (
    <View className="flex-1">
      {cart.length > 0 && (
        <View className="gap-2 border-b border-neutral-200 bg-neutral-50 p-4">
          <Text className="text-sm font-semibold uppercase text-neutral-500">
            Cart ({cart.length})
          </Text>
          {cart.map((line) => (
            <View
              key={line.variantId}
              className="flex-row items-center justify-between gap-3 rounded-lg bg-white p-3"
            >
              <View className="flex-1 gap-0.5">
                <Text className="text-sm font-medium text-neutral-900">
                  {line.productName} — {line.variantName}
                </Text>
                <Text className="text-xs text-neutral-500">
                  {line.quantity} × {line.unitPrice}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => removeLine(line.variantId)}
                className="rounded-lg border border-neutral-300 px-3 py-1.5 active:opacity-70"
              >
                <Text className="text-xs font-medium text-neutral-900">Remove</Text>
              </Pressable>
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            disabled={createTicket.isPending}
            onPress={checkout}
            className={`flex-row items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-3 active:opacity-70 ${
              createTicket.isPending ? 'opacity-40' : ''
            }`}
          >
            {createTicket.isPending && <ActivityIndicator size="small" color="white" />}
            <Text className="text-base font-medium text-white">Create ticket</Text>
          </Pressable>
          {createTicket.isError && (
            <View className="gap-1 rounded-lg bg-red-50 p-3">
              <Text className="text-sm text-red-900">{describeSaleError(createTicket.error)}</Text>
            </View>
          )}
        </View>
      )}

      <ProductBrowser tenantId={tenantId} cart={cart} onAdd={addOrReplace} />
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Catalog browser — products, then one product's variants                    */
/* -------------------------------------------------------------------------- */

function ProductBrowser({
  tenantId,
  cart,
  onAdd,
}: {
  tenantId: string;
  cart: readonly CartLine[];
  onAdd: (line: CartLine) => void;
}): React.JSX.Element {
  const client = getSupabaseClient();
  const products = useProducts(client, tenantId);
  const categories = useProductCategories(client, tenantId);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const categoryNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const category of categories.data ?? []) map.set(category.id, category.name);
    return map;
  }, [categories.data]);

  if (selectedProduct !== null) {
    return (
      <VariantBrowser
        tenantId={tenantId}
        product={selectedProduct}
        cart={cart}
        onAdd={onAdd}
        onBack={() => setSelectedProduct(null)}
      />
    );
  }

  if (products.isPending) return <LoadingState label="Loading catalog…" />;
  if (products.isError) {
    return <ErrorState error={products.error} onRetry={() => void products.refetch()} />;
  }
  if (products.data.rows.length === 0) {
    return <EmptyState title="No products yet" detail="Nothing in the catalog to sell." />;
  }

  return (
    <ScrollView contentContainerClassName="gap-2 p-4">
      {products.data.rows.map((product) => (
        <Pressable
          key={product.id}
          accessibilityRole="button"
          onPress={() => setSelectedProduct(product)}
          className="gap-1 rounded-xl border border-neutral-200 p-4 active:opacity-70"
        >
          <Text className="text-base font-semibold text-neutral-900">{product.name}</Text>
          {product.category_id !== null && (
            <Text className="text-sm text-neutral-500">
              {categoryNames.get(product.category_id) ?? ''}
            </Text>
          )}
        </Pressable>
      ))}
    </ScrollView>
  );
}

function VariantBrowser({
  tenantId,
  product,
  cart,
  onAdd,
  onBack,
}: {
  tenantId: string;
  product: Product;
  cart: readonly CartLine[];
  onAdd: (line: CartLine) => void;
  onBack: () => void;
}): React.JSX.Element {
  const client = getSupabaseClient();
  const variants = useProductVariants(client, tenantId, product.id);

  return (
    <ScrollView contentContainerClassName="gap-2 p-4">
      <Pressable
        accessibilityRole="button"
        onPress={onBack}
        className="mb-1 self-start rounded-lg border border-neutral-300 px-3 py-2 active:opacity-70"
      >
        <Text className="text-sm font-medium text-neutral-900">← {product.name}</Text>
      </Pressable>

      {variants.isPending ? (
        <LoadingState label="Loading variants…" />
      ) : variants.isError ? (
        <ErrorState error={variants.error} onRetry={() => void variants.refetch()} />
      ) : variants.data.length === 0 ? (
        <EmptyState title="No variants" detail="This product has no sellable variants." />
      ) : (
        variants.data.map((variant) => (
          <VariantPickerRow
            key={variant.id}
            product={product}
            variant={variant}
            inCart={cart.some((l) => l.variantId === variant.id)}
            onAdd={onAdd}
          />
        ))
      )}
    </ScrollView>
  );
}

/** Matches `MONEY_PATTERN`/`QUANTITY_PATTERN` non-negative shape — see
 *  `AdjustStockAction.tsx`'s `QUANTITY_INPUT` for the established convention. */
const QUANTITY_INPUT = /^\d{1,14}(\.\d{1,4})?$/;

function VariantPickerRow({
  product,
  variant,
  inCart,
  onAdd,
}: {
  product: Product;
  variant: ProductVariant;
  inCart: boolean;
  onAdd: (line: CartLine) => void;
}): React.JSX.Element {
  const [quantity, setQuantity] = useState('1');
  const trimmed = quantity.trim();
  const valid = QUANTITY_INPUT.test(trimmed) && trimmed !== '0';

  return (
    <View className="gap-2 rounded-xl border border-neutral-200 p-4">
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="flex-1 text-base font-semibold text-neutral-900">{variant.name}</Text>
        <Text className="text-base font-semibold text-neutral-900">
          {formatNaira(variant.unit_price)}
        </Text>
      </View>
      <Text className="text-sm text-neutral-500">{variant.sku}</Text>
      <View className="flex-row items-center gap-2">
        <TextInput
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="decimal-pad"
          className="w-24 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900"
        />
        <Pressable
          accessibilityRole="button"
          disabled={!valid}
          onPress={() =>
            onAdd({
              variantId: variant.id,
              productName: product.name,
              variantName: variant.name,
              sku: variant.sku,
              unitPrice: formatNaira(variant.unit_price),
              quantity: trimmed,
            })
          }
          className={`flex-1 items-center rounded-lg px-4 py-2.5 active:opacity-70 ${
            valid ? 'bg-neutral-900' : 'bg-neutral-200'
          }`}
        >
          <Text className={`text-sm font-medium ${valid ? 'text-white' : 'text-neutral-400'}`}>
            {inCart ? 'Update in cart' : 'Add to cart'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Payment step                                                               */
/* -------------------------------------------------------------------------- */

const AMOUNT_INPUT = /^\d{1,15}(\.\d{1,4})?$/;

const PAYMENT_METHODS: readonly { value: DriverTripPaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'pos', label: 'POS' },
  { value: 'card', label: 'Card' },
];

function PaymentStep({
  tenantId,
  tripId,
  ticketId,
  onDone,
}: {
  tenantId: string;
  tripId: string;
  ticketId: string;
  onDone: () => void;
}): React.JSX.Element {
  const client = getSupabaseClient();
  const recordPayment = useRecordDriverTripPayment(client, tenantId);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<DriverTripPaymentMethod>('cash');

  const trimmed = amount.trim();
  const validAmount = AMOUNT_INPUT.test(trimmed) && trimmed !== '0';

  function submit(): void {
    if (!validAmount) return;
    recordPayment.mutate(
      { tripId, input: { ticketId, amount: trimmed, method } },
      { onSuccess: onDone },
    );
  }

  return (
    <View className="gap-4 p-6">
      <Text className="text-lg font-semibold text-neutral-900">Record payment</Text>
      <Text className="text-sm text-neutral-500">
        Ticket created. Enter what the customer actually handed over.
      </Text>

      <View className="gap-1">
        <Text className="text-sm text-neutral-500">Amount collected</Text>
        <TextInput
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          placeholder="0.00"
          editable={!recordPayment.isPending}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base text-neutral-900"
        />
      </View>

      <View className="gap-1">
        <Text className="text-sm text-neutral-500">Method</Text>
        <View className="flex-row flex-wrap gap-2">
          {PAYMENT_METHODS.map((m) => (
            <Pressable
              key={m.value}
              accessibilityRole="button"
              accessibilityState={{ selected: method === m.value }}
              disabled={recordPayment.isPending}
              onPress={() => setMethod(m.value)}
              className={`rounded-lg px-3 py-1.5 ${
                method === m.value ? 'bg-neutral-900' : 'border border-neutral-300 bg-white'
              }`}
            >
              <Text
                className={`text-xs font-medium ${
                  method === m.value ? 'text-white' : 'text-neutral-900'
                }`}
              >
                {m.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={!validAmount || recordPayment.isPending}
        onPress={submit}
        className={`flex-row items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-3 active:opacity-70 ${
          !validAmount || recordPayment.isPending ? 'opacity-40' : ''
        }`}
      >
        {recordPayment.isPending && <ActivityIndicator size="small" color="white" />}
        <Text className="text-base font-medium text-white">Save payment</Text>
      </Pressable>

      {recordPayment.isError && (
        <View className="gap-1 rounded-lg bg-red-50 p-3">
          <Text className="text-sm text-red-900">{describeSaleError(recordPayment.error)}</Text>
        </View>
      )}
    </View>
  );
}

/** Same discipline as `driver/home.tsx`'s `describeError`: `code` is the only thing
 *  branched on, server text is never rendered. */
function describeSaleError(error: Error): string {
  const code = error instanceof BakeflowApiError ? error.code : 'unexpected_error';
  switch (code) {
    case 'invalid_transition':
      return 'That is no longer possible — your trip may have moved on. Go back and check.';
    case 'insufficient_role':
      return 'You are not able to do that.';
    case 'session_expired':
      return 'Your session has expired. Sign in again.';
    case 'network_unavailable':
      return 'No connection. This has not been saved.';
    case 'invalid_request':
      return 'Something in that request was not accepted.';
    default:
      return 'That did not work. Nothing has been changed.';
  }
}
