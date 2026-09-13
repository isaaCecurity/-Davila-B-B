import { nextTicketStatus } from '@bakeflow/api';
import { getSupabaseClient } from '@bakeflow/auth';
import { useAdvanceTicket } from '@bakeflow/hooks';
import type { TicketStatus } from '@bakeflow/types';
import {
  Button,
  Card,
  Chips,
  GroupLabel,
  Icon,
  Menu,
  MenuItem,
  ScreenScroll,
  Skeleton,
  Text,
} from '@bakeflow/ui';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { EmptyState, ErrorState, NoOrganizationState } from '../../components/ScreenState';
import { useActivePersona } from '../../features/auth/hooks/useActivePersona';
import { useBranchOptions } from '../../features/branch/hooks/useBranchOptions';
import { ProductionCard } from '../../features/production/components/ProductionCard';
import { useOrderRows, type OrderRow } from '../../features/tickets/hooks/useOrderRows';
import { ADVANCE_VERB, STATUS_META } from '../../features/tickets/ticketDisplay';
import { toast } from '../../stores/ui/toast.store';
import { useOffBarBack } from '../../navigation/useOffBarBack';

const QUEUE: readonly TicketStatus[] = ['confirmed', 'scheduled', 'in_production', 'ready'];

/** Earliest due first; undated orders after dated ones, then by number. */
function byDue(a: OrderRow, b: OrderRow): number {
  const ad = a.ticket.due_at;
  const bd = b.ticket.due_at;
  if (ad !== bd) {
    if (ad === null) return 1;
    if (bd === null) return -1;
    return ad.localeCompare(bd);
  }
  return a.ticket.ticket_number.localeCompare(b.ticket.ticket_number);
}

function Stat({ value, label, tone }: { value: string; label: string; tone: string }): React.JSX.Element {
  return (
    <View className="min-w-0 flex-1 rounded-md bg-white px-3.5 py-3 shadow-e2" accessible accessibilityLabel={`${value} ${label}`}>
      <Text tabular className={`text-title-2 font-bold ${tone}`}>{value}</Text>
      <Text variant="caption" numberOfLines={1}>{label}</Text>
    </View>
  );
}

/**
 * Production — the prototype's baker `production` tab (and `production-monitor`): what to make,
 * what is in the oven, and what is ready.
 *
 * Under AD-022 the MVP does not track production batches or ingredients — client grants on
 * `production_batches` and `recipes` are revoked. What a baker does in this version is move
 * orders through the kitchen: `scheduled → in_production → ready`, via `update_ticket()`, whose
 * actor list the live `guard_ticket_status_transition()` trigger decides (baker on those two
 * hops). So this screen is that queue.
 *
 * Moves are optimistic: the card jumps to its next section at once, shows progress on its
 * button, and returns with an error toast if the database refuses.
 *
 * PORT-NOTE: "Record production" (choose product → batch → quantity), batch cards, production
 * records and entry corrections all sit on production batches, which are out of MVP scope
 * (AD-022) — not ported. Finished stock and waste are on the Stock screen. The Schedule step is
 * hidden from bakers only because the trigger refuses it for them (advisory; see tabs.ts).
 */
