import type { ReactNode } from 'react';
import { View } from 'react-native';

import { cn } from './cn';
import { PressableScale } from './PressableScale';

export type CardTone = 'raised' | 'quiet' | 'recessed' | 'ink';

const TONE: Record<CardTone, string> = {
  raised: 'bg-white shadow-e2',
  quiet: 'bg-white',
  recessed: 'bg-cream-deep',
  ink: 'bg-ink shadow-e2',
};

export interface CardProps {
  children: ReactNode;
  tone?: CardTone;
  /** Makes the whole card a button with the prototype's .985 press. */
  onPress?: () => void;
  accessibilityLabel?: string;
  className?: string;
}

/**
 * The prototype's `.card`: a white surface lifted off the cream ground by a whisper-quiet
 * shadow (`e-2`), 18px radius, 16px padding. `ink` is the always-dark hero surface, and
 * `recessed` sits below the ground for rests and grouped sub-content.
 */
export function Card({
  children,
  tone = 'raised',
  onPress,
  accessibilityLabel,
  className,
}: CardProps): React.JSX.Element {
  const classes = cn('rounded-md p-4', TONE[tone], className);

  if (onPress === undefined) return <View className={classes}>{children}</View>;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      className={classes}
    >
      {children}
    </PressableScale>
  );
}
