import type { ReactNode } from 'react';
import { View } from 'react-native';

import { cn } from './cn';
import { Text } from './Text';

export type CalloutTone = 'error' | 'warning' | 'success' | 'info';

const SURFACE: Record<CalloutTone, string> = {
  error: 'bg-error-tint',
  warning: 'bg-warning-tint',
  success: 'bg-success-tint',
  info: 'bg-info-tint',
};

const TITLE: Record<CalloutTone, string> = {
  error: 'text-error',
  warning: 'text-warning',
  success: 'text-success',
  info: 'text-info',
};

export interface CalloutProps {
  tone?: CalloutTone;
  title: string;
  /** The fix or next step. A message that only names the problem strands people. */
  detail?: ReactNode;
  className?: string;
}

/**
 * A tinted status block — replaces the repeated `gap-1 rounded-lg bg-red-50 p-3`.
 *
 * Error and warning callouts announce themselves, because they usually appear in
 * response to something the user just did and would otherwise go unnoticed by
 * anyone not looking at that part of the screen.
 */
export function Callout({
  tone = 'info',
  title,
  detail,
  className,
}: CalloutProps): React.JSX.Element {
  const urgent = tone === 'error' || tone === 'warning';

  return (
    <View
      accessibilityRole={urgent ? 'alert' : undefined}
      accessibilityLiveRegion={urgent ? 'polite' : 'none'}
      className={cn('gap-1 rounded-sm p-3', SURFACE[tone], className)}
    >
      <Text variant="label" className={TITLE[tone]}>
        {title}
      </Text>
      {typeof detail === 'string' ? <Text variant="meta">{detail}</Text> : detail}
    </View>
  );
}
