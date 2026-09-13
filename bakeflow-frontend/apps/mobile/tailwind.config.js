/** @type {import('tailwindcss').Config} */
// Tailwind MUST stay on the v3 line: nativewind@4.2.6 depends on
// react-native-css-interop@0.2.6, whose peer range is `tailwindcss: ~3`.
// Tailwind v4 breaks NativeWind 4.2.6.
//
// ---------------------------------------------------------------------------
// DESIGN TOKENS
// Ported from the design prototype's single source of truth:
//   "# BakeFlow frontend design/export/bakeflow-frontend/css/tokens.css"
// Keep the two in step — that file is still the living visual spec.
//
// Colours that flip between light and dark are declared here as CSS variables
// and given their VALUES in global.css, so a theme switch happens in one
// place. The `rgb(var(--x) / <alpha-value>)` form is what makes opacity
// utilities (`bg-cream/50`) work.
//
// Colours that do NOT change between themes — apricot, success, warning,
// error, info, ink — are plain hex, because the prototype doesn't flip them.
// ---------------------------------------------------------------------------

/** Themeable colours. Values live in global.css under :root and .dark. */
const THEMED = [
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
];

const themedColors = Object.fromEntries(
  THEMED.map((k) => [k, `rgb(var(--bf-${k}) / <alpha-value>)`])
);

module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './features/**/*.{js,jsx,ts,tsx}',
    './navigation/**/*.{js,jsx,ts,tsx}',
    './providers/**/*.{js,jsx,ts,tsx}',
    // Shared design-system components live outside this app. Tailwind only
    // generates classes it can see, so packages/ui must be scanned or its
    // styles silently will not exist in the bundle.
    '../../packages/ui/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ...themedColors,
        // Fixed across themes — an always-dark surface and the semantics.
        ink: '#2A211C',
        'ink-soft': '#43362E',
        apricot: '#E58A5B',
        'apricot-deep': '#C8703F',
        success: '#3E8F68',
        warning: '#D49A3A',
        error: '#C95C54',
        info: '#5B7FA6',
      },
      // The prototype's 8pt space scale already matches Tailwind's default
      // (1=4px … 12=48px), so spacing is deliberately NOT overridden.
      borderRadius: {
        xs: '8px',
        sm: '11px',
        md: '18px',
        lg: '22px',
        xl: '26px',
        pill: '999px',
      },
      fontSize: {
        display: ['34px', { lineHeight: '1.06' }],
        'title-1': ['27px', { lineHeight: '1.06' }],
        'title-2': ['21px', { lineHeight: '1.25' }],
        'title-3': ['17px', { lineHeight: '1.25' }],
        body: ['15px', { lineHeight: '1.45' }],
        callout: ['14px', { lineHeight: '1.45' }],
        foot: ['13px', { lineHeight: '1.45' }],
        caption: ['12.5px', { lineHeight: '1.45' }],
      },
      lineHeight: { tight: '1.06', snug: '1.25', body: '1.45' },
      spacing: {
        // Layout constants that aren't part of the 8pt scale.
        tabbar: '62px',
        appbar: '52px',
        gutter: '20px',
        tap: '44px', // minimum comfortable touch target
      },
      // NOTE: on native these degrade to elevation with limited fidelity —
      // they are correct on web and harmless (no shadow) if unsupported.
      boxShadow: {
        e1: '0 1px 2px rgba(42, 33, 28, .04)',
        e2: '0 2px 6px rgba(42, 33, 28, .05), 0 1px 1px rgba(42, 33, 28, .03)',
        e3: '0 8px 24px rgba(42, 33, 28, .08), 0 2px 6px rgba(42, 33, 28, .04)',
        e4: '0 -10px 40px rgba(42, 33, 28, .14)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(.22, 1, .36, 1)',
        inout: 'cubic-bezier(.5, 0, .2, 1)',
        nav: 'cubic-bezier(.32, .72, 0, 1)',
      },
      transitionDuration: { fast: '130ms', base: '215ms', slow: '360ms' },
    },
  },
  plugins: [],
};
