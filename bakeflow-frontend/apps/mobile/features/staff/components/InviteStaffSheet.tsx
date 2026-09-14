import { BakeflowApiError, errorReason } from '@bakeflow/api';
import { getSupabaseClient } from '@bakeflow/auth';
import { useCreateAndSendInvite } from '@bakeflow/hooks';
import { Button, Callout, Chips, Field, Icon, Sheet, Text } from '@bakeflow/ui';
import { formatPhone, inviteEmailSchema, toE164Phone } from '@bakeflow/validation';
import { useState } from 'react';
import { Share, View } from 'react-native';

import { useSessionStore } from '../../../stores/session';
import { toast } from '../../../stores/ui/toast.store';
import { useActivePersona } from '../../auth/hooks/useActivePersona';
import { useBranchOptions } from '../../branch/hooks/useBranchOptions';
import { ORG_WIDE_ROLES, invitableRolesFor } from '../staffDisplay';

type Channel = 'email' | 'phone';

function describe(error: Error): string {
  const code = error instanceof BakeflowApiError ? error.code : 'unexpected_error';
  const reason = errorReason(error);
  if (reason === 'not_your_branch') return 'You can only invite people to a branch you manage.';
  if (reason === 'invalid_phone') return 'Enter the phone number in full, like 0803 123 4567 or +234 803 123 4567.';
  if (reason === 'invalid_email') return 'Enter an email like name@example.com.';
  if (reason === 'role_required') return 'Choose the role this person will have.';
  if (code === 'insufficient_role') return 'You cannot invite someone to this role. Owners invite any role; branch managers invite cashiers, bakers, drivers and supervisors.';
  if (code === 'duplicate_reference') return 'This person already has a pending invite. They can use that one, or wait for it to expire.';
  if (code === 'rate_limited') return 'Too many invites in a short time. Wait a minute and try again.';
  if (code === 'network_unavailable') return 'No connection. The invite was not sent.';
  if (code === 'invalid_transition') return 'Owner and admin invitations cover the whole bakery, not one branch.';
  return 'The invite was not sent. Check the details and try again.';
}

/**
 * Invite someone — the prototype's `inviteStaffSheet`: who to reach, the role, and (for branch
 * roles) where they work.
 *
 * AD-026: an invite is **by role** — the role is chosen explicitly, never defaulted — and goes to
 * an email **or** a phone number. Owners and admins invite from here as before; a branch manager
 * sees only the crew roles (cashier, baker, driver, supervisor) and their own branches. The RPC
 * decides; this sheet only avoids offering what it would refuse.
 *
 * Email: `send-invite-email` delivers the link (simulated while no provider is configured — AD-023,
 * in which case the link is offered to share). Phone: no SMS provider sends invites, so the link is
 * always shared by the inviter; the invitee accepts after signing in with that phone number.
 *
 * PORT-NOTE: the prototype's role list is "Counter Staff, Baker, Delivery, Supervisor, Branch
 * Manager"; these are the canonical roles, filtered by who is inviting.
 */
