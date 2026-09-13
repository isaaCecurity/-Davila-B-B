/**
 * User preferences (docs/FRONTEND-STRUCTURE.md §3, `settings` store).
 *
 * Holds the prototype's theme setting — light, dark, or follow the device — and persists it.
 * Storage follows `@bakeflow/auth`'s platform split: SecureStore on device, `localStorage`
 * only in the web development preview, where SecureStore has no implementation.
 */

import type { ThemePreference } from '@bakeflow/ui';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';

const THEME_KEY = 'bakeflow.theme';
const PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

async function read(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function write(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

interface SettingsState {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  /** Load persisted preferences once at startup. Failure keeps the defaults. */
  hydrate: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: 'system',

  setTheme: (theme) => {
    set({ theme });
    // Fire-and-forget: an unwritable keystore should not undo a choice the user can see.
    void write(THEME_KEY, theme).catch(() => undefined);
  },

  hydrate: async () => {
    try {
      const stored = await read(THEME_KEY);
      if (stored !== null && (PREFERENCES as readonly string[]).includes(stored)) {
        set({ theme: stored as ThemePreference });
      }
    } catch {
      // Unreadable storage: stay on "system".
    }
  },
}));
