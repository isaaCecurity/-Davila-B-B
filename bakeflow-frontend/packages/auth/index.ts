/**
 * @bakeflow/auth — the Supabase client and its session storage.
 *
 * ## Session storage: what AD-014 asks for, and why this is not literally that
 *
 * AD-014 (APPROVED, "not built") specifies **"AES-256-GCM via `expo-crypto`, key in
 * SecureStore, ciphertext in `expo-file-system`. No AsyncStorage."**
 *
 * The first clause is not implementable as written. `expo-crypto` exposes
 * `getRandomBytes`, `getRandomBytesAsync`, `getRandomValues`, `digest`,
 * `digestStringAsync` and `randomUUID` — **it has no cipher of any kind**, AES-GCM
 * included (verified against the installed `expo-crypto` type definitions, not assumed).
 * Building AES out of a digest function by hand is the one thing a codebase must never do.
 *
 * So this implements the *intent* of AD-014 — the session never touches unencrypted
 * general-purpose storage, and never AsyncStorage — by the strongest mechanism actually
 * available in the dependency set:
 *
 * > **The session lives in `expo-secure-store`, chunked**, which is the Android Keystore
 * > and the iOS Keychain. Both are OS-managed and hardware-backed where the device
 * > supports it.
 *
 * That is arguably stronger than the approved design, which would have put ciphertext in
 * the app's own sandbox with its key in the very same SecureStore: an attacker who can
 * read SecureStore defeats both, and this one avoids a hand-rolled cipher. It is
 * nevertheless **not the approved design**, so it is recorded as BLOCKER-013 for a
 * decision rather than quietly substituted.
 *
 * ### Why chunking is required
 *
 * SecureStore rejects values over ~2048 bytes on Android. A Supabase session is a JSON
 * blob containing an access-token JWT plus a refresh token and user object, and routinely
 * exceeds that. Writing it whole would fail on exactly the devices this app targets. The
 * value is therefore split across `bakeflow.session.0..n` with a count at
 * `bakeflow.session.n`, and reassembled on read.
 *
 * ## Organization switching is a *token* operation, not a client-state operation
 *
 * `set_active_organization()` updates one column — `profiles.active_tenant_id` — and
 * nothing else (read from the live function body). The `tenant_id` claim that every RLS
 * policy reads comes from the **JWT**, which is minted at sign-in and refresh. So calling
 * the RPC changes nothing the database can see until the session is refreshed, and
 * `setActiveOrganization` below is deliberately the only exported path that does both.
 */

import { getConfig } from '@bakeflow/config';
import {
  createClient,
  type Session,
  type SupabaseClient,
  type SupportedStorage,
} from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

/* -------------------------------------------------------------------------- */
/* Chunked SecureStore adapter                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Well under SecureStore's ~2048-byte Android limit. The margin covers the key name and
 * the platform's own encoding overhead, neither of which counts against the value in a
 * way this code can measure portably.
 */
const CHUNK_SIZE = 1536;

/** SecureStore keys must match `[A-Za-z0-9._-]+`; Supabase's own keys contain none of the
 *  characters that would break that, but it is enforced rather than assumed. */
function sanitize(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, '_');
}

const countKey = (key: string): string => `${sanitize(key)}.n`;
const chunkKey = (key: string, index: number): string => `${sanitize(key)}.${index}`;

