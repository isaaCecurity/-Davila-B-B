import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { timing } from './motion';
import { Text } from './Text';
import { motion } from './tokens';
import './interop';

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Pinned under the scrolling body — primary and cancel actions. */
  foot?: ReactNode;
  /** Right-hand header slot. */
  headerRight?: ReactNode;
  /** Show the drag grip and allow swipe-to-dismiss. */
  grip?: boolean;
  children: ReactNode;
}

/** Fraction of the sheet's height a downward drag must pass to dismiss on release. */
const DISMISS_FRACTION = 0.3;
const DISMISS_VELOCITY = 900;

/**
 * The prototype's bottom sheet: scrim fades to .38 while the sheet rises on the navigation
 * curve (400ms); closing reverses on the in-out curve (260ms).
 *
 * The sheet stays mounted through its exit animation and only unmounts once it is off
 * screen, so closing never cuts to nothing. Dragging the grip or body down past 30% of the
 * height — or flicking — dismisses; anything less springs back.
 *
 * Rendered in a Modal so it sits above the tab bar, with its own GestureHandlerRootView:
 * on Android, gestures do not reach content inside a Modal without one.
 *
 * PORT-NOTE: the prototype scrim adds a 2px backdrop blur; without expo-blur it is the
 * scrim colour alone.
 */
export function Sheet({
  visible,
  onClose,
  title,
  foot,
  headerRight,
  grip = true,
  children,
}: SheetProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const height = useSharedValue(800);
  const translateY = useSharedValue(800);
  const scrim = useSharedValue(0);

  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);

  useEffect(() => {
    if (!mounted) return;
    if (visible) {
      translateY.value = height.value;
      translateY.value = withTiming(0, timing('sheetIn', 'nav'));
      scrim.value = withTiming(motion.scrimOpacity, timing('base'));
    } else {
      scrim.value = withTiming(0, timing('scrimOut', 'inout'));
      translateY.value = withTiming(height.value * 1.01, timing('sheetOut', 'inout'), (done) => {
        if (done === true) scheduleOnRN(setMounted, false);
      });
    }
  }, [visible, mounted, height, translateY, scrim]);

  const drag = Gesture.Pan()
    .enabled(grip)
    .activeOffsetY(8)
    .onUpdate((e) => {
      translateY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > height.value * DISMISS_FRACTION || e.velocityY > DISMISS_VELOCITY) {
        scheduleOnRN(onClose);
      } else {
        translateY.value = withSpring(0, { damping: 24, stiffness: 260 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));

  if (!mounted) return null;

  return (
    <Modal transparent visible statusBarTranslucent onRequestClose={onClose} animationType="none">
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View className="absolute inset-0 bg-scrim" style={scrimStyle}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            className="flex-1"
            onPress={onClose}
          />
        </Animated.View>

        <GestureDetector gesture={drag}>
          <Animated.View
            accessibilityViewIsModal
            onLayout={(e) => {
              height.value = e.nativeEvent.layout.height;
            }}
            className="absolute bottom-0 left-0 right-0 max-h-[88%] overflow-hidden rounded-t-xl bg-white shadow-e4"
            style={sheetStyle}
          >
            {grip && (
              <View className="items-center pb-1 pt-2.5">
                <View className="h-[4.5px] w-[38px] rounded-[3px] bg-border" />
              </View>
            )}
            {(title !== undefined || headerRight !== undefined) && (
              <View className="flex-row items-center gap-3 px-5 pb-3 pt-1.5">
                {title !== undefined && (
                  <Text variant="subtitle" accessibilityRole="header" className="flex-1">
                    {title}
                  </Text>
                )}
                {headerRight}
              </View>
            )}
            <ScrollView
              className="flex-shrink"
              contentContainerClassName="px-5 pb-5"
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
            {foot !== undefined && (
              <View
                className="border-t border-border bg-white px-5 pt-3"
                style={{ paddingBottom: Math.max(insets.bottom, 24) }}
              >
                {foot}
              </View>
            )}
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}
