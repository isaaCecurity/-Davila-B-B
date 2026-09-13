import type { ReactNode } from 'react';
import { View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';
import './interop';

export interface AppBarProps {
  title: string;
  sub?: string;
  /** Renders the back chevron when provided. */
  onBack?: () => void;
  right?: ReactNode;
  /**
   * Scroll offset of the screen body. When given, the bar picks up its "stuck" hairline as
   * content scrolls beneath it — the prototype's `.appbar.is-stuck`.
   */
  scrollY?: SharedValue<number>;
}

/** The prototype's 44px round icon button: presses to .9. */
export function IconButton({
  icon,
  label,
  onPress,
  tinted = false,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  onPress: () => void;
  tinted?: boolean;
}): React.JSX.Element {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      scaleTo={0.9}
      className={`h-tap w-tap items-center justify-center rounded-pill ${
        tinted ? 'bg-white shadow-e1' : 'active:bg-cocoa/10'
      }`}
    >
      <Icon name={icon} size={21} />
    </PressableScale>
  );
}

/**
 * Screen header: optional back, title with sub-line, right-hand actions.
 *
 * PORT-NOTE: the prototype's stuck state is a translucent bar with backdrop blur. Blur needs
 * expo-blur, which is not a dependency, so the stuck state is the cream ground at full
 * opacity plus the same hairline and soft drop — the separation reads the same.
 */
export function AppBar({ title, sub, onBack, right, scrollY }: AppBarProps): React.JSX.Element {
  const insets = useSafeAreaInsets();

  const stuck = useAnimatedStyle(() => {
    const t = scrollY === undefined ? 0 : interpolate(scrollY.value, [0, 12], [0, 1], 'clamp');
    return { opacity: t };
  });

  return (
    <View className="z-20 bg-cream" style={{ paddingTop: insets.top + 4 }}>
      <View className="flex-row items-center gap-3 px-gutter pb-2.5">
        {onBack !== undefined && <IconButton icon="chevLeft" label="Back" onPress={onBack} />}
        <View className="min-w-0 flex-1">
          <Text
            variant="subtitle"
            numberOfLines={1}
            accessibilityRole="header"
            style={{ letterSpacing: -0.3 }}
          >
            {title}
          </Text>
          {sub !== undefined && (
            <Text variant="meta" numberOfLines={1}>
              {sub}
            </Text>
          )}
        </View>
        {right}
      </View>
      <Animated.View
        pointerEvents="none"
        className="absolute bottom-0 left-0 right-0 h-px bg-border"
        style={stuck}
      />
    </View>
  );
}
