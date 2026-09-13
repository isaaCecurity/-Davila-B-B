import { cssInterop } from 'nativewind';
import { Pressable, type PressableProps } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { timing } from './motion';
import { motion } from './tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
/* Register explicitly so className resolves on the animated wrapper on every platform,
   rather than relying on NativeWind's automatic interop reaching a Reanimated component. */
cssInterop(AnimatedPressable, { className: 'style' });

export interface PressableScaleProps extends PressableProps {
  /** Scale while pressed. The prototype uses .985 on cards and .93 on tab buttons. */
  scaleTo?: number;
  className?: string;
}

/**
 * The prototype's tactile press: `:active { transform: scale(.985) }`.
 *
 * Runs on the UI thread, so the squash lands on the frame the finger touches down even when
 * the JS thread is busy rendering the next screen.
 */
export function PressableScale({
  scaleTo = motion.pressScale,
  onPressIn,
  onPressOut,
  style,
  ...rest
}: PressableScaleProps): React.JSX.Element {
  const scale = useSharedValue(1);
  const pressed = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...rest}
      style={[pressed, style as object]}
      onPressIn={(e) => {
        scale.value = withTiming(scaleTo, timing('fast'));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withTiming(1, timing('base'));
        onPressOut?.(e);
      }}
    />
  );
}
