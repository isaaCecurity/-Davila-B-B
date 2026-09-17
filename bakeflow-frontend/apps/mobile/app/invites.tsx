import { BakeflowApiError } from '@bakeflow/api';
import { getSupabaseClient } from '@bakeflow/auth';
import { useOrganizationInvites, useResendInvite, useRevokeInvite } from '@bakeflow/hooks';
import type { OrganizationInvite } from '@bakeflow/types';
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Icon,
  IconButton,
  IconTile,
  List,
  ListRow,
  Menu,
  MenuItem,
  ScreenScroll,
  Sheet,
  Skeleton,
  Text,
} from '@bakeflow/ui';
import { formatPhone } from '@bakeflow/validation';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Share, View } from 'react-native';

import { ErrorState, NoOrganizationState } from '../components/ScreenState';
import { useActivePersona } from '../features/auth/hooks/useActivePersona';
import { InviteStaffSheet } from '../features/staff/components/InviteStaffSheet';
import { canInvite, inviteRecipient, inviteView } from '../features/staff/staffDisplay';
import { useSessionStore } from '../stores/session';
import { toast } from '../stores/ui/toast.store';

const stamp = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/** Revoke and resend apply to invites that are still open: pending or expired (P9.9 Q7). */
function actionable(invite: OrganizationInvite): boolean {
  return invite.status === 'pending' || invite.status === 'expired';
}

function describeAction(error: Error): string {
  const code = error instanceof BakeflowApiError ? error.code : 'unexpected_error';
  if (code === 'insufficient_role') return 'You can only manage invites you could send: branch managers handle crew invites for their own branch.';
  if (code === 'invalid_transition') return 'This invite was already accepted or revoked. Pull down to refresh the list.';
  if (code === 'duplicate_reference') return 'This person already has another pending invite. Use or revoke that one first.';
  if (code === 'rate_limited') return 'Too many invites in a short time. Wait a minute and try again.';
  if (code === 'network_unavailable') return 'No connection. Nothing was changed.';
  return 'Something went wrong. Nothing was changed; try again.';
}

/**
 * Invites — the prototype's `invites` list: everyone invited, and where each invite stands.
 *
 * Owner/admin see every invite; a branch manager sees invites for the branches they manage
 * (`organization_invites_select`, AD-026). Another role sees an explanation rather than an empty
 * list that looks like "nobody was invited". Each invite is addressed to an email or a phone.
 *
 * Tapping an invite opens the prototype's `inviteActionsSheet`: Resend (for pending and expired
 * invites) and Revoke, through `resend_organization_invite()` and
 * `revoke_organization_invite()` (P9.9 Q7). Resending mints a new link — an email invite is emailed
 * again, a phone invite (or an email while delivery is simulated) shows the link to share.
 *
 * PORT-NOTE: "Copy invite link" is omitted — only a hash of each link is stored, so an existing link
 * cannot be shown again; Resend gives a fresh one. Revoke asks for confirmation first (it is audited
 * and cannot be undone — the app's rule for such actions), and a revoked invite stays in the list
 * marked Revoked instead of disappearing, because invites are never deleted.
 */
