/**
 * Chunked key/value storage — the session-persistence half of `@bakeflow/auth`.
 *
 * Split from `index.ts` and parameterised by its backend for the same reason `claims.ts`
 * was: `index.ts` imports `expo-secure-store`, which pulls in `react-native`, whose
 * Flow-typed entry point Node cannot parse. The chunking logic itself has no native
 * dependency, and it is the part with real failure modes — torn writes, orphaned tail
 * chunks — so it belongs where it can be exercised.
 *
 * ## Why chunking exists
 *
 * `expo-secure-store` rejects values over roughly 2048 bytes on Android. A Supabase session
 * is JSON containing an access-token JWT, a refresh token and a user object, and routinely
 * exceeds that. Storing it whole fails on exactly the devices this app targets.
 *
 * ## The commit-point rule
 *
 * The chunk count is written **last**. It is what `getItem` trusts, so until it lands there
 * is no readable value. A process killed midway through writing leaves orphan chunks and no
 * count, and the next read reports "no session" rather than reassembling a truncated one —
 * which would hand supabase-js a valid-looking access token with no refresh token.
 *
 * Correspondingly the previous value's chunks are cleared **first**: a shorter new value
 * would otherwise leave the old tail in place for `getItem` to concatenate.
 */

/** The subset of a key/value store this needs. `expo-secure-store` satisfies it. */
export interface KeyValueBackend {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

/**
 * Well under SecureStore's ~2048-byte Android limit. The margin covers the key name and the
 * platform's own encoding overhead, neither of which this code can measure portably.
 */
export const CHUNK_SIZE = 1536;

/** SecureStore keys must match `[A-Za-z0-9._-]+`. Enforced rather than assumed. */
function sanitize(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

const countKey = (key: string): string => `${sanitize(key)}.n`;
const chunkKey = (key: string, index: number): string => `${sanitize(key)}.${index}`;

export interface ChunkedStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function createChunkedStorage(backend: KeyValueBackend): ChunkedStorage {
  async function readChunkCount(key: string): Promise<number> {
    const raw = await backend.getItemAsync(countKey(key));
    if (raw === null) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
  }

  async function clearChunks(key: string, count: number): Promise<void> {
    const deletions: Promise<void>[] = [backend.deleteItemAsync(countKey(key))];
    for (let i = 0; i < count; i += 1) deletions.push(backend.deleteItemAsync(chunkKey(key, i)));
    await Promise.all(deletions);
  }

  return {
    async getItem(key: string): Promise<string | null> {
      try {
        const count = await readChunkCount(key);
        if (count === 0) return null;
        const parts: string[] = [];
        for (let i = 0; i < count; i += 1) {
          const part = await backend.getItemAsync(chunkKey(key, i));
          // A missing interior chunk means the store is torn. Half a session is worse than
          // none — see the commit-point note above.
          if (part === null) return null;
          parts.push(part);
        }
        return parts.join('');
      } catch {
        // A read failure is reported as "no session", which lands the user on sign-in. A
        // throw here would surface as an unrecoverable error on a screen with no way out.
        return null;
      }
    },

    async setItem(key: string, value: string): Promise<void> {
      // Clear first: a shorter new value must not leave the old tail readable.
      await clearChunks(key, await readChunkCount(key));

      const chunks: string[] = [];
      for (let i = 0; i < value.length; i += CHUNK_SIZE) {
        chunks.push(value.slice(i, i + CHUNK_SIZE));
      }
      for (let i = 0; i < chunks.length; i += 1) {
        await backend.setItemAsync(chunkKey(key, i), chunks[i] ?? '');
      }
      // Commit point. Deliberately last — a write failure propagates rather than being
      // swallowed, because silently failing to persist produces an app that looks signed
      // in until the next cold start.
      await backend.setItemAsync(countKey(key), String(chunks.length));
    },

    async removeItem(key: string): Promise<void> {
      await clearChunks(key, await readChunkCount(key));
    },
  };
}
