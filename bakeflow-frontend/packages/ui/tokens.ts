/**
 * BakeFlow design tokens — the single source of truth.
 *
 * Values are ported from the design prototype (`css/tokens.css`, `css/app.css`), which
 * remains the living visual spec. See docs/PROTOTYPE-PORT.md decision D1 for why these
 * supersede the values in docs/DESIGN-TOKENS.md.
 *
 * Pure data, no React Native imports: `apps/mobile/tailwind.config.js` loads this file in
 * Node through Tailwind's jiti loader, so it must stay importable outside the app bundle.
 *
 * Two consumers, one set of values:
 * - className styling reads these through Tailwind (`bg-cream`, `rounded-md`, `text-body`).
 * - Anything that cannot take a className — Reanimated timings, spinner and placeholder
 *   colours, SVG fills — imports them directly from here.
 */

type Hex = `#${string}`;

/** Colours that change between light and dark. Names are the prototype's own vocabulary. */
export const THEMED_COLORS = [
  'cocoa',
  'cocoa-soft',
  'cream',
  'cream-deep',
  'white',
  'warm-gray',
  'warm-gray-soft',
  'border',
  'apricot-tint',
  'success-tint',
  'warning-tint',
  'error-tint',
  'info-tint',
] as const;

export type ThemedColor = (typeof THEMED_COLORS)[number];
export type ColorScheme = 'light' | 'dark';

export const themed: Record<ColorScheme, Record<ThemedColor, Hex>> = {
  light: {
    cocoa: '#2A211C',
    'cocoa-soft': '#43362E',
    cream: '#F7F3EC',
    'cream-deep': '#F1EBE1',
    white: '#FFFFFF',
    'warm-gray': '#5F5850',
    'warm-gray-soft': '#736B62',
    border: '#E7E1D8',
    'apricot-tint': '#FBEDE4',
    'success-tint': '#E6F0EA',
    'warning-tint': '#FAF0DC',
    'error-tint': '#F8E7E4',
    'info-tint': '#E8EEF4',
  },
  dark: {
    cocoa: '#EFE7DC',
    'cocoa-soft': '#D8CCBC',
    cream: '#17130F',
    'cream-deep': '#1E1811',
    white: '#26201A',
    'warm-gray': '#A79D91',
    'warm-gray-soft': '#8C8377',
    border: '#3A3026',
    'apricot-tint': '#3A2A1E',
    'success-tint': '#1D3226',
    'warning-tint': '#3A2E14',
    'error-tint': '#3A2119',
    'info-tint': '#1C2A38',
  },
};

/** Colours that are identical in both themes — the prototype never flips these. */
export const fixed = {
  ink: '#2A211C',
  'ink-soft': '#43362E',
  apricot: '#E58A5B',
  'apricot-deep': '#C8703F',
  success: '#3E8F68',
  warning: '#D49A3A',
  error: '#C95C54',
  info: '#5B7FA6',
  scrim: '#1A1411',
  /* Darker glyph colours for text and icons sitting on a tint (the prototype's `.itile`
     tones); the base semantic colour alone is too light to read on its own tint. */
  'success-ink': '#2F7354',
  'warning-ink': '#9E6E17',
  'error-ink': '#A8443C',
  'info-ink': '#446080',
} as const satisfies Record<string, Hex>;

/**
 * Initials-avatar pairs (`.avatar.-a` … `-e`): a tinted ground with a matching ink. A person
 * keeps the same tone everywhere they appear.
 */
export const avatarTones = {
  a: { bg: '#F3E3D6', ink: '#A6602F' },
  b: { bg: '#E2ECE6', ink: '#2F7354' },
  c: { bg: '#E6E9F0', ink: '#46587A' },
  d: { bg: '#F1E7EC', ink: '#7C4A61' },
  e: { bg: '#EDEAE2', ink: '#6B6156' },
} as const satisfies Record<string, { bg: Hex; ink: Hex }>;

export type AvatarTone = keyof typeof avatarTones;

export type FixedColor = keyof typeof fixed;
export type ColorToken = ThemedColor | FixedColor;

/**
 * Semantic roles → token names. Screens should think in roles; the brand names are what
 * the prototype CSS uses, so a porter reading `var(--cream)` maps it straight to `bg-cream`.
 */
