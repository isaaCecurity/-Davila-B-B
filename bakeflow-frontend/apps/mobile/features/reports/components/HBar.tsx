import { Text } from '@bakeflow/ui';
import { View } from 'react-native';

/**
 * The prototype's `.hbar`: a 96px label, an 8px track filled to this row's share of the leader, and a
 * 66px right-aligned figure, 9px padding (components.css).
 *
 * `ratio` is a plot proportion derived from exact strings — display only, like `TrendChart`; the
 * figure beside it is the exact string, formatted. The leader's bar is apricot, the rest cocoa.
 */
export function HBar({
  label,
  ratio,
  value,
  lead = false,
}: {
  label: string;
  ratio: number;
  value: string;
  lead?: boolean;
}): React.JSX.Element {
  const pct = ratio <= 0 ? 0 : Math.max(2, Math.min(100, Math.round(ratio * 100)));
  return (
    <View className="flex-row items-center gap-3 py-[9px]" accessible accessibilityLabel={`${label}: ${value}`}>
      <Text className="w-[96px] text-foot font-medium text-cocoa" numberOfLines={1}>{label}</Text>
      <View className="h-2 flex-1 overflow-hidden rounded-[5px] bg-cream-deep">
        <View className={`h-2 rounded-[5px] ${lead ? 'bg-apricot' : 'bg-cocoa'}`} style={{ width: `${pct}%` }} />
      </View>
      <Text tabular className="w-[66px] text-right text-foot font-semibold text-cocoa" numberOfLines={1}>{value}</Text>
    </View>
  );
}
