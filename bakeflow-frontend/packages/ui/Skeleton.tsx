import { useEffect } from 'react';
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { cn } from './cn';
import { curve } from './motion';
import './interop';

export type SkeletonVariant = 'text' | 'title' | 'figure' | 'chart' | 'row';

const SHAPE: Record<SkeletonVariant, string> = {
  text: 'h-[13px] rounded-pill',
  title: 'h-[19px] rounded-pill',
  figure: 'h-[38px] rounded-[10px]',
  chart: 'h-[148px] rounded-md',
  row: 'h-[58px] rounded-md',
};

/**
 * A loading placeholder shaped like the content it stands in for — never a centred spinner
 * on a list (docs/DESIGN-TOKENS.md, still binding).
 *
 * PORT-NOTE: the prototype sweeps a cream-deep → white gradient across (1.25s, ease-out).
 * Without a gradient dependency this pulses the same surface's opacity on the same rhythm.
 * It holds still when the OS asks for reduced motion.
 */
export function Skeleton({
  variant = 'text',
  className,
}: {
  variant?: SkeletonVariant;
  className?: string;
}): React.JSX.Element {
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(0.55, { duration: 625, easing: curve('out'), reduceMotion: ReduceMotion.System }),
      -1,
      true,
      undefined,
      ReduceMotion.System
    );
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn('bg-cream-deep', SHAPE[variant], className)}
      style={style}
    />
  );
}
