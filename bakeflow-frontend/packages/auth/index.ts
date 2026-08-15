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

import { createChunkedStorage } from './chunked-storage';

/* -------------------------------------------------------------------------- */
/* Session storage                                                             */
/* -------------------------------------------------------------------------- */

/**
 * `SupportedStorage`, backed by the platform keystore via the chunking logic in
 * `./chunked-storage` (which is backend-injected so it can be verified under Node — this
 * module cannot be, because `expo-secure-store` pulls in React Native).
 *
 * SecureStore is the Android Keystore and the iOS Keychain: OS-managed, and hardware-backed
 * where the device supports it. See the AD-014 note at the top of this file.
 */
export const secureSessionStorage: SupportedStorage = createChunkedStorage(SecureStore);
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

// Claim reading lives in ./claims (no React Native import) so it can be verified under
// plain Node. Re-exported here so callers still have one auth entry point.
export { activeTenantIdFromSession, decodeJwtPayload, rolesFromSession } from './claims';
export type { SessionLike } from './claims';
export { CHUNK_SIZE, createChunkedStorage } from './chunked-storage';
export type { ChunkedStorage, KeyValueBackend } from './chunked-storage';
export type { Session } from '@supabase/supabase-js';
