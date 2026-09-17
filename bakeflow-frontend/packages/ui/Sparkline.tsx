import { useMemo } from 'react';
import { View } from 'react-native';

import { skia } from './skia';
import { colorFor, type ColorToken } from './tokens';
import { useScheme } from './ThemeProvider';

/**
 * The prototype's `spark()`: a small unlabeled trend line (80 × 28 on the branch cards).
 *
 * Values are plot coordinates only, as in `TrendChart` — every figure a person reads is formatted
 * from its exact string elsewhere. Drawn once, without an entrance animation (the prototype's
 * sparklines are static).
 */
export function Sparkline({
  values,
  width = 80,
  height = 28,
  color = 'success',
  accessibilityLabel,
}: {
  values: readonly number[];
  width?: number;
  height?: number;
  color?: ColorToken;
  accessibilityLabel?: string;
}): React.JSX.Element {
  const scheme = useScheme();
  const { Canvas, Path } = skia();
  const path = useMemo(() => {
    if (values.length === 0) return '';
    const pad = 2;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || 1;
    return values
      .map((v, i) => {
        const x = pad + (width - pad * 2) * (values.length > 1 ? i / (values.length - 1) : 0.5);
        const y = pad + (height - pad * 2) * (1 - (v - min) / span);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [values, width, height]);

  return (
    <View accessible={accessibilityLabel !== undefined} accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <Canvas style={{ width, height }}>
        {path !== '' && (
          <Path path={path} style="stroke" strokeWidth={1.8} strokeCap="round" strokeJoin="round" color={colorFor(scheme, color)} />
        )}
      </Canvas>
    </View>
  );
}