export default function ProductionScreen(): React.JSX.Element {
  const router = useRouter();
  const onBack = useOffBarBack('production');
  const persona = useActivePersona();
  const branches = useBranchOptions();
  const [branchIndex, setBranchIndex] = useState(0);
  const branch = branches.options[branchIndex] ?? branches.options[0] ?? null;

  const filters = useMemo(
    () => (branch === null ? { statuses: QUEUE } : { statuses: QUEUE, branchId: branch.branchId }),
    [branch]
  );
  const list = useOrderRows(filters);
  const advance = useAdvanceTicket(getSupabaseClient(), list.tenantId);

  // Optimistic target status per ticket while its move is in flight.
  const [moving, setMoving] = useState<ReadonlyMap<string, TicketStatus>>(new Map());

  const sections = useMemo(() => {
    const shown = (r: OrderRow): TicketStatus => {
      const to = moving.get(r.ticket.id);
      return to !== undefined && r.ticket.status !== to ? to : r.ticket.status;
    };
    const pick = (s: TicketStatus): OrderRow[] => list.rows.filter((r) => shown(r) === s).sort(byDue);
    return {
      shown,
      preparing: pick('in_production'),
      toStart: pick('scheduled'),
      confirmed: pick('confirmed'),
      ready: pick('ready'),
    };
  }, [list.rows, moving]);

  if (list.tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const isBaker = persona === 'baker';

  function move(row: OrderRow): void {
    const from = row.ticket.status;
    const to = nextTicketStatus(from);
    if (to === null) return;
    setMoving((m) => new Map(m).set(row.ticket.id, to));
    advance.mutate(
      { ticketId: row.ticket.id, from },
      {
        onSuccess: () => {
          toast({ tone: 'success', title: `${row.ticket.ticket_number} → ${STATUS_META[to].label}`, text: row.itemLine ?? row.customerName });
        },
        onError: (e) => {
          setMoving((m) => {
            const next = new Map(m);
            next.delete(row.ticket.id);
            return next;
          });
          toast({ tone: 'error', title: `${row.ticket.ticket_number} not moved`, text: e.message });
        },
      }
    );
  }

  const card = (row: OrderRow, canAct: boolean): React.JSX.Element => {
    const status = sections.shown(row);
    const inFlight = moving.get(row.ticket.id) !== undefined && row.ticket.status !== moving.get(row.ticket.id);
    const to = nextTicketStatus(status);
    return (
      <ProductionCard
        key={row.ticket.id}
        row={row}
        status={status}
        action={canAct && to !== null ? (ADVANCE_VERB[to] ?? null) : null}
        busy={inFlight}
        onAction={() => move(row)}
        onPress={() => router.push(`/order/${row.ticket.id}`)}
      />
    );
  };

  const empty = !list.isLoading && list.rows.length === 0;

  return (
    <ScreenScroll
      title="Production"
      onBack={onBack}
      sub={
        list.isLoading
          ? branch?.label
          : `${branch?.label ?? 'All branches'} · ${sections.toStart.length + sections.preparing.length} to make`
      }
      refreshing={list.isRefetching && !list.isFetchingNextPage}
      onRefresh={() => void list.refetch()}
    >
      {branches.options.length > 1 && (
        <Chips
          className="mt-2"
          accessibilityLabel="Branch"
          options={branches.options.map((b, i) => ({ key: String(i), label: b.label }))}
          value={String(branchIndex)}
          onChange={(k) => setBranchIndex(Number(k))}
        />
      )}

      {list.isLoading || branches.isLoading ? (
        <View className="mt-5 gap-3">
          <Skeleton variant="row" className="h-[72px]" />
          <Skeleton variant="row" className="h-[120px]" />
          <Skeleton variant="row" className="h-[120px]" />
        </View>
      ) : list.isError ? (
        <View className="mt-5">
          <ErrorState error={list.error ?? new Error('Could not load the production queue.')} onRetry={() => void list.refetch()} />
        </View>
      ) : (
        <>
          <View className="mt-4 flex-row gap-2.5">
            <Stat value={String(sections.toStart.length)} label="To start" tone="text-cocoa" />
            <Stat value={String(sections.preparing.length)} label="Preparing" tone="text-apricot-deep" />
            <Stat value={String(sections.ready.length)} label="Ready" tone="text-success-ink" />
          </View>

          {empty ? (
            <EmptyState
              title="Nothing to make right now"
              detail="Orders appear here once they are confirmed. Pull down to check again."
            />
          ) : (
            <>
              {sections.preparing.length > 0 && (
                <>
                  <GroupLabel>Preparing</GroupLabel>
                  <View className="gap-3">{sections.preparing.map((r) => card(r, true))}</View>
                </>
              )}
              {sections.toStart.length > 0 && (
                <>
                  <GroupLabel>To start</GroupLabel>
                  <View className="gap-3">{sections.toStart.map((r) => card(r, true))}</View>
                </>
              )}
              {sections.confirmed.length > 0 && (
                <>
                  <GroupLabel>Confirmed · not yet scheduled</GroupLabel>
                  <View className="gap-3">{sections.confirmed.map((r) => card(r, !isBaker))}</View>
                </>
              )}
              {sections.ready.length > 0 && (
                <>
                  <GroupLabel>Ready</GroupLabel>
                  <View className="gap-3">{sections.ready.map((r) => card(r, false))}</View>
                </>
              )}
              {list.hasNextPage === true && (
                <Button
                  className="mt-4"
                  label="Load more orders"
                  tone="secondary"
                  busy={list.isFetchingNextPage}
                  onPress={() => void list.fetchNextPage()}
                  block
                />
              )}
            </>
          )}

          <GroupLabel>Finished stock</GroupLabel>
          <Menu>
            <MenuItem icon="layers" title="Stock on the shelf" sub="Counts, and recording waste" onPress={() => router.push('/inventory')} />
          </Menu>
          <Card tone="recessed" className="mt-4 flex-row items-start gap-2.5 p-3.5">
            <Icon name="info" size={15} color="textMuted" />
            <Text variant="caption" className="flex-1">
              Batches and ingredients are not tracked in this version. Move each order along as you make it.
            </Text>
          </Card>
        </>
      )}
    </ScreenScroll>
  );
}
