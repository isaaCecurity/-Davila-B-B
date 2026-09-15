import type { ReportPeriod, RevenueReportDay } from '@bakeflow/types';

import { dayLabel } from './hooks/useRevenueWeek';

/** How a period reads in a switch and in a sentence. */
export const PERIOD_LABEL: Record<ReportPeriod, { chip: string; phrase: string }> = {
  today: { chip: 'Today', phrase: 'today' },
  '7d': { chip: '7 days', phrase: 'last 7 days' },
  '30d': { chip: '30 days', phrase: 'last 30 days' },
  '90d': { chip: '90 days', phrase: 'last 90 days' },
  month: { chip: 'This month', phrase: 'this month so far' },
  last_month: { chip: 'Last month', phrase: 'last month' },
};

/**
 * Chart points for a run of days. The value is a plot coordinate only (see `TrendChart`); every
 * figure a person reads is formatted from the exact string elsewhere. Up to 7 days are labelled by
 * weekday; longer runs get about five evenly spaced "12 Sep" labels so they stay legible.
 */
export function revenueChartPoints(
  days: readonly Pick<RevenueReportDay, 'date' | 'net_revenue'>[],
): { value: number; label: string }[] {
  const n = days.length;
  const step = n <= 7 ? 1 : Math.ceil((n - 1) / 4);
  return days.map((d, i) => {
    let label = '';
    if (n <= 7) label = dayLabel(d.date);
    else if (i % step === 0 || i === n - 1) label = dayLabel(d.date, 'dayMonth');
    return { value: Number(d.net_revenue), label };
  });
}

/** `2026-09-01 … 2026-09-14` as "1 Sep – 14 Sep"; a single day as "14 Sep". */
export function rangeLabel(start: string, end: string): string {
  return start === end ? dayLabel(end, 'dayMonth') : `${dayLabel(start, 'dayMonth')} – ${dayLabel(end, 'dayMonth')}`;
}
