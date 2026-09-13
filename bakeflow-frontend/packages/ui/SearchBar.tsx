import { TextInput, View, type TextInputProps } from 'react-native';

import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { useScheme } from './ThemeProvider';
import { colorFor } from './tokens';

/** The prototype's `.searchbar`: 42px, inset hairline that darkens on focus, clear button. */
export function SearchBar({
  value,
  onChangeText,
  placeholder,
  autoFocus,
  ...rest
}: Omit<TextInputProps, 'style'> & {
  value: string;
  onChangeText: (text: string) => void;
}): React.JSX.Element {
  const scheme = useScheme();
  return (
    <View className="h-[42px] flex-row items-center gap-[9px] rounded-sm border border-border bg-white px-[13px]">
      <Icon name="search" size={17} color="textMuted" />
      <TextInput
        {...rest}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colorFor(scheme, 'textMuted')}
        autoFocus={autoFocus}
        autoCorrect={false}
        spellCheck={false}
        returnKeyType="search"
        accessibilityLabel={placeholder}
        className="min-w-0 flex-1 text-callout text-cocoa"
      />
      {value !== '' && (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText('')}
          hitSlop={10}
        >
          <Icon name="close" size={16} color="textSecondary" />
        </PressableScale>
      )}
    </View>
  );
}
