import type { ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { cn } from './cn';

export interface ScreenProps {
  children: ReactNode;
  /** Apply the standard gutter. Off for lists that manage their own padding. */
  padded?: boolean;
  className?: string;
}

/**
 * The outermost wrapper of every screen: safe-area inset plus the app ground.
 *
 * Replaces the repeated `flex-1 bg-white`. The ground is `bg-cream`, not white —
 * white is reserved for raised surfaces (cards, inputs, sheets), which is what
 * gives the interface its depth.
 */
export function Screen({ children, padded = false, className }: ScreenProps): React.JSX.Element {
  return (
    <SafeAreaView className={cn('flex-1 bg-cream', className)}>
      {padded ? <View className="flex-1 p-gutter">{children}</View> : children}
    </SafeAreaView>
  );
}
