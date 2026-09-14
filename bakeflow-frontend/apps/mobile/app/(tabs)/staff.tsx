import { getSupabaseClient } from '@bakeflow/auth';
import { useOrganizationInvites, useStaffRoles, useWarehouses } from '@bakeflow/hooks';
import type { StaffRole } from '@bakeflow/types';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  GroupLabel,
  IconButton,
  List,
  ListRow,
  MenuItem,
  Menu,
  ScreenScroll,
  SearchBar,
  Sheet,
  Skeleton,
  Text,
} from '@bakeflow/ui';
import { formatPhone } from '@bakeflow/validation';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, View } from 'react-native';

import { ErrorState, NoOrganizationState } from '../../components/ScreenState';
import { useActivePersona } from '../../features/auth/hooks/useActivePersona';
import { InviteStaffSheet } from '../../features/staff/components/InviteStaffSheet';
import { canInvite, inviteView } from '../../features/staff/staffDisplay';
import { useOffBarBack } from '../../navigation/useOffBarBack';
import { useSessionStore } from '../../stores/session';

interface Person {
  profileId: string;
  name: string;
  phone: string | null;
  suspended: boolean;
  roles: StaffRole[];
  rank: number;
}

const joined = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Staff & activity — the prototype's `staff` screen: who works here, in which role and branch,
 * and a way to invite more.
 *
 * The directory is `user_roles` joined to profiles and roles. RLS shows owners, admins and branch
 * managers everyone, and anyone else only themselves — a supervisor opening this tab sees the
 * list the database allows, with a note when it is just them.
 *
 * PORT-NOTE: on-shift status, per-person sales and orders today, the "Today's activity"
 * timeline and "Sales by staff" need shift records and per-staff aggregates that have no read
 * endpoint (and money sums the device does not do) — not ported. The per-person permissions
 * list is read-only "set by role" in the prototype; it is replaced by the roles the person
 * actually holds. Invite is offered to owners, admins and branch managers — the callers
 * `create_organization_invite()` accepts (AD-026; advisory, the RPC decides).
 */
