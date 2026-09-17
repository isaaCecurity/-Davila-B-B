import { signOut } from '@bakeflow/auth';
import { Avatar, Card, GroupLabel, Icon, Menu, MenuItem, ScreenScroll, Text } from '@bakeflow/ui';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { useActivePersona } from '../../features/auth/hooks/useActivePersona';
import { useDisplayName } from '../../features/auth/hooks/useDisplayName';
import { unregisterCurrentPushToken } from '../../features/notifications/PushBridge';
import { useActiveOrganization } from '../../features/organization/hooks/useActiveOrganization';
import { PERSONA_LABEL } from '../../navigation/tabs';
import { toast } from '../../stores/ui/toast.store';

/**
 * The More tab — the prototype's `more` screen: who you are, then everything that does not
 * earn a place in the tab bar, grouped by what it is for.
 *
 * Which groups appear follows the prototype's role logic. That is presentation only:
 * hiding "Expenses" from a cashier removes a dead end, and RLS still decides what the
 * screen could show if reached some other way.
 *
 * PORT-NOTE: the prototype's rows carry live counts ("12 items · 2 low on stock"). Rows
 * link only to routes that exist. My activity is covered by My sales / Tickets; Profit & Loss is
 * out of MVP scope (AD-022); row counts need aggregates and are not shown. The prototype-only "Design system" and "States gallery" rows are not ported.
 */
export default function MoreScreen(): React.JSX.Element {
  const router = useRouter();
  const persona = useActivePersona();
  const org = useActiveOrganization();
  const { name: displayName, contact, photo } = useDisplayName();
  const isOwner = persona === 'owner';
  const isManager = persona === 'manager';
  const isDriver = persona === 'driver';
  const canManageStaff = isOwner || isManager;
  const canSeeMoney = isOwner || isManager || persona === 'cashier';

  async function onSignOut(): Promise<void> {
    try {
      await unregisterCurrentPushToken();
      await signOut();
    } catch (e) {
      toast({
        tone: 'error',
        title: 'Could not sign out',
        text: e instanceof Error ? e.message : 'Check your connection and try again.',
      });
    }
  }

  return (
    <ScreenScroll title="More">
      <Card accessibilityLabel={`${displayName}, ${PERSONA_LABEL[persona]}`}>
        <View className="flex-row items-center gap-[13px]">
          <Avatar name={displayName} uri={photo} size="lg" />
          <View className="min-w-0 flex-1">
            <Text variant="subtitle" numberOfLines={1}>
              {displayName}
            </Text>
            <Text variant="meta" numberOfLines={1}>
              {PERSONA_LABEL[persona]}
              {org !== undefined ? ` · ${org.name}` : ''}
            </Text>
          </View>
        </View>
      </Card>

      <GroupLabel>Operations</GroupLabel>
      <Menu>
        {!isDriver && (
          <MenuItem icon="box" tone="accent" title="Products" onPress={() => router.push('/products')} />
        )}
        <MenuItem icon="users" title="Customers" onPress={() => router.push('/customers')} />
        {!isDriver && (
          <MenuItem icon="layers" title="Stock" onPress={() => router.push('/inventory')} />
        )}
        {(isOwner || isManager) && (
          <MenuItem icon="flame" title="Production" onPress={() => router.push('/production')} />
        )}
        {!isDriver && (
          <MenuItem icon="truck" title="Deliveries" onPress={() => router.push('/delivery')} />
        )}
        {canManageStaff && (
          <MenuItem icon="user" title="Staff & activity" sub="Team and invites" onPress={() => router.push('/staff')} />
        )}
        {!isDriver && (
          <MenuItem icon="truck" title="Driver trips" sub="Verify loads, reconcile, settle" onPress={() => router.push('/trips')} />
        )}
        {isDriver && (
          <MenuItem icon="truck" title="My trip" onPress={() => router.push('/trip')} />
        )}
      </Menu>

      {isDriver && (
        <>
          <GroupLabel>You</GroupLabel>
          <Menu>
            <MenuItem icon="bell" title="Alerts" onPress={() => router.push('/alerts')} />
          </Menu>
        </>
      )}

      {canSeeMoney && (
        <>
          <GroupLabel>Money</GroupLabel>
          <Menu>
            <MenuItem icon="cash" tone="warn" title="Cash sessions" onPress={() => router.push('/cash')} />
            {(isOwner || isManager) && (
              <MenuItem icon="receipt" title="Expenses" onPress={() => router.push('/expenses')} />
            )}
            <MenuItem icon="chart" title="Reports" onPress={() => router.push('/reports')} />
          </Menu>
        </>
      )}

      <GroupLabel>Bakery</GroupLabel>
      <Menu>
        {!isDriver && (
          <MenuItem
            icon="store"
            title="Organisation"
            sub={org?.name}
            onPress={() => router.push('/select-organization')}
          />
        )}
        <MenuItem icon="settings" title="Settings" sub="Appearance, account and more" onPress={() => router.push('/settings')} />
        {(isOwner || persona === 'admin') && (
          <MenuItem icon="history" title="Audit log" onPress={() => router.push('/audit')} />
        )}
        <MenuItem icon="logout" tone="bad" title="Sign out" onPress={() => void onSignOut()} />
      </Menu>

      <View className="mt-4 flex-row items-center gap-2 px-0.5">
        <Icon name="shield" size={14} color="textMuted" />
        <Text variant="caption">BakeFlow · signed in as {contact}</Text>
      </View>
    </ScreenScroll>
  );
}
