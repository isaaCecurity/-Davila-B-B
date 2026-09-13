import { BakeflowApiError } from '@bakeflow/api';
import { getSupabaseClient, setActiveOrganization } from '@bakeflow/auth';
import { clearOrganizationScopedCache, useAcceptInvite } from '@bakeflow/hooks';
import { Button, Callout, Card, ConfirmRing, EmptyState, Icon, ScreenScroll, Text } from '@bakeflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { usePendingInviteStore } from '../stores/auth/pendingInvite.store';
import { useSessionStore } from '../stores/session';

function describe(error: Error): string {
  const code = error instanceof BakeflowApiError ? error.code : 'unexpected_error';
  if (code === 'invalid_transition') {
    return 'This invite has already been used, was withdrawn, or has expired. Ask whoever invited you for a new one.';
  }
  if (code === 'invalid_request') return 'This link is incomplete. Open the invite link again, exactly as it was sent.';
  if (code === 'insufficient_role') return 'Sign in to the account the invite is for, then open the link again.';
  if (code === 'network_unavailable') return 'No connection. Nothing has changed — try again when you are online.';
  return 'The invite could not be accepted. Try again, or ask for a new invite.';
}

/**
 * Accept an invitation — the destination of `bakeflow://invite?token=…` (the link
 * `send-invite-email` builds).
 *
 * `accept_organization_invite()` adds the role and branch, then this screen switches to the
 * organization and refreshes the token (`setActiveOrganization`) so every read that follows sees
 * it. The navigation gate lets a signed-in user stay here with or without an organization, and
 * carries the token through sign-in when the link was opened signed out.
 *
 * PORT-NOTE: the prototype has no invitee screen (its invites are fictional); this one is new,
 * styled after its confirm panel.
 */
export default function AcceptInviteScreen(): React.JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ token?: string }>();
  const pending = usePendingInviteStore((s) => s.token);
  const clearPending = usePendingInviteStore((s) => s.clear);
  const email = useSessionStore((s) => s.session?.user.email ?? '');
  const accept = useAcceptInvite(getSupabaseClient());
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [joined, setJoined] = useState<{ org: string; role: string } | null>(null);

  const token = typeof params.token === 'string' && params.token !== '' ? params.token : pending;

  // The token has reached its screen; stop holding it, or the gate would keep returning here.
  useEffect(() => {
    if (pending !== null) clearPending();
  }, [pending, clearPending]);

  const leave = (): void => router.replace('/');

  function join(): void {
    if (token === null) return;
    setSwitchError(null);
    accept.mutate(
      { rawToken: token },
      {
        onSuccess: async (result) => {
          setSwitching(true);
          try {
            await setActiveOrganization(result.organizationId);
            // A different organization's cached rows must never render under the new claim.
            clearOrganizationScopedCache(queryClient);
            setJoined({ org: result.organizationName, role: result.roleName });
          } catch {
            setSwitchError(`You joined ${result.organizationName}, but switching to it did not finish. Choose it from your bakeries.`);
          } finally {
            setSwitching(false);
          }
        },
      }
    );
  }

  if (joined !== null) {
    return (
      <ScreenScroll title="Invitation">
        <View className="items-center pt-16">
          <ConfirmRing />
          <Text variant="title" className="mt-4 text-center">Welcome to {joined.org}</Text>
          <Text variant="meta" className="mt-1 text-center">You joined as {joined.role}.</Text>
          <Button className="mt-8 self-stretch" label="Open BakeFlow" onPress={leave} block />
        </View>
      </ScreenScroll>
    );
  }

  if (token === null) {
    return (
      <ScreenScroll title="Invitation" onBack={leave}>
        <EmptyState
          icon="mail"
          title="No invite in this link"
          text="Open the invite link from your email or message again, exactly as it was sent."
          action={<Button label="Go to BakeFlow" onPress={leave} />}
        />
      </ScreenScroll>
    );
  }

  return (
    <ScreenScroll title="Invitation" onBack={leave}>
      <Card tone="ink" className="mt-2 rounded-lg p-5">
        <View className="h-11 w-11 items-center justify-center rounded-[14px] bg-white/10">
          <Icon name="mail" size={21} color="white" />
        </View>
        <Text className="mt-4 text-title-1 font-bold tracking-[-0.6px] text-white">You have been invited</Text>
        <Text className="mt-1.5 text-foot text-white/60">
          Accepting adds this account{email === '' ? '' : ` (${email})`} to the bakery that invited you, with the role they chose.
        </Text>
      </Card>

      {accept.isError && <Callout className="mt-4" tone="error" title="Invite not accepted" detail={describe(accept.error)} />}
      {switchError !== null && (
        <Callout className="mt-4" tone="warning" title="Almost there" detail={switchError} />
      )}

      <View className="mt-6 gap-2.5">
        <Button label="Accept invitation" busy={accept.isPending || switching} onPress={join} block />
        <Button
          label={switchError !== null ? 'Choose a bakery' : 'Not now'}
          tone="secondary"
          onPress={() => (switchError !== null ? router.replace('/select-organization') : leave())}
          block
        />
      </View>
    </ScreenScroll>
  );
}