export default function StaffScreen(): React.JSX.Element {
  const router = useRouter();
  const onBack = useOffBarBack('staff');
  const client = getSupabaseClient();
  const persona = useActivePersona();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const userId = useSessionStore((s) => s.userId);
  const myEmail = useSessionStore((s) => s.session?.user.email ?? '');
  const mayInvite = canInvite(persona);

  const staff = useStaffRoles(client, tenantId);
  const invites = useOrganizationInvites(client, tenantId, { enabled: mayInvite });
  const warehouses = useWarehouses(client, tenantId);
  const [query, setQuery] = useState('');
  const [inviting, setInviting] = useState(false);
  const [open, setOpen] = useState<Person | null>(null);
  const [shown, setShown] = useState<Person | null>(null);
  if (open !== null && open !== shown) setShown(open);

  // Branches are named by their first stockroom, as everywhere else (no branch read yet).
  const branchName = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of warehouses.data ?? []) if (!map.has(w.branch_id)) map.set(w.branch_id, w.name);
    return map;
  }, [warehouses.data]);

  const people = useMemo<Person[]>(() => {
    const by = new Map<string, Person>();
    for (const r of staff.data ?? []) {
      const p = by.get(r.profile_id) ?? {
        profileId: r.profile_id,
        // An unnamed profile (e.g. a phone sign-up, AD-026) is shown by its phone, or by email when it
        // is your own; others' emails are not readable.
        name:
          r.full_name !== ''
            ? r.full_name
            : r.phone !== null && r.phone !== ''
              ? formatPhone(r.phone)
              : r.profile_id === userId && myEmail !== ''
                ? myEmail
                : 'Unnamed',
        phone: r.phone,
        suspended: r.status === 'suspended',
        roles: [],
        rank: r.role_rank,
      };
      p.roles.push(r);
      p.rank = Math.min(p.rank, r.role_rank);
      by.set(r.profile_id, p);
    }
    return [...by.values()].sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  }, [staff.data, userId, myEmail]);

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const q = query.trim().toLowerCase();
  const rows = q === '' ? people : people.filter((p) => `${p.name} ${p.roles.map((r) => r.role_name).join(' ')}`.toLowerCase().includes(q));
  // A role held twice (organization-wide and at a branch, say) reads once per distinct place.
  const roleLine = (p: Person): string =>
    [...new Set(p.roles.map((r) => (r.branch_id === null ? r.role_name : `${r.role_name} · ${branchName.get(r.branch_id) ?? 'branch'}`)))].join(', ');
  const pending = (invites.data ?? []).filter((i) => inviteView(i).label === 'Pending').length;
  const onlyMe = people.length === 1 && people[0]?.profileId === userId;

  return (
    <View className="flex-1 bg-cream">
      <ScreenScroll
        title="Staff & activity"
        sub={staff.isLoading ? undefined : `${people.length} ${people.length === 1 ? 'person' : 'people'}`}
        onBack={onBack}
        right={mayInvite ? <IconButton icon="plus" label="Invite staff" tinted onPress={() => setInviting(true)} /> : undefined}
        refreshing={staff.isRefetching || invites.isRefetching}
        onRefresh={() => {
          void staff.refetch();
          if (mayInvite) void invites.refetch();
        }}
      >
        <View className="mt-2">
          <SearchBar value={query} onChangeText={setQuery} placeholder="Find staff by name or role" />
        </View>

        <GroupLabel>Team</GroupLabel>
        {staff.isLoading ? (
          <View className="gap-2"><Skeleton variant="row" /><Skeleton variant="row" /><Skeleton variant="row" /></View>
        ) : staff.isError ? (
          <ErrorState error={staff.error} onRetry={() => void staff.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState icon="users" title={q === '' ? 'No staff yet' : 'Nobody matches'} text={q === '' ? 'Invite your team to get started.' : 'Try a name or a role.'} />
        ) : (
          <List>
            {rows.map((p) => (
              <ListRow
                key={p.profileId}
                leading={<Avatar name={p.name} />}
                title={p.profileId === userId ? `${p.name} (you)` : p.name}
                sub={roleLine(p)}
                trailing={p.suspended ? <Badge label="Suspended" tone="bad" icon="alert" /> : undefined}
                onPress={() => setOpen(p)}
              />
            ))}
          </List>
        )}
        {onlyMe && !mayInvite && (
          <Text variant="caption" className="mt-3">Your role shows your own record here; managers see the whole team.</Text>
        )}

        {mayInvite && (
          <>
            <GroupLabel>Invitations</GroupLabel>
            <Menu>
              <MenuItem
                icon="mail"
                title="Invites"
                sub={invites.isLoading ? 'Loading…' : `${pending} pending · ${(invites.data ?? []).length} total`}
                onPress={() => router.push('/invites')}
              />
            </Menu>
          </>
        )}
        <View className="h-10" />
      </ScreenScroll>

      <InviteStaffSheet visible={inviting} onClose={() => setInviting(false)} />

      <Sheet
        visible={open !== null}
        onClose={() => setOpen(null)}
        title={shown?.name ?? ''}
        foot={<Button label="Done" onPress={() => setOpen(null)} block />}
      >
        {shown !== null && (
          <View className="gap-4">
            <View className="flex-row items-center gap-3">
              <Avatar name={shown.name} size="lg" />
              <View className="min-w-0 flex-1">
                <Text variant="subtitle">{shown.roles[0]?.role_name ?? ''}</Text>
                <Text variant="meta">{shown.suspended ? 'Suspended' : 'Active'}{shown.phone === null ? '' : ` · ${shown.phone}`}</Text>
              </View>
            </View>
            <View>
              <Text variant="label" className="mb-2">Roles</Text>
              <List>
                {shown.roles.map((r) => (
                  <ListRow
                    key={r.user_role_id}
                    title={r.role_name}
                    sub={`${r.branch_id === null ? 'Whole bakery' : (branchName.get(r.branch_id) ?? 'Branch')} · since ${joined.format(new Date(r.created_at))}`}
                    chevron={false}
                  />
                ))}
              </List>
            </View>
            <Text variant="caption">Permissions follow each role. Per-person overrides are not supported yet.</Text>
            {shown.phone !== null && (
              <Button label={`Call ${shown.name.split(' ')[0] ?? ''}`} tone="secondary" onPress={() => void Linking.openURL(`tel:${shown.phone ?? ''}`)} block />
            )}
          </View>
        )}
      </Sheet>
    </View>
  );
}
