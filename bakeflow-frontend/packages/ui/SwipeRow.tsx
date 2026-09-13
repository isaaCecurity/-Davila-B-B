import type { ReactNode } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { cn } from './cn';
import { Icon, type IconName } from './Icon';
import { timing } from './motion';
import { PressableScale } from './PressableScale';
import { Text } from './Text';
import './interop';

const ACTION_WIDTH = 82;
/** Past this much drag, releasing leaves the row open. */
const OPEN_THRESHOLD = 44;

export interface SwipeAction {
  label: string;
  icon: IconName;
  tone: 'advance' | 'cancel';
  onPress: () => void;
}

/**
 * The prototype's `.swipe` row: drag a card left to reveal an action behind it.
 *
 * The pan only claims horizontal movement (`activeOffsetX`, `failOffsetY`), so vertical
 * scrolling of the list stays with the list. A swipe is never the only way to an action —
 * the same action is on the detail screen, which keeps it reachable by tap and by screen
 * reader (Web Interface Guidelines: gestures need a non-gesture alternative).
 */
export function SwipeRow({
  action,
  children,
  enabled = true,
}: {
  action: SwipeAction;
  children: ReactNode;
  enabled?: boolean;
}): React.JSX.Element {
  const x = useSharedValue(0);

  const close = (): void => {
    x.value = withTiming(0, timing('base'));
  };

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onUpdate((e) => {
      const start = x.value < -OPEN_THRESHOLD ? -ACTION_WIDTH : 0;
      x.value = Math.max(-ACTION_WIDTH - 14, Math.min(0, start + e.translationX));
    })
    .onEnd(() => {
      x.value = withTiming(x.value < -OPEN_THRESHOLD ? -ACTION_WIDTH : 0, timing('base'));
    });

  const surface = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  if (!enabled) return <>{children}</>;

  return (
    <View className="overflow-hidden rounded-md">
      <View className="absolute inset-0 flex-row justify-end">
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={action.label}
          scaleTo={0.96}
          onPress={() => {
            close();
            scheduleOnRN(action.onPress);
          }}
          className={cn(
            'w-[82px] items-center justify-center gap-[5px]',
            action.tone === 'advance' ? 'bg-success' : 'bg-error'
          )}
        >
          <Icon name={action.icon} size={18} color="white" strokeWidth={2.2} />
          <Text className="text-[10.5px] font-semibold text-white">{action.label}</Text>
        </PressableScale>
      </View>
      <GestureDetector gesture={pan}>
        <Animated.View style={surface}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}
