import type { ReactElement } from 'react';
import { RefreshControl, type FlatListProps } from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';

import { AppBar, type AppBarProps } from './AppBar';
import { useScheme } from './ThemeProvider';
import { colorFor } from './tokens';
import './interop';

export interface ScreenListProps<T>
  extends Omit<AppBarProps, 'scrollY'>,
    Pick<
      FlatListProps<T>,
      | 'data'
      | 'renderItem'
      | 'keyExtractor'
      | 'ListHeaderComponent'
      | 'ListFooterComponent'
      | 'ListEmptyComponent'
      | 'onEndReached'
    > {
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Rendered above the list, outside it — e.g. a floating action button. */
  overlay?: ReactElement;
}

/**
 * `ScreenScroll` for long lists: the same app bar and scroll-linked hairline, over a
 * virtualised FlatList. Lists that can exceed a screenful use this, not a ScrollView —
 * rendering every row of a 200-order day up front is the jank the prototype never had to face
 * (Web Interface Guidelines: virtualise large lists).
 */
export function ScreenList<T>({
  title,
  sub,
  onBack,
  right,
  refreshing = false,
  onRefresh,
  overlay,
  ...list
}: ScreenListProps<T>): React.JSX.Element {
  const scrollY = useSharedValue(0);
  const scheme = useScheme();
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });

  return (
    <Animated.View className="flex-1 bg-cream">
      <AppBar title={title} sub={sub} onBack={onBack} right={right} scrollY={scrollY} />
      <Animated.FlatList
        {...list}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onEndReachedThreshold={0.4}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 96 }}
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
      />
      {overlay}
    </Animated.View>
  );
}