export const semantic = {
  canvas: 'cream',
  surface: 'white',
  sunken: 'cream-deep',
  primary: 'cocoa',
  primaryPressed: 'cocoa-soft',
  onPrimary: 'cream',
  textPrimary: 'cocoa',
  textSecondary: 'warm-gray',
  textMuted: 'warm-gray-soft',
  rule: 'border',
  accent: 'apricot',
  accentTint: 'apricot-tint',
  success: 'success',
  successTint: 'success-tint',
  warning: 'warning',
  warningTint: 'warning-tint',
  danger: 'error',
  dangerTint: 'error-tint',
  info: 'info',
  infoTint: 'info-tint',
  inverse: 'ink',
} as const satisfies Record<string, ColorToken>;

export type SemanticColor = keyof typeof semantic;

/** Resolve a token or semantic role to a literal hex for the given scheme. */
export function colorFor(scheme: ColorScheme, token: ColorToken | SemanticColor): Hex {
  const name: ColorToken = token in semantic ? semantic[token as SemanticColor] : (token as ColorToken);
  return name in fixed ? fixed[name as FixedColor] : themed[scheme][name as ThemedColor];
}

/** `#RRGGBB` → `"R G B"`, the form Tailwind composes as `rgb(<triplet> / <alpha>)`. */
export function hexToTriplet(hex: Hex): string {
  const h = hex.slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ');
}

export const radius = {
  xs: 8,
  sm: 11,
  md: 18,
  lg: 22,
  xl: 26,
  pill: 999,
} as const;

/**
 * The 8pt scale equals Tailwind's default spacing (1 = 4px … 12 = 48px), so only layout
 * constants outside that scale are declared.
 */
export const layout = {
  tabbar: 62,
  appbar: 52,
  gutter: 20,
  tap: 44,
} as const;

/**
 * Type scale. Line heights are absolute pixels, not multipliers: React Native reads
 * `lineHeight` as px, so a unitless 1.06 would collapse lines on device even though it
 * renders fine on web.
 */
export const type = {
  display: { size: 34, lineHeight: 36 },
  'title-1': { size: 27, lineHeight: 29 },
  'title-2': { size: 21, lineHeight: 26 },
  'title-3': { size: 17, lineHeight: 21 },
  body: { size: 15, lineHeight: 22 },
  callout: { size: 14, lineHeight: 20 },
  foot: { size: 13, lineHeight: 19 },
  caption: { size: 12.5, lineHeight: 18 },
} as const;

/* PORT-NOTE: the prototype uses variable-font weights 450, 560, 620, 650, 660. Native text
   only honours whole hundreds, so those round to the nearest of the four below. The visual
   difference at these sizes is a fraction of a stroke. */
export const weight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/* PORT-NOTE: the prototype's `e-*` shadows are whisper-quiet box-shadows. RN 0.76+ accepts
   `boxShadow` natively, so the same strings are used on both platforms. */
export const elevation = {
  e1: '0 1px 2px rgba(42, 33, 28, 0.04)',
  e2: '0 2px 6px rgba(42, 33, 28, 0.05), 0 1px 1px rgba(42, 33, 28, 0.03)',
  e3: '0 8px 24px rgba(42, 33, 28, 0.08), 0 2px 6px rgba(42, 33, 28, 0.04)',
  e4: '0 -10px 40px rgba(42, 33, 28, 0.14)',
} as const;

/**
 * Motion. Easings are cubic-bezier control points — pass them to Reanimated as
 * `Easing.bezier(...easing.nav)`. Durations are the prototype's exact values.
 */
export const easing = {
  out: [0.22, 1, 0.36, 1],
  inout: [0.5, 0, 0.2, 1],
  nav: [0.32, 0.72, 0, 1],
} as const;

export const duration = {
  fast: 130,
  base: 215,
  slow: 360,
  push: 360,
  pop: 340,
  fadeOut: 180,
  scrimOut: 200,
  sheetIn: 400,
  sheetOut: 260,
  toastIn: 320,
  toastOut: 220,
  toastVisible: 4000,
  undoWindow: 5000,
  skeleton: 340,
} as const;

/** Distances and scales the prototype's keyframes animate through. */
export const motion = {
  pushOutX: -0.22,
  pushOutOpacity: 0.55,
  tabInY: 7,
  fadeInScale: 0.985,
  toastInY: -14,
  toastInScale: 0.97,
  pressScale: 0.985,
  scrimOpacity: 0.38,
} as const;

export const tokens = {
  themed,
  fixed,
  semantic,
  radius,
  layout,
  type,
  weight,
  elevation,
  easing,
  duration,
  motion,
} as const;
