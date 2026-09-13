import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';
import { useEffect, useState, type ReactNode } from 'react';

/**
 * Web preview only: holds the tree until Skia's CanvasKit (WebAssembly) has loaded.
 *
 * This works only together with `@bakeflow/ui`'s lazy `skia()` accessor. Skia binds to
 * CanvasKit when its module is first evaluated, so the module must not be evaluated until
 * after this gate opens — every Skia import in the app goes through that accessor for exactly
 * that reason. (Loading CanvasKit in a custom entry and dynamically importing the app was
 * tried first; the static web export cannot resolve that lazy chunk.)
 *
 * The binary is served from `public/canvaskit.wasm` (gitignored; regenerate with the command
 * recorded in apps/mobile/.gitignore). Metro resolves this `.web.tsx` variant for web only.
 */
export function SkiaReady({ children }: { children: ReactNode }): React.JSX.Element | null {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void LoadSkiaWeb({ locateFile: (file: string) => `/${file}` }).then(() => {
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  return ready ? <>{children}</> : null;
}
