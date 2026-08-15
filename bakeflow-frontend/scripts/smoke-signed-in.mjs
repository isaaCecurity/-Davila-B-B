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
const WAREHOUSE_A = 'b0000000-0000-4000-8000-00000000da01';
const SUGAR = 'b1000000-0000-4000-8000-00000000da02';
const YEAST = 'b1000000-0000-4000-8000-00000000da03';

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
  'JWT carries a top-level tenant_id claim',
  'tenant_id' in claims,
  `tenant_id=${JSON.stringify(claims.tenant_id)} roles=${JSON.stringify(claims.roles)}`,
);

/**
 * The organization active at sign-in. This is NOT always null: `set_active_organization`
 * persists to `profiles.active_tenant_id` and deliberately refuses NULL, so there is no
 * way to un-choose an organization — the choice survives sign-out and is restored by the
 * hook on the next sign-in. That is intended behaviour, so the assertions below are
 * written against whatever tenant the token actually carries rather than assuming a
 * never-used account. The one thing guaranteed is that it is not ORG_A: a fresh account
 * starts null, and every completed run of this file leaves ORG_B active.
 */
const signedInTenant = claims.tenant_id ?? null;
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

// ------------------------------------ catalog reflects the token, always --
// The general invariant, which covers the no-organization case rather than assuming it:
// the catalog contains exactly the rows of the tenant in the token, and nothing at all
// when that tenant is null. A null claim must return an empty list, never an error.
const before = await supabase
  .from('products').select('id,name,tenant_id').is('deleted_at', null);
check(
  signedInTenant === null
    ? 'catalog is EMPTY while no organization is active (not an error)'
    : `catalog holds only the signed-in organization's rows (active=${signedInTenant})`,
  before.error === null &&
    (before.data ?? []).every((p) => p.tenant_id === signedInTenant),
  before.error ? before.error.message : `rows=${before.data?.length}`,
);

// ------------------------------------------------------ switch to org A --
const rpcA = await supabase.rpc('set_active_organization', { p_tenant_id: ORG_A });
check('set_active_organization(A) succeeds', rpcA.error === null, rpcA.error?.message ?? '');

// The property that matters is that the RPC does not reach into the token already issued:
// until the client refreshes, the database still sees the OLD tenant. Skipping the refresh
// would silently leave the user operating in the previous organization.
const staleClaims = claimsOf(session);
check(
  'the OLD token still carries the PREVIOUS tenant — the RPC alone changes nothing the DB can see',
  (staleClaims.tenant_id ?? null) === signedInTenant && staleClaims.tenant_id !== ORG_A,
  `stale tenant_id=${JSON.stringify(staleClaims.tenant_id)} (was ${JSON.stringify(signedInTenant)})`,
);

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

// ------------------------------------------------ inventory read (P9.4) --
// Mirrors packages/api/queries/inventory.ts: same tables, same ::text casts on quantities.
const warehousesA = await supabase
  .from('warehouses')
  .select('id,tenant_id,branch_id,name,is_default,created_at,updated_at')
  .is('deleted_at', null)
  .order('branch_id', { ascending: true })
  .order('name', { ascending: true });
check('warehouses load for A', warehousesA.error === null, warehousesA.error?.message ?? '');
check('only A’s stockroom is visible', (warehousesA.data ?? []).length === 1 &&
  warehousesA.data[0].id === WAREHOUSE_A,
  (warehousesA.data ?? []).map((w) => w.name).join(', '));

const levelsA = await supabase
  .from('ingredient_stock_levels')
  .select('id,tenant_id,warehouse_id,ingredient_id,quantity_on_hand::text,created_at,updated_at')
  .eq('warehouse_id', WAREHOUSE_A)
  .is('deleted_at', null)
  .order('ingredient_id', { ascending: true });
check('ingredient stock levels load', levelsA.error === null && (levelsA.data ?? []).length === 3,
  levelsA.error?.message ?? `n=${levelsA.data?.length}`);
check('quantity_on_hand arrives as an exact decimal STRING',
  (levelsA.data ?? []).every((r) => typeof r.quantity_on_hand === 'string'),
  JSON.stringify((levelsA.data ?? []).map((r) => r.quantity_on_hand)));

// The levels were never inserted — only ledger movements were (CLAUDE.md rule 7). These
// exact values are therefore the trigger's arithmetic, not fixture data.
const byIngredient = new Map((levelsA.data ?? []).map((r) => [r.ingredient_id, r.quantity_on_hand]));
check('a level equals the SUM of its movements, computed by the trigger (30 - 5 = 25)',
  byIngredient.get(SUGAR) === '25.0000', String(byIngredient.get(SUGAR)));
check('a second item sums correctly too (5 - 2.5 = 2.5)',
  byIngredient.get(YEAST) === '2.5000', String(byIngredient.get(YEAST)));

const prodLevelsA = await supabase
  .from('product_stock_levels')
  .select('id,tenant_id,warehouse_id,product_variant_id,quantity_on_hand::text,created_at,updated_at')
  .eq('warehouse_id', WAREHOUSE_A)
  .is('deleted_at', null);
check('finished-good stock levels load', prodLevelsA.error === null &&
  prodLevelsA.data?.[0]?.quantity_on_hand === '42.0000',
  prodLevelsA.error?.message ?? JSON.stringify(prodLevelsA.data));

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

// Inventory isolates on the same boundary — asked for by A's warehouse id explicitly, so
// this is RLS refusing rather than a filter narrowing.
const aLevelsFromB = await supabase
  .from('ingredient_stock_levels').select('id,quantity_on_hand::text')
  .eq('warehouse_id', WAREHOUSE_A).is('deleted_at', null);
check("A's stock levels are invisible while B is active",
  aLevelsFromB.error === null && (aLevelsFromB.data ?? []).length === 0,
  aLevelsFromB.error ? aLevelsFromB.error.message : `rows=${aLevelsFromB.data?.length}`);

const warehousesB = await supabase
  .from('warehouses').select('id,name').is('deleted_at', null);
check('B sees only its own stockroom',
  (warehousesB.data ?? []).length === 1 && warehousesB.data[0].id !== WAREHOUSE_A,
  (warehousesB.data ?? []).map((w) => w.name).join(', '));

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
