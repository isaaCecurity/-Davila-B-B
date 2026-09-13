import { BakeflowApiError } from '@bakeflow/api';
import { getSupabaseClient } from '@bakeflow/auth';
import { useCreateAndSendInvite } from '@bakeflow/hooks';
import { Button, Callout, Chips, Field, Icon, Sheet, Text } from '@bakeflow/ui';
import { inviteEmailSchema } from '@bakeflow/validation';
import { useState } from 'react';
import { Share, View } from 'react-native';

import { useSessionStore } from '../../../stores/session';
import { toast } from '../../../stores/ui/toast.store';
import { useBranchOptions } from '../../branch/hooks/useBranchOptions';
import { INVITABLE_ROLES, ORG_WIDE_ROLES } from '../staffDisplay';

function describe(error: Error): string {
  const code = error instanceof BakeflowApiError ? error.code : 'unexpected_error';
  if (code === 'insufficient_role') return 'Only owners and admins can invite people, and only to roles below their own.';
  if (code === 'rate_limited') return 'Too many invites in a short time. Wait a minute and try again.';
  if (code === 'network_unavailable') return 'No connection. The invite was not sent.';
  if (code === 'invalid_transition') return 'Owner and admin invitations cover the whole bakery, not one branch.';
  return 'The invite was not sent. Check the details and try again.';
}

/**
 * Invite someone — the prototype's `inviteStaffSheet`: email, role, and (for branch roles) where
 * they work.
 *
 * `create_organization_invite()` mints the link and `send-invite-email` delivers it. While no
 * email provider is configured (AD-023) delivery comes back `simulated`, and this sheet then says
 * so and offers the link to share directly, rather than claiming an email went out.
 *
 * PORT-NOTE: the prototype's role list is "Counter Staff, Baker, Delivery, Supervisor, Branch
 * Manager"; these are the canonical roles. Which of them the inviter may grant is the database's
 * decision (`can_manage_target_role`), shown as returned.
 */
export function InviteStaffSheet({ visible, onClose }: { visible: boolean; onClose: () => void }): React.JSX.Element {
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const invite = useCreateAndSendInvite(getSupabaseClient(), tenantId);
  const branches = useBranchOptions();
  const [email, setEmail] = useState('');
  const [roleKey, setRoleKey] = useState<string>('cashier');
  const [branchIndex, setBranchIndex] = useState(0);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);

  const trimmed = email.trim();
  const validEmail = inviteEmailSchema.safeParse(trimmed).success;
  const orgWide = ORG_WIDE_ROLES.has(roleKey);
  const branch = orgWide ? null : (branches.options[branchIndex] ?? branches.options[0] ?? null);

  function close(): void {
    invite.reset();
    setLink(null);
    onClose();
  }

  function send(): void {
    if (!validEmail) return;
    invite.mutate(
      { email: trimmed, roleKey, branchId: branch?.branchId ?? null },
      {
        onSuccess: (result) => {
          setEmail('');
          if (result.delivery.status === 'simulated') {
            setLink({ email: trimmed, url: `bakeflow://invite?token=${encodeURIComponent(result.rawToken)}` });
            return;
          }
          toast({ tone: 'success', title: 'Invite sent', text: trimmed });
          close();
        },
      }
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={link === null ? 'Invite staff' : 'Share the invite'}
      foot={
        link === null ? (
          <Button label="Send invite" busy={invite.isPending} disabled={!validEmail || (!orgWide && branch === null)} onPress={send} block />
        ) : (
          <View className="gap-2.5">
            <Button
              label="Share link"
              onPress={() => void Share.share({ message: `You're invited to BakeFlow. Open this link on your phone to join: ${link.url}` })}
              block
            />
            <Button label="Done" tone="secondary" onPress={close} block />
          </View>
        )
      }
    >
      {link !== null ? (
        <View className="gap-4">
          <Callout
            tone="warning"
            title="No email was sent"
            detail={`Email delivery is not set up yet, so send ${link.email} this link yourself. It works once, for 7 days.`}
          />
          <View className="flex-row items-center gap-2.5 rounded-md bg-cream-deep px-3.5 py-3">
            <Icon name="lock" size={15} color="textMuted" />
            <Text variant="caption" className="flex-1" selectable numberOfLines={3}>{link.url}</Text>
          </View>
          <Text variant="caption">Anyone with this link can join with this role — share it only with them.</Text>
        </View>
      ) : (
        <View className="gap-4">
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="name@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            error={trimmed === '' || validEmail ? null : 'Enter an email like name@example.com'}
          />
          <View className="gap-2">
            <Text variant="label">Role</Text>
            <Chips
              accessibilityLabel="Role"
              options={INVITABLE_ROLES.map((r) => ({ key: r.key, label: r.label }))}
              value={roleKey}
              onChange={setRoleKey}
            />
            <Text variant="caption">{INVITABLE_ROLES.find((r) => r.key === roleKey)?.hint ?? ''}</Text>
          </View>
          {!orgWide && branches.options.length > 0 && (
            <View className="gap-2">
              <Text variant="label">Works at</Text>
              <Chips
                accessibilityLabel="Branch"
                options={branches.options.map((b, i) => ({ key: String(i), label: b.label }))}
                value={String(branchIndex)}
                onChange={(k) => setBranchIndex(Number(k))}
              />
            </View>
          )}
          {invite.isError && <Callout tone="error" title="Invite not sent" detail={describe(invite.error)} />}
        </View>
      )}
    </Sheet>
  );
}
