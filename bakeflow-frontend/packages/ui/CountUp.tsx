import { useEffect, useState } from 'react';
import { Platform, TextInput } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedReaction,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { cn } from './cn';
import { Text } from './Text';
import { duration } from './tokens';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

export type CountUpFormat = 'naira' | 'integer';

function groupDigits(digits: string): string {
  'worklet';
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits.charAt(i);
  }
  return out;
}

/** A frame of the count, formatted like the final figure. Never the figure itself. */
function frameText(n: number, format: CountUpFormat): string {
  'worklet';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(n);
  if (format === 'integer') return `${sign}${groupDigits(String(Math.round(a)))}`;
  const kobo = Math.round(a * 100);
  const whole = Math.floor(kobo / 100);
  const frac = String(kobo % 100).padStart(2, '0');
  return `${sign}₦${groupDigits(String(whole))}.${frac}`;
}

const EASE = Easing.out(Easing.cubic);

/**
 * The prototype's `animateFigure()`: the dominant number on a screen counts up over 620ms on
 * easeOutCubic. Supporting numbers do not — if everything counted, nothing would feel important.
 *
 * ## The final frame is always the exact string
 *
 * `text` is the figure as the screen already formats it from the server's exact decimal string
 * (e.g. `formatNaira(summary.net_revenue)`). `to` is a plot-style number used **only** to draw
 * the intermediate frames of the animation, like a chart coordinate; the moment the tween ends,
 * and whenever motion is reduced, `text` itself is shown. Screen readers only ever get `text`.
 *
 * ## Off the JS thread where the platform allows
 *
 * The clock runs as a Reanimated timing on the UI thread. On iOS/Android the frames are written
 * straight into a non-editable `TextInput` through animated props, so the count never touches
 * the JS thread. On web, where animated props cannot set text content, each frame commits
 * through React state — a single text node for ~40 frames.
 */
export function CountUp({
  to,
  text,
  format = 'naira',
  className,
}: {
  to: number;
  text: string;
  format?: CountUpFormat;
  className?: string;
}): React.JSX.Element {
  const progress = useSharedValue(0);
  const done = useSharedValue(false);
  const [webFrame, setWebFrame] = useState<string | null>(null);
  const target = Number.isFinite(to) ? to : 0;

  useEffect(() => {
    done.value = false;
    progress.value = 0;
    progress.value = withTiming(
      1,
      { duration: duration.countUp, easing: EASE, reduceMotion: ReduceMotion.System },
      (finished) => {
        done.value = finished === true;
      }
    );
  }, [text, target, progress, done]);

  useAnimatedReaction(
    () => (done.value || progress.value >= 1 ? null : frameText(target * progress.value, format)),
    (frame, previous) => {
      if (Platform.OS === 'web' && frame !== previous) scheduleOnRN(setWebFrame, frame);
    },
    [target, format]
  );

  const animatedProps = useAnimatedProps(() => {
    const frame = done.value || progress.value >= 1 ? text : frameText(target * progress.value, format);
    return { text: frame, defaultValue: frame } as unknown as Record<string, string>;
  }, [text, target, format]);

  const classes = cn('tabular-nums', className);

  if (Platform.OS === 'web') {
    return (
      <Text className={classes} accessibilityLabel={text}>
        {webFrame ?? text}
      </Text>
    );
  }

  return (
    <AnimatedTextInput
      accessibilityLabel={text}
      editable={false}
      caretHidden
      scrollEnabled={false}
      underlineColorAndroid="transparent"
      defaultValue={text}
      animatedProps={animatedProps}
      className={cn('p-0', classes)}
      style={{ fontVariant: ['tabular-nums'] }}
    />
  );
}
