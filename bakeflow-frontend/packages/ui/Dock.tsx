import type { ReactNode } from 'react';
import Animated, { ReduceMotion, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { curve } from './motion';
import { duration } from './tokens';
import './interop';

const DOCK_IN = SlideInDown.duration(duration.dockIn)
  .easing(curve('out'))
  .reduceMotion(ReduceMotion.System);

/**
 * The prototype's `.dock`: the action bar pinned to the bottom of a form or cart, rising in
 * from below (`dock-in` 340ms on the out curve) and clearing the home indicator.
 */
export function Dock({ children }: { children: ReactNode }): React.JSX.Element {
  const insets = useSafeAreaInsets();
  return (
    <Animated.View
      entering={DOCK_IN}
      className="absolute bottom-0 left-0 right-0 border-t border-border bg-white px-gutter pt-3 shadow-e4"
      style={{ paddingBottom: Math.max(insets.bottom, 16) }}
    >
      {children}
    </Animated.View>
  );
}
