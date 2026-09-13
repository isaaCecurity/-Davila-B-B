import type { ReactNode } from 'react';
import { View } from 'react-native';

import { cn } from './cn';

export interface CardProps {
  children: ReactNode;
  /** Recessed instead of raised — for rests, chips, and grouped sub-content. */
  sunken?: boolean;
  className?: string;
}

/**
 * A raised surface. Replaces the repeated
 * `gap-3 rounded-xl border border-neutral-200 p-4`.
 *
 * White on cream is the app's primary depth cue, so a card carries only a
 * whisper-quiet border — heavy borders fight the elevation rather than add to it.
 */
export function Card({ children, sunken = false, className }: CardProps): React.JSX.Element {
  return (
    <View
      className={cn(
        'gap-3 rounded-md border border-border p-4',
        sunken ? 'bg-cream-deep' : 'bg-white',
        className
      )}
    >
      {children}
    </View>
  );
}
