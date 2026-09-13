import { Icon, type IconName } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

/**
 * The prototype's floating `.fab`: an ink pill with an icon and a short verb, pinned
 * bottom-right above the tab bar. Presses to .94.
 */
export function Fab({
  label,
  icon = 'plus',
  onPress,
}: {
  label: string;
  icon?: IconName;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      scaleTo={0.94}
      className="absolute bottom-5 right-gutter z-40 h-[50px] flex-row items-center gap-2 rounded-pill bg-ink pl-[17px] pr-5 shadow-e3"
    >
      <Icon name={icon} size={18} color="white" strokeWidth={2} />
      <Text className="text-callout font-semibold text-white">{label}</Text>
    </PressableScale>
  );
}
