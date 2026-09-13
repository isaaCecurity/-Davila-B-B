/** @type {import('tailwindcss').Config} */
// Tailwind MUST stay on the v3 line: nativewind@4.2.6 depends on
// react-native-css-interop@0.2.6, whose peer range is `tailwindcss: ~3`.
// Tailwind v4 breaks NativeWind 4.2.6.
//
// Every value comes from packages/ui/tokens.ts — nothing is declared here. Requiring a
// .ts file works because tailwindcss@3.4.17 always loads its config through jiti with a
// TypeScript transform (see lib/lib/load-config.js), which applies to nested requires.
//
// Themeable colours are CSS variables. Their VALUES are set at runtime by
// packages/ui/ThemeProvider via NativeWind's vars(), which is what flips light/dark on
// native. The `:root` block below is generated from the same tokens as a first-paint
// fallback for web.
const {
  THEMED_COLORS,
  themed,
  fixed,
  radius,
  layout,
  type,
  elevation,
  duration,
  easing,
  hexToTriplet,
} = require('../../packages/ui/tokens.ts');

const px = (n) => `${n}px`;
const map = (obj, fn) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v)]));

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
        ...Object.fromEntries(
          THEMED_COLORS.map((k) => [k, `rgb(var(--bf-${k}) / <alpha-value>)`])
        ),
        ...fixed,
      },
      borderRadius: map(radius, px),
      spacing: map(layout, px),
      minHeight: map(layout, px),
      fontSize: map(type, (t) => [px(t.size), { lineHeight: px(t.lineHeight) }]),
      boxShadow: elevation,
      transitionDuration: map(duration, (ms) => `${ms}ms`),
      transitionTimingFunction: map(easing, (b) => `cubic-bezier(${b.join(', ')})`),
    },
  },
  plugins: [
    ({ addBase }) =>
      addBase({
        ':root': Object.fromEntries(
          THEMED_COLORS.map((k) => [`--bf-${k}`, hexToTriplet(themed.light[k])])
        ),
      }),
  ],
};
