import Animated, { Keyframe, ReduceMotion } from 'react-native-reanimated';

import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';
import { duration, motion } from './tokens';
import './interop';

/** `@keyframes fab-in { from { opacity: 0; transform: translateY(12px) scale(.9) } }` */
const FAB_IN = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: motion.fabInY }, { scale: motion.fabInScale }] },
  100: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
})
  .duration(duration.fabIn)
  .reduceMotion(ReduceMotion.System);

/**
 * The prototype's floating `.fab`: an ink pill with an icon and a short verb, pinned
 * bottom-right above the tab bar. Rises in on mount (`fab-in`, 420ms) and presses to .94.
 */
export function Fab({
  label,
  icon = 'plus',
  onPress,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Animated.View entering={FAB_IN} className="absolute bottom-5 right-gutter z-40">
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        scaleTo={0.94}
        className="h-[50px] flex-row items-center gap-2 rounded-pill bg-ink pl-[17px] pr-5 shadow-e3"
      >
        <Icon name={icon} size={18} color="white" strokeWidth={2} />
        <Text className="text-callout font-semibold text-white">{label}</Text>
      </PressableScale>
    </Animated.View>
  );
}
