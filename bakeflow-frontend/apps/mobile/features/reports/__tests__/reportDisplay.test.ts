/// <reference types="jest" />
import type { Money } from '@bakeflow/types';

import { dayLabel } from '../hooks/useRevenueWeek';
import { rangeLabel, revenueChartPoints } from '../reportDisplay';

function days(n: number, start = '2026-09-01'): { date: string; net_revenue: Money }[] {
  const base = new Date(`${start}T00:00:00Z`).getTime();
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
    net_revenue: `${i * 100}.0000` as Money,
  }));
}

describe('dayLabel', () => {
  it('reads the server date as a calendar day, whatever the device zone', () => {
    expect(dayLabel('2026-09-14')).toBe('Mon');
    expect(dayLabel('2026-09-14', 'dayMonth')).toBe('14 Sept');
  });
});

describe('revenueChartPoints', () => {
  it('labels every day of a week by weekday', () => {
    const pts = revenueChartPoints(days(7, '2026-09-08'));
    expect(pts.map((p) => p.label)).toEqual(['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon']);
    expect(pts[6]?.value).toBe(600);
  });

  it('labels about five points of a long range, always the last', () => {
    const pts = revenueChartPoints(days(30));
    const labelled = pts.filter((p) => p.label !== '');
    expect(labelled.length).toBeGreaterThanOrEqual(4);
    expect(labelled.length).toBeLessThanOrEqual(6);
    expect(pts[29]?.label).not.toBe('');
    expect(pts).toHaveLength(30);
  });
});

describe('rangeLabel', () => {
  it('names a range and a single day', () => {
    expect(rangeLabel('2026-09-01', '2026-09-14')).toBe('1 Sept – 14 Sept');
    expect(rangeLabel('2026-09-14', '2026-09-14')).toBe('14 Sept');
  });
});
