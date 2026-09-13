import { nextTicketStatus } from '@bakeflow/api';
import { getSupabaseClient } from '@bakeflow/auth';
import {
  useAllProductVariants,
  useCustomersByIds,
  useProducts,
  useTicketWithItems,
} from '@bakeflow/hooks';
import { isZeroDecimalString, type TicketStatus } from '@bakeflow/types';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Icon,
  IconTile,
  PressableScale,
  ScreenScroll,
  Skeleton,
  Text,
} from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState, ErrorState } from '../../components/ScreenState';
import { useActivePersona } from '../../features/auth/hooks/useActivePersona';
import { AdvanceTicketSheet } from '../../features/tickets/components/AdvanceTicketSheet';
import { CancelTicketSheet } from '../../features/tickets/components/CancelTicketSheet';
import { RecordPaymentSheet } from '../../features/tickets/components/RecordPaymentSheet';
import {
  ADVANCE_VERB,
  FULFILMENT_LABEL,
  PAY_META,
  payStateOf,
  STATUS_META,
  ticketTime,
  trimQuantity,
} from '../../features/tickets/ticketDisplay';
import { useSessionStore } from '../../stores/session';

/** The forward path shown as a timeline (STATE-MACHINES.md §1). */
const LIFECYCLE: readonly { status: TicketStatus; label: string }[] = [
  { status: 'submitted', label: 'Order placed' },
  { status: 'confirmed', label: 'Confirmed' },
  { status: 'in_production', label: 'In the kitchen' },
  { status: 'ready', label: 'Ready' },
  { status: 'delivered', label: 'Handed over' },
  { status: 'completed', label: 'Completed' },
];
const ORDER_OF: Record<TicketStatus, number> = {
  draft: 0, submitted: 1, confirmed: 2, scheduled: 2, in_production: 3,
  ready: 4, delivered: 5, completed: 6, cancelled: -1, archived: -1,
};

function Section({ title, aside, children }: { title: string; aside?: string; children: ReactNode }): React.JSX.Element {
  return (
    <View className="mt-8">
      <View className="mb-3 flex-row items-baseline gap-3">
        <Text variant="subtitle" accessibilityRole="header" className="flex-1">{title}</Text>
        {aside !== undefined && <Text variant="meta">{aside}</Text>}
      </View>
      {children}
    </View>
  );
}

function RecapLine({ label, value, total = false }: { label: string; value: string; total?: boolean }): React.JSX.Element {
  return (
    <View className="flex-row items-center py-1">
      <Text className={total ? 'flex-1 text-body font-semibold text-cocoa' : 'flex-1 text-callout text-warm-gray'}>{label}</Text>
      <Text tabular className={total ? 'text-title-3 font-bold text-cocoa' : 'text-callout font-semibold text-cocoa'}>{value}</Text>
    </View>
  );
}

/**
 * Order detail — the prototype's `order` screen, on a live ticket.
 *
 * Every figure shown is one the database computed (`subtotal_amount`, `discount_amount`,
 * `tax_amount`, `total_amount`, `amount_paid`); nothing is added up here.
 *
 * PORT-NOTE: the prototype's timeline shows who did each step and when. There is no ticket
 * status-history read yet, so steps show done / current / not yet from the status alone.
 * Its "Share", "Print receipt", "Reassign" and "Edit items" rows are not ported: there is no
 * receipt or assignment endpoint, and submitted items are frozen by design.
 */
