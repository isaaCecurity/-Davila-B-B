// @bakeflow/ui — the shared design-system primitives.
//
// These carry the BakeFlow visual language ported from the design prototype at
// "# BakeFlow frontend design/export/bakeflow-frontend/", whose css/tokens.css
// and css/components.css remain the living visual spec. Token VALUES live in
// apps/mobile/tailwind.config.js and apps/mobile/global.css.
//
// The set is deliberately small and was derived from what the screens actually
// repeat, not from guesswork. Add a primitive when a pattern recurs, not in
// anticipation of one.

export { cn } from './cn';

export { Button, type ButtonProps, type ButtonTone } from './Button';
export { Callout, type CalloutProps, type CalloutTone } from './Callout';
export { Card, type CardProps } from './Card';
export { Field, type FieldProps } from './Field';
export { Row, type RowProps } from './Row';
export { Screen, type ScreenProps } from './Screen';
export { Text, type TextProps, type TextVariant } from './Text';
