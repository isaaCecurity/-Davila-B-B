/**
 * Lazy access to React Native Skia.
 *
 * On web, Skia binds its API to CanvasKit the moment its module is first evaluated
 * (`export const Skia = JsiSkApi(global.CanvasKit)` in skia/Skia.web.js). A top-level import
 * evaluates it at bundle load — before the WebAssembly binary exists — and every icon then
 * draws blank for the life of the page. Requiring it inside a function keeps it in the bundle
 * but defers evaluation to first use, which the app's web gate (providers/SkiaReady.web.tsx)
 * holds until CanvasKit has loaded. Native is unaffected: Skia is linked in and ready.
 *
 * Every Skia import in this package goes through here. A static
 * `import … from '@shopify/react-native-skia'` would silently reintroduce the blank icons.
 */

type SkiaModule = typeof import('@shopify/react-native-skia');

let cached: SkiaModule | null = null;

export function skia(): SkiaModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred evaluation is the point; see above
  cached ??= require('@shopify/react-native-skia') as SkiaModule;
  return cached;
}
