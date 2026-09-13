import type { ReactNode } from 'react';
import { View } from 'react-native';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/**
 * The prototype's `.empty`: art, a headline naming the space, one line saying what will
 * appear or what to try, and a verb-first action.
 *
 * Never "Nothing here yet" — every list gets copy specific to what it holds
 * (docs/DESIGN-TOKENS.md rule 8, still binding).
 */
export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: IconName;
  title: string;
  text: string;
  action?: ReactNode;
}): React.JSX.Element {
  return (
    <View className="items-center px-5 py-10">
      <View className="mb-5 h-[76px] w-[76px] items-center justify-center rounded-pill bg-cream-deep">
        <Icon name={icon} size={34} color="textMuted" strokeWidth={1.4} />
      </View>
      <Text variant="subtitle" className="text-center" accessibilityRole="header">
        {title}
      </Text>
      <Text variant="meta" className="mt-[7px] max-w-[250px] text-center leading-[21px]">
        {text}
      </Text>
      {action !== undefined && <View className="mt-5">{action}</View>}
    </View>
  );
}
