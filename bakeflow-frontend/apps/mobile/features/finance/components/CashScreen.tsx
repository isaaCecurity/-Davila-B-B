import { getSupabaseClient } from '@bakeflow/auth';
import { useCashSessions, useExpenses } from '@bakeflow/hooks';
import type { CashSession } from '@bakeflow/types';
import {
  Badge,
  Button,
  Card,
  Chips,
  EmptyState,
  IconTile,
  List,
  ListRow,
  ScreenScroll,
  Skeleton,
  Text,
} from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { ErrorState, NoOrganizationState } from '../../../components/ScreenState';
import { useSessionStore } from '../../../stores/session';
import { useBranchOptions } from '../../branch/hooks/useBranchOptions';
import { varianceView, when } from '../financeDisplay';
import { useOffBarBack } from '../../../navigation/useOffBarBack';
import { OpenSessionSheet } from './CashSessionSheets';
import { CashSessionPanel } from './CashSessionPanel';

/**
 * The prototype's `cash` (manager) and `my-cash` (cashier) screens: the till that is open now,
 * and the sessions before it.
 *
 * `mine` narrows to sessions this person opened. That is a presentation filter for the
 * cashier's own view — which sessions a user may read or close is decided by RLS.
 */
export function CashScreen({ mine }: { mine: boolean }): React.JSX.Element {
  const router = useRouter();
  const onBack = useOffBarBack(mine ? 'my-cash' : 'cash');
  const client = getSupabaseClient();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const userId = useSessionStore((s) => s.userId);
  const branches = useBranchOptions();
  const [branchIndex, setBranchIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const branch = branches.options[branchIndex] ?? branches.options[0] ?? null;

  const sessions = useCashSessions(client, tenantId, branch?.branchId);
  const expenses = useExpenses(client, tenantId, branch?.branchId);

  const visible = useMemo(() => {
    const rows = (sessions.data ?? []).filter((s) => !mine || s.opened_by === userId);
    // ISO-8601 timestamps order correctly as strings; this sorts by time, not by money.
    return [...rows].sort((a, b) => b.opened_at.localeCompare(a.opened_at));
  }, [sessions.data, mine, userId]);

  const openSession = visible.find((s) => s.status === 'open') ?? null;
  const history = visible.filter((s) => s.status === 'closed');
  const shown: CashSession | null = visible.find((s) => s.id === selectedId) ?? openSession;

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  return (
    <ScreenScroll
      title={mine ? 'My cash' : 'Cash session'}
      onBack={onBack}
      sub={branch?.label}
      refreshing={sessions.isRefetching || expenses.isRefetching}
      onRefresh={() => {
        void sessions.refetch();
        void expenses.refetch();
      }}
      right={openSession !== null ? <Badge label="Open" tone="live" icon="clock" /> : undefined}
    >
      {branches.options.length > 1 && (
        <Chips
          className="mt-2"
          accessibilityLabel="Branch"
          options={branches.options.map((b, i) => ({ key: String(i), label: b.label }))}
          value={String(branchIndex)}
          onChange={(k) => {
            setBranchIndex(Number(k));
            setSelectedId(null);
          }}
        />
      )}

      <View className="mt-5">
        {branches.isLoading || sessions.isLoading ? (
          <View className="gap-3">
            <Skeleton variant="row" className="h-[220px]" />
            <Skeleton variant="row" />
          </View>
        ) : branch === null ? (
          <EmptyState icon="store" title="No branch available" text="A branch needs a stockroom before it can run a till." />
        ) : sessions.isError ? (
          <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />
        ) : shown === null ? (
          <EmptyState
            icon="cash"
            title={mine ? 'You have no open till' : `No open till at ${branch.label}`}
            text="Open a cash session with the float already in the drawer before taking cash."
            action={<Button label="Open session" onPress={() => setOpening(true)} />}
          />
        ) : (
          <>
            {shown.status === 'closed' && openSession === null && (
              <Card tone="recessed" className="mb-3 flex-row items-center gap-3 p-3">
                <Text variant="meta" className="flex-1">No till is open right now.</Text>
                <Button label="Open session" tone="secondary" onPress={() => setOpening(true)} />
              </Card>
            )}
            <CashSessionPanel session={shown} expenses={expenses.data ?? []} />
          </>
        )}
      </View>

      {history.length > 0 && (
        <View className="mt-8 gap-3">
          <Text variant="subtitle" accessibilityRole="header">Earlier sessions</Text>
          <List>
            {history.slice(0, 20).map((s) => {
              const v = varianceView(s.variance_amount);
              return (
                <ListRow
                  key={s.id}
                  leading={<IconTile icon="cash" size="sm" tone={v === null ? 'neutral' : v.tile} />}
                  title={when(s.opened_at)}
                  sub={s.counted_amount === null ? 'No count recorded' : `Counted ${formatNaira(s.counted_amount)}`}
                  trailing={v !== null ? <Badge label={v.label === 'Balanced' ? 'Balanced' : `${v.label} ${v.amount}`} tone={v.tone} /> : undefined}
                  chevron={false}
                  onPress={() => setSelectedId(s.id)}
                />
              );
            })}
          </List>
        </View>
      )}

      {branch !== null && (
        <OpenSessionSheet
          branchId={branch.branchId}
          branchLabel={branch.label}
          visible={opening}
          onClose={() => setOpening(false)}
        />
      )}
    </ScreenScroll>
  );
}
