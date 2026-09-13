import { getSupabaseClient } from '@bakeflow/auth';
import { useCustomersByIds, useDeliveries, useDrivers, useTicketItemsForTickets, useTicketsByIds } from '@bakeflow/hooks';
import type { Delivery, Driver, Ticket } from '@bakeflow/types';
import { useMemo } from 'react';

import { useSessionStore } from '../../../stores/session';
import { useVariantLabels } from '../../catalog/hooks/useVariantLabels';
import { startOfToday, trimQuantity } from '../../tickets/ticketDisplay';

export interface DeliveryRow {
  delivery: Delivery;
  ticket: Ticket | null;
  customerName: string;
  /** "2 × Agege Bread · 1 × Meat Pie", or null while lines load. */
  itemLine: string | null;
}

export interface DriverSummary {
  driverId: string;
  name: string;
  phone: string | null;
  rows: DeliveryRow[];
  active: number;
  problems: number;
}

/*
 * PORT-NOTE: "today" is the device's local midnight, and each list reads one page of 200 — a
 * day's deliveries for one bakery sit well inside that. Open deliveries from earlier days are
 * included too, because an unfinished delivery does not stop mattering at midnight.
 */
const PAGE = { limit: 200 } as const;

/**
 * Everything the delivery screens show, joined: today's deliveries plus every still-open one,
 * with order numbers, customer names, item lines and drivers attached — a fixed handful of
 * batched reads, whatever the number of stops.
 */
export function useDeliveryBoard({ branchId, driverId }: { branchId?: string; driverId?: string } = {}) {
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const since = useMemo(() => startOfToday(), []);

  // `driverId` is a convenience filter: RLS already lets a driver see their own stops anywhere.
  const scope = { ...(branchId === undefined ? {} : { branchId }), ...(driverId === undefined ? {} : { driverId }) };
  const open = useDeliveries(client, tenantId, { openOnly: true, ...scope }, PAGE);
  const today = useDeliveries(client, tenantId, { since, ...scope }, PAGE);
  const drivers = useDrivers(client, driverId === undefined ? tenantId : null);

  const deliveries = useMemo(() => {
    const byId = new Map<string, Delivery>();
    for (const d of [...(open.data?.rows ?? []), ...(today.data?.rows ?? [])]) byId.set(d.id, d);
    // Newest first, as the API orders them; ISO timestamps compare as strings.
    return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [open.data, today.data]);

  const ticketIds = useMemo(() => deliveries.map((d) => d.ticket_id), [deliveries]);
  const tickets = useTicketsByIds(client, tenantId, ticketIds);
  const customerIds = useMemo(
    () => [...new Set((tickets.data ?? []).map((t) => t.customer_id).filter((id): id is string => id !== null))],
    [tickets.data]
  );
  const customers = useCustomersByIds(client, tenantId, customerIds);
  const items = useTicketItemsForTickets(client, tenantId, ticketIds);
  const { labels } = useVariantLabels();

  const rows = useMemo<DeliveryRow[]>(() => {
    const ticketById = new Map((tickets.data ?? []).map((t) => [t.id, t]));
    const nameById = new Map((customers.data ?? []).map((c) => [c.id, c.full_name]));
    const linesByTicket = new Map<string, string[]>();
    for (const line of items.data ?? []) {
      const text = `${trimQuantity(line.quantity)} × ${labels.get(line.product_variant_id)?.label ?? 'item'}`;
      linesByTicket.set(line.ticket_id, [...(linesByTicket.get(line.ticket_id) ?? []), text]);
    }
    return deliveries.map((delivery) => {
      const ticket = ticketById.get(delivery.ticket_id) ?? null;
      return {
        delivery,
        ticket,
        customerName:
          ticket === null ? 'Order' : ticket.customer_id === null ? 'Walk-in customer' : (nameById.get(ticket.customer_id) ?? 'Customer'),
        itemLine: items.data === undefined ? null : (linesByTicket.get(delivery.ticket_id) ?? []).join(' · ') || 'No items',
      };
    });
  }, [deliveries, tickets.data, customers.data, items.data, labels]);

  const byDriver = useMemo<DriverSummary[]>(() => {
    const known = new Map<string, Driver>((drivers.data ?? []).map((d) => [d.profile_id, d]));
    const groups = new Map<string, DeliveryRow[]>();
    for (const r of rows) {
      if (r.delivery.driver_id === null) continue;
      groups.set(r.delivery.driver_id, [...(groups.get(r.delivery.driver_id) ?? []), r]);
    }
    // Every driver appears, even with no stops, so a dispatcher can see who is free.
    for (const d of known.keys()) if (!groups.has(d)) groups.set(d, []);
    return [...groups.entries()]
      .map(([driverId, list]) => ({
        driverId,
        name: known.get(driverId)?.full_name ?? 'Former driver',
        phone: known.get(driverId)?.phone ?? null,
        rows: list,
        active: list.filter((r) => r.delivery.status === 'in_transit' || r.delivery.status === 'assigned').length,
        problems: list.filter((r) => r.delivery.status === 'failed').length,
      }))
      .sort((a, b) => b.active - a.active || a.name.localeCompare(b.name));
  }, [rows, drivers.data]);

  return {
    rows,
    byDriver,
    unassigned: rows.filter((r) => r.delivery.status === 'pending'),
    todayCount: (today.data?.rows ?? []).length,
    isLoading: open.isLoading || today.isLoading,
    isError: open.isError || today.isError,
    error: open.error ?? today.error,
    isRefetching: open.isRefetching || today.isRefetching || drivers.isRefetching,
    refetch: () => {
      void open.refetch();
      void today.refetch();
      void drivers.refetch();
    },
    tenantId,
  };
}
