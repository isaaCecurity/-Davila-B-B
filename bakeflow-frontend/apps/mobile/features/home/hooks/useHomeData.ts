import type { TicketFilters } from '@bakeflow/api';
import { getSupabaseClient } from '@bakeflow/auth';
import { useCashSessions, useTickets } from '@bakeflow/hooks';

import { useSessionStore } from '../../../stores/session';

const COUNT_PAGE = { limit: 200 } as const;

/**
 * How many tickets match, as display text: "12", or "200+" when there are more than one page.
 * A count of rows, not a sum of anything they contain.
 */
export function useTicketCount(filters: TicketFilters) {
  const tenantId = useSessionStore((s) => s.activeTenantId);
  // Callers may build filters inline: TanStack hashes query keys structurally, so a new object
  // with the same values is the same query.
  const q = useTickets(getSupabaseClient(), tenantId, filters, COUNT_PAGE);
  const n = q.data?.rows.length ?? 0;
  return {
    count: n,
    label: q.isLoading ? '—' : `${n}${q.data?.nextCursor != null ? '+' : ''}`,
    rows: q.data?.rows ?? [],
    isLoading: q.isLoading,
    isRefetching: q.isRefetching,
    refetch: q.refetch,
  };
}

/** The branch's open till, if any. */
export function useOpenTill(branchId: string | undefined) {
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const sessions = useCashSessions(getSupabaseClient(), tenantId, branchId);
  return {
    open: (sessions.data ?? []).find((s) => s.status === 'open') ?? null,
    isLoading: sessions.isLoading,
    refetch: sessions.refetch,
  };
}
