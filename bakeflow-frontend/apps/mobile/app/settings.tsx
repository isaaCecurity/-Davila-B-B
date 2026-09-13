import { signOut } from '@bakeflow/auth';
import type { ThemePreference } from '@bakeflow/ui';
import { Avatar, Button, Card, GroupLabel, Icon, Menu, MenuItem, PressableScale, ScreenScroll, Sheet, Text } from '@bakeflow/ui';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { useActivePersona } from '../features/auth/hooks/useActivePersona';
import { useActiveOrganization } from '../features/organization/hooks/useActiveOrganization';
import { PERSONA_LABEL } from '../navigation/tabs';
import { useSessionStore } from '../stores/session';
import { useSettingsStore } from '../stores/settings/settings.store';
import { toast } from '../stores/ui/toast.store';

const THEME_LABEL: Record<ThemePreference, string> = { system: 'System default', light: 'Light', dark: 'Dark' };

/**
 * Settings — the prototype's `settings`: one screen whose sections change by role, not just a
 * shorter list.
 *
 * Every row goes somewhere real. Appearance is live (the persisted theme preference that drives
 * `ThemeProvider`).
 *
 * PORT-NOTE: the prototype's notification switches, sound & haptics, language, pricing tiers,
 * stock-adjustment rules, payment/delivery settings, the Supervisor-role toggle, sessions &
 * devices, change password, subscription and billing have no backend or preference store yet —
 * they are omitted rather than shown as switches that do nothing. Organization and branch setup
 * belong to the Web workspace (`ROLES-AND-PERMISSIONS.md`).
 */
export default function SettingsScreen(): React.JSX.Element {
  const router = useRouter();
  const persona = useActivePersona();
  const org = useActiveOrganization();
  const email = useSessionStore((s) => s.session?.user.email ?? '');
  const fullName = useSessionStore((s) => (s.session?.user.user_metadata?.['full_name'] as string | undefined) ?? '');
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const [picking, setPicking] = useState(false);

  const orgAdmin = persona === 'owner' || persona === 'manager' || persona === 'admin';
  const name = fullName !== '' ? fullName : email;
  const version = Constants.expoConfig?.version ?? '—';

  async function onSignOut(): Promise<void> {
    try {
      await signOut();
    } catch (e) {
      toast({ tone: 'error', title: 'Could not sign out', text: e instanceof Error ? e.message : 'Check your connection and try again.' });
    }
  }

  return (
    <View className="flex-1 bg-cream">
      <ScreenScroll title="Settings" onBack={() => (router.canGoBack() ? router.back() : router.replace('/more'))}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${name}, account details`}
          onPress={() => router.push('/account')}
          scaleTo={0.98}
          className="mt-2 flex-row items-center gap-[13px] rounded-md bg-white p-4 shadow-e2"
        >
          <Avatar name={name} size="lg" />
          <View className="min-w-0 flex-1">
            <Text variant="subtitle" numberOfLines={1}>{name}</Text>
            <Text variant="meta" numberOfLines={1}>{PERSONA_LABEL[persona]}{org === undefined ? '' : ` · ${org.name}`}</Text>
          </View>
          <Icon name="chevRight" size={17} color="textMuted" />
        </PressableScale>

        {orgAdmin ? (
          <>
            <GroupLabel>Staff & roles</GroupLabel>
            <Menu>
              <MenuItem icon="users" title="Staff & roles" sub="Team and who does what" onPress={() => router.push('/staff')} />
              {(persona === 'owner' || persona === 'admin') && (
                <MenuItem icon="mail" title="Invites" sub="Invite and track new staff" onPress={() => router.push('/invites')} />
              )}
            </Menu>
            <GroupLabel>Catalog & stock</GroupLabel>
            <Menu>
              <MenuItem icon="box" title="Products" onPress={() => router.push('/products')} />
              <MenuItem icon="layers" title="Stock" sub="Counts and adjustments" onPress={() => router.push('/inventory')} />
            </Menu>
          </>
        ) : (
          <>
            <GroupLabel>Work</GroupLabel>
            <Menu>
              {persona === 'cashier' && <MenuItem icon="bag" title="Orders" onPress={() => router.push('/orders')} />}
              {persona === 'cashier' && <MenuItem icon="users" title="Customers" onPress={() => router.push('/customers')} />}
              {persona === 'driver' && <MenuItem icon="truck" title="My trip" onPress={() => router.push('/trip')} />}
              {persona === 'baker' && <MenuItem icon="flame" title="Production" onPress={() => router.push('/production')} />}
              {persona === 'supervisor' && <MenuItem icon="layers" title="Operations" onPress={() => router.push('/operations')} />}
              <MenuItem icon="bell" title="Alerts" onPress={() => router.push('/alerts')} />
            </Menu>
          </>
        )}

        <GroupLabel>App</GroupLabel>
        <Menu>
          <MenuItem icon="settings" title="Appearance" sub={THEME_LABEL[theme]} onPress={() => setPicking(true)} />
        </Menu>

        {(persona === 'owner' || persona === 'admin') && (
          <>
            <GroupLabel>Security</GroupLabel>
            <Menu>
              <MenuItem icon="history" title="Audit log" sub="Who changed what" onPress={() => router.push('/audit')} />
            </Menu>
          </>
        )}

        <GroupLabel>Account</GroupLabel>
        <Menu>
          <MenuItem icon="store" title="Switch bakery" sub={org?.name} onPress={() => router.push('/select-organization')} />
          <MenuItem icon="info" title="About BakeFlow" sub={`Version ${version}`} onPress={() => toast({ tone: 'neutral', title: `BakeFlow ${version}`, text: 'Operations for independent bakeries' })} />
        </Menu>

        <Button className="mt-6" label="Sign out" tone="danger" onPress={() => void onSignOut()} block />
        <Text variant="caption" className="mt-4 text-center">BakeFlow · signed in as {email}</Text>
        <View className="h-8" />
      </ScreenScroll>

      <Sheet visible={picking} onClose={() => setPicking(false)} title="Appearance">
        <Card className="gap-0 p-0">
          {(['system', 'light', 'dark'] as const).map((k, i) => (
            <PressableScale
              key={k}
              accessibilityRole="radio"
              accessibilityState={{ selected: theme === k }}
              aria-selected={theme === k}
              onPress={() => {
                setTheme(k);
                setPicking(false);
              }}
              className={`min-h-tap flex-row items-center px-4 py-3.5 ${i > 0 ? 'border-t border-border' : ''}`}
            >
              <Text className="flex-1 text-callout font-medium text-cocoa">{THEME_LABEL[k]}</Text>
              {theme === k && <Icon name="check" size={17} color="cocoa" strokeWidth={2.4} />}
            </PressableScale>
          ))}
        </Card>
      </Sheet>
    </View>
  );
}
