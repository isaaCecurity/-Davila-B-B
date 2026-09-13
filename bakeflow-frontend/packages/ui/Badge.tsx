import { View } from 'react-native';

import { cn } from './cn';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import type { ColorToken } from './tokens';

export type BadgeTone = 'ok' | 'pending' | 'live' | 'bad' | 'neutral' | 'info';

const SURFACE: Record<BadgeTone, string> = {
  ok: 'bg-success-tint',
  pending: 'bg-warning-tint',
  live: 'bg-apricot-tint',
  bad: 'bg-error-tint',
  neutral: 'bg-cocoa/5',
  info: 'bg-info-tint',
};

const INK: Record<BadgeTone, { text: string; icon: ColorToken }> = {
  ok: { text: 'text-success-ink', icon: 'success-ink' },
  pending: { text: 'text-warning-ink', icon: 'warning-ink' },
  live: { text: 'text-apricot-deep', icon: 'apricot-deep' },
  bad: { text: 'text-error-ink', icon: 'error-ink' },
  neutral: { text: 'text-cocoa', icon: 'cocoa' },
  info: { text: 'text-info-ink', icon: 'info-ink' },
};

/**
 * The prototype's status `.badge`: uppercase caption on a tint, led by an icon.
 *
 * Always a word as well as a colour — state is never carried by colour alone
 * (docs/DESIGN-TOKENS.md, still binding).
 */
export function Badge({
  label,
  tone,
  icon,
  onDark = false,
  className,
}: {
  label: string;
  tone: BadgeTone;
  icon?: IconName;
  /**
   * Sitting on the always-dark ink surface. Only `neutral` changes: its dark-on-faint-dark
   * pairing is invisible there, while the pastel tones already read on ink.
   */
  onDark?: boolean;
  className?: string;
}): React.JSX.Element {
  const inverted = onDark && tone === 'neutral';
  return (
    <View
      accessibilityLabel={label}
      className={cn(
        'flex-row items-center gap-[5px] self-start rounded-xs px-[9px] py-1',
        inverted ? 'bg-white/15' : SURFACE[tone],
        className
      )}
    >
      {icon !== undefined && (
        <Icon name={icon} size={11} color={inverted ? 'white' : INK[tone].icon} strokeWidth={2.2} />
      )}
      <Text
        className={cn(
          'text-caption font-bold uppercase tracking-[0.4px]',
          inverted ? 'text-white' : INK[tone].text
        )}
      >
        {label}
      </Text>
    </View>
  );
}
