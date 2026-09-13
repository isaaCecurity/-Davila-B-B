import Animated, { Keyframe, ReduceMotion } from 'react-native-reanimated';

import { Icon } from './Icon';
import { duration, motion } from './tokens';
import './interop';

/** `@keyframes pop { 0% { scale(.6); opacity: 0 } 60% { scale(1.04) } 100% { scale(1) } }` */
const POP = new Keyframe({
  0: { opacity: 0, transform: [{ scale: motion.popFrom }] },
  60: { opacity: 1, transform: [{ scale: motion.popOvershoot }] },
  100: { opacity: 1, transform: [{ scale: 1 }] },
})
  .duration(duration.confirmPop)
  .reduceMotion(ReduceMotion.System);

/**
 * The prototype's `.confirm-panel .cp-ring`: the success tick that pops in when something was
 * recorded — overshoots to 1.04 and settles.
 */
export function ConfirmRing(): React.JSX.Element {
  return (
    <Animated.View
      entering={POP}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="h-16 w-16 items-center justify-center rounded-full bg-success-tint"
    >
      <Icon name="check" size={28} color="success" strokeWidth={2.4} />
    </Animated.View>
  );
}
