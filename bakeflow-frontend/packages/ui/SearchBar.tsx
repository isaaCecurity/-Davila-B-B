import { useState } from 'react';
import { Platform, TextInput, View, type TextInputProps } from 'react-native';

import { cn } from './cn';
import { Icon } from './Icon';
import { PressableScale } from './PressableScale';
import { useScheme } from './ThemeProvider';
import { colorFor } from './tokens';

/** Web draws its own focus outline inside the bar; the bar's border already shows focus. */
const WEB_NO_OUTLINE = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextInputProps['style']) : undefined;

/**
 * The prototype's `.searchbar`: 42px, hairline border that darkens to cocoa on focus
 * (`:focus-within`), clear button.
 *
 * `iconPosition` follows the prototype screen being ported: most bars lead with the magnifier,
 * while the global `search`, sales-monitor and counter-sale bars put it after the input.
 */
export function SearchBar({
  value,
  onChangeText,
  placeholder,
  autoFocus,
  iconPosition = 'start',
  accessibilityLabel,
  onFocus,
  onBlur,
  ...rest
}: Omit<TextInputProps, 'style'> & {
  value: string;
  onChangeText: (text: string) => void;
  iconPosition?: 'start' | 'end';
}): React.JSX.Element {
  const scheme = useScheme();
  const [focused, setFocused] = useState(false);
  const icon = <Icon name="search" size={17} color="textMuted" />;
  return (
    <View
      className={cn(
        'h-[42px] flex-row items-center gap-[9px] rounded-sm bg-white px-[13px]',
        focused ? 'border-[1.5px] border-cocoa' : 'border border-border'
      )}
    >
      {iconPosition === 'start' && icon}
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
        accessibilityLabel={accessibilityLabel ?? placeholder ?? 'Search'}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        style={WEB_NO_OUTLINE}
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
      {iconPosition === 'end' && value === '' && icon}
    </View>
  );
}
