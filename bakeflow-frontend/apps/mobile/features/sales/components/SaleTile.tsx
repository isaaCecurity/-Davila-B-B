import { Icon, PressableScale, Text, curve, fixed } from '@bakeflow/ui';
import { formatNaira } from '@bakeflow/utils';
import type { Money } from '@bakeflow/types';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

/**
 * The prototype's `.sale-tile`: category code and "N in bag" on top, the product and its price,
 * and a deck underneath. When the product is in the bag the `−1` button slides open to 36% while
 * `Add` narrows to 64% (`flex-basis .32s` on the navigation curve) — here a Reanimated timing on
 * `flexGrow`, collapsed under Reduce Motion.
 */
export function SaleTile({
  label,
  category,
  price,
  count,
  outOfStock,
  onAdd,
  onRemove,
  onEditCount,
}: {
  label: string;
  category: string;
  price: Money | null;
  count: number;
  outOfStock: boolean;
  onAdd: () => void;
  onRemove: () => void;
  onEditCount: () => void;
}): React.JSX.Element {
  const open = useSharedValue(count > 0 ? 1 : 0);
  useEffect(() => {
    open.value = withTiming(count > 0 ? 1 : 0, { duration: 320, easing: curve('nav'), reduceMotion: ReduceMotion.System });
  }, [count, open]);

  const minusStyle = useAnimatedStyle(() => ({ flexGrow: 0.36 * open.value, opacity: open.value }));
  const addStyle = useAnimatedStyle(() => ({ flexGrow: 1 - 0.36 * open.value }));

  const inBag = count > 0;

  return (
    <View
      className={`min-h-[150px] w-[48.4%] justify-between overflow-hidden rounded-md border bg-white shadow-e1 ${inBag ? 'border-ink' : 'border-border'} ${outOfStock ? 'opacity-50' : ''}`}
    >
      <View className="px-[13px] pb-2 pt-[13px]">
        <View className="mb-[5px] min-h-[20px] flex-row items-center justify-between">
          <Text className="flex-1 text-[10px] font-extrabold uppercase tracking-[0.8px] text-warm-gray-soft" numberOfLines={1}>
            {category}
          </Text>
          {inBag && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${count} ${label} in bag. Change quantity`}
              onPress={onEditCount}
              hitSlop={8}
              className="rounded-pill bg-ink px-2 py-0.5"
            >
              {/* Inline colour: Text's default `text-cocoa` (same shade as the ink pill) can win on
                  stylesheet order over a fixed-colour class. */}
              <Text className="text-[11px] font-extrabold" style={{ color: fixed.apricot }}>
                {count} in bag
              </Text>
            </Pressable>
          )}
        </View>
        <Text className="mb-0.5 text-foot font-semibold text-cocoa" numberOfLines={2}>{label}</Text>
        <Text tabular className="text-foot font-bold text-cocoa">
          {outOfStock ? 'Out of stock' : price === null ? '—' : formatNaira(price)}
        </Text>
      </View>

      <View className="h-10 flex-row overflow-hidden border-t border-border bg-cream-deep">
        <Animated.View style={minusStyle} className="overflow-hidden border-r border-border">
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Remove one ${label}`}
            disabled={!inBag}
            onPress={onRemove}
            scaleTo={0.94}
            className="h-10 flex-row items-center justify-center gap-[5px]"
          >
            <Icon name="minus" size={13} color="error" />
            <Text className="text-[11.5px] font-extrabold text-error">-1</Text>
          </PressableScale>
        </Animated.View>
        <Animated.View style={addStyle} className="bg-ink">
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={`Add one ${label}`}
            disabled={outOfStock}
            onPress={onAdd}
            scaleTo={0.96}
            className="h-10 flex-row items-center justify-center gap-[5px] px-1"
          >
            <Icon name="plus" size={13} color="apricot" />
            <Text className="text-[11.5px] font-extrabold text-white" numberOfLines={1}>
              {inBag ? 'Add' : 'Tap to Add'}
            </Text>
          </PressableScale>
        </Animated.View>
      </View>
    </View>
  );
}
