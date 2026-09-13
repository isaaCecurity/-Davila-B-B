import { useMemo } from 'react';
import { Image, PixelRatio } from 'react-native';

import { ICONS, type IconName, type IconPart } from './icons';
import { skia } from './skia';
import { useScheme } from './ThemeProvider';
import { colorFor, type ColorToken, type SemanticColor } from './tokens';

export type { IconName } from './icons';

export interface IconProps {
  name: IconName;
  size?: number;
  /** A token or semantic role — never a raw colour, so icons follow the theme. */
  color?: ColorToken | SemanticColor;
  strokeWidth?: number;
}

/** Rasterised icons, keyed by everything that changes the pixels. */
const rasterCache = new Map<string, string>();

/**
 * Draws an icon once, at device pixel density, into a CPU raster surface and returns it as a
 * PNG data URI.
 *
 * Why not a live Skia `<Canvas>` per icon: on web every canvas holds its own WebGL context and
 * browsers keep only ~16 alive, so a screen with more icons than that silently loses the
 * oldest (observed: tab icons vanishing after opening a list). On native each canvas is its own
 * GPU surface — real cost in long lists on the low-end Android devices this app targets. A
 * raster surface uses no GL context, and the cached image renders as a plain `<Image>`.
 */
function rasterise(name: IconName, px: number, hex: string, strokeWidth: number): string {
  const key = `${name}|${px}|${hex}|${strokeWidth}`;
  const hit = rasterCache.get(key);
  if (hit !== undefined) return hit;

  const { Skia, PaintStyle, StrokeCap, StrokeJoin } = skia();
  const surface = Skia.Surface.Make(px, px);
  if (surface === null) return '';

  const canvas = surface.getCanvas();
  canvas.scale(px / 24, px / 24);
  const color = Skia.Color(hex);
  const parts: readonly IconPart[] = ICONS[name];

  for (const part of parts) {
    const path = Skia.Path.MakeFromSVGString(part.d);
    if (path === null) continue;
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setColor(color);
    paint.setAlphaf(part.opacity ?? 1);
    if (part.fill === true) {
      paint.setStyle(PaintStyle.Fill);
      canvas.drawPath(path, paint);
    }
    if (part.stroke !== false) {
      paint.setStyle(PaintStyle.Stroke);
      paint.setStrokeWidth(strokeWidth);
      paint.setStrokeCap(StrokeCap.Round);
      paint.setStrokeJoin(StrokeJoin.Round);
      canvas.drawPath(path, paint);
    }
  }

  surface.flush();
  const uri = `data:image/png;base64,${surface.makeImageSnapshot().encodeToBase64()}`;
  rasterCache.set(key, uri);
  return uri;
}

/**
 * The prototype's icon family: 24-unit grid, 1.65 stroke, round caps and joins.
 *
 * Decorative by default — the surrounding control's label is what screen readers announce.
 * Geometry is drawn with Skia (react-native-svg is not a dependency) but displayed as a cached
 * image; see `rasterise` for why.
 */
export function Icon({
  name,
  size = 20,
  color = 'textPrimary',
  strokeWidth = 1.65,
}: IconProps): React.JSX.Element {
  const hex = colorFor(useScheme(), color);
  const px = PixelRatio.getPixelSizeForLayoutSize(size);
  const uri = useMemo(() => rasterise(name, px, hex, strokeWidth), [name, px, hex, strokeWidth]);

  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size }}
      accessible={false}
      aria-hidden
      fadeDuration={0}
    />
  );
}
