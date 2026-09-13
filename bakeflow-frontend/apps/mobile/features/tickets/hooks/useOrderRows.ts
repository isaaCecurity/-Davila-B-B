import type { TicketFilters } from '@bakeflow/api';
import { getSupabaseClient } from '@bakeflow/auth';
import { useCustomersByIds, useTicketItemsForTickets, useTicketPages } from '@bakeflow/hooks';
import type { Ticket, TicketItem } from '@bakeflow/types';
import { useMemo } from 'react';

import { useSessionStore } from '../../../stores/session';
import { useVariantLabels } from '../../catalog/hooks/useVariantLabels';
import { trimQuantity } from '../ticketDisplay';

export interface OrderRow {
  ticket: Ticket;
  customerName: string;
  /** "2 × Celebration Cake · 5 × Agege Bread", or null while lines are still loading. */
  itemLine: string | null;
  itemCount: number;
}

/**
 * A ticket list joined to what a card needs to say: who ordered, and what.
 *
 * Tickets load as keyset pages; lines and customers for everything loaded arrive in one
 * batched request each, so a page of 50 cards costs four round trips, not fifty.
 */
export function useOrderRows(filters: TicketFilters) {
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);

  const pages = useTicketPages(client, tenantId, filters);
  const tickets = useMemo(() => pages.data?.pages.flatMap((p) => p.rows) ?? [], [pages.data]);

  const ticketIds = useMemo(() => tickets.map((t) => t.id), [tickets]);
  const customerIds = useMemo(
    () => [...new Set(tickets.map((t) => t.customer_id).filter((id): id is string => id !== null))],
    [tickets]
  );

  const items = useTicketItemsForTickets(client, tenantId, ticketIds);
  const customers = useCustomersByIds(client, tenantId, customerIds);
  const { labels } = useVariantLabels();

  const rows = useMemo<OrderRow[]>(() => {
    const customerName = new Map((customers.data ?? []).map((c) => [c.id, c.full_name]));
    const linesByTicket = new Map<string, TicketItem[]>();
    for (const line of items.data ?? []) {
      const list = linesByTicket.get(line.ticket_id) ?? [];
      list.push(line);
      linesByTicket.set(line.ticket_id, list);
    }

    return tickets.map((ticket) => {
      const lines = linesByTicket.get(ticket.id) ?? [];
      return {
        ticket,
        customerName:
          ticket.customer_id === null
            ? 'Walk-in customer'
            : (customerName.get(ticket.customer_id) ?? 'Customer'),
        itemLine: items.data === undefined
          ? null
          : lines.length === 0
            ? 'No items yet'
            : lines
                .map((l) => `${trimQuantity(l.quantity)} × ${labels.get(l.product_variant_id)?.label ?? 'item'}`)
                .join(' · '),
        itemCount: lines.length,
      };
    });
  }, [tickets, items.data, customers.data, labels]);

  return {
    rows,
    isLoading: pages.isLoading,
    isError: pages.isError,
    error: pages.error,
    isRefetching: pages.isRefetching,
    refetch: pages.refetch,
    hasNextPage: pages.hasNextPage,
    isFetchingNextPage: pages.isFetchingNextPage,
    fetchNextPage: pages.fetchNextPage,
    tenantId,
  };
}
