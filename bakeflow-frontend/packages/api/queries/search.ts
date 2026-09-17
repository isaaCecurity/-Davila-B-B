/**
 * Workspace search — P9.9 Q6, `search_workspace()`.
 *
 * A read-only RPC that runs with the caller's own RLS (SECURITY INVOKER): it adds matching and
 * ranking, never visibility, so every hit is a row the caller could already open. Customers match
 * by name or phone (a 0803… query finds +234 803…), orders by number or customer name, products by
 * name, variant name or SKU; starts-with matches first. Fewer than 2 characters returns nothing.
 */

import type { WorkspaceSearchResults } from '@bakeflow/types';
import { workspaceSearchSchema } from '@bakeflow/validation';

import type { BakeflowClient } from '../client';
import { BakeflowApiError } from '../errors';
import { parseRow, run } from '../internal/read';

export interface WorkspaceSearchOptions {
  /** Rows per group, 1–20 (default 6, the prototype's cap). */
  limit?: number;
  /** Only orders the caller created — the cashier's and driver's own-orders view. */
  onlyMyOrders?: boolean;
}

export async function searchWorkspace(
  client: BakeflowClient,
  query: string,
  options: WorkspaceSearchOptions = {},
): Promise<WorkspaceSearchResults> {
  const payload = await run(
    client.rpc('search_workspace', {
      p_query: query,
      p_limit: Math.min(Math.max(Math.trunc(options.limit ?? 6), 1), 20),
      p_only_my_orders: options.onlyMyOrders ?? false,
    }),
  );
  const parsed = parseRow(workspaceSearchSchema, payload, 'searchWorkspace');
  if (parsed === null) {
    throw new BakeflowApiError({ code: 'response_shape_invalid', message: 'searchWorkspace: the RPC returned no envelope' });
  }
  return parsed;
}
