import { getSupabaseClient } from '@bakeflow/auth';
import { useExpenses } from '@bakeflow/hooks';
import { EXPENSE_CATEGORIES, type Expense, type ExpenseCategory } from '@bakeflow/types';
import {
  Chips,
  EmptyState,
  GroupLabel,
  IconButton,
  IconTile,
  List,
  ListRow,
  ScreenScroll,
  Skeleton,
  Button,
} from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { ErrorState, NoOrganizationState } from '../../components/ScreenState';
import { useBranchOptions } from '../../features/branch/hooks/useBranchOptions';
import { CATEGORY_META, METHOD_LABEL, when } from '../../features/finance/financeDisplay';
import { useSessionStore } from '../../stores/session';

const dayKey = new Intl.DateTimeFormat('en-NG', { weekday: 'long', day: 'numeric', month: 'short' });

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return dayKey.format(d);
}

/**
 * Expenses — the prototype's `expenses` list: what was spent, grouped by day.
 *
 * PORT-NOTE: the prototype heads the screen with "Spent today", a month total, a category
 * breakdown bar and per-day subtotals. Each is a sum over money, which this app does not do on
 * the device, so rows show each expense's exact amount and the grouping stays; totals belong to
 * a server-side report. Receipt photos have a column but no upload flow yet.
 */
export default function ExpensesScreen(): React.JSX.Element {
  const router = useRouter();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const branches = useBranchOptions();
  const [branchIndex, setBranchIndex] = useState(0);
  const [category, setCategory] = useState<'all' | ExpenseCategory>('all');
  const branch = branches.options[branchIndex] ?? branches.options[0] ?? null;
  const expenses = useExpenses(getSupabaseClient(), tenantId, branch?.branchId);

  const groups = useMemo(() => {
    const rows = (expenses.data ?? [])
      .filter((e) => category === 'all' || e.category === category)
      // ISO timestamps sort correctly as strings — ordering by time, not by amount.
      .sort((a, b) => b.incurred_at.localeCompare(a.incurred_at));
    const map = new Map<string, Expense[]>();
    for (const e of rows) {
      const key = dayLabel(e.incurred_at);
      map.set(key, [...(map.get(key) ?? []), e]);
    }
    return [...map.entries()];
  }, [expenses.data, category]);

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const count = expenses.data?.length ?? 0;

  return (
    <ScreenScroll
      title="Expenses"
      sub={expenses.isLoading ? branch?.label : `${branch?.label ?? ''} · ${count} recorded`}
      onBack={() => router.back()}
      right={<IconButton icon="plus" label="Add expense" tinted onPress={() => router.push('/add-expense')} />}
      refreshing={expenses.isRefetching}
      onRefresh={() => void expenses.refetch()}
    >
      <View className="gap-3 pt-2">
        {branches.options.length > 1 && (
          <Chips
            accessibilityLabel="Branch"
            options={branches.options.map((b, i) => ({ key: String(i), label: b.label }))}
            value={String(branchIndex)}
            onChange={(k) => setBranchIndex(Number(k))}
          />
        )}
        <Chips
          accessibilityLabel="Category"
          options={[
            { key: 'all' as const, label: 'All' },
            ...EXPENSE_CATEGORIES.map((c) => ({ key: c, label: CATEGORY_META[c].label })),
          ]}
          value={category}
          onChange={setCategory}
        />
      </View>

      {expenses.isLoading || branches.isLoading ? (
        <View className="mt-5 gap-2">
          <Skeleton variant="row" />
          <Skeleton variant="row" />
        </View>
      ) : expenses.isError ? (
        <View className="mt-5">
          <ErrorState error={expenses.error} onRetry={() => void expenses.refetch()} />
        </View>
      ) : groups.length === 0 ? (
        <EmptyState
          icon="receipt"
          title={category === 'all' ? 'No expenses recorded' : `No ${CATEGORY_META[category].label.toLowerCase()} expenses`}
          text="Recording an expense takes about ten seconds, and everything you spend shapes your profit."
          action={<Button label="Add expense" onPress={() => router.push('/add-expense')} />}
        />
      ) : (
        groups.map(([label, rows]) => (
          <View key={label}>
            <GroupLabel>{label}</GroupLabel>
            <List>
              {rows.map((e) => (
                <ListRow
                  key={e.id}
                  leading={<IconTile icon={CATEGORY_META[e.category].icon} size="sm" />}
                  title={e.description ?? CATEGORY_META[e.category].label}
                  sub={[CATEGORY_META[e.category].label, e.paid_method === null ? null : METHOD_LABEL[e.paid_method], when(e.incurred_at)]
                    .filter(Boolean)
                    .join(' · ')}
                  end={formatNaira(e.amount)}
                />
              ))}
            </List>
          </View>
        ))
      )}
    </ScreenScroll>
  );
}
