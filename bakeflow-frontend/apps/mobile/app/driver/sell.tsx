import { getSupabaseClient } from '@bakeflow/auth';
import type { DriverTripPaymentMethod } from '@bakeflow/api';
import {
  useAllProductVariants,
  useCompleteDriverFieldSale,
  useCreateRoadsideTicket,
  useCurrentDriverTrip,
  useRecordDriverTripPayment,
} from '@bakeflow/hooks';
import type { DriverTrip, Money, Ticket } from '@bakeflow/types';
import {
  Button,
  Callout,
  Card,
  Chips,
  ConfirmRing,
  CountUp,
  Dock,
  EmptyState,
  IconButton,
  List,
  ListRow,
  ScreenScroll,
  SearchBar,
  Sheet,
  Skeleton,
  Text,
} from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import { positiveMoneySchema } from '@bakeflow/validation';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, NoOrganizationState } from '../../components/ScreenState';
import { CountStepper } from '../../features/driverTrip/components/CountStepper';
import { useWarehouseStock } from '../../features/driverTrip/hooks/useWarehouseStock';
import { isPositiveQuantity, sumQuantities } from '../../features/driverTrip/quantity';
import { describeTripError } from '../../features/driverTrip/tripDisplay';
import { trimQuantity } from '../../features/tickets/ticketDisplay';
import { useSessionStore } from '../../stores/session';
import { toast } from '../../stores/ui/toast.store';

type Step = 1 | 2 | 3 | 4;

const STEP_ENTER = FadeIn.duration(215).reduceMotion(ReduceMotion.System);

const METHODS: readonly { key: DriverTripPaymentMethod; label: string }[] = [
  { key: 'cash', label: 'Cash' },
  { key: 'transfer', label: 'Transfer' },
  { key: 'pos', label: 'POS' },
  { key: 'card', label: 'Card' },
];

/**
 * New ticket — the prototype's driver `new-ticket` (and `created`): what they are buying from
 * the vehicle, a check, then payment.
 *
 * Three server writes, in order (AD-020): `createRoadsideTicket` (a draft with its lines),
 * `completeDriverFieldSale` (draft → completed; recomputes the total, issues the invoice, moves
 * stock out of the vehicle), then `recordDriverTripPayment` against the trip's cash custody. If
 * completion fails after the ticket exists, retrying completes *that* ticket rather than writing
 * a second one.
 *
 * Nothing is priced on the device: each line shows its unit price, and the total shown at
 * payment is the server's exact `total_amount` from completion. The amount collected starts as
 * that exact string and may be lowered — anything unpaid stays as the customer's balance.
 *
 * PORT-NOTE: the prototype's customer step (search, quick picks, walk-in) is not ported:
 * roadside tickets are `customer_id = null` by contract (BLOCKER-021 path), so the flow starts
 * at products. Its live running total and change/credit maths are money arithmetic; the server's
 * total and outstanding balance replace them. Products come from the vehicle's own stock.
 */
export default function NewTicketScreen(): React.JSX.Element {
  const router = useRouter();
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const userId = useSessionStore((s) => s.userId);
  const trip = useCurrentDriverTrip(client, tenantId, userId);

  const leave = (): void => (router.canGoBack() ? router.back() : router.replace('/route'));

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  if (trip.isLoading) {
    return (
      <ScreenScroll title="New ticket" onBack={leave}>
        <Skeleton variant="row" className="mt-2 h-[200px]" />
      </ScreenScroll>
    );
  }
  if (trip.isError) {
    return (
      <ScreenScroll title="New ticket" onBack={leave}>
        <ErrorState error={trip.error} onRetry={() => void trip.refetch()} />
      </ScreenScroll>
    );
  }
  if (trip.data == null || trip.data.status !== 'in_transit') {
    return (
      <ScreenScroll title="New ticket" onBack={leave}>
        <EmptyState
          icon="truck"
          title="No trip on the road"
          text="Tickets are written while your trip is on the road. Open your trip to load and depart first."
          action={<Button label="Open trip" onPress={() => router.replace('/trip')} />}
        />
      </ScreenScroll>
    );
  }

  return <SellFlow trip={trip.data} onLeave={leave} />;
}

