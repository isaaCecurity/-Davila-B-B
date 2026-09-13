import { Icon, IconButton, PressableScale, ScreenScroll, Text, type IconName } from '@bakeflow/ui';
import { useRouter, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown, ReduceMotion } from 'react-native-reanimated';

import { useActiveOrganization } from '../../organization/hooks/useActiveOrganization';
import { useSessionStore } from '../../../stores/session';

function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/**
 * The prototype's `homeHead()` over a scrolling body: who and where, with notifications one tap
 * away. Every role's home sits inside this.
 *
 * PORT-NOTE: the prototype's branch picker pill and sync chip are not ported — there is no
 * branch read to switch between (screens pick a branch in place), and offline sync is P10.
 * Search opens the cross-entity search screen.
 */
export function HomeScaffold({
  context,
  refreshing,
  onRefresh,
  children,
}: {
  context?: string;
  refreshing?: boolean;
  onRefresh?: () => void;
  children: ReactNode;
}): React.JSX.Element {
  const router = useRouter();
  const org = useActiveOrganization();
  const fullName = useSessionStore((s) => (s.session?.user.user_metadata?.['full_name'] as string | undefined) ?? '');
  const first = fullName.trim().split(/\s+/)[0] ?? '';

  return (
    <ScreenScroll
      title={first === '' ? greeting() : `${greeting()}, ${first}`}
      sub={[org?.name, context].filter(Boolean).join(' · ')}
      right={
        <View className="flex-row gap-1.5">
          <IconButton icon="search" label="Search" onPress={() => router.push('/search')} />
          <IconButton icon="bell" label="Notifications" tinted onPress={() => router.push('/alerts')} />
        </View>
      }
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      {children}
    </ScreenScroll>
  );
}

/**
 * The prototype's `.stat` tile. Tiles reveal in sequence on first render (`tab-in 420ms`,
 * 55ms apart) — here a Reanimated `FadeInDown` with the same stagger, collapsed under Reduce
 * Motion.
 */
export function StatTile({
  index,
  icon,
  label,
  value,
  sub,
  attention = false,
  href,
}: {
  index: number;
  icon: IconName;
  label: string;
  value: string;
  sub?: string;
  attention?: boolean;
  href?: Href;
}): React.JSX.Element {
  const router = useRouter();
  const body = (
    <>
      <View className="flex-row items-center gap-2">
        <View className={`h-7 w-7 items-center justify-center rounded-[9px] ${attention ? 'bg-warning-tint' : 'bg-cream-deep'}`}>
          <Icon name={icon} size={15} color={attention ? 'warning-ink' : 'cocoa'} />
        </View>
        <Text variant="meta" numberOfLines={1} className="flex-1">{label}</Text>
      </View>
      <Text tabular className="mt-3 text-title-2 font-bold tracking-[-0.5px] text-cocoa" numberOfLines={1}>{value}</Text>
      <Text variant="caption" numberOfLines={1} className={`mt-0.5 ${attention ? 'text-warning-ink' : ''}`}>{sub ?? ' '}</Text>
    </>
  );
  return (
    <Animated.View
      entering={FadeInDown.duration(420).delay(60 + index * 55).reduceMotion(ReduceMotion.System)}
      className="w-[48.5%]"
    >
      {href === undefined ? (
        <View className="rounded-md bg-white p-4 shadow-e2" accessible accessibilityLabel={`${label}, ${value}${sub === undefined ? '' : `, ${sub}`}`}>
          {body}
        </View>
      ) : (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${value}${sub === undefined ? '' : `, ${sub}`}`}
          onPress={() => router.push(href)}
          scaleTo={0.97}
          className={`rounded-md bg-white p-4 shadow-e2 ${attention ? 'border border-warning/40' : ''}`}
        >
          {body}
        </PressableScale>
      )}
    </Animated.View>
  );
}

export function TileGrid({ children }: { children: ReactNode }): React.JSX.Element {
  return <View className="flex-row flex-wrap justify-between gap-y-3">{children}</View>;
}

export interface QuickAction {
  label: string;
  icon: IconName;
  tone: 'ink' | 'accent' | 'ok' | 'plain';
  href: Href;
}

const QA_TONE: Record<QuickAction['tone'], { box: string; icon: 'white' | 'apricot-deep' | 'success' | 'cocoa' }> = {
  ink: { box: 'bg-ink', icon: 'white' },
  accent: { box: 'bg-apricot-tint', icon: 'apricot-deep' },
  ok: { box: 'bg-success-tint', icon: 'success' },
  plain: { box: 'bg-cream-deep', icon: 'cocoa' },
};

/** The prototype's `quickActions()` strip. */
export function QuickActions({ actions }: { actions: readonly QuickAction[] }): React.JSX.Element {
  const router = useRouter();
  return (
    <View className="mt-8">
      <Text variant="subtitle" accessibilityRole="header" className="mb-3">Quick actions</Text>
      <View className="flex-row gap-2.5">
        {actions.map((a) => (
          <PressableScale
            key={a.label}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            onPress={() => router.push(a.href)}
            scaleTo={0.95}
            className="flex-1 items-center gap-2 rounded-md bg-white px-2 py-3.5 shadow-e2"
          >
            <View className={`h-10 w-10 items-center justify-center rounded-[13px] ${QA_TONE[a.tone].box}`}>
              <Icon name={a.icon} size={17} color={QA_TONE[a.tone].icon} />
            </View>
            <Text className="text-center text-foot font-semibold text-cocoa" numberOfLines={1}>{a.label}</Text>
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

/** A section heading with an optional link on the right — the prototype's `.section-head`. */
export function SectionHead({ title, link }: { title: string; link?: { label: string; href: Href } }): React.JSX.Element {
  const router = useRouter();
  return (
    <View className="mb-3 mt-8 flex-row items-center">
      <Text variant="subtitle" accessibilityRole="header" className="flex-1">{title}</Text>
      {link !== undefined && (
        <PressableScale accessibilityRole="link" onPress={() => router.push(link.href)} className="min-h-tap justify-center px-1">
          <Text className="text-foot font-semibold text-apricot-deep">{link.label}</Text>
        </PressableScale>
      )}
    </View>
  );
}
