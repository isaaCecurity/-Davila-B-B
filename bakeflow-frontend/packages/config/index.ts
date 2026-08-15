/**
 * @bakeflow/config — runtime configuration, resolved once and validated loudly.
 *
 * ## Why this exists rather than reading `process.env` at each call site
 *
 * Expo inlines `process.env.EXPO_PUBLIC_*` at build time. A missing variable therefore
 * becomes the string `"undefined"` or an empty string in the bundle rather than throwing,
 * and `createClient("", "")` fails later with a confusing network error on the first
 * query. Resolving here means a misconfigured build fails at startup with a message that
 * names the variable.
 *
 * ## Only `EXPO_PUBLIC_` variables belong here
 *
 * Anything without that prefix is stripped from the client bundle. That is a feature: the
 * **service-role key must never be referenced by this app at all.** RLS does not constrain
 * a service-role caller (`API-CONTRACT.md` §165), so a service-role key reaching a phone
 * would defeat every policy in the database at once. The anon/publishable key is the only
 * key a client may hold, and it is safe precisely because RLS *does* constrain it.
 */

/** Read an `EXPO_PUBLIC_` variable, failing with an actionable message when absent. */
function required(name: string, value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  // `"undefined"` is checked explicitly: Expo's inlining turns a missing variable into
  // that literal string in some configurations, which is truthy and would sail past a
  // plain falsy check.
  if (trimmed === '' || trimmed === 'undefined') {
    throw new Error(
      `${name} is not set. Copy apps/mobile/.env.example to apps/mobile/.env and fill it ` +
        'in, then restart the bundler with `npx expo start --clear` — Expo inlines these ' +
        'at build time, so a running bundler will not pick up the change.',
    );
  }
  return trimmed;
}

export interface BakeflowConfig {
  supabaseUrl: string;
  /** The anon/publishable key. Never the service-role key — see the module note. */
  supabaseAnonKey: string;
}

let cached: BakeflowConfig | null = null;

/**
 * The resolved configuration.
 *
 * Lazy and memoised rather than a module-level constant, so that importing anything from
 * this package does not throw at import time. A throw during module evaluation in React
 * Native surfaces as an unrecoverable red screen with no component stack; throwing from a
 * call lets a provider catch it and render something a user can act on.
 */
export function getConfig(): BakeflowConfig {
  if (cached === null) {
    cached = {
      supabaseUrl: required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
      supabaseAnonKey: required(
        'EXPO_PUBLIC_SUPABASE_ANON_KEY',
        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      ),
    };
  }
  return cached;
}

/** Test seam. Not used by the app. */
export function resetConfigForTests(): void {
  cached = null;
}
