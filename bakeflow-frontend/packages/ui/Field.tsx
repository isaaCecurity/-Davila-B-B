import { TextInput, type TextInputProps, View } from 'react-native';

import { cn } from './cn';
import { Text } from './Text';
import { useScheme } from './ThemeProvider';
import { colorFor } from './tokens';

export interface FieldProps extends TextInputProps {
  label: string;
  /** Inline error, rendered under the control and announced to screen readers. */
  error?: string | null;
  hint?: string;
  className?: string;
}

/**
 * A labelled text input.
 *
 * The label is a real sibling rather than a placeholder, because a placeholder
 * disappears the moment someone starts typing — which is exactly when a person
 * filling a long form needs to confirm what the field was asking for.
 */
export function Field({
  label,
  error = null,
  hint,
  className,
  ...rest
}: FieldProps): React.JSX.Element {
  const invalid = error !== null && error !== '';
  const scheme = useScheme();

  return (
    <View className="gap-2">
      <Text variant="label">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colorFor(scheme, 'textMuted')}
        className={cn(
          'min-h-tap rounded-sm border bg-white px-4 py-3 text-body text-cocoa',
          invalid ? 'border-error' : 'border-border',
          className
        )}
        {...rest}
      />
      {invalid && (
        <Text accessibilityRole="alert" variant="meta" className="text-error">
          {error}
        </Text>
      )}
      {!invalid && hint !== undefined && <Text variant="caption">{hint}</Text>}
    </View>
  );
}
