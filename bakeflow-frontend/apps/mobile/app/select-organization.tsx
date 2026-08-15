import { getSupabaseClient, setActiveOrganization, signOut } from '@bakeflow/auth';
import { clearAllCache, useMyOrganizationRoles, useMyOrganizations } from '@bakeflow/hooks';
import type { OrganizationMembership } from '@bakeflow/types';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, LoadingState } from '../components/ScreenState';
import { useSessionStore } from '../stores/session';

/**
 * Organization picker and switcher.
 *
 * Reachable in two ways, and it behaves identically in both: as the forced step after
 * sign-in when the token carries no `tenant_id`, and as the switcher from the catalog
 * header. There is no "first run" variant — a second code path for the same decision is
 * how the two drift.
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
 * live policies and that role-based RLS is the authority; a client-side rule here would be
 * an authorization claim the database does not make.
 */
export default function SelectOrganizationScreen(): React.JSX.Element {
  const client = getSupabaseClient();
  const queryClient = useQueryClient();
  const userId = useSessionStore((s) => s.userId);
  const activeTenantId = useSessionStore((s) => s.activeTenantId);

  const organizations = useMyOrganizations(client, userId);
  const roles = useMyOrganizationRoles(client, userId);

  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);

  async function choose(tenantId: string): Promise<void> {
    if (switchingTo !== null) return;
    setSwitchingTo(tenantId);
    setSwitchError(null);
    try {
      // Writes profiles.active_tenant_id AND refreshes the token. The refresh fires
      // onAuthStateChange, which evicts organization-scoped cache entries before the new
      // claim reaches the store — see AppProviders. Nothing is evicted here, so there is
      // exactly one place that decision lives.
      await setActiveOrganization(tenantId);
    } catch (thrown) {
      setSwitchError(
        thrown instanceof Error ? thrown.message : 'Could not switch bakery.',
      );
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

  if (organizations.isPending) return <LoadingState label="Loading your bakeries…" />;

  if (organizations.isError) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <ErrorState error={organizations.error} onRetry={() => void organizations.refetch()} />
        <SignOutRow onPress={() => void onSignOut()} />
      </SafeAreaView>
    );
  }

  const rows = organizations.data;

  if (rows.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <EmptyState
          title="No bakeries yet"
          detail="Your account is not a member of any bakery. Ask an owner or admin to invite you."
        />
        <SignOutRow onPress={() => void onSignOut()} />
      </SafeAreaView>
    );
  }

  const roleFor = (tenantId: string): string | null =>
    roles.data?.find((r) => r.tenant_id === tenantId)?.role_name ?? null;

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="gap-1 p-6 pb-3">
        <Text className="text-2xl font-bold text-neutral-900">Choose a bakery</Text>
        <Text className="text-base text-neutral-500">
          {rows.length === 1 ? 'You belong to one bakery.' : `You belong to ${rows.length} bakeries.`}
        </Text>
      </View>

      {switchError !== null && (
        <Text accessibilityRole="alert" className="px-6 pb-2 text-base text-red-600">
          {switchError}
        </Text>
      )}

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        contentContainerClassName="px-6 pb-6 gap-3"
        renderItem={({ item }) => (
          <OrganizationRow
            organization={item}
            roleName={roleFor(item.id)}
            isActive={item.id === activeTenantId}
            isSwitching={switchingTo === item.id}
            disabled={switchingTo !== null}
            onPress={() => void choose(item.id)}
          />
        )}
      />

      <SignOutRow onPress={() => void onSignOut()} />
    </SafeAreaView>
  );
}

function OrganizationRow({
  organization,
  roleName,
  isActive,
  isSwitching,
  disabled,
  onPress,
}: {
  organization: OrganizationMembership;
  roleName: string | null;
  isActive: boolean;
  isSwitching: boolean;
  disabled: boolean;
  onPress: () => void;
}): React.JSX.Element {
  // A suspended organization is shown but not selectable. Hiding it would leave a user
  // whose bakery was suspended staring at an empty list with no explanation.
  const suspended = organization.status !== 'active';
  const selectable = !disabled && !suspended;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: isActive, disabled: !selectable }}
      disabled={!selectable}
      onPress={onPress}
      className={`flex-row items-center justify-between rounded-xl border p-4 ${
        isActive ? 'border-neutral-900 bg-neutral-50' : 'border-neutral-200'
      } ${selectable ? 'active:opacity-70' : 'opacity-50'}`}
    >
      <View className="flex-1 gap-1 pr-3">
        <Text className="text-lg font-semibold text-neutral-900">{organization.name}</Text>
        <Text className="text-sm text-neutral-500">
          {suspended ? `Suspended · ${organization.status}` : (roleName ?? organization.slug)}
        </Text>
      </View>
      {isSwitching ? (
        <ActivityIndicator />
      ) : isActive ? (
        <Text className="text-sm font-medium text-neutral-900">Active</Text>
      ) : null}
    </Pressable>
  );
}

function SignOutRow({ onPress }: { onPress: () => void }): React.JSX.Element {
  return (
    <View className="border-t border-neutral-200 p-6">
      <Pressable accessibilityRole="button" onPress={onPress} className="active:opacity-70">
        <Text className="text-center text-base font-medium text-red-600">Sign out</Text>
      </Pressable>
    </View>
  );
}
