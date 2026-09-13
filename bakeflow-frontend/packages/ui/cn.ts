/**
 * Join class strings, dropping falsy entries.
 *
 * Caller-supplied classes are appended last so they win — NativeWind resolves
 * conflicts by source order, not specificity, so "last wins" is the only way a
 * consumer can override a component's defaults.
 */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}
