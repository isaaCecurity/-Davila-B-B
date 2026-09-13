import { Children, isValidElement, type ReactNode } from 'react';
import { View } from 'react-native';

import { cn } from './cn';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { Text } from './Text';

/**
 * The prototype's `.list`: a raised white group of rows, each after the first separated by a
 * hairline that starts at the content inset.
 */
export function List({ children, className }: { children: ReactNode; className?: string }): React.JSX.Element {
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View className={cn('overflow-hidden rounded-md bg-white shadow-e2', className)}>
      {rows.map((row, i) => (
        <View key={row.key ?? i}>
          {i > 0 && <View className="absolute left-4 right-0 top-0 z-10 h-px bg-border" />}
          {row}
        </View>
      ))}
    </View>
  );
}

export interface ListRowProps {
  title: string;
  sub?: string;
  leading?: ReactNode;
  /** Right-aligned value, e.g. an amount. */
  end?: string;
  endSub?: string;
  /** Trailing element instead of `end` (a badge). */
  trailing?: ReactNode;
  onPress?: () => void;
  chevron?: boolean;
}

/** One `.li` row: leading slot, title and sub-line, right-hand value, optional chevron. */
export function ListRow({
  title,
  sub,
  leading,
  end,
  endSub,
  trailing,
  onPress,
  chevron = onPress !== undefined,
}: ListRowProps): React.JSX.Element {
  const body = (
    <>
      {leading}
      <View className="min-w-0 flex-1">
        <Text className="text-callout font-medium text-cocoa" numberOfLines={1}>
          {title}
        </Text>
        {sub !== undefined && (
          <Text variant="caption" className="text-warm-gray" numberOfLines={1}>
            {sub}
          </Text>
        )}
      </View>
      {end !== undefined && (
        <View className="items-end">
          <Text tabular className="text-callout font-semibold text-cocoa">
            {end}
          </Text>
          {endSub !== undefined && <Text variant="caption">{endSub}</Text>}
        </View>
      )}
      {trailing}
      {chevron && <Icon name="chevRight" size={17} color="textMuted" />}
    </>
  );

  const classes = 'min-h-tap flex-row items-center gap-3 px-4 py-[13px]';

  if (onPress === undefined) return <View className={classes}>{body}</View>;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={[title, sub, end].filter(Boolean).join(', ')}
      onPress={onPress}
      scaleTo={1}
      className={cn(classes, 'active:bg-cocoa/5')}
    >
      {body}
    </PressableScale>
  );
}
