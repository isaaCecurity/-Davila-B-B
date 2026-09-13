import { ScrollView, View } from 'react-native';

import { cn } from './cn';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

export interface ChipOption<K extends string> {
  key: K;
  label: string;
  /** Shown in a small bubble after the label. */
  count?: string;
}

/**
 * The prototype's `.chips` filter strip: a horizontally scrolling row of pills, the selected
 * one inverted to ink. Bleeds to the screen edges so the first chip lines up with the gutter
 * while the strip still scrolls under it.
 */
export function Chips<K extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  className,
}: {
  options: readonly ChipOption<K>[];
  value: K;
  onChange: (key: K) => void;
  accessibilityLabel: string;
  className?: string;
}): React.JSX.Element {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      className={cn('-mx-gutter', className)}
      contentContainerClassName="gap-[7px] px-gutter py-[3px]"
    >
      {options.map((o) => {
        const on = o.key === value;
        return (
          <PressableScale
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            aria-selected={on}
            accessibilityLabel={o.count !== undefined ? `${o.label}, ${o.count}` : o.label}
            onPress={() => onChange(o.key)}
            scaleTo={0.95}
            className={cn(
              'h-[34px] flex-row items-center gap-1.5 rounded-pill px-3.5',
              on ? 'bg-ink' : 'bg-white shadow-e1'
            )}
          >
            <Text className={cn('text-foot font-medium', on ? 'text-white' : 'text-cocoa')}>
              {o.label}
            </Text>
            {o.count !== undefined && (
              <View className={cn('rounded-pill px-[5px] py-px', on ? 'bg-white/20' : 'bg-cocoa/10')}>
                <Text className={cn('text-[10.5px] font-bold', on ? 'text-white' : 'text-cocoa')}>
                  {o.count}
                </Text>
              </View>
            )}
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}
