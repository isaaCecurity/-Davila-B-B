import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { cn } from './cn';

/**
 * The type roles used across the app, mapped to the design scale.
 *
 * Screens should pick a role, never a raw size — that is what keeps a heading
 * on the finance screen the same weight as one on inventory.
 */
export type TextVariant =
  | 'display' // hero financial figure
  | 'title' // screen / section heading
  | 'subtitle' // card heading
  | 'body' // default reading text
  | 'label' // form labels, emphasised small text
  | 'meta' // secondary metadata, timestamps
  | 'caption'; // tertiary, quietest

const VARIANTS: Record<TextVariant, string> = {
  display: 'text-display font-bold text-cocoa',
  title: 'text-title-2 font-bold text-cocoa',
  subtitle: 'text-title-3 font-semibold text-cocoa',
  body: 'text-body text-cocoa',
  label: 'text-foot font-medium text-warm-gray',
  meta: 'text-callout text-warm-gray',
  caption: 'text-caption text-warm-gray-soft',
};

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  /** Numeric alignment for figures in columns — the design calls for tabular. */
  tabular?: boolean;
  className?: string;
}

export function Text({
  variant = 'body',
  tabular = false,
  className,
  ...rest
}: TextProps): React.JSX.Element {
  return (
    <RNText
      className={cn(VARIANTS[variant], tabular && 'tabular-nums', className)}
      {...rest}
    />
  );
}
