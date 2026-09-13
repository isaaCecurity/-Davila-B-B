import { Icon, PressableScale } from '@bakeflow/ui';
import { TextInput, View } from 'react-native';

import { stepQuantity } from '../quantity';

/**
 * The prototype's `.stepper`: minus, the count, plus. The count is also typeable, because
 * loading forty loaves one tap at a time is not a workflow.
 *
 * The value stays an exact decimal string; steps are whole units (`stepQuantity`).
 */
export function CountStepper({
  value,
  onChange,
  label,
  step = 1,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
  step?: number;
}): React.JSX.Element {
  const empty = value === '' || value === '0';
  return (
    <View className="flex-row items-center gap-1">
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Fewer ${label}`}
        disabled={empty}
        onPress={() => onChange(stepQuantity(value, -step))}
        scaleTo={0.9}
        className={`h-9 w-9 items-center justify-center rounded-[11px] ${empty ? 'bg-cream-deep/60' : 'bg-cream-deep'}`}
      >
        <Icon name="minus" size={14} color={empty ? 'textMuted' : 'cocoa'} />
      </PressableScale>
      <TextInput
        value={value}
        onChangeText={(t) => onChange(t.replace(/[^\d.]/g, ''))}
        keyboardType="decimal-pad"
        inputMode="decimal"
        selectTextOnFocus
        accessibilityLabel={`${label} count`}
        className="min-w-[48px] text-center text-callout font-semibold text-cocoa"
        style={{ fontVariant: ['tabular-nums'] }}
      />
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`More ${label}`}
        onPress={() => onChange(stepQuantity(value, step))}
        scaleTo={0.9}
        className="h-9 w-9 items-center justify-center rounded-[11px] bg-ink"
      >
        <Icon name="plus" size={14} color="white" />
      </PressableScale>
    </View>
  );
}