export default function OrderDetailScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const persona = useActivePersona();
  const [sheet, setSheet] = useState<'advance' | 'pay' | 'cancel' | null>(null);

  const detail = useTicketWithItems(client, tenantId, id ?? null);
  const ticket = detail.data?.ticket ?? null;
  const customers = useCustomersByIds(client, tenantId, ticket?.customer_id != null ? [ticket.customer_id] : []);
  const variants = useAllProductVariants(client, tenantId, { limit: 200 });
  const products = useProducts(client, tenantId, { limit: 200 });

  const back = (): void => router.back();

  if (detail.isLoading) {
    return (
      <ScreenScroll title="Order" onBack={back}>
        <View className="gap-3 pt-5">
          <Skeleton variant="chart" />
          <Skeleton variant="row" />
          <Skeleton variant="row" className="h-[160px]" />
        </View>
      </ScreenScroll>
    );
  }
  if (detail.isError) {
    return (
      <ScreenScroll title="Order" onBack={back}>
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      </ScreenScroll>
    );
  }
  if (ticket === null || detail.data == null) {
    return (
      <ScreenScroll title="Order" onBack={back}>
        <EmptyState title="Order not found" detail="It may belong to another branch, or it was removed." />
      </ScreenScroll>
    );
  }

  const customer = customers.data?.[0];
  const customerName = ticket.customer_id === null ? 'Walk-in customer' : (customer?.full_name ?? 'Customer');
  const status = STATUS_META[ticket.status];
  const pay = payStateOf(ticket);
  const next = nextTicketStatus(ticket.status);
  const isManager = persona === 'owner' || persona === 'manager' || persona === 'admin';
  const canCancel = isManager && ticket.status !== 'completed' && ticket.status !== 'cancelled' && ticket.status !== 'archived';
  const canPay = ticket.status !== 'cancelled' && ticket.status !== 'archived' && pay !== 'paid' && pay !== null;
  const productName = new Map((products.data?.rows ?? []).map((p) => [p.id, p.name]));
  const variant = new Map((variants.data?.rows ?? []).map((v) => [v.id, v]));
  const step = ORDER_OF[ticket.status];

  return (
    <View className="flex-1 bg-cream">
      <ScreenScroll
        title={ticket.ticket_number}
        sub={`${customerName} · ${ticketTime(ticket.created_at)}`}
        onBack={back}
        refreshing={detail.isRefetching}
        onRefresh={() => void detail.refetch()}
      >
        {/* Hero: total and where it stands */}
        <Card tone="ink" className="mt-5 rounded-lg p-5">
          <Text className="text-caption font-semibold uppercase tracking-[1.2px] text-white/50">Order total</Text>
          <Text tabular className="mt-1.5 text-display font-bold tracking-[-1.2px] text-white">
            {formatNaira(ticket.total_amount)}
          </Text>
          <View className="mt-4 flex-row flex-wrap gap-2">
            <Badge label={status.label} tone={status.tone} icon={status.icon} onDark />
            {pay !== null && <Badge {...PAY_META[pay]} onDark />}
            <Badge
              label={FULFILMENT_LABEL[ticket.fulfilment_type]}
              tone="neutral"
              icon={ticket.fulfilment_type === 'delivery' ? 'truck' : 'bag'}
              onDark
            />
          </View>
        </Card>

        {/* Customer */}
        <Section title="Customer">
          <Card>
            <View className="flex-row items-center gap-3">
              <Avatar name={customerName} size="lg" />
              <View className="min-w-0 flex-1">
                <Text className="text-callout font-semibold text-cocoa" numberOfLines={1}>{customerName}</Text>
                <Text variant="meta" numberOfLines={1}>
                  {customer?.phone ?? (ticket.customer_id === null ? 'Counter sale' : 'No phone on file')}
                </Text>
              </View>
            </View>
          </Card>
        </Section>

        {/* Items and recap — database-computed figures only */}
        <Section title="Items" aside={`${detail.data.items.length} line${detail.data.items.length === 1 ? '' : 's'}`}>
          <Card>
            {detail.data.items.length === 0 && <Text variant="meta">No items on this order yet.</Text>}
            {detail.data.items.map((line, i) => {
              const v = variant.get(line.product_variant_id);
              return (
                <View key={line.id} className={`flex-row items-center gap-3 py-2.5 ${i > 0 ? 'border-t border-border' : ''}`}>
                  <View className="h-[30px] min-w-[30px] items-center justify-center rounded-[10px] bg-cream-deep px-1">
                    <Text className="text-[11px] font-bold text-cocoa">{trimQuantity(line.quantity)}×</Text>
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-callout font-medium text-cocoa" numberOfLines={1}>
                      {v !== undefined ? (productName.get(v.product_id) ?? v.name) : 'Item'}
                    </Text>
                    <Text variant="caption" numberOfLines={1}>
                      {v !== undefined ? `${v.name} · ${formatNaira(line.unit_price)} each` : formatNaira(line.unit_price)}
                    </Text>
                  </View>
                  <Text tabular className="text-callout font-semibold text-cocoa">{formatNaira(line.line_total)}</Text>
                </View>
              );
            })}
            <View className="mt-3 border-t border-border pt-3">
              <RecapLine label="Subtotal" value={formatNaira(ticket.subtotal_amount)} />
              {!isZeroDecimalString(ticket.discount_amount) && (
                <RecapLine label="Discount" value={`−${formatNaira(ticket.discount_amount)}`} />
              )}
              {!isZeroDecimalString(ticket.tax_amount) && <RecapLine label="Tax" value={formatNaira(ticket.tax_amount)} />}
              <View className="my-1.5 h-px bg-border" />
              <RecapLine label="Total" value={formatNaira(ticket.total_amount)} total />
            </View>
          </Card>
        </Section>

        {/* Payment */}
        <Section title="Payment">
          <Card>
            <View className="flex-row items-center gap-3">
              <IconTile
                icon={pay === 'paid' ? 'check' : pay === 'partial' ? 'alert' : pay === 'unpaid' ? 'clock' : 'receipt'}
                tone={pay === 'paid' ? 'ok' : pay === 'partial' ? 'warn' : pay === 'unpaid' ? 'bad' : 'neutral'}
              />
              <View className="min-w-0 flex-1">
                <Text className="text-callout font-semibold text-cocoa">
                  {pay === 'paid' ? 'Paid in full' : pay === 'partial' ? 'Part paid' : pay === 'unpaid' ? 'Not paid yet' : 'Nothing to pay yet'}
                </Text>
                <Text variant="meta">
                  {formatNaira(ticket.amount_paid)} received of {formatNaira(ticket.total_amount)}
                </Text>
              </View>
            </View>
            {canPay && (
              <Button
                label="Record payment"
                tone={pay === 'unpaid' ? 'primary' : 'secondary'}
                className="mt-4"
                onPress={() => setSheet('pay')}
                block
              />
            )}
          </Card>
        </Section>

        {/* Timeline */}
        <Section title="Timeline">
          <Card>
            {ticket.status === 'cancelled' && (
              <View className="mb-4 flex-row items-start gap-3">
                <IconTile icon="close" tone="bad" size="sm" />
                <View className="min-w-0 flex-1">
                  <Text className="text-foot font-semibold text-cocoa">Cancelled</Text>
                  <Text variant="meta">{ticket.cancelled_reason ?? 'No reason recorded.'}</Text>
                </View>
              </View>
            )}
            {LIFECYCLE.map((s, i) => {
              const at = i + 1;
              const state = step < 0 ? 'todo' : at < step ? 'done' : at === step ? 'current' : 'todo';
              return (
                <View key={s.status} className="flex-row gap-3">
                  <View className="items-center">
                    <View
                      className={`h-[22px] w-[22px] items-center justify-center rounded-pill ${
                        state === 'done' ? 'bg-success' : state === 'current' ? 'border-2 border-apricot bg-white' : 'border-2 border-border bg-white'
                      }`}
                    >
                      {state === 'done' && <Icon name="check" size={11} color="white" strokeWidth={2.6} />}
                    </View>
                    {i < LIFECYCLE.length - 1 && <View className={`w-0.5 flex-1 ${state === 'done' ? 'bg-success' : 'bg-border'}`} />}
                  </View>
                  <View className="flex-1 pb-4">
                    <Text className={`text-callout font-semibold ${state === 'todo' ? 'text-warm-gray-soft' : 'text-cocoa'}`}>{s.label}</Text>
                    <Text variant="caption">{state === 'todo' ? 'Not yet' : state === 'current' ? 'Now' : 'Done'}</Text>
                  </View>
                </View>
              );
            })}
          </Card>
        </Section>

        {canCancel && (
          <View className="mt-8">
            <Button label="Cancel this order" tone="danger" onPress={() => setSheet('cancel')} block />
          </View>
        )}
        <View className="h-28" />
      </ScreenScroll>

      {/* Dock: the next step, for roles that move orders along */}
      {next !== null && ticket.status !== 'cancelled' && persona !== 'driver' && (
        <View
          className="absolute bottom-0 left-0 right-0 flex-row items-center gap-3 border-t border-border bg-white px-gutter pt-3 shadow-e4"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <View className="min-w-0 flex-1">
            <Text variant="caption">Next step</Text>
            <Text className="text-title-3 font-bold text-cocoa">{STATUS_META[next].label}</Text>
          </View>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={ADVANCE_VERB[next] ?? 'Advance'}
            onPress={() => setSheet('advance')}
            className="min-h-tap flex-row items-center gap-2 rounded-sm bg-cocoa px-5 py-3.5"
          >
            <Text className="text-body font-semibold text-cream">{ADVANCE_VERB[next] ?? 'Advance'}</Text>
            <Icon name="arrowRight" size={16} color="onPrimary" />
          </PressableScale>
        </View>
      )}

      <AdvanceTicketSheet
        ticket={sheet === 'advance' ? ticket : null}
        customerName={customerName}
        onClose={() => setSheet(null)}
      />
      <RecordPaymentSheet ticket={ticket} visible={sheet === 'pay'} onClose={() => setSheet(null)} />
      <CancelTicketSheet ticket={ticket} visible={sheet === 'cancel'} onClose={() => setSheet(null)} />
    </View>
  );
}
