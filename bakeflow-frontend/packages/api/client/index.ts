/**
 * The typed Supabase client surface used by this package.
 *
 * ## Why the client is injected rather than constructed here
 *
 * `packages/api` takes **no runtime dependency** on `@supabase/supabase-js` — the import
 * below is `import type`, erased at compile time. Three reasons:
 *
 * 1. `@supabase/supabase-js` is declared by `apps/mobile`, not by this package. Adding it
 *    here would mean a `package.json` change and a lockfile churn for a dependency that
 *    is only ever needed at the app's composition root.
 * 2. Session storage is AD-014's business (AES-256-GCM via `expo-crypto`, key in
 *    SecureStore, ciphertext in `expo-file-system`, **no AsyncStorage**). That is not
 *    built yet. A `createClient` call here would have to choose a storage adapter now
 *    and would almost certainly choose the forbidden default.
 * 3. Injection keeps the read functions trivially testable and free of a module-level
 *    singleton, which matters because organization switching must invalidate everything
 *    (P8.1).
 *
 * No environment-variable convention exists in this repository yet, and inventing one
 * here would pre-empt a decision that belongs to `packages/config` and P8.1.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The client the data layer accepts.
 *
 * Deliberately **not** parameterised with a generated `Database` type. The generated
 * types declare money and quantity columns as `number` (see `@bakeflow/types`
 * `scalars.ts`), so adopting them would reintroduce the float hazard the branded scalars
 * exist to prevent. Responses are therefore treated as `unknown` at this boundary and
 * narrowed by Zod — a checked gate rather than an asserted one.
 */
export type BakeflowClient = SupabaseClient;
