import type { ReactNode } from 'react';
import { View } from 'react-native';

import { cn } from './cn';

export interface RowProps {
  children: ReactNode;
  /** Push children to opposite ends — the label/value pattern. */
  spread?: boolean;
  wrap?: boolean;
  className?: string;
}

/**
 * A horizontal group. Replaces the repeated
 * `flex-row items-center justify-between gap-3`.
 */
export function Row({
  children,
  spread = false,
  wrap = false,
  className,
}: RowProps): React.JSX.Element {
  return (
    <View
      className={cn(
        'flex-row items-center gap-3',
        spread && 'justify-between',
        wrap && 'flex-wrap',
        className
      )}
    >
      {children}
    </View>
  );
}