function SellFlow({ trip, onLeave }: { trip: DriverTrip; onLeave: () => void }): React.JSX.Element {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const stock = useWarehouseStock(trip.warehouse_id, { inStockOnly: true });
  const variants = useAllProductVariants(client, tenantId, { limit: 200 });

  const createTicket = useCreateRoadsideTicket(client, tenantId);
  const completeSale = useCompleteDriverFieldSale(client, tenantId);
  const recordPayment = useRecordDriverTripPayment(client, tenantId);

  const [step, setStep] = useState<Step>(1);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [completed, setCompleted] = useState<Ticket | null>(null);
  const [method, setMethod] = useState<DriverTripPaymentMethod>('cash');
  const [amount, setAmount] = useState('');
  const [paid, setPaid] = useState<Money | null>(null);

  const price = useMemo(() => new Map((variants.data?.rows ?? []).map((v) => [v.id, v.unit_price])), [variants.data]);
  const chosen = stock.lines.filter((l) => isPositiveQuantity(qty[l.variantId] ?? ''));
  const badCount = Object.values(qty).some((v) => v !== '' && v !== '0' && !isPositiveQuantity(v));
  const units = chosen.length === 0 ? '0' : sumQuantities(chosen.map((l) => qty[l.variantId] ?? '0'));
  const q = query.trim().toLowerCase();

  const checkoutPending = createTicket.isPending || completeSale.isPending;
  const checkoutError = completeSale.error ?? createTicket.error;
  const parsedAmount = positiveMoneySchema.safeParse(amount.trim());
  const amountHint = amount.trim() === '' || parsedAmount.success ? null : 'Enter an amount like 4500 or 4500.50';

  function complete(ticketId: string): void {
    completeSale.mutate(
      { ticketId, tripId: trip.id },
      {
        onSuccess: (result) => {
          setDraftId(null);
          setCompleted(result.ticket);
          // Starts as the server's exact total, trailing zeros trimmed as text — not a computed figure.
          setAmount(trimQuantity(result.ticket.total_amount));
          setStep(3);
        },
      }
    );
  }

  function checkout(): void {
    if (draftId !== null) return complete(draftId);
    createTicket.mutate(
      {
        input: {
          branchId: trip.branch_id,
          driverTripId: trip.id,
          lines: chosen.map((l) => ({ productVariantId: l.variantId, quantity: qty[l.variantId] ?? '0' })),
        },
      },
      {
        onSuccess: (created) => {
          setDraftId(created.ticket.id);
          complete(created.ticket.id);
        },
      }
    );
  }

  function pay(): void {
    if (completed === null || !parsedAmount.success) return;
    const collected = parsedAmount.data;
    recordPayment.mutate(
      { tripId: trip.id, input: { ticketId: completed.id, amount: collected, method } },
      {
        onSuccess: () => {
          setPaid(collected);
          setStep(4);
        },
      }
    );
  }

  function reset(): void {
    setStep(1);
    setQty({});
    setQuery('');
    setDraftId(null);
    setCompleted(null);
    setAmount('');
    setPaid(null);
    setMethod('cash');
    createTicket.reset();
    completeSale.reset();
    recordPayment.reset();
  }

  if (step === 4 && completed !== null) {
    return (
      <View className="flex-1 bg-cream px-gutter" style={{ paddingTop: insets.top + 72, paddingBottom: Math.max(insets.bottom, 24) }}>
        {/* The prototype's `.confirm-panel`. */}
        <View className="items-center">
          <ConfirmRing />
          <Text variant="title" className="mt-4 text-center">Sale recorded</Text>
          <CountUp to={Number(completed.total_amount)} text={formatNaira(completed.total_amount)} className="mt-3 text-display font-bold tracking-[-1.2px] text-cocoa" />
          <Text variant="meta" className="mt-1 text-center">
            {completed.ticket_number} · {paid === null ? 'nothing collected yet' : `${formatNaira(paid)} collected by ${METHODS.find((m) => m.key === method)?.label.toLowerCase() ?? method}`}
          </Text>
        </View>
        <View className="flex-1" />
        <View className="gap-2.5">
          <Button label="Create another ticket" onPress={reset} block />
          <Button label="Done" tone="secondary" onPress={() => router.replace('/route')} block />
        </View>
      </View>
    );
  }

  const dirty = chosen.length > 0 && completed === null;

  return (
    <View className="flex-1 bg-cream">
      <ScreenScroll
        title={step === 3 ? 'Take payment' : 'New ticket'}
        sub={step === 3 && completed !== null ? completed.ticket_number : `Step ${step} of 3`}
        onBack={step === 2 ? () => setStep(1) : undefined}
        right={
          step === 3 ? undefined : (
            <IconButton icon="close" label="Discard ticket" onPress={() => (dirty ? setConfirmDiscard(true) : onLeave())} />
          )
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
              <Text variant="subtitle" accessibilityRole="header">What are they buying?</Text>
              <SearchBar value={query} onChangeText={setQuery} placeholder="Search what's on the vehicle" />
              {stock.isLoading || variants.isLoading ? (
                <View className="gap-2"><Skeleton variant="row" /><Skeleton variant="row" /></View>
              ) : stock.isError ? (
                <ErrorState error={stock.error ?? new Error('Could not load the vehicle stock.')} onRetry={() => void stock.refetch()} />
              ) : stock.lines.length === 0 ? (
                <Callout tone="warning" title="Nothing left to sell" detail="The vehicle has no stock recorded. Head back and return the trip." />
              ) : (
                <List>
                  {stock.lines
                    .filter((l) => q === '' || l.label.toLowerCase().includes(q) || (l.sku ?? '').toLowerCase().includes(q))
                    .map((l) => {
                      const unit = price.get(l.variantId);
                      return (
                        <View key={l.variantId} className="min-h-tap flex-row items-center gap-3 px-4 py-3">
                          <View className="min-w-0 flex-1">
                            <Text className="text-callout font-medium text-cocoa" numberOfLines={1}>{l.label}</Text>
                            <Text variant="caption" numberOfLines={1}>
                              {unit === undefined ? '' : `${formatNaira(unit)} each · `}{trimQuantity(l.quantity)} on the vehicle
                            </Text>
                          </View>
                          <CountStepper
                            label={l.label}
                            value={qty[l.variantId] ?? '0'}
                            onChange={(v) => setQty((prev) => ({ ...prev, [l.variantId]: v }))}
                          />
                        </View>
                      );
                    })}
                </List>
              )}
              {badCount && <Callout tone="warning" title="Check the counts" detail="Use whole numbers or up to 4 decimal places." />}
            </View>
          )}

          {step === 2 && (
            <View className="gap-4">
              <Text variant="subtitle" accessibilityRole="header">Check the ticket</Text>
              <List>
                {chosen.map((l) => {
                  const unit = price.get(l.variantId);
                  return (
                    <ListRow
                      key={l.variantId}
                      leading={
                        <View className="h-[30px] min-w-[30px] items-center justify-center rounded-[10px] bg-cream-deep px-1">
                          <Text className="text-[11px] font-bold text-cocoa">{qty[l.variantId]}×</Text>
                        </View>
                      }
                      title={l.label}
                      sub={unit === undefined ? undefined : `${formatNaira(unit)} each`}
                      onPress={() => setStep(1)}
                    />
                  );
                })}
              </List>
              <Callout
                tone="info"
                title="Roadside sale"
                detail="The total is worked out from these items when you create the ticket, and the stock comes off the vehicle."
              />
              {checkoutError !== null && (
                <Callout
                  tone="error"
                  title={draftId === null ? 'Ticket not created' : 'Ticket saved, sale not completed'}
                  detail={`${describeTripError(checkoutError)}${draftId === null ? '' : ' Try again to finish this same ticket.'}`}
                />
              )}
            </View>
          )}

          {step === 3 && completed !== null && (
            <View className="gap-5">
              <Card tone="ink" className="rounded-lg p-5">
                <Text className="text-caption font-semibold uppercase tracking-[1.2px] text-white/50">Total</Text>
                <Text tabular className="mt-1.5 text-display font-bold tracking-[-1.2px] text-white">{formatNaira(completed.total_amount)}</Text>
                <Text className="mt-1 text-foot text-white/60">{completed.ticket_number} · completed, stock recorded</Text>
              </Card>

              <View className="gap-2">
                <Text variant="label">Paid with</Text>
                <Chips accessibilityLabel="Payment method" options={METHODS} value={method} onChange={setMethod} />
              </View>

              <View>
                <Text variant="label" className="mb-2">Amount collected</Text>
                <View className="flex-row items-center justify-center gap-2 rounded-md bg-cream-deep px-4 py-5">
                  <Text className="text-title-2 font-semibold text-warm-gray">₦</Text>
                  <TextInput
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="decimal-pad"
                    inputMode="decimal"
                    selectTextOnFocus
                    accessibilityLabel="Amount collected in naira"
                    className="min-w-[120px] text-center text-[34px] font-bold tracking-[-1.1px] text-cocoa"
                    style={{ fontVariant: ['tabular-nums'] }}
                  />
                </View>
                {amountHint !== null ? (
                  <Text accessibilityRole="alert" variant="meta" className="mt-2 text-center text-error">{amountHint}</Text>
                ) : (
                  <Text variant="caption" className="mt-2 text-center">Lower it if they pay part now — the rest stays on their balance.</Text>
                )}
              </View>

              {recordPayment.isError && <Callout tone="error" title="Payment not recorded" detail={describeTripError(recordPayment.error)} />}
            </View>
          )}
        </Animated.View>
        <View className="h-32" />
      </ScreenScroll>

      <Dock key={step === 3 ? 'pay' : 'cart'}>
        {step === 3 ? (
          <View className="gap-2">
            <Button label="Record payment" busy={recordPayment.isPending} disabled={!parsedAmount.success} onPress={pay} block />
            <Button
              label="Customer pays later"
              tone="secondary"
              disabled={recordPayment.isPending}
              onPress={() => {
                toast({ tone: 'neutral', title: 'Saved without payment', text: `${completed?.ticket_number ?? ''} is on the customer's balance` });
                setStep(4);
              }}
              block
            />
          </View>
        ) : (
          <View className="flex-row items-center gap-3">
            <View className="min-w-0 flex-1">
              <Text variant="caption">On this ticket</Text>
              <Text className="text-title-3 font-bold text-cocoa">
                {trimQuantity(units)} item{units === '1' ? '' : 's'} · {chosen.length} product{chosen.length === 1 ? '' : 's'}
              </Text>
            </View>
            <Button
              label={step === 2 ? (draftId === null ? 'Create ticket' : 'Try again') : 'Continue'}
              busy={checkoutPending}
              disabled={chosen.length === 0 || badCount}
              onPress={() => (step === 2 ? checkout() : setStep(2))}
            />
          </View>
        )}
      </Dock>

      <Sheet
        visible={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title="Discard this ticket?"
        foot={
          <View className="gap-2.5">
            <Button label="Discard" tone="danger" onPress={() => { setConfirmDiscard(false); onLeave(); }} block />
            <Button label="Keep editing" tone="secondary" onPress={() => setConfirmDiscard(false)} block />
          </View>
        }
      >
        <Text variant="meta">{draftId === null ? 'Nothing has been saved yet.' : 'The ticket was saved as a draft but the sale is not complete.'}</Text>
      </Sheet>
    </View>
  );
}
