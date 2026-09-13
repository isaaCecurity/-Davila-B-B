import { IconTile, ScreenScroll, Text, type IconName } from '@bakeflow/ui';
import { View } from 'react-native';

/**
 * Holding screen for a tab route registered by the Phase 2 shell whose screen is rebuilt in
 * Phase 3 (docs/PROTOTYPE-PORT.md). Says so plainly rather than showing an empty screen that
 * looks like missing data.
 */
export function PortPending({
  title,
  icon,
  prototypeScreen,
}: {
  title: string;
  icon: IconName;
  prototypeScreen: string;
}): React.JSX.Element {
  return (
    <ScreenScroll title={title}>
      <View className="items-center gap-3 pt-16">
        <IconTile icon={icon} tone="accent" />
        <Text variant="subtitle">{title} is being rebuilt</Text>
        <Text variant="meta" className="text-center">
          This screen is being ported from the design prototype ({prototypeScreen}).
        </Text>
      </View>
    </ScreenScroll>
  );
}
