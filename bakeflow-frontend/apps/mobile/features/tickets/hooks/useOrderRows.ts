import type { TicketFilters } from '@bakeflow/api';
import { getSupabaseClient } from '@bakeflow/auth';
import {
  useAllProductVariants,
  useCustomersByIds,
  useProducts,
  useTicketItemsForTickets,
  useTicketPages,
} from '@bakeflow/hooks';
import type { Ticket, TicketItem } from '@bakeflow/types';
import { useMemo } from 'react';

import { useSessionStore } from '../../../stores/session';
import { trimQuantity } from '../ticketDisplay';

export interface OrderRow {
  ticket: Ticket;
  customerName: string;
  /** "2 × Celebration Cake · 5 × Agege Bread", or null while lines are still loading. */
  itemLine: string | null;
  itemCount: number;
}

/*
 * PORT-NOTE: product and variant names come from the first 200 of each (the API's page
 * ceiling). A bakery catalogue is far smaller; beyond that a line falls back to its SKU-less
 * "item" label rather than showing a wrong name. A by-id variant lookup would lift the limit.
 */
const NAME_PAGE = { limit: 200 } as const;

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
  const variants = useAllProductVariants(client, tenantId, NAME_PAGE);
  const products = useProducts(client, tenantId, NAME_PAGE);

  const rows = useMemo<OrderRow[]>(() => {
    const customerName = new Map((customers.data ?? []).map((c) => [c.id, c.full_name]));
    const productName = new Map((products.data?.rows ?? []).map((p) => [p.id, p.name]));
    const variantsPerProduct = new Map<string, number>();
    for (const v of variants.data?.rows ?? []) {
      variantsPerProduct.set(v.product_id, (variantsPerProduct.get(v.product_id) ?? 0) + 1);
    }
    const variantLabel = new Map(
      (variants.data?.rows ?? []).map((v) => {
        const product = productName.get(v.product_id) ?? v.name;
        const many = (variantsPerProduct.get(v.product_id) ?? 1) > 1;
        return [v.id, many ? `${product} (${v.name})` : product];
      })
    );

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
                .map((l) => `${trimQuantity(l.quantity)} × ${variantLabel.get(l.product_variant_id) ?? 'item'}`)
                .join(' · '),
        itemCount: lines.length,
      };
    });
  }, [tickets, items.data, customers.data, variants.data, products.data]);

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
