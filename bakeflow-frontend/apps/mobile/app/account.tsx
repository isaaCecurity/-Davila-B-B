import { getSupabaseClient, rolesFromSession } from '@bakeflow/auth';
import { useStaffRoles, useWarehouses } from '@bakeflow/hooks';
import { Avatar, Card, GroupLabel, List, ListRow, ScreenScroll, Skeleton, Text } from '@bakeflow/ui';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { View } from 'react-native';

import { useActiveOrganization } from '../features/organization/hooks/useActiveOrganization';
import { useSessionStore } from '../stores/session';

/**
 * Account — the prototype's `account` / `profile`: who you are here, in which bakery, roles and
 * branches.
 *
 * Roles come from your own `user_roles` rows (always readable to you), branch names from the
 * stockrooms you can see.
 *
 * PORT-NOTE: "Edit name" and "Upload photo" need a profile update path and an upload flow that
 * are not built yet — not ported.
 */
export default function AccountScreen(): React.JSX.Element {
  const router = useRouter();
  const client = getSupabaseClient();
  const org = useActiveOrganization();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const session = useSessionStore((s) => s.session);
  const userId = useSessionStore((s) => s.userId);
  const email = session?.user.email ?? '';
  const fullName = (session?.user.user_metadata?.['full_name'] as string | undefined) ?? '';
  const roles = useStaffRoles(client, tenantId);
  const warehouses = useWarehouses(client, tenantId);

  const mine = useMemo(() => (roles.data ?? []).filter((r) => r.profile_id === userId), [roles.data, userId]);
  const branchName = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of warehouses.data ?? []) if (!map.has(w.branch_id)) map.set(w.branch_id, w.name);
    return map;
  }, [warehouses.data]);
  const tokenRoles = rolesFromSession(session);

  return (
    <ScreenScroll title="Account" onBack={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}>
      <Card className="mt-2 items-center px-4 py-6">
        <Avatar name={fullName !== '' ? fullName : email} size="lg" />
        <Text variant="title" className="mt-3 text-center">{fullName !== '' ? fullName : email}</Text>
        {fullName !== '' && <Text variant="meta" className="mt-0.5">{email}</Text>}
      </Card>

      <GroupLabel>Bakery</GroupLabel>
      <List>
        <ListRow title="Organization" sub={org?.name ?? 'None selected'} chevron={false} />
      </List>

      <GroupLabel>Roles</GroupLabel>
      {roles.isLoading ? (
        <Skeleton variant="row" />
      ) : mine.length === 0 ? (
        <Text variant="meta">{tokenRoles.length === 0 ? 'No roles in this bakery.' : tokenRoles.join(', ')}</Text>
      ) : (
        <List>
          {[...new Map(mine.map((r) => [`${r.role_key}:${r.branch_id ?? ''}`, r])).values()].map((r) => (
            <ListRow
              key={r.user_role_id}
              title={r.role_name}
              sub={r.branch_id === null ? 'Whole bakery' : (branchName.get(r.branch_id) ?? 'Branch')}
              chevron={false}
            />
          ))}
        </List>
      )}
      <View className="h-6" />
      <Text variant="caption">Roles decide what you can do. An owner or admin changes them.</Text>
    </ScreenScroll>
  );
}
