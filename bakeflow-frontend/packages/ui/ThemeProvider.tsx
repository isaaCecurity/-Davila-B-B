import { useColorScheme, vars } from 'nativewind';
import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';

import { hexToTriplet, THEMED_COLORS, themed, type ColorScheme } from './tokens';

/** The prototype's theme setting: an explicit scheme, or follow the device. */
export type ThemePreference = ColorScheme | 'system';

function schemeVars(scheme: ColorScheme): ReturnType<typeof vars> {
  return vars(
    Object.fromEntries(
      THEMED_COLORS.map((k) => [`--bf-${k}`, hexToTriplet(themed[scheme][k])])
    )
  );
}

/* Built once at module scope — NativeWind recommends against creating vars() per render. */
const SCHEME_VARS: Record<ColorScheme, ReturnType<typeof vars>> = {
  light: schemeVars('light'),
  dark: schemeVars('dark'),
};

/**
 * Applies the theme preference and sets the themeable colour variables on the root.
 *
 * vars() on an ancestor is NativeWind's documented runtime theming path and behaves the
 * same on native and web. The preference must be applied explicitly: with
 * `darkMode: 'class'`, NativeWind's web runtime initialises to an explicit "light" unless
 * `<html>` already carries the `dark` class, so it never falls back to the device setting
 * on its own — `setColorScheme('system')` is what hands control back to the OS.
 */
export function ThemeProvider({
  preference = 'system',
  children,
}: {
  preference?: ThemePreference;
  children: ReactNode;
}): React.JSX.Element {
  const { colorScheme, setColorScheme } = useColorScheme();

  useEffect(() => {
    setColorScheme(preference);
  }, [preference, setColorScheme]);

  const scheme: ColorScheme = colorScheme === 'dark' ? 'dark' : 'light';
  // The ground is painted here too: navigator scenes are transparent, so without it any gap
  // between screens shows the navigator's default grey instead of cream.
  return (
    <View className="flex-1 bg-cream" style={SCHEME_VARS[scheme]}>
      {children}
    </View>
  );
}

/** The active scheme, for consumers that need literal colours (spinners, SVG, Reanimated). */
export function useScheme(): ColorScheme {
  const { colorScheme } = useColorScheme();
  return colorScheme === 'dark' ? 'dark' : 'light';
}
