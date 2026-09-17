import './interop';

// @bakeflow/ui — the shared design-system primitives.
//
// These carry the BakeFlow visual language ported from the design prototype at
// "# BakeFlow frontend design/export/bakeflow-frontend/", whose css/tokens.css
// and css/components.css remain the living visual spec. Every token value lives in
// ./tokens.ts, which apps/mobile/tailwind.config.js imports.
//
// The set is deliberately small and was derived from what the screens actually
// repeat, not from guesswork. Add a primitive when a pattern recurs, not in
// anticipation of one.

export { cn } from './cn';
export * from './tokens';
export { ThemeProvider, useScheme, type ThemePreference } from './ThemeProvider';
export { curve, timing, type DurationName, type EasingName } from './motion';
export { ICONS, type IconPart } from './icons';
export { Icon, type IconName, type IconProps } from './Icon';
export { PressableScale, type PressableScaleProps } from './PressableScale';
export { AppBar, IconButton, type AppBarProps } from './AppBar';
export { ScreenScroll, type ScreenScrollProps } from './ScreenScroll';
export { ScreenList, type ScreenListProps } from './ScreenList';
export { Badge, type BadgeTone } from './Badge';
export { Chips, type ChipOption } from './Chips';
export { EmptyState } from './EmptyState';
export { Fab } from './Fab';
export { Dock } from './Dock';
export { ConfirmRing } from './ConfirmRing';
export { CountUp, type CountUpFormat } from './CountUp';
export { SearchBar } from './SearchBar';
export { SwipeRow, type SwipeAction } from './SwipeRow';
export { List, ListRow, type ListRowProps } from './List';
export { Sparkline } from './Sparkline';
export { TrendChart, type TrendPoint } from './TrendChart';
export { TabBar, type TabBarProps, type TabItem } from './TabBar';
export { Sheet, type SheetProps } from './Sheet';
export { Toast, type ToastData, type ToastTone } from './Toast';
export { Skeleton, type SkeletonVariant } from './Skeleton';

export { Button, type ButtonProps, type ButtonTone } from './Button';
export { Callout, type CalloutProps, type CalloutTone } from './Callout';
export { Card, type CardProps, type CardTone } from './Card';
export { IconTile, type TileTone } from './IconTile';
export { Avatar, initialsOf, toneFor } from './Avatar';
export { GroupLabel, Menu, MenuItem, type MenuItemProps } from './Menu';
export { Field, type FieldProps } from './Field';
export { Row, type RowProps } from './Row';
export { Screen, type ScreenProps } from './Screen';
export { Text, type TextProps, type TextVariant } from './Text';
