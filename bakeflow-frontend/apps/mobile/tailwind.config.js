/** @type {import('tailwindcss').Config} */
// Tailwind MUST stay on the v3 line: nativewind@4.2.6 depends on
// react-native-css-interop@0.2.6, whose peer range is `tailwindcss: ~3`.
// Tailwind v4 breaks NativeWind 4.2.6.
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
  theme: { extend: {} },
  plugins: [],
};
