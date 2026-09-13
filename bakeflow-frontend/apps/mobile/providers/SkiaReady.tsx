import type { ReactNode } from 'react';

/**
 * Skia is linked natively on iOS and Android, so there is nothing to wait for.
 * The web preview has its own implementation in `SkiaReady.web.tsx`.
 */
export function SkiaReady({ children }: { children: ReactNode }): React.JSX.Element {
  return <>{children}</>;
}
