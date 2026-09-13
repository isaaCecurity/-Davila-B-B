import { getDailyRevenueSummary } from '@bakeflow/api';
import { getSupabaseClient } from '@bakeflow/auth';
import { queryKeys } from '@bakeflow/hooks';
import type { DailyRevenueSummary } from '@bakeflow/types';
import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useSessionStore } from '../../../stores/session';

const dayLabel = new Intl.DateTimeFormat('en-NG', { weekday: 'short' });

/** `YYYY-MM-DD` for the device's local calendar day `offset` days before today. */
function isoDay(offset: number): { date: string; label: string } {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { date, label: dayLabel.format(d) };
}

export interface RevenueDay {
  date: string;
  label: string;
  summary: DailyRevenueSummary | undefined;
}

/**
 * The last seven days of the server's daily revenue summary for one branch, oldest first.
 *
 * Each day is its own cached query under the same key `useDailyRevenueSummary` uses, so the
 * hero's "today" and the chart's last point are one request, not two. The server resolves
 * each date in the organization's own timezone.
 */
export function useRevenueWeek(branchId: string | null) {
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const days = useMemo(() => [6, 5, 4, 3, 2, 1, 0].map(isoDay), []);

  const results = useQueries({
    queries: days.map(({ date }, i) => ({
      // The last entry is "today": keyed exactly like `useDailyRevenueSummary(…, undefined)`.
      queryKey: queryKeys.dailyRevenueSummary(tenantId ?? 'none', branchId ?? 'none', i === 6 ? undefined : date),
      queryFn: () => {
        if (branchId === null) throw new Error('No branch selected for this report.');
        return getDailyRevenueSummary(client, branchId, i === 6 ? undefined : date);
      },
      enabled: tenantId !== null && branchId !== null,
    })),
  });

  return {
    days: days.map((d, i): RevenueDay => ({ ...d, summary: results[i]?.data })),
    today: results[6],
    isLoading: results.some((r) => r.isLoading),
    isError: results[6]?.isError === true,
    error: results[6]?.error ?? null,
    refetch: () => results.forEach((r) => void r.refetch()),
    isRefetching: results.some((r) => r.isRefetching),
  };
}