export default function InvitesScreen(): React.JSX.Element {
  const router = useRouter();
  const persona = useActivePersona();
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const allowed = canInvite(persona);
  const invites = useOrganizationInvites(getSupabaseClient(), tenantId, { enabled: allowed });
  const [inviting, setInviting] = useState(false);
  const [open, setOpen] = useState<OrganizationInvite | null>(null);
  const [shown, setShown] = useState<OrganizationInvite | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [link, setLink] = useState<{ to: string; url: string; phone: boolean } | null>(null);
  const revoke = useRevokeInvite(getSupabaseClient(), tenantId);
  const resend = useResendInvite(getSupabaseClient(), tenantId);
  if (open !== null && open !== shown) setShown(open);

  function closeSheet(): void {
    setOpen(null);
    setConfirming(false);
    setLink(null);
    revoke.reset();
    resend.reset();
  }

  function revokeShown(invite: OrganizationInvite): void {
    revoke.mutate(
      { inviteId: invite.id },
      {
        onSuccess: () => {
          toast({ tone: 'neutral', title: 'Invite revoked', text: inviteRecipient(invite) });
          closeSheet();
        },
      }
    );
  }

  function resendShown(invite: OrganizationInvite): void {
    if (resend.isPending) return;
    resend.mutate(
      { inviteId: invite.id },
      {
        onSuccess: (result) => {
          const url = `bakeflow://invite?token=${encodeURIComponent(result.rawToken)}`;
          if (result.delivery === null || result.delivery.status === 'simulated') {
            setLink({
              to: result.phone !== null ? formatPhone(result.phone) : (result.email ?? inviteRecipient(invite)),
              url,
              phone: result.phone !== null,
            });
            return;
          }
          toast({ tone: 'success', title: 'Invite resent', text: inviteRecipient(invite) });
          closeSheet();
        },
      }
    );
  }

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
          <EmptyState icon="lock" title="Owners and managers send invites" text="Ask an owner or your branch manager to invite someone to the bakery." />
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
                    title={inviteRecipient(iv)}
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
        onClose={closeSheet}
        title={shown === null ? '' : link !== null ? 'Share the new link' : confirming ? 'Revoke this invite?' : inviteRecipient(shown)}
        foot={
          shown === null ? undefined : link !== null ? (
            <View className="gap-2.5">
              <Button
                label={link.phone ? 'Send by WhatsApp or SMS' : 'Share link'}
                onPress={() => void Share.share({ message: `You're invited to BakeFlow. Open this link on your phone to join: ${link.url}` })}
                block
              />
              <Button label="Done" tone="secondary" onPress={closeSheet} block />
            </View>
          ) : confirming ? (
            <View className="gap-2.5">
              <Button label="Revoke invite" tone="danger" busy={revoke.isPending} onPress={() => revokeShown(shown)} block />
              <Button label="Keep invite" tone="secondary" disabled={revoke.isPending} onPress={() => setConfirming(false)} block />
            </View>
          ) : (
            <Button label="Close" tone="secondary" onPress={closeSheet} block />
          )
        }
      >
        {shown !== null && link !== null ? (
          <View className="gap-4">
            <Callout
              tone={link.phone ? 'info' : 'warning'}
              title={link.phone ? 'Send this link yourself' : 'No email was sent'}
              detail={`${link.phone ? 'Invites are not sent by SMS.' : 'Email delivery is not set up yet.'} Send ${link.to} this new link. It works once, for 7 days; the old link no longer works.`}
            />
            <View className="flex-row items-center gap-2.5 rounded-md bg-cream-deep px-3.5 py-3">
              <Icon name="lock" size={15} color="textMuted" />
              <Text variant="caption" className="flex-1" selectable numberOfLines={3}>{link.url}</Text>
            </View>
          </View>
        ) : shown !== null && confirming ? (
          <View className="gap-3">
            <Text variant="body">
              The link sent to {inviteRecipient(shown)} stops working straight away. This cannot be undone — to invite them again, send a new invite.
            </Text>
            {revoke.isError && <Callout tone="error" title="Invite not revoked" detail={describeAction(revoke.error)} />}
          </View>
        ) : shown !== null ? (
          <View className="gap-4">
            <Text variant="meta">
              {shown.role_name} · sent {stamp.format(new Date(shown.created_at))} ·{' '}
              <Text variant="meta" className="font-semibold text-cocoa">{inviteView(shown).label.toLowerCase()}</Text>
            </Text>
            {actionable(shown) ? (
              <>
                <Menu>
                  <MenuItem icon="history" title="Resend invite" onPress={() => resendShown(shown)} />
                </Menu>
                {resend.isPending && <Text variant="caption">Making a new link…</Text>}
                {resend.isError && <Callout tone="error" title="Invite not resent" detail={describeAction(resend.error)} />}
                <Button label="Revoke invite" tone="danger" disabled={resend.isPending} onPress={() => setConfirming(true)} block />
              </>
            ) : (
              <Text variant="caption">
                {shown.accepted_at !== null
                  ? `Accepted ${stamp.format(new Date(shown.accepted_at))}.`
                  : 'This invite was revoked. To invite them again, send a new invite.'}
              </Text>
            )}
          </View>
        ) : null}
      </Sheet>
    </View>
  );
}
