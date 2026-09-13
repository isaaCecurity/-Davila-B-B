import {
  Easing,
  ReduceMotion,
  type EasingFunction,
  type EasingFunctionFactory,
  type WithTimingConfig,
} from 'react-native-reanimated';

import { duration, easing } from './tokens';

export type EasingName = keyof typeof easing;
export type DurationName = keyof typeof duration;

/** A prototype easing curve as a Reanimated easing. */
export function curve(name: EasingName): EasingFunction | EasingFunctionFactory {
  const [x1, y1, x2, y2] = easing[name];
  return Easing.bezier(x1, y1, x2, y2);
}

/**
 * A timing config built from prototype tokens.
 *
 * `ReduceMotion.System` makes every animation built through this helper collapse to its
 * end state when the OS "Reduce Motion" setting is on — the native counterpart of the
 * prototype's `prefers-reduced-motion` handling, with no per-call-site checks.
 */
export function timing(d: DurationName, e: EasingName = 'out'): WithTimingConfig {
  return { duration: duration[d], easing: curve(e), reduceMotion: ReduceMotion.System };
}
