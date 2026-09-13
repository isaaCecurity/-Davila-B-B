import { getSupabaseClient } from '@bakeflow/auth';
import { useAuditEvents, useStaffRoles } from '@bakeflow/hooks';
import { EmptyState, IconTile, List, ListRow, ScreenScroll, Skeleton, Text, type IconName } from '@bakeflow/ui';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { ErrorState, NoOrganizationState } from '../components/ScreenState';
import { useActivePersona } from '../features/auth/hooks/useActivePersona';
import { useSessionStore } from '../stores/session';

const stamp = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const ENTITY_ICON: Record<string, IconName> = {
  ticket: 'receipt',
  tickets: 'receipt',
  payment: 'cash',
  payments: 'cash',
  cash_session: 'cash',
  cash_sessions: 'cash',
  expense: 'receipt',
  expenses: 'receipt',
  stock_movement: 'layers',
  stock_movements: 'layers',
  delivery: 'truck',
  deliveries: 'truck',
  driver_trip: 'truck',
  driver_trips: 'truck',
  organization_invite: 'mail',
  user_roles: 'users',
};

/** "cash_session" + "status_change" → "Cash session · status change". Words only, no guessing. */
function describe(entity: string, action: string): string {
  const words = (s: string): string => s.replace(/_/g, ' ');
  const e = words(entity.replace(/s$/, ''));
  return `${e.charAt(0).toUpperCase()}${e.slice(1)} · ${words(action)}`;
}

/**
 * Audit log — the prototype's owner `audit`: the accountability record of who changed what.
 *
 * Read-only, newest first, from `audit_log` (owner/admin/accountant by RLS). Actor names come
 * from the staff directory the same roles can read.
 *
 * PORT-NOTE: the prototype writes a sentence per event ("Corrected production entry · Meat Pie
 * 96 → 94"). Live entries carry `before`/`after` JSON snapshots of any table, which are not read
 * here (they can include money as JSON numbers); rows show the record type, the action and the
 * actor. A per-event detail view with a safe snapshot diff is a later step.
 */
export default function AuditScreen(): React.JSX.Element {
  const router = useRouter();
  const persona = useActivePersona();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const userId = useSessionStore((s) => s.userId);
  const allowed = persona === 'owner' || persona === 'admin';
  const client = getSupabaseClient();
  const events = useAuditEvents(client, tenantId, { enabled: allowed });
  const staff = useStaffRoles(client, allowed ? tenantId : null);
  const names = useMemo(() => new Map((staff.data ?? []).map((r) => [r.profile_id, r.full_name])), [staff.data]);

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const rows = events.data ?? [];
  return (
    <ScreenScroll
      title="Audit log"
      sub={allowed && !events.isLoading ? `${rows.length} recent action${rows.length === 1 ? '' : 's'}` : undefined}
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}
      refreshing={events.isRefetching}
      onRefresh={() => void events.refetch()}
    >
      {!allowed ? (
        <EmptyState icon="shield" title="Owner only" text="This record is visible to the bakery owner and admins." />
      ) : events.isLoading ? (
        <View className="mt-2 gap-2"><Skeleton variant="row" /><Skeleton variant="row" /><Skeleton variant="row" /></View>
      ) : events.isError ? (
        <ErrorState error={events.error} onRetry={() => void events.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon="history" title="Nothing recorded yet" text="Changes to orders, payments, stock, cash and staff appear here." />
      ) : (
        <View className="mt-2">
          <List>
            {rows.map((a) => (
              <ListRow
                key={a.id}
                leading={<IconTile icon={ENTITY_ICON[a.entity_type] ?? 'history'} size="sm" />}
                title={describe(a.entity_type, a.action)}
                sub={`${a.actor_id === null ? 'System' : a.actor_id === userId ? 'You' : names.get(a.actor_id) || 'Staff member'} · ${stamp.format(new Date(a.occurred_at))}`}
                chevron={false}
              />
            ))}
          </List>
          <Text variant="caption" className="mt-4 text-center">Orders, payments, stock, cash and staff changes across every role.</Text>
        </View>
      )}
    </ScreenScroll>
  );
}