export function InviteStaffSheet({ visible, onClose }: { visible: boolean; onClose: () => void }): React.JSX.Element {
  const tenantId = useSessionStore((s) => s.activeTenantId);
  const persona = useActivePersona();
  const invite = useCreateAndSendInvite(getSupabaseClient(), tenantId);
  const branches = useBranchOptions();
  const roles = invitableRolesFor(persona);

  const [channel, setChannel] = useState<Channel>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [roleKey, setRoleKey] = useState('');
  const [branchIndex, setBranchIndex] = useState(0);
  const [link, setLink] = useState<{ to: string; channel: Channel; url: string } | null>(null);

  const trimmedEmail = email.trim();
  const validEmail = inviteEmailSchema.safeParse(trimmedEmail).success;
  const e164 = toE164Phone(phone);
  const contactOk = channel === 'email' ? validEmail : e164 !== null;
  const role = roles.find((r) => r.key === roleKey) ?? null;
  const orgWide = role !== null && ORG_WIDE_ROLES.has(role.key);
  const branch = orgWide ? null : (branches.options[branchIndex] ?? branches.options[0] ?? null);
  const canSend = contactOk && role !== null && (orgWide || branch !== null);

  function reset(): void {
    setEmail('');
    setPhone('');
    setRoleKey('');
    setBranchIndex(0);
  }

  function close(): void {
    invite.reset();
    setLink(null);
    onClose();
  }

  function send(): void {
    if (!canSend || role === null) return;
    const to = channel === 'email' ? trimmedEmail : (e164 ?? '');
    invite.mutate(
      {
        email: channel === 'email' ? trimmedEmail : null,
        phone: channel === 'phone' ? e164 : null,
        roleKey: role.key,
        branchId: branch?.branchId ?? null,
      },
      {
        onSuccess: (result) => {
          reset();
          const url = `bakeflow://invite?token=${encodeURIComponent(result.rawToken)}`;
          if (result.delivery === null || result.delivery.status === 'simulated') {
            setLink({ to: channel === 'phone' ? formatPhone(to) : to, channel, url });
            return;
          }
          toast({ tone: 'success', title: 'Invite sent', text: to });
          close();
        },
      }
    );
  }

  const shareTitle = link?.channel === 'phone' ? 'Send the invite' : 'Share the invite';

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={link === null ? 'Invite staff' : shareTitle}
      foot={
        link === null ? (
          <Button label="Send invite" busy={invite.isPending} disabled={!canSend} onPress={send} block />
        ) : (
          <View className="gap-2.5">
            <Button
              label={link.channel === 'phone' ? 'Send by WhatsApp or SMS' : 'Share link'}
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
          {link.channel === 'phone' ? (
            <Callout
              tone="info"
              title="Send this link yourself"
              detail={`Invites are not sent by SMS. Send ${link.to} this link by WhatsApp or SMS. It works once, for 7 days.`}
            />
          ) : (
            <Callout
              tone="warning"
              title="No email was sent"
              detail={`Email delivery is not set up yet, so send ${link.to} this link yourself. It works once, for 7 days.`}
            />
          )}
          <View className="flex-row items-center gap-2.5 rounded-md bg-cream-deep px-3.5 py-3">
            <Icon name="lock" size={15} color="textMuted" />
            <Text variant="caption" className="flex-1" selectable numberOfLines={3}>{link.url}</Text>
          </View>
          <Text variant="caption">
            {link.channel === 'phone'
              ? `The link only works for someone who signs in with the phone number ${link.to}.`
              : `The link only works for someone signed in as ${link.to}.`}{' '}
            Share it with them only.
          </Text>
        </View>
      ) : (
        <View className="gap-4">
          <View className="gap-2">
            <Text variant="label">Send to</Text>
            <Chips
              accessibilityLabel="Send invite to"
              options={[
                { key: 'email', label: 'Email' },
                { key: 'phone', label: 'Phone number' },
              ]}
              value={channel}
              onChange={(k) => setChannel(k)}
            />
          </View>
          {channel === 'email' ? (
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="name@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              error={trimmedEmail === '' || validEmail ? null : 'Enter an email like name@example.com'}
            />
          ) : (
            <Field
              label="Phone number"
              value={phone}
              onChangeText={setPhone}
              placeholder="0803 123 4567"
              keyboardType="phone-pad"
              autoComplete="tel"
              error={phone.trim() === '' || e164 !== null ? null : 'Enter the full number, like 0803 123 4567'}
              hint={e164 !== null ? `Invite goes to ${formatPhone(e164)}` : undefined}
            />
          )}
          <View className="gap-2">
            <Text variant="label">Role</Text>
            <Chips
              accessibilityLabel="Role"
              options={roles.map((r) => ({ key: r.key, label: r.label }))}
              value={roleKey}
              onChange={setRoleKey}
            />
            <Text variant="caption">{role?.hint ?? 'Choose the role this person will have.'}</Text>
          </View>
          {role !== null && !orgWide && branches.options.length > 0 && (
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
