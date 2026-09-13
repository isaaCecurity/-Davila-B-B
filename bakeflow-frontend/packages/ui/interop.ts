import { cssInterop } from 'nativewind';
import Animated from 'react-native-reanimated';

/*
 * NativeWind resolves `className` on the React Native core components it wraps, but not on
 * Reanimated's animated components — verified in the web preview, where an
 * `Animated.ScrollView` silently lost its gutter and an `Animated.View` its background.
 * Registering them here makes className work on every platform. Imported for its side
 * effect by each module that styles an animated component; repeat imports are no-ops.
 */
cssInterop(Animated.View, { className: 'style' });
cssInterop(Animated.ScrollView, {
  className: 'style',
  contentContainerClassName: 'contentContainerStyle',
});
