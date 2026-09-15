import { getSupabaseClient } from '@bakeflow/auth';
import { useRevenueReport } from '@bakeflow/hooks';
import type { DailyRevenueSummary, ReportPeriod, RevenueReport } from '@bakeflow/types';
import { useMemo } from 'react';

import { useSessionStore } from '../../../stores/session';

const weekday = new Intl.DateTimeFormat('en-NG', { weekday: 'short', timeZone: 'UTC' });
const dayMonth = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** A server `YYYY-MM-DD` as a calendar label. Read as UTC so the device's zone never shifts the day. */
export function dayLabel(date: string, style: 'weekday' | 'dayMonth' = 'weekday'): string {
  const d = new Date(`${date}T00:00:00Z`);
  return (style === 'weekday' ? weekday : dayMonth).format(d);
}

export interface RevenueDay {
  date: string;
  label: string;
  /** The day in `get_daily_revenue_summary()`'s shape — the ranged report's row for that day. */
  summary: DailyRevenueSummary | undefined;
}

function toSummary(report: RevenueReport, index: number): DailyRevenueSummary | undefined {
  const day = report.days[index];
  if (day === undefined) return undefined;
  return {
    branch_id: report.branch_id,
    reporting_date: day.date,
    timezone: report.timezone,
    gross_revenue: day.gross_revenue,
    recognized_refunds: day.recognized_refunds,
    net_revenue: day.net_revenue,
    gross_collected: day.gross_collected,
    refunds_paid: day.refunds_paid,
    net_collected: day.net_collected,
  };
}

/**
 * Revenue by day for one branch over a period, oldest first — one `get_revenue_report()` request.
 *
 * Previously seven `get_daily_revenue_summary()` calls whose dates came from the device's calendar;
 * the ranged report resolves the days in the organization's timezone (REPORTING-MODEL.md §13) and
 * each row equals that day's daily summary, so screens keep the same shape. `today` is the last day
 * of the period (every period used here ends today).
 */
export function useRevenueWeek(branchId: string | null, period: ReportPeriod = '7d') {
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const { data, isLoading, isError, error, refetch, isRefetching } = useRevenueReport(client, tenantId, branchId, period);

  return useMemo(() => {
    const days: RevenueDay[] =
      data === undefined
        ? []
        : data.days.map((d, i) => ({ date: d.date, label: dayLabel(d.date), summary: toSummary(data, i) }));
    const last = data === undefined ? undefined : toSummary(data, data.days.length - 1);
    return {
      report: data,
      days,
      today: { data: last },
      isLoading,
      isError,
      error,
      refetch: () => void refetch(),
      isRefetching,
    };
  }, [data, isLoading, isError, error, isRefetching, refetch]);
}
