import type { TicketStatus } from './sales';
import type { Money, Uuid } from './scalars';

/**
 * `search_workspace()` (P9.9 Q6) — one search across customers, orders and products. The function
 * runs with the caller's own RLS, so every hit is a row the caller can already open.
 */
export interface SearchCustomerHit {
  id: Uuid;
  full_name: string;
  phone: string | null;
}

export interface SearchOrderHit {
  id: Uuid;
  ticket_number: string;
  status: TicketStatus;
  total_amount: Money;
  created_at: string;
  /** Null for a walk-in or roadside sale. */
  customer_name: string | null;
}

export interface SearchProductHit {
  id: Uuid;
  name: string;
  /** Active variants. */
  variant_count: number;
  /** The lowest active variant price, exact; null when the product has no active variant. */
  price_from: Money | null;
}

export interface WorkspaceSearchResults {
  query: string;
  customers: SearchCustomerHit[];
  orders: SearchOrderHit[];
  products: SearchProductHit[];
}
