import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cn } from './cn';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { skia } from './skia';
import { Text } from './Text';
import { fixed } from './tokens';

export interface TabItem {
  key: string;
  label: string;
  icon: IconName;
  /** Small apricot dot — the prototype marks Orders when something is pending. */
  badge?: boolean;
}

export interface TabBarProps {
  items: TabItem[];
  activeKey: string;
  onPress: (key: string) => void;
  /**
   * Driver layout: tabs float on a white pill with a raised centre action, because a
   * driver's whole job is logging a ticket.
   */
  fab?: { label: string; onPress: () => void };
}

function Tab({
  item,
  active,
  onPress,
}: {
  item: TabItem;
  active: boolean;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <PressableScale
      accessibilityRole="tab"
      accessibilityLabel={item.label}
      accessibilityState={{ selected: active }}
      aria-selected={active}
      onPress={onPress}
      scaleTo={0.93}
      className="min-h-tap flex-1 items-center justify-center gap-1 rounded-[14px]"
    >
      <View>
        <Icon name={item.icon} size={23} color={active ? 'textPrimary' : 'textSecondary'} />
        {item.badge === true && (
          <View className="absolute -right-1.5 -top-0.5 h-1.5 w-1.5 rounded-pill border-2 border-cream bg-apricot" />
        )}
      </View>
      <Text
        variant="caption"
        className={cn(
          'text-[10.5px]',
          active ? 'font-bold text-cocoa' : 'font-semibold text-warm-gray'
        )}
      >
        {item.label}
      </Text>
    </PressableScale>
  );
}

const FAB = 58;

/** The driver's raised action: apricot → apricot-deep at 160°, ringed in the cream ground. */
function Fab({ label, onPress }: { label: string; onPress: () => void }): React.JSX.Element {
  const { Canvas, Circle, LinearGradient, vec } = skia();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      scaleTo={0.95}
      className="absolute left-1/2 items-center justify-center rounded-pill"
      style={{
        top: -30,
        width: FAB + 12,
        height: FAB + 12,
        marginLeft: -(FAB + 12) / 2,
        boxShadow: '0 12px 22px -8px rgba(200, 112, 63, 0.55)',
      }}
    >
      <View className="absolute inset-0 rounded-pill bg-cream" />
      <Canvas style={{ position: 'absolute', width: FAB, height: FAB }}>
        <Circle cx={FAB / 2} cy={FAB / 2} r={FAB / 2}>
          <LinearGradient
            start={vec(FAB * 0.33, 0)}
            end={vec(FAB * 0.67, FAB)}
            colors={[fixed.apricot, fixed['apricot-deep']]}
          />
        </Circle>
      </Canvas>
      <Icon name="plus" size={26} color="onPrimary" strokeWidth={2.4} />
    </PressableScale>
  );
}

/**
 * Role-adaptive bottom navigation, drawn from the prototype's `.tabbar`.
 *
 * PORT-NOTE: the prototype's bar is translucent cream with an 18px backdrop blur. Without
 * expo-blur it is the cream ground at 96% opacity with the same top hairline.
 */
export function TabBar({ items, activeKey, onPress, fab }: TabBarProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(insets.bottom, 8);

  if (fab !== undefined) {
    const left = items.slice(0, Math.ceil(items.length / 2));
    const right = items.slice(Math.ceil(items.length / 2));
    return (
      <View className="bg-cream px-4" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        <View className="flex-row items-center rounded-pill bg-white px-1.5 py-2 shadow-e3">
          {left.map((it) => (
            <Tab key={it.key} item={it} active={it.key === activeKey} onPress={() => onPress(it.key)} />
          ))}
          <View className="flex-1" />
          {right.map((it) => (
            <Tab key={it.key} item={it} active={it.key === activeKey} onPress={() => onPress(it.key)} />
          ))}
          <Fab label={fab.label} onPress={fab.onPress} />
        </View>
      </View>
    );
  }

  return (
    <View
      className="flex-row border-t border-border bg-cream/95 px-1.5 pt-1.5"
      style={{ paddingBottom: bottom }}
    >
      {items.map((it) => (
        <Tab key={it.key} item={it} active={it.key === activeKey} onPress={() => onPress(it.key)} />
      ))}
    </View>
  );
}