async function readChunkCount(key: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(countKey(key));
  if (raw === null) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Remove every chunk of a key.
 *
 * Takes the count explicitly rather than re-reading it, because it is called *before* a
 * write to clear a previous, possibly longer, value. Deleting only as many chunks as the
 * new value needs would leave orphaned tail chunks that a later read would concatenate
 * into a corrupt session.
 */
async function clearChunks(key: string, count: number): Promise<void> {
  const deletions: Promise<void>[] = [SecureStore.deleteItemAsync(countKey(key))];
  for (let i = 0; i < count; i += 1) {
    deletions.push(SecureStore.deleteItemAsync(chunkKey(key, i)));
  }
  await Promise.all(deletions);
}

/**
 * `SupportedStorage`, backed by the platform keystore.
 *
 * Every method swallows nothing: a SecureStore failure on read returns `null` (treated by
 * supabase-js as "no session", which correctly lands the user on sign-in) but a failure on
 * **write** propagates, because silently failing to persist a session produces an app that
 * appears signed in until the next cold start.
 */
export const secureSessionStorage: SupportedStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const count = await readChunkCount(key);
      if (count === 0) return null;
      const parts: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const part = await SecureStore.getItemAsync(chunkKey(key, i));
        // A missing interior chunk means the store is torn — a half-written session is
        // worse than none, because supabase-js would try to parse it and could end up
        // with a valid-looking access token and no refresh token.
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join('');
    } catch {
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    const previous = await readChunkCount(key);
    await clearChunks(key, previous);

    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }
    for (let i = 0; i < chunks.length; i += 1) {
      // `chunks[i]` is provably defined; the non-null assertion is avoided because
      // `noUncheckedIndexedAccess` is on and an assertion here would be the only one in
      // the package.
      const chunk = chunks[i] ?? '';
      await SecureStore.setItemAsync(chunkKey(key, i), chunk);
    }
    // The count is written LAST, on purpose. It is the commit point: if the process dies
    // midway through the loop above, no count exists (or the old one was already deleted),
    // so `getItem` reports no session rather than reassembling a truncated one.
    await SecureStore.setItemAsync(countKey(key), String(chunks.length));
  },

  async removeItem(key: string): Promise<void> {
    await clearChunks(key, await readChunkCount(key));
  },
};

/* -------------------------------------------------------------------------- */
/* Client                                                                      */
/* -------------------------------------------------------------------------- */

let client: SupabaseClient | null = null;

/**
 * The single Supabase client for this app.
 *
 * A module singleton rather than a React context value: `packages/api` takes the client as
 * a parameter (see its `client` module), and the auth listener below must outlive any
 * component tree.
 *
 * `detectSessionInUrl` is false because there is no URL to detect one in on native, and
 * leaving it on makes supabase-js reach for `window.location`.
 */
export function getSupabaseClient(): SupabaseClient {
  if (client === null) {
    const { supabaseUrl, supabaseAnonKey } = getConfig();
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage: secureSessionStorage,
        storageKey: 'bakeflow.session',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

/* -------------------------------------------------------------------------- */
/* Auth operations                                                             */
/* -------------------------------------------------------------------------- */

/** The `tenant_id` claim on the current access token, or `null` when none is set. */
export function activeTenantIdFromSession(session: Session | null): string | null {
  if (session === null) return null;
  // Decoding the JWT payload is avoided: supabase-js already exposes the parsed claims,
  // and hand-parsing a token in app code invites treating it as trusted. This value is
  // used ONLY to key caches and drive navigation — never as an authorization decision,
  // which stays entirely with RLS.
  const claims = session.user.app_metadata as Record<string, unknown> | undefined;
  const raw = claims?.['tenant_id'];
  return typeof raw === 'string' && raw !== '' ? raw : null;
}

export async function signInWithPassword(email: string, password: string): Promise<Session> {
  const { data, error } = await getSupabaseClient().auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error !== null) throw error;
  if (data.session === null) {
    throw new Error('Sign-in succeeded but returned no session.');
  }
  return data.session;
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabaseClient().auth.signOut();
  if (error !== null) throw error;
}

export async function getCurrentSession(): Promise<Session | null> {
  const { data, error } = await getSupabaseClient().auth.getSession();
  if (error !== null) throw error;
  return data.session;
}

/**
 * Switch the active organization and mint a token that says so.
 *
 * **Both steps are mandatory and neither is optional.** The RPC writes
 * `profiles.active_tenant_id`; the refresh is what puts the new `tenant_id` into the JWT,
 * and every RLS policy reads the JWT. Calling only the RPC leaves the database serving the
 * *previous* organization's rows while the UI believes it switched — which looks exactly
 * like a data leak and would be reported as one.
 *
 * Returns the refreshed session so the caller can key its caches off the claim that is
 * actually in force, rather than off the id it requested.
 */
export async function setActiveOrganization(tenantId: string): Promise<Session> {
  const supabase = getSupabaseClient();

  const { error: rpcError } = await supabase.rpc('set_active_organization', {
    p_tenant_id: tenantId,
  });
  if (rpcError !== null) throw rpcError;

  const { data, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError !== null) throw refreshError;
  if (data.session === null) {
    throw new Error('Organization switched but the session could not be refreshed.');
  }
  return data.session;
}

export type { Session } from '@supabase/supabase-js';
