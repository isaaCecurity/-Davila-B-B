import { View } from 'react-native';
import Animated, { FadeOut, Keyframe, LinearTransition, ReduceMotion } from 'react-native-reanimated';

import { curve } from './motion';
import { PressableScale } from './PressableScale';
import { Text } from './Text';
import { duration, motion } from './tokens';
import './interop';

export type ToastTone = 'neutral' | 'success' | 'error';

export interface ToastData {
  id: string;
  title: string;
  text?: string;
  tone?: ToastTone;
  /** A single inline action — the prototype's "Undo". */
  action?: { label: string; onPress: () => void };
}

/* toast-in: from translateY(-14px) scale(.97), transparent → settled, 320ms ease-out. */
const ENTER = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: motion.toastInY }, { scale: motion.toastInScale }] },
  100: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }], easing: curve('out') },
})
  .duration(duration.toastIn)
  .reduceMotion(ReduceMotion.System);

const EXIT = FadeOut.duration(duration.toastOut).reduceMotion(ReduceMotion.System);

const MARK: Record<ToastTone, { glyph: string; className: string }> = {
  neutral: { glyph: 'i', className: 'bg-ink-soft' },
  success: { glyph: '✓', className: 'bg-success' },
  error: { glyph: '!', className: 'bg-error' },
};

/**
 * One toast: the prototype's dark ink card, stacked from the top.
 *
 * Presentational only — the queue and timers live in the app's UI store. Its container is an
 * `aria-live` region equivalent: `accessibilityLiveRegion` on Android, and the text is
 * announced on iOS via the alert role.
 */
export function Toast({ toast }: { toast: ToastData }): React.JSX.Element {
  const mark = MARK[toast.tone ?? 'neutral'];

  return (
    <Animated.View
      entering={ENTER}
      exiting={EXIT}
      layout={LinearTransition.duration(duration.base)}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      className="flex-row items-start gap-[11px] rounded-[15px] bg-ink px-[15px] py-3 shadow-e3"
    >
      <View className={`mt-px h-[26px] w-[26px] items-center justify-center rounded-xs ${mark.className}`}>
        <Text className="text-[13px] font-bold text-white">{mark.glyph}</Text>
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-callout font-semibold text-white">{toast.title}</Text>
        {toast.text !== undefined && (
          <Text className="text-foot text-white/70">{toast.text}</Text>
        )}
      </View>
      {toast.action !== undefined && (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={toast.action.label}
          onPress={toast.action.onPress}
          className="min-h-tap justify-center px-2"
        >
          <Text className="text-callout font-bold text-apricot">{toast.action.label}</Text>
        </PressableScale>
      )}
    </Animated.View>
  );
}
