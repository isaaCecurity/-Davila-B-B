import type { ReactNode } from 'react';
import { RefreshControl } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';

import { AppBar, type AppBarProps } from './AppBar';
import { cn } from './cn';
import { useScheme } from './ThemeProvider';
import { colorFor } from './tokens';
import './interop';

export interface ScreenScrollProps extends Omit<AppBarProps, 'scrollY'> {
  children: ReactNode;
  /** Pull-to-refresh. Every list screen provides it (port brief, Phase 3). */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Drop the side gutter for full-bleed content. */
  flush?: boolean;
  contentClassName?: string;
}

/**
 * The prototype's standard screen: `appbar()` over a scrolling `.body`.
 *
 * Scroll position is tracked on the UI thread and handed to the app bar, which fades in its
 * hairline as content passes beneath it — `.appbar.is-stuck` without a JS-thread scroll
 * listener.
 */
export function ScreenScroll({
  children,
  refreshing = false,
  onRefresh,
  flush = false,
  contentClassName,
  ...bar
}: ScreenScrollProps): React.JSX.Element {
  const scrollY = useSharedValue(0);
  const scheme = useScheme();
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  return (
    <Animated.View className="flex-1 bg-cream">
      <AppBar {...bar} scrollY={scrollY} />
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName={cn(flush ? 'pb-16' : 'px-gutter pb-16', contentClassName)}
        refreshControl={
          onRefresh === undefined ? undefined : (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colorFor(scheme, 'textSecondary')}
              colors={[colorFor(scheme, 'accent')]}
            />
          )
        }
      >
        {children}
      </Animated.ScrollView>
    </Animated.View>
  );
}
