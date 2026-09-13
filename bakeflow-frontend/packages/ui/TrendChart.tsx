import { useEffect, useMemo } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { ReduceMotion, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated';

import { curve } from './motion';

import { skia } from './skia';
import { Text } from './Text';
import { duration, fixed } from './tokens';

export interface TrendPoint {
  /** Plot height only — never displayed or summed. See `TrendChart`. */
  value: number;
  label: string;
}

/**
 * Catmull-Rom → cubic Bézier through the points: the prototype's smooth "flow" line.
 * `tension` matches its 0.42 so the curve has the same softness.
 */
function flowPath(pts: readonly { x: number; y: number }[], tension = 0.42): string {
  if (pts.length === 0) return '';
  const first = pts[0];
  if (first === undefined) return '';
  let d = `M${first.x},${first.y}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    if (p0 === undefined || p1 === undefined || p2 === undefined || p3 === undefined) continue;
    const c1x = p1.x + ((p2.x - p0.x) / 6) * (tension * 3);
    const c1y = p1.y + ((p2.y - p0.y) / 6) * (tension * 3);
    const c2x = p2.x - ((p3.x - p1.x) / 6) * (tension * 3);
    const c2y = p2.y - ((p3.y - p1.y) / 6) * (tension * 3);
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2.x},${p2.y}`;
  }
  return d;
}

/**
 * The prototype's hero line chart: an apricot flow line over a soft fading area, with the
 * active day marked and day labels beneath.
 *
 * ## Values are plot coordinates, not money
 *
 * Callers pass numbers derived from exact decimal strings purely to position the line. They
 * are never shown, summed, compared for business purposes or written anywhere; every figure a
 * person reads is formatted from the original string elsewhere on the screen. A chart cannot
 * be drawn without converting to a coordinate, and this is the only place that conversion is
 * allowed to happen.
 *
 * ## Entrance only
 *
 * The line draws left to right while the area fades up behind it (Skia `end` and `opacity`
 * driven by a Reanimated shared value, 620ms on the out curve), then holds still — the
 * prototype's rule that data which keeps moving is data you cannot read. It redraws when the
 * data changes, and appears instantly under Reduce Motion.
 *
 * One Skia canvas per chart (charts are few per screen), created through the lazy `skia()`
 * accessor so it is safe on web.
 */
export function TrendChart({
  points,
  activeIndex = points.length - 1,
  height = 104,
  onDark = false,
  accessibilityLabel,
}: {
  points: readonly TrendPoint[];
  activeIndex?: number;
  height?: number;
  onDark?: boolean;
  accessibilityLabel: string;
}): React.JSX.Element {
  const { width: screen } = useWindowDimensions();
  const width = Math.max(200, screen - 40);
  const { Canvas, Path, LinearGradient, Circle, vec, Group } = skia();

  const geometry = useMemo(() => {
    const padX = 20;
    const padT = 14;
    const padB = 10;
    const values = points.map((p) => p.value);
    const max = Math.max(...values, 0) * 1.1;
    const min = Math.min(...values, 0) * 0.72;
    const span = max - min || 1;
    const x = (i: number): number => padX + (width - padX * 2) * (points.length > 1 ? i / (points.length - 1) : 0.5);
    const y = (v: number): number => padT + (height - padT - padB) * (1 - (v - min) / span);
    const pts = points.map((p, i) => ({ x: x(i), y: y(p.value) }));
    const line = flowPath(pts);
    const last = pts[pts.length - 1];
    const firstPt = pts[0];
    const area =
      last !== undefined && firstPt !== undefined
        ? `${line} L${last.x},${height - padB + 6} L${firstPt.x},${height - padB + 6} Z`
        : '';
    return { pts, line, area };
  }, [points, width, height]);

  const active = geometry.pts[activeIndex];

  const drawn = useSharedValue(0);
  useEffect(() => {
    drawn.value = 0;
    drawn.value = withTiming(1, { duration: duration.chartDraw, easing: curve('out'), reduceMotion: ReduceMotion.System });
  }, [geometry.line, drawn]);
  const areaOpacity = useDerivedValue(() => drawn.value);
  const dotOpacity = useDerivedValue(() => (drawn.value > 0.92 ? (drawn.value - 0.92) / 0.08 : 0));

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <Canvas style={{ width, height }}>
        {geometry.area !== '' && (
          <Path path={geometry.area} opacity={areaOpacity}>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(0, height)}
              colors={[onDark ? 'rgba(229,138,91,0.34)' : 'rgba(229,138,91,0.22)', 'rgba(229,138,91,0)']}
            />
          </Path>
        )}
        {geometry.line !== '' && (
          <Path path={geometry.line} start={0} end={drawn} style="stroke" strokeWidth={2.6} strokeCap="round" strokeJoin="round" color={fixed.apricot} />
        )}
        {active !== undefined && (
          <Group opacity={dotOpacity}>
            <Circle cx={active.x} cy={active.y} r={6} color={onDark ? fixed.ink : '#FFFFFF'} />
            <Circle cx={active.x} cy={active.y} r={4} color={fixed.apricot} />
          </Group>
        )}
      </Canvas>
      <View className="mt-1 flex-row justify-between px-5">
        {points.map((p, i) => (
          <Text
            key={`${p.label}-${i}`}
            className={`text-[11px] ${i === activeIndex ? (onDark ? 'font-bold text-white' : 'font-bold text-cocoa') : onDark ? 'text-white/45' : 'text-warm-gray-soft'}`}
          >
            {p.label}
          </Text>
        ))}
      </View>
    </View>
  );
}
