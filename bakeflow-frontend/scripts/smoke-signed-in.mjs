/**
 * Signed-in smoke test against the live project.
 *
 * Exercises the exact sequence the app performs — sign in → read claims → list
 * organizations → set active + refresh → catalog → product detail → sign out — and asserts
 * organization isolation at each step.
 *
 * It drives `@supabase/supabase-js` directly rather than importing `@bakeflow/api`, for one
 * reason: those modules pull in `react-native` through `expo-secure-store`, whose
 * Flow-typed entry point Node cannot parse. The queries below are therefore written to
 * match `packages/api/queries/*` exactly — same tables, same explicit column projections,
 * same `::text` casts, same `deleted_at IS NULL` filters. If they drift, this test stops
 * being evidence about the app.
 *
 * Requires the scratch fixtures created for this purpose. Safe to re-run.
 *
 *   node scripts/smoke-signed-in.mjs
 */

import { createClient } from '@supabase/supabase-js';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://tvfyxpafbpnkneujcnvr.supabase.co';
const KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'sb_publishable_mlUe7laMCw3u08YZqCf6eA_sXIB7jRf';

const EMAIL = 'smoke.owner@bakeflow.test';
const PASSWORD = 'SmokeTest!2026';
const ORG_A = 'ab000000-0000-4000-8000-00000000da01';
const ORG_B = 'ab000000-0000-4000-8000-00000000da02';
const ORG_C = 'ab000000-0000-4000-8000-00000000da03';
const PRODUCT_A1 = 'ae000000-0000-4000-8000-00000000da01';

let failures = 0;
const check = (name, passed, detail = '') => {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failures += 1;
};

