import { View } from 'react-native';

import { cn } from './cn';
import { Icon, type IconName } from './Icon';
import type { ColorToken } from './tokens';

export type TileTone = 'neutral' | 'ok' | 'warn' | 'bad' | 'accent' | 'info' | 'ink';

const SURFACE: Record<TileTone, string> = {
  neutral: 'bg-cream-deep',
  ok: 'bg-success-tint',
  warn: 'bg-warning-tint',
  bad: 'bg-error-tint',
  accent: 'bg-apricot-tint',
  info: 'bg-info-tint',
  ink: 'bg-ink',
};

const GLYPH: Record<TileTone, ColorToken> = {
  neutral: 'cocoa',
  ok: 'success',
  warn: 'warning-ink',
  bad: 'error-ink',
  accent: 'apricot-deep',
  info: 'info-ink',
  ink: 'white',
};

/**
 * The prototype's `.itile`: a rounded square carrying an icon, tinted by meaning.
 *
 * Tone is never the only signal — every tile sits beside a title that says the same thing
 * in words (docs/DESIGN-TOKENS.md, still binding).
 */
export function IconTile({
  icon,
  tone = 'neutral',
  size = 'md',
  className,
}: {
  icon: IconName;
  tone?: TileTone;
  size?: 'sm' | 'md';
  className?: string;
}): React.JSX.Element {
  const sm = size === 'sm';
  return (
    <View
      className={cn(
        'items-center justify-center',
        sm ? 'h-8 w-8 rounded-[10px]' : 'h-[38px] w-[38px] rounded-xl',
        SURFACE[tone],
        className
      )}
    >
      <Icon name={icon} size={sm ? 16 : 18} color={GLYPH[tone]} />
    </View>
  );
}
