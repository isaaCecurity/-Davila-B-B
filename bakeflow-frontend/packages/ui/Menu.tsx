import { Children, isValidElement, type ReactNode } from 'react';
import { View } from 'react-native';

import { Icon, type IconName } from './Icon';
import { IconTile, type TileTone } from './IconTile';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

/** The prototype's `.group-label`: an uppercase eyebrow followed by a hairline. */
export function GroupLabel({ children }: { children: string }): React.JSX.Element {
  return (
    <View className="mb-3 mt-6 flex-row items-center gap-3" accessibilityRole="header">
      <Text className="text-caption font-bold uppercase tracking-[1.2px] text-warm-gray-soft">
        {children}
      </Text>
      <View className="h-px flex-1 bg-border" />
    </View>
  );
}

/**
 * A raised group of menu rows (`.menu`). Rows after the first get a hairline that starts
 * at the text, not the icon — the prototype's inset divider.
 */
export function Menu({ children }: { children: ReactNode }): React.JSX.Element {
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View className="overflow-hidden rounded-md bg-white shadow-e2">
      {rows.map((row, i) => (
        <View key={row.key ?? i}>
          {i > 0 && <View className="absolute left-[65px] right-0 top-0 z-10 h-px bg-border" />}
          {row}
        </View>
      ))}
    </View>
  );
}

export interface MenuItemProps {
  icon: IconName;
  title: string;
  sub?: string;
  tone?: TileTone;
  /** Short count or status on the right, before the chevron. */
  badge?: string;
  onPress: () => void;
}

/** One tappable row: tinted icon tile, title with optional sub-line, chevron. */
export function MenuItem({ icon, title, sub, tone, badge, onPress }: MenuItemProps): React.JSX.Element {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={sub !== undefined ? `${title}, ${sub}` : title}
      onPress={onPress}
      scaleTo={1}
      className="min-h-tap flex-row items-center gap-[13px] px-4 py-[13px] active:bg-cocoa/5"
    >
      <IconTile icon={icon} tone={tone} size="sm" />
      <View className="min-w-0 flex-1">
        <Text variant="body" className="font-semibold" numberOfLines={1}>
          {title}
        </Text>
        {sub !== undefined && (
          <Text variant="meta" numberOfLines={1}>
            {sub}
          </Text>
        )}
      </View>
      {badge !== undefined && (
        <Text variant="meta" className="font-semibold">
          {badge}
        </Text>
      )}
      <Icon name="chevRight" size={17} color="textMuted" />
    </PressableScale>
  );
}