/** Mirrors packages/auth/claims.ts — top-level claims, not app_metadata. */
const claimsOf = (session) => {
  const part = session.access_token.split('.')[1];
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(
    Buffer.from(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='), 'base64').toString(),
  );
};

const supabase = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------- sign in --
const signIn = await supabase.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
check('sign in succeeds', signIn.error === null, signIn.error?.message ?? '');
if (signIn.error) process.exit(1);

let session = signIn.data.session;
let claims = claimsOf(session);
check(
  'JWT carries a top-level tenant_id claim (null before any org is chosen)',
  'tenant_id' in claims,
  `tenant_id=${JSON.stringify(claims.tenant_id)} roles=${JSON.stringify(claims.roles)}`,
);
check('tenant_id is NOT in app_metadata (the P8.1 bug)', claims.app_metadata?.tenant_id === undefined);

// One clear diagnosis instead of ten downstream failures. The claim being ABSENT (rather
// than present-and-null) means GoTrue never ran the hook: the hook itself sets the key
// unconditionally, to null when there is no active organization.
if (!('tenant_id' in claims)) {
  console.log(`
+----------------------------------------------------------------------------+
| BLOCKER-014: the access-token hook is NOT being invoked by GoTrue.          |
|                                                                            |
| The JWT has no tenant_id key at all. The hook always sets it (null when no  |
| organization is active), so an ABSENT key means the hook never ran -- not   |
| that the user has no organization.                                          |
|                                                                            |
| The database side is verified correct:                                     |
|   public.custom_access_token_hook(event jsonb), owner postgres,            |
|   SECURITY DEFINER, EXECUTE granted to supabase_auth_admin, and calling it |
|   directly returns the right tenant_id and roles.                          |
|   pg_stat_statements shows 0 calls by supabase_auth_admin.                 |
|                                                                            |
| Fix in the dashboard -> Authentication -> Hooks:                           |
|   * slot must be "Customize Access Token (JWT) Claims" (not Send SMS/Email)|
|   * Postgres function: public.custom_access_token_hook                     |
|   * equivalently uri = pg-functions://postgres/public/custom_access_token_hook
|   * the toggle must be ENABLED and SAVED                                   |
|                                                                            |
| Every failure below this line is downstream of that one setting.           |
+----------------------------------------------------------------------------+
`);
}

// ------------------------------------------------- organization switcher --
// Must work with a null tenant claim; organizations_select keys off auth.uid().
const orgs = await supabase
  .from('organizations')
  .select('id,name,slug,status,created_at,updated_at')
  .is('deleted_at', null)
  .order('name', { ascending: true })
  .order('id', { ascending: true });
check('organization list loads with a null tenant claim', orgs.error === null, orgs.error?.message ?? '');
check('exactly the 2 organizations the user belongs to are visible', orgs.data?.length === 2,
  (orgs.data ?? []).map((o) => o.name).join(', '));
check('the non-member organization C is NOT visible', !(orgs.data ?? []).some((o) => o.id === ORG_C));

const rolesRead = await supabase
  .from('user_roles')
  .select('tenant_id,branch_id,roles(key,name,rank)')
  .is('deleted_at', null);
check('own roles are readable', rolesRead.error === null && (rolesRead.data ?? []).length === 2,
  (rolesRead.data ?? []).map((r) => r.roles?.key).join(', '));

// --------------------------------------------------- catalog with no org --
const before = await supabase.from('products').select('id,name').is('deleted_at', null);
check('catalog is EMPTY while no organization is active (not an error)',
  before.error === null && (before.data ?? []).length === 0,
  before.error ? before.error.message : `rows=${before.data?.length}`);

// ------------------------------------------------------ switch to org A --
const rpcA = await supabase.rpc('set_active_organization', { p_tenant_id: ORG_A });
check('set_active_organization(A) succeeds', rpcA.error === null, rpcA.error?.message ?? '');

const staleClaims = claimsOf(session);
check('the OLD token still has no tenant — the RPC alone changes nothing the DB can see',
  staleClaims.tenant_id === null || staleClaims.tenant_id === undefined,
  `stale tenant_id=${JSON.stringify(staleClaims.tenant_id)}`);

const refreshA = await supabase.auth.refreshSession();
check('refreshSession succeeds', refreshA.error === null, refreshA.error?.message ?? '');
session = refreshA.data.session;
claims = claimsOf(session);
check('the refreshed token carries tenant_id = A', claims.tenant_id === ORG_A, String(claims.tenant_id));
check('roles claim is populated for A', Array.isArray(claims.roles) && claims.roles.includes('owner'),
  JSON.stringify(claims.roles));

// ------------------------------------------------------- catalog for A --
const catA = await supabase
  .from('products')
  .select('id,tenant_id,category_id,name,description,image_url,is_active,created_at,updated_at')
  .is('deleted_at', null)
  .order('name', { ascending: true });
check('catalog A loads', catA.error === null, catA.error?.message ?? '');
check('catalog A shows exactly its 2 products', (catA.data ?? []).length === 2,
  (catA.data ?? []).map((p) => p.name).join(', '));
check('every returned row belongs to A', (catA.data ?? []).every((p) => p.tenant_id === ORG_A));
check("B's product is not in A's catalog", !(catA.data ?? []).some((p) => p.name === 'Meat Pie B'));

// -------------------------------------------------------- product detail --
const detail = await supabase
  .from('products')
  .select('id,tenant_id,category_id,name,description,image_url,is_active,created_at,updated_at')
  .eq('id', PRODUCT_A1)
  .is('deleted_at', null)
  .maybeSingle();
check('product detail loads', detail.error === null && detail.data?.name === 'Agege Bread',
  detail.error?.message ?? detail.data?.name);

const variants = await supabase
  .from('product_variants')
  .select('id,tenant_id,product_id,name,sku,unit_price::text,is_active,created_at,updated_at')
  .eq('product_id', PRODUCT_A1)
  .is('deleted_at', null)
  .order('sku', { ascending: true });
check('variants load', variants.error === null && (variants.data ?? []).length === 2,
  variants.error?.message ?? `n=${variants.data?.length}`);
check('unit_price arrives as an exact decimal STRING (::text cast survives)',
  (variants.data ?? []).every((v) => typeof v.unit_price === 'string'),
  JSON.stringify((variants.data ?? []).map((v) => v.unit_price)));
check('a 4-decimal price keeps its scale',
  (variants.data ?? []).some((v) => v.unit_price === '1500.5000'),
  JSON.stringify((variants.data ?? []).map((v) => v.unit_price)));

// The 15-digit price proves the whole precision strategy end-to-end.
const bigVariant = await supabase
  .from('product_variants')
  .select('unit_price::text, raw:unit_price')
  .eq('sku', 'COC-STD')
  .maybeSingle();
check('a 15-digit price survives as text', bigVariant.data?.unit_price === '12345678901234.5678',
  String(bigVariant.data?.unit_price));
check('the same column WITHOUT ::text is already corrupted by JSON.parse',
  bigVariant.data?.raw !== 12345678901234.5678 || String(bigVariant.data?.raw) !== '12345678901234.5678',
  `raw=${String(bigVariant.data?.raw)}`);

// ------------------------------------------------------- switch to org B --
await supabase.rpc('set_active_organization', { p_tenant_id: ORG_B });
const refreshB = await supabase.auth.refreshSession();
session = refreshB.data.session;
claims = claimsOf(session);
check('token now carries tenant_id = B', claims.tenant_id === ORG_B, String(claims.tenant_id));

const catB = await supabase.from('products').select('id,tenant_id,name').is('deleted_at', null);
check('catalog B shows exactly its 1 product', (catB.data ?? []).length === 1,
  (catB.data ?? []).map((p) => p.name).join(', '));
check('after switching, NONE of A’s products are returned',
  !(catB.data ?? []).some((p) => p.tenant_id === ORG_A));

const aDetailFromB = await supabase
  .from('products').select('id,name').eq('id', PRODUCT_A1).is('deleted_at', null).maybeSingle();
check("A's product is invisible by direct id while B is active", aDetailFromB.data === null,
  JSON.stringify(aDetailFromB.data));

// --------------------------------------------- switching to a non-member --
const rpcC = await supabase.rpc('set_active_organization', { p_tenant_id: ORG_C });
check('switching to an organization the user does not belong to is REFUSED',
  rpcC.error !== null, rpcC.error?.message ?? 'NO ERROR (unexpected)');

// ---------------------------------------------------------------- sign out --
const out = await supabase.auth.signOut();
check('sign out succeeds', out.error === null, out.error?.message ?? '');
const afterOut = await supabase.from('products').select('id').limit(1);
check('after sign out the catalog is no longer readable',
  afterOut.error !== null || (afterOut.data ?? []).length === 0,
  afterOut.error ? `${afterOut.error.code} ${afterOut.error.message}` : `rows=${afterOut.data?.length}`);

console.log(failures === 0 ? '\nSMOKE TEST PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
