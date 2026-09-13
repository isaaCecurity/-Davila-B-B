import { getSupabaseClient } from '@bakeflow/auth';
import { useOrganizationInvites } from '@bakeflow/hooks';
import type { OrganizationInvite } from '@bakeflow/types';
import { Badge, Button, EmptyState, IconButton, IconTile, List, ListRow, ScreenScroll, Sheet, Skeleton, Text } from '@bakeflow/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { ErrorState, NoOrganizationState } from '../components/ScreenState';
import { useActivePersona } from '../features/auth/hooks/useActivePersona';
import { InviteStaffSheet } from '../features/staff/components/InviteStaffSheet';
import { inviteView } from '../features/staff/staffDisplay';
import { useSessionStore } from '../stores/session';

const stamp = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * Invites — the prototype's `invites` list: everyone invited, and where each invite stands.
 *
 * Owner/admin only by RLS (`organization_invites_select`); another role sees an explanation
 * rather than an empty list that looks like "nobody was invited".
 *
 * PORT-NOTE: the prototype's per-invite "Copy invite link", "Resend" and "Revoke" have no
 * backend: only a hash of the token is stored (the link cannot be shown again), and the client
 * holds no UPDATE grant on invites. "Send a new invite" opens the invite sheet instead.
 */
export default function InvitesScreen(): React.JSX.Element {
  const router = useRouter();
  const persona = useActivePersona();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const allowed = persona === 'owner' || persona === 'admin';
  const invites = useOrganizationInvites(getSupabaseClient(), tenantId, { enabled: allowed });
  const [inviting, setInviting] = useState(false);
  const [open, setOpen] = useState<OrganizationInvite | null>(null);
  const [shown, setShown] = useState<OrganizationInvite | null>(null);
  if (open !== null && open !== shown) setShown(open);

  if (tenantId === null) {
    return <NoOrganizationState onChoose={() => router.push('/select-organization')} />;
  }

  const rows = invites.data ?? [];
  const back = (): void => (router.canGoBack() ? router.back() : router.replace('/staff'));

  return (
    <View className="flex-1 bg-cream">
      <ScreenScroll
        title="Invites"
        sub={invites.isLoading || !allowed ? undefined : `${rows.length} total`}
        onBack={back}
        right={allowed ? <IconButton icon="plus" label="Invite staff" tinted onPress={() => setInviting(true)} /> : undefined}
        refreshing={invites.isRefetching}
        onRefresh={() => void invites.refetch()}
      >
        {!allowed ? (
          <EmptyState icon="lock" title="Owners and admins manage invites" text="Ask an owner or admin to invite someone to the bakery." />
        ) : invites.isLoading ? (
          <View className="mt-2 gap-2"><Skeleton variant="row" /><Skeleton variant="row" /></View>
        ) : invites.isError ? (
          <ErrorState error={invites.error} onRetry={() => void invites.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="mail"
            title="No invites sent yet"
            text="Tap + to invite someone to join the bakery."
            action={<Button label="Invite staff" onPress={() => setInviting(true)} />}
          />
        ) : (
          <View className="mt-2">
            <List>
              {rows.map((iv) => {
                const v = inviteView(iv);
                return (
                  <ListRow
                    key={iv.id}
                    leading={<IconTile icon={v.icon} tone={v.tile} size="sm" />}
                    title={iv.email}
                    sub={`${iv.role_name} · sent ${stamp.format(new Date(iv.created_at))}`}
                    trailing={<Badge label={v.label} tone={v.tone} />}
                    onPress={() => setOpen(iv)}
                  />
                );
              })}
            </List>
          </View>
        )}
      </ScreenScroll>

      <InviteStaffSheet visible={inviting} onClose={() => setInviting(false)} />

      <Sheet
        visible={open !== null}
        onClose={() => setOpen(null)}
        title={shown?.email ?? ''}
        foot={
          <View className="gap-2.5">
            {shown !== null && inviteView(shown).label !== 'Accepted' && (
              <Button
                label="Send a new invite"
                onPress={() => {
                  setOpen(null);
                  setInviting(true);
                }}
                block
              />
            )}
            <Button label="Close" tone="secondary" onPress={() => setOpen(null)} block />
          </View>
        }
      >
        {shown !== null && (
          <View className="gap-3">
            <View className="flex-row items-center gap-2">
              <Badge label={inviteView(shown).label} tone={inviteView(shown).tone} icon={inviteView(shown).icon} />
              <Text variant="meta">{shown.role_name}</Text>
            </View>
            <Text variant="meta">Sent {stamp.format(new Date(shown.created_at))}</Text>
            <Text variant="meta">
              {shown.accepted_at !== null
                ? `Accepted ${stamp.format(new Date(shown.accepted_at))}`
                : `${new Date(shown.expires_at) <= new Date() ? 'Expired' : 'Expires'} ${stamp.format(new Date(shown.expires_at))}`}
            </Text>
            <Text variant="caption">
              Invite links are shown only when they are created. To give someone a fresh link, send a new invite.
            </Text>
          </View>
        )}
      </Sheet>
    </View>
  );
}
