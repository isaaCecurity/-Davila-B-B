import { getSupabaseClient, setActiveOrganization, signOut } from '@bakeflow/auth';
import { clearAllCache, useMyOrganizationRoles, useMyOrganizations } from '@bakeflow/hooks';
import type { OrganizationMembership } from '@bakeflow/types';
import {
  Avatar,
  Callout,
  Card,
  EmptyState,
  GroupLabel,
  Icon,
  IconButton,
  Menu,
  MenuItem,
  PressableScale,
  ScreenScroll,
  Skeleton,
  Text,
} from '@bakeflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { ErrorState } from '../components/ScreenState';
import { useSessionStore } from '../stores/session';
import { toast } from '../stores/ui/toast.store';

/**
 * Organization picker and switcher.
 *
 * Reachable in two ways, and it behaves identically in both: as the forced step after
 * sign-in when the token carries no `tenant_id`, and as the switcher from More. There is no
 * "first run" variant — a second code path for the same decision is how the two drift.
 *
 * ## Why this screen can load at all
 *
 * Every other screen is empty without a tenant claim. This one is not, because
 * `organizations_select` resolves against `auth.uid()` rather than `current_tenant_id()`.
 * That asymmetry is the only reason the app is not deadlocked on first sign-in.
 *
 * ## The role label is a label
 *
 * `role_name` is shown next to each bakery so a user with several knows which hat they
 * wear where. It gates nothing. AD-016 records that `has_permission()` gates zero of the
 * live policies and that role-based RLS is the authority.
 *
 * Styled as the prototype's `org` screen: the current bakery first, then the others, then the
 * account.
 *
 * PORT-NOTE: the prototype's per-bakery "today" revenue needs another organization's figures,
 * which the current token cannot read; its branch chips switch nothing server-side (each screen
 * picks its branch in place); "Join another bakery with an invite code" is the invite link
 * (`/invite`).
 */
export default function SelectOrganizationScreen(): React.JSX.Element {
  const router = useRouter();
  const client = getSupabaseClient();
  const queryClient = useQueryClient();
  const userId = useSessionStore((s) => s.userId);
  const activeTenantId = useSessionStore((s) => s.activeTenantId);
  const email = useSessionStore((s) => s.session?.user.email ?? '');

  const organizations = useMyOrganizations(client, userId);
  const roles = useMyOrganizationRoles(client, userId);

  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  async function choose(org: OrganizationMembership): Promise<void> {
    if (switchingTo !== null) return;
    setSwitchingTo(org.id);
    setSwitchError(null);
    try {
      // Writes profiles.active_tenant_id AND refreshes the token. The refresh fires
      // onAuthStateChange, which evicts organization-scoped cache entries before the new
      // claim reaches the store — see AppProviders. Nothing is evicted here, so there is
      // exactly one place that decision lives.
      await setActiveOrganization(org.id);
      toast({ tone: 'success', title: `Now in ${org.name}` });
      router.replace('/');
    } catch {
      setSwitchError('Could not switch bakery. Check your connection and try again.');
    } finally {
      setSwitchingTo(null);
    }
  }

  async function onSignOut(): Promise<void> {
    await signOut();
    // Everything, not just organization-scoped: the next user on this device must not
    // inherit the previous user's organization list either.
    clearAllCache(queryClient);
  }

  const rows = organizations.data ?? [];
  const current = rows.find((o) => o.id === activeTenantId) ?? null;
  const others = rows.filter((o) => o.id !== activeTenantId);
  const roleFor = (tenantId: string): string | null => roles.data?.find((r) => r.tenant_id === tenantId)?.role_name ?? null;

  return (
    <ScreenScroll
      title="Bakeries"
      sub={organizations.isLoading ? undefined : rows.length === 1 ? 'You belong to one bakery' : `You belong to ${rows.length} bakeries`}
      right={activeTenantId !== null && router.canGoBack() ? <IconButton icon="close" label="Close" onPress={() => router.back()} /> : undefined}
    >
      {organizations.isLoading ? (
        <View className="mt-2 gap-3">
          <Skeleton variant="row" className="h-[96px]" />
          <Skeleton variant="row" />
        </View>
      ) : organizations.isError ? (
        <ErrorState error={organizations.error} onRetry={() => void organizations.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="store"
          title="No bakeries yet"
          text="Your account is not a member of any bakery. Ask an owner or admin to send you an invite link."
        />
      ) : (
        <>
          {switchError !== null && <Callout className="mt-2" tone="error" title="Not switched" detail={switchError} />}

          {current !== null && (
            <Card className="mt-2 p-5">
              <Text className="text-caption font-semibold uppercase tracking-[1.2px] text-warm-gray-soft">Current bakery</Text>
              <View className="mt-3 flex-row items-center gap-3">
                <Avatar name={current.name} size="lg" />
                <View className="min-w-0 flex-1">
                  <Text variant="subtitle" numberOfLines={1}>{current.name}</Text>
                  <Text variant="meta">{roleFor(current.id) ?? current.slug}</Text>
                </View>
                <View className="h-6 w-6 items-center justify-center rounded-full bg-ink">
                  <Icon name="check" size={12} color="white" strokeWidth={2.6} />
                </View>
              </View>
            </Card>
          )}

          {others.length > 0 && (
            <>
              <GroupLabel>{current === null ? 'Choose a bakery' : 'Switch bakery'}</GroupLabel>
              <Card className="gap-0 p-0">
                {others.map((org, i) => (
                  <OrganizationRow
                    key={org.id}
                    organization={org}
                    roleName={roleFor(org.id)}
                    first={i === 0}
                    isSwitching={switchingTo === org.id}
                    disabled={switchingTo !== null}
                    onPress={() => void choose(org)}
                  />
                ))}
              </Card>
              <Text variant="caption" className="mt-3 px-0.5">Switching bakery changes your context only. Nothing is signed out.</Text>
            </>
          )}
        </>
      )}

      <GroupLabel>Account</GroupLabel>
      <Menu>
        {activeTenantId !== null && <MenuItem icon="user" title={email} sub="Account and settings" onPress={() => router.push('/settings')} />}
        <MenuItem icon="logout" tone="bad" title="Sign out" onPress={() => void onSignOut()} />
      </Menu>
    </ScreenScroll>
  );
}

function OrganizationRow({
  organization,
  roleName,
  first,
  isSwitching,
  disabled,
  onPress,
}: {
  organization: OrganizationMembership;
  roleName: string | null;
  first: boolean;
  isSwitching: boolean;
  disabled: boolean;
  onPress: () => void;
}): React.JSX.Element {
  // A suspended organization is shown but not selectable. Hiding it would leave a user
  // whose bakery was suspended staring at an empty list with no explanation.
  const suspended = organization.status !== 'active';
  const selectable = !disabled && !suspended;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ disabled: !selectable }}
      disabled={!selectable}
      onPress={onPress}
      scaleTo={0.98}
      className={`min-h-tap flex-row items-center gap-3 px-4 py-3.5 ${first ? '' : 'border-t border-border'} ${selectable ? '' : 'opacity-50'}`}
    >
      <Avatar name={organization.name} />
      <View className="min-w-0 flex-1">
        <Text className="text-callout font-semibold text-cocoa" numberOfLines={1}>{organization.name}</Text>
        <Text variant="meta" numberOfLines={1}>{suspended ? `Suspended · ${organization.status}` : (roleName ?? organization.slug)}</Text>
      </View>
      {isSwitching ? <ActivityIndicator /> : <Icon name="chevRight" size={17} color="textMuted" />}
    </PressableScale>
  );
}
