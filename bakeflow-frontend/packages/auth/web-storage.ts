/**
 * A `KeyValueBackend` over `localStorage`, for **web previews only**.
 *
 * ## Read this before using it for anything
 *
 * `expo-secure-store` has no web implementation. It is the Android Keystore and the iOS
 * Keychain, and neither exists in a browser. Importing it under `react-native-web` gives a
 * module whose methods reject at runtime, so the first `getSession()` on web throws and the
 * app never renders.
 *
 * This backend exists so the app can be **looked at** in a browser during development. It is
 * emphatically *not* the session storage this project specifies:
 *
 * - `localStorage` is plaintext, readable by any script running on the origin.
 * - It is exactly the "general-purpose unencrypted storage" that the AD-014 note at the top
 *   of `index.ts` says the session must never touch.
 * - Chunking is preserved only so the web path exercises the same code as the device path.
 *   `localStorage` has no ~2048-byte limit, so the chunking buys nothing here.
 *
 * Native builds are unaffected: `index.ts` selects this backend only when
 * `Platform.OS === 'web'`, so iOS and Android continue to use SecureStore exclusively.
 *
 * **A production web app must not ship this.** The web workspace is reserved but unbuilt
 * (see `docs/FRONTEND-STRUCTURE.md`); when it is built, its session storage is a decision to
 * be made deliberately, not inherited from this file. Recorded as TECHNICAL_DEBT.
 */

import type { KeyValueBackend } from './chunked-storage';

/**
 * Resolved lazily rather than at module load: React Native Web evaluates modules in
 * environments (SSR, static export) where `window` is not yet defined, and throwing there
 * would break the bundle rather than the one call that actually needs storage.
 */
function store(): Storage {
  if (typeof globalThis.localStorage === 'undefined') {
    throw new Error(
      'Web session storage is unavailable: this environment has no localStorage. ' +
        'The web target is a development preview only — see packages/auth/web-storage.ts.',
    );
  }
  return globalThis.localStorage;
}

export const webSessionBackend: KeyValueBackend = {
  getItemAsync(key: string): Promise<string | null> {
    return Promise.resolve(store().getItem(key));
  },
  setItemAsync(key: string, value: string): Promise<void> {
    store().setItem(key, value);
    return Promise.resolve();
  },
  deleteItemAsync(key: string): Promise<void> {
    store().removeItem(key);
    return Promise.resolve();
  },
};
