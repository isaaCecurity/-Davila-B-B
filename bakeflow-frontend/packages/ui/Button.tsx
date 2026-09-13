import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  Text as RNText,
} from 'react-native';

import { cn } from './cn';

export type ButtonTone = 'primary' | 'secondary' | 'danger';

const SURFACE: Record<ButtonTone, string> = {
  primary: 'bg-cocoa active:opacity-80',
  secondary: 'bg-white border border-border active:opacity-70',
  danger: 'bg-error active:opacity-80',
};

const LABEL: Record<ButtonTone, string> = {
  primary: 'text-cream',
  secondary: 'text-cocoa',
  danger: 'text-cream',
};

/** Spinner colour must be a literal — ActivityIndicator takes a prop, not a class. */
const SPINNER: Record<ButtonTone, string> = {
  primary: '#F7F3EC',
  secondary: '#2A211C',
  danger: '#F7F3EC',
};

export interface ButtonProps extends Omit<PressableProps, 'children' | 'className'> {
  label: string;
  tone?: ButtonTone;
  /** Shows a spinner and blocks presses. The label stays, so width does not jump. */
  busy?: boolean;
  block?: boolean;
  className?: string;
}

/**
 * The app's action control.
 *
 * Every button clears the 44px minimum touch target regardless of its text, and
 * a disabled button is a flat `bg-border` rather than a faded primary — faded
 * brand colour reads as "loading" to most people, not "unavailable".
 */
export function Button({
  label,
  tone = 'primary',
  busy = false,
  block = false,
  disabled,
  className,
  ...rest
}: ButtonProps): React.JSX.Element {
  const inert = disabled === true || busy;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inert, busy }}
      disabled={inert}
      className={cn(
        'min-h-tap flex-row items-center justify-center gap-2 rounded-sm px-5 py-4',
        inert ? 'bg-border' : SURFACE[tone],
        block && 'w-full',
        className
      )}
      {...rest}
    >
      {busy && <ActivityIndicator color={SPINNER[tone]} />}
      <RNText
        className={cn('text-body font-semibold', inert ? 'text-warm-gray' : LABEL[tone])}
      >
        {label}
      </RNText>
    </Pressable>
  );
}
