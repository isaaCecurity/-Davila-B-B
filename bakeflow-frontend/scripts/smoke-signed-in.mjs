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

import { Buffer } from 'node:buffer';

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
const FLOUR = 'b1000000-0000-4000-8000-00000000da01';
const BRANCH_A = 'ac000000-0000-4000-8000-00000000da01';
const BRANCH_B = 'ac000000-0000-4000-8000-00000000da02';
// Mirrors the projection queries/delivery.ts derives from deliverySchema. No ::text cast:
// `deliveries` has no NUMERIC column at all.
const DELIVERY_COLUMNS =
  'id,tenant_id,branch_id,ticket_id,driver_id,status,address_line,contact_phone,' +
  'scheduled_at,dispatched_at,delivered_at,proof_url,recipient_name,failure_reason,' +
  'created_at,updated_at';
const VARIANT_A1 = 'af000000-0000-4000-8000-00000000da01';
const SMOKE_UID = 'aa000000-0000-4000-8000-00000000da01';
const NOT_MY_UID = '00000000-0000-4000-8000-0000000000ff';
const RECIPE_A1 = 'b2000000-0000-4000-8000-00000000da01';
const BATCH_A2 = 'b3000000-0000-4000-8000-00000000da02';

/** Mirrors the projections in packages/api/queries/production.ts. */
const BATCH_COLUMNS =
  'id,tenant_id,created_at,updated_at,branch_id,batch_number,recipe_id,ticket_id,' +
  'planned_quantity::text,actual_quantity::text,status,started_at,completed_at,' +
  'assigned_to,failure_reason';
const BATCH_LINE_COLUMNS =
  'id,tenant_id,created_at,updated_at,batch_id,ingredient_id,' +
  'planned_quantity::text,actual_quantity::text,waste_quantity::text';

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
// By name, not by count: the production-batch-transitions section below permanently adds
// a disposable product per run (no client-side delete path exists for it — see that
// section's closing comment), so the catalog's total size grows across runs the same way
// tickets and deliveries already do. The two seeded products are the invariant.
check('catalog A shows its 2 seeded products',
  ['Agege Bread', 'Coconut Bread'].every((name) => (catA.data ?? []).some((p) => p.name === name)),
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
// >= 3, not === 3: the production-batch-transitions section below gives a disposable
// ingredient a real opening balance through adjust_stock(), and *_stock_levels rows have
// no client write path at all (ingredient_stock_levels_select is the ONLY policy on the
// table — read live while adding that section) — a level row, once trigger-created,
// cannot be hidden by this suite the way a soft-deletable row can. FLOUR/SUGAR/YEAST are
// still asserted exactly by id via byIngredient below, which extra rows cannot perturb.
check('ingredient stock levels load', levelsA.error === null && (levelsA.data ?? []).length >= 3,
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
// Found by VARIANT_A1 rather than taken as data[0]: the production-batch-transitions
// section below writes a real production_output movement for a disposable variant in
// this same warehouse, and with no ORDER BY the row order between the two is not
// guaranteed — indexing [0] would make this assertion order-dependent and occasionally
// flaky rather than wrong. product_stock_levels has no client write path (see the
// ingredient-levels comment above), so the extra row cannot be removed, only searched past.
check('finished-good stock levels load', prodLevelsA.error === null &&
  (prodLevelsA.data ?? []).find((r) => r.product_variant_id === VARIANT_A1)?.quantity_on_hand === '42.0000',
  prodLevelsA.error?.message ?? JSON.stringify(prodLevelsA.data));

// ----------------------------------------------- production read (P9.5) --
// Mirrors packages/api/queries/production.ts: same tables, same ::text casts, same
// batch_number ordering.
const batchesA = await supabase
  .from('production_batches')
  .select(BATCH_COLUMNS)
  .is('deleted_at', null)
  .order('batch_number', { ascending: true });
check('production batches load for A', batchesA.error === null, batchesA.error?.message ?? '');
// The first three, not the only three: the production-batch-transitions section below
// permanently adds batches every run (same reasoning as the catalog check above).
// batch_number is assigned in creation order, so the three original seed batches are
// always the lowest-numbered and this is still a real check of ordering, not just presence.
check('A sees its 3 original batches first, in batch_number order',
  (batchesA.data ?? []).slice(0, 3).map((b) => b.batch_number).join(',') ===
    'BATCH-000001,BATCH-000002,BATCH-000003',
  (batchesA.data ?? []).map((b) => `${b.batch_number}:${b.status}`).join(' '));
check('planned_quantity arrives as an exact decimal STRING',
  (batchesA.data ?? []).every((b) => typeof b.planned_quantity === 'string'),
  JSON.stringify((batchesA.data ?? []).map((b) => b.planned_quantity)));

// guard_production_batch_transition() stamped started_at on the scheduled -> in_progress
// UPDATE. Nothing wrote that column directly, so this is the trigger's work.
const inProgress = (batchesA.data ?? []).find((b) => b.status === 'in_progress');
check('the in-progress batch carries a trigger-stamped started_at',
  inProgress !== undefined && inProgress.started_at !== null && inProgress.completed_at === null,
  JSON.stringify({ started: inProgress?.started_at, completed: inProgress?.completed_at }));

// Filtering happens in the query, exactly as the screen does it.
const filtered = await supabase
  .from('production_batches').select(BATCH_COLUMNS)
  .eq('status', 'in_progress').is('deleted_at', null);
// Not length === 1: if a run below this point ever crashes between raw-updating a batch
// to in_progress and completing/failing it (a real risk — this script has hit transient
// "fetch failed" network errors mid-run before), that batch would be left in_progress
// permanently, same growth reasoning as the two checks above. What's actually being
// tested — the filter returns only in_progress rows, and the known fixture is among
// them — survives that.
check('filtering by status returns only in_progress rows, including the known fixture',
  (filtered.data ?? []).every((b) => b.status === 'in_progress') &&
    (filtered.data ?? []).some((b) => b.id === BATCH_A2),
  (filtered.data ?? []).map((b) => `${b.batch_number}:${b.status}`).join(' '));

// The ingredient lines were NEVER inserted — only the batch was. Every value below is
// copy_batch_planned_ingredients() scaling the recipe by planned/yield and rounding to 4dp.
const linesA2 = await supabase
  .from('production_batch_ingredients')
  .select(BATCH_LINE_COLUMNS)
  .eq('batch_id', BATCH_A2)
  .is('deleted_at', null)
  .order('ingredient_id', { ascending: true });
check('batch ingredient lines load', linesA2.error === null && (linesA2.data ?? []).length === 1,
  linesA2.error?.message ?? `n=${linesA2.data?.length}`);
check('a line is the recipe SCALED and ROUNDED by the trigger (2.5 * 7/3 -> 5.8333)',
  linesA2.data?.[0]?.planned_quantity === '5.8333' &&
    linesA2.data?.[0]?.ingredient_id === FLOUR,
  JSON.stringify(linesA2.data?.[0]?.planned_quantity));
check('an unstarted line has no actuals yet',
  linesA2.data?.[0]?.actual_quantity === null && linesA2.data?.[0]?.waste_quantity === '0.0000',
  JSON.stringify({ actual: linesA2.data?.[0]?.actual_quantity,
                   waste: linesA2.data?.[0]?.waste_quantity }));

const recipesA = await supabase
  .from('recipes')
  .select('id,tenant_id,product_variant_id,name,yield_quantity::text,version,is_active,created_at,updated_at')
  .in('id', [RECIPE_A1])
  .is('deleted_at', null);
check('recipes resolve by id, for naming batches',
  recipesA.data?.[0]?.name === 'Smoke Agege Recipe', JSON.stringify(recipesA.data?.[0]?.name));

// ---------------------------------------- production batch transitions (P9.5) --
// `scheduled -> in_progress` and `scheduled -> cancelled` are plain PostgREST updates
// (authenticated holds UPDATE on production_batches, unlike deliveries), policed by
// guard_production_batch_transition(). `in_progress -> completed` and `-> failed` are the
// two SECURITY DEFINER RPCs that atomically write stock_movements alongside the status
// change — mutations/production.ts, RPC bodies read live 2026-08-21.
//
// A real completion/failure consumes real ingredient stock and produces real finished-good
// stock, permanently — the ledger is immutable. RECIPE_A1 resolves to FLOUR/SUGAR and to
// VARIANT_A1, and this file's own inventory assertions above hardcode their levels
// (120.0000, 25.0000, 42.0000) as exact, unchanging values. Running a real completion
// against RECIPE_A1 would corrupt those assertions on every subsequent run. So this section
// creates its own disposable ingredient/product/recipe graph — never touching any fixture
// another check depends on — and is the only place in this file that calls adjust_stock,
// complete_production_batch or fail_production_batch for real.
const suffix = Date.now().toString(36);
const throwawayIngredient = await supabase
  .from('ingredients')
  .insert({ tenant_id: ORG_A, name: `Smoke Batch Ingredient ${suffix}`, unit_of_measure: 'kg' })
  .select('id').single();
check('a disposable ingredient can be created for this section',
  throwawayIngredient.error === null,
  throwawayIngredient.error ? throwawayIngredient.error.message : '');

const throwawayProduct = await supabase
  .from('products')
  .insert({ tenant_id: ORG_A, name: `Smoke Batch Product ${suffix}` })
  .select('id').single();
const throwawayVariant = await supabase
  .from('product_variants')
  .insert({
    tenant_id: ORG_A, product_id: throwawayProduct.data?.id,
    name: `Smoke Batch Variant ${suffix}`, sku: `SMOKE-BATCH-${suffix}`, unit_price: '1.0000',
  })
  .select('id').single();
const throwawayRecipe = await supabase
  .from('recipes')
  .insert({
    tenant_id: ORG_A, product_variant_id: throwawayVariant.data?.id,
    name: `Smoke Batch Recipe ${suffix}`, yield_quantity: '1.0000',
  })
  .select('id').single();
const throwawayRecipeIngredient = await supabase
  .from('recipe_ingredients')
  .insert({
    tenant_id: ORG_A, recipe_id: throwawayRecipe.data?.id,
    ingredient_id: throwawayIngredient.data?.id, quantity: '1.0000',
  })
  .select('id').single();
check('the disposable product/variant/recipe/recipe-ingredient graph was created',
  throwawayProduct.error === null && throwawayVariant.error === null &&
    throwawayRecipe.error === null && throwawayRecipeIngredient.error === null,
  JSON.stringify({
    product: throwawayProduct.error?.message, variant: throwawayVariant.error?.message,
    recipe: throwawayRecipe.error?.message, line: throwawayRecipeIngredient.error?.message,
  }));

// adjust_stock's own P4.2b contract: p_new_quantity is an absolute target. Giving the
// disposable ingredient an opening balance of 10 kg is what lets a completion consume 1 kg
// without ever touching FLOUR, SUGAR or YEAST.
const openingBalance = await supabase.rpc('adjust_stock', {
  p_warehouse_id: WAREHOUSE_A, p_item_type: 'ingredient', p_item_id: throwawayIngredient.data?.id,
  p_new_quantity: '10.0000', p_reason: 'opening_balance', p_note: null,
});
check('adjust_stock gives the disposable ingredient a 10kg opening balance',
  openingBalance.error === null,
  openingBalance.error ? openingBalance.error.message : '');

// Two batches against the same disposable recipe: one completed, one failed. Each starts
// scheduled (the INSERT default) with no explicit status.
const batchToComplete = await supabase
  .from('production_batches')
  .insert({ tenant_id: ORG_A, branch_id: BRANCH_A, recipe_id: throwawayRecipe.data?.id, planned_quantity: '1.0000' })
  .select('id,status,batch_number').single();
check('a batch can be scheduled against the disposable recipe',
  batchToComplete.error === null && batchToComplete.data?.status === 'scheduled',
  batchToComplete.error ? batchToComplete.error.message : JSON.stringify(batchToComplete.data));

const linesSnapshotted = await supabase
  .from('production_batch_ingredients').select('ingredient_id,planned_quantity::text')
  .eq('batch_id', batchToComplete.data?.id);
check('copy_batch_planned_ingredients() snapshotted one line at 1.0000 (1 * 1/1)',
  linesSnapshotted.data?.length === 1 && linesSnapshotted.data[0].planned_quantity === '1.0000',
  JSON.stringify(linesSnapshotted.data));

// The RPC's own precondition — batch must already be in_progress — fires before any
// stock_movements write, so this is safe to attempt against a still-scheduled batch.
const completeTooEarly = await supabase.rpc('complete_production_batch', {
  p_batch_id: batchToComplete.data?.id, p_actual_quantity: '1.0000',
  p_ingredient_actuals: [], p_warehouse_id: null,
});
check('complete_production_batch() on a SCHEDULED batch is REFUSED (invalid_transition)',
  completeTooEarly.error !== null,
  completeTooEarly.error ? completeTooEarly.error.message : 'NO ERROR (unexpected)');

const startBatch = await supabase
  .from('production_batches').update({ status: 'in_progress' })
  .eq('id', batchToComplete.data?.id).select('id,status,started_at').single();
check('a plain UPDATE moves scheduled -> in_progress and stamps started_at',
  startBatch.data?.status === 'in_progress' && startBatch.data?.started_at !== null,
  startBatch.error ? startBatch.error.message : JSON.stringify(startBatch.data));

const illegalHop = await supabase
  .from('production_batches').update({ status: 'cancelled' })
  .eq('id', batchToComplete.data?.id).select('id');
check('an UPDATE from in_progress to cancelled is REFUSED (not a legal hop)',
  illegalHop.error !== null,
  illegalHop.error ? illegalHop.error.message : 'NO ERROR (unexpected)');

const completion = await supabase.rpc('complete_production_batch', {
  p_batch_id: batchToComplete.data?.id, p_actual_quantity: '1.0000',
  p_ingredient_actuals: [], p_warehouse_id: null,
});
check('complete_production_batch() succeeds on an in_progress batch',
  completion.error === null, completion.error ? completion.error.message : '');

const completedRead = await supabase
  .from('production_batches')
  .select('status,actual_quantity::text,completed_at')
  .eq('id', batchToComplete.data?.id).maybeSingle();
check('the completed batch reads back completed, actual 1.0000, completed_at set',
  completedRead.data?.status === 'completed' && completedRead.data?.actual_quantity === '1.0000' &&
    completedRead.data?.completed_at !== null,
  JSON.stringify(completedRead.data));

const movementsForCompletion = await supabase
  .from('stock_movements').select('reason,item_type,quantity_delta::text')
  .eq('reference_type', 'production_batch').eq('reference_id', batchToComplete.data?.id);
check('completion wrote exactly one consume (-1kg ingredient) and one output (+1 product)',
  movementsForCompletion.data?.length === 2 &&
    movementsForCompletion.data.some((m) => m.reason === 'production_consume' && m.item_type === 'ingredient' && m.quantity_delta === '-1.0000') &&
    movementsForCompletion.data.some((m) => m.reason === 'production_output' && m.item_type === 'product' && m.quantity_delta === '1.0000'),
  JSON.stringify(movementsForCompletion.data));

const ingredientLevelAfterCompletion = await supabase
  .from('ingredient_stock_levels').select('quantity_on_hand::text')
  .eq('warehouse_id', WAREHOUSE_A).eq('ingredient_id', throwawayIngredient.data?.id).maybeSingle();
check('the disposable ingredient level dropped from 10 to 9 (10 - 1)',
  ingredientLevelAfterCompletion.data?.quantity_on_hand === '9.0000',
  JSON.stringify(ingredientLevelAfterCompletion.data));

// A second batch, same disposable recipe, for the failure path.
const batchToFail = await supabase
  .from('production_batches')
  .insert({ tenant_id: ORG_A, branch_id: BRANCH_A, recipe_id: throwawayRecipe.data?.id, planned_quantity: '1.0000' })
  .select('id').single();
await supabase.from('production_batches').update({ status: 'in_progress' }).eq('id', batchToFail.data?.id);

const failure = await supabase.rpc('fail_production_batch', {
  p_batch_id: batchToFail.data?.id, p_reason: 'smoke test — oven fault',
  p_ingredient_actuals: [], p_warehouse_id: null,
});
check('fail_production_batch() succeeds on an in_progress batch',
  failure.error === null, failure.error ? failure.error.message : '');

const failedRead = await supabase
  .from('production_batches').select('status,failure_reason,completed_at')
  .eq('id', batchToFail.data?.id).maybeSingle();
check('the failed batch reads back failed, with its reason and completed_at set',
  failedRead.data?.status === 'failed' &&
    failedRead.data?.failure_reason === 'smoke test — oven fault' &&
    failedRead.data?.completed_at !== null,
  JSON.stringify(failedRead.data));

const movementsForFailure = await supabase
  .from('stock_movements').select('reason,item_type,quantity_delta::text')
  .eq('reference_type', 'production_batch').eq('reference_id', batchToFail.data?.id);
check('failure wrote exactly one consume movement and NO output movement (ingredients used, nothing made)',
  movementsForFailure.data?.length === 1 &&
    movementsForFailure.data[0].reason === 'production_consume' &&
    movementsForFailure.data[0].quantity_delta === '-1.0000',
  JSON.stringify(movementsForFailure.data));

const ingredientLevelAfterFailure = await supabase
  .from('ingredient_stock_levels').select('quantity_on_hand::text')
  .eq('warehouse_id', WAREHOUSE_A).eq('ingredient_id', throwawayIngredient.data?.id).maybeSingle();
check('the disposable ingredient level dropped from 9 to 8 (9 - 1) — a failed batch still consumes',
  ingredientLevelAfterFailure.data?.quantity_on_hand === '8.0000',
  JSON.stringify(ingredientLevelAfterFailure.data));

// BLOCKER-017 — RESOLVED 2026-08-22, regression-guarded here rather than left to a code
// read. authenticated holds a blanket UPDATE on production_batches (unlike deliveries), so
// nothing at the grant layer alone stops a raw update from reaching 'completed' without
// the RPC — but guard_production_batch_transition() now refuses new.status IN
// ('completed','failed') unless a transaction-local flag the RPCs set immediately before
// their own final UPDATE is present. Two independent refusals, for two different reasons:
const batchForBypass = await supabase
  .from('production_batches')
  .insert({ tenant_id: ORG_A, branch_id: BRANCH_A, recipe_id: throwawayRecipe.data?.id, planned_quantity: '1.0000' })
  .select('id').single();
await supabase.from('production_batches').update({ status: 'in_progress' }).eq('id', batchForBypass.data?.id);

// Missing completed_at trips the standing CHECK production_batches_completed_fields —
// unrelated to and unaffected by the BLOCKER-017 fix, but still a real first line of defence.
const incompleteBypass = await supabase
  .from('production_batches')
  .update({ status: 'completed', actual_quantity: '1.0000' })
  .eq('id', batchForBypass.data?.id)
  .select('id');
check('a raw UPDATE with no completed_at is refused by production_batches_completed_fields',
  incompleteBypass.error !== null,
  incompleteBypass.error ? incompleteBypass.error.message : 'NO ERROR (unexpected)');

// Supplying completed_at too (what a determined bypass would actually do) used to succeed
// — this is the exact call that proved BLOCKER-017 live. It is now refused by the trigger
// guard itself, independent of the CHECK constraint above.
const rawBypass = await supabase
  .from('production_batches')
  .update({ status: 'completed', actual_quantity: '1.0000', completed_at: new Date().toISOString() })
  .eq('id', batchForBypass.data?.id)
  .select('status,actual_quantity::text');
check('BLOCKER-017 regression guard: a raw UPDATE with completed_at is now REFUSED by the trigger',
  rawBypass.error !== null,
  rawBypass.error ? rawBypass.error.message : JSON.stringify(rawBypass.data));

const movementsForBypass = await supabase
  .from('stock_movements').select('id')
  .eq('reference_type', 'production_batch').eq('reference_id', batchForBypass.data?.id);
check('no stock movements exist for the refused bypass batch',
  (movementsForBypass.data ?? []).length === 0,
  `movements=${movementsForBypass.data?.length}`);

const ingredientLevelAfterBypass = await supabase
  .from('ingredient_stock_levels').select('quantity_on_hand::text')
  .eq('warehouse_id', WAREHOUSE_A).eq('ingredient_id', throwawayIngredient.data?.id).maybeSingle();
check('the disposable ingredient level is UNCHANGED by the refused bypass (still 8, not 7)',
  ingredientLevelAfterBypass.data?.quantity_on_hand === '8.0000',
  JSON.stringify(ingredientLevelAfterBypass.data));

// The batch left behind by the refused bypass is still legitimately in_progress — complete
// it for real, to prove the trigger guard does NOT also block the RPC path it exists to
// protect (a flag bug here would silently break every future completion).
const legitimateCompletion = await supabase.rpc('complete_production_batch', {
  p_batch_id: batchForBypass.data?.id, p_actual_quantity: '1.0000',
  p_ingredient_actuals: [], p_warehouse_id: null,
});
check('the RPC path still works after the BLOCKER-017 fix (the guard does not also block it)',
  legitimateCompletion.error === null,
  legitimateCompletion.error ? legitimateCompletion.error.message : '');

// No teardown here: a client-side soft-delete UPDATE against these disposable rows
// (setting only deleted_at) was tried and refused with 42501 "new row violates row-level
// security policy" on both production_batches and products, despite production_batches_
// update / products_update reading as permissive for an owner from pg_policy — the exact
// mechanism was not run down, and is not this section's concern to solve. So, like the
// ticket/delivery fixtures this file already creates every run (see the P9.6 fixture
// note above), the disposable ingredient, product, variant, recipe and batches created
// above are permanent. The assertions below that read production_batches and products
// unscoped are written to tolerate that growth rather than assume a fixed count — see
// their comments.

// ------------------------- ticket creation (BLOCKER-012 + BLOCKER-015 fix) --
// Two defects had to fall before this INSERT could work, and both are real:
//   BLOCKER-012 — assign_order_number() passed 'ticket' while
//     document_sequences_doc_type_check still allowed only ('order',...): 23514.
//   BLOCKER-015 — guard_order_actor_and_assignment() resolved the actor's membership
//     through profiles.tenant_id, the user's HOME organization, rather than through
//     user_roles, the membership set: P0001 'invalid order creator'.
// This is a real signed-in INSERT through PostgREST — `authenticated` holds INSERT on
// tickets, so tickets_insert (the RLS policy) is what authorizes it, not a service key.
const ticketInsert = await supabase
  .from('tickets')
  .insert({
    tenant_id: ORG_A,
    branch_id: BRANCH_A,
    fulfilment_type: 'pickup',
    // Deliberately a lie: guard_order_actor_and_assignment() must overwrite it.
    created_by: NOT_MY_UID,
  })
  .select('id,ticket_number,status,tenant_id,branch_id,created_by,subtotal_amount::text,total_amount::text')
  .single();
check('a ticket can be CREATED by a signed-in user (BLOCKER-012 + 015 resolved)',
  ticketInsert.error === null,
  ticketInsert.error ? `${ticketInsert.error.code} ${ticketInsert.error.message}` : '');

// One diagnosis instead of nine downstream failures, should either defect return.
if (ticketInsert.error?.message?.includes('invalid order creator')) {
  console.log(`
+----------------------------------------------------------------------------+
| REGRESSION of BLOCKER-015 — the ticket actor guard is resolving membership  |
| through profiles.tenant_id again.                                          |
|                                                                            |
| profiles.tenant_id is the user's HOME organization, not their membership   |
| set — accept_organization_invite() says so in its own body. Membership     |
| lives in user_roles, which is what has_role() and every RLS policy consult. |
|                                                                            |
| Symptom if it regresses: a user who joined A first can create tickets in A  |
| and NEVER in B, and a user with a null profiles.tenant_id can create        |
| tickets nowhere.                                                           |
|                                                                            |
| Fixed 2026-08-16 by migration                                              |
| fix_ticket_actor_membership_check_for_multi_org. See BLOCKERS.md 015.       |
+----------------------------------------------------------------------------+
`);
}
if (ticketInsert.error?.code === '23514') {
  console.log('\nREGRESSION of BLOCKER-012: document_sequences_doc_type_check no longer allows \'ticket\'.\n');
}

const ticket = ticketInsert.data;
check('the trigger assigned a ticket number from the tenant sequence',
  /^TKT-\d{6}$/.test(ticket?.ticket_number ?? ''), String(ticket?.ticket_number));
check('a new ticket starts in draft', ticket?.status === 'draft', String(ticket?.status));
check('created_by is stamped from the JWT — a client CANNOT forge authorship',
  ticket?.created_by === SMOKE_UID && ticket?.created_by !== NOT_MY_UID,
  `created_by=${ticket?.created_by}`);
check('an empty ticket totals zero, as exact decimal strings',
  ticket?.subtotal_amount === '0.0000' && ticket?.total_amount === '0.0000',
  JSON.stringify({ subtotal: ticket?.subtotal_amount, total: ticket?.total_amount }));

const itemInsert = await supabase
  .from('ticket_items')
  .insert({
    tenant_id: ORG_A,
    ticket_id: ticket?.id,
    product_variant_id: VARIANT_A1,
    quantity: '2',
    // Deliberately a lie, and NOT the catalog price (850.0000): the price guard must
    // overwrite it. A client that could name its own price could sell at any price.
    unit_price: '1500.5000',
  })
  .select('id,quantity::text,unit_price::text,line_total::text')
  .single();
check('a ticket item can be created', itemInsert.error === null,
  itemInsert.error ? `${itemInsert.error.code} ${itemInsert.error.message}` : '');
// guard_order_item_price() replaces NEW.unit_price with product_variants.unit_price on
// every INSERT, so pricing is catalog-authoritative and a client CANNOT forge it.
check('unit_price is taken from the CATALOG, not from the client (850.0000)',
  itemInsert.data?.unit_price === '850.0000' && itemInsert.data?.unit_price !== '1500.5000',
  String(itemInsert.data?.unit_price));
// line_total is GENERATED ALWAYS as round(quantity * unit_price, 4) — the client never
// sends it, and cannot disagree with it.
check('line_total is computed BY THE DATABASE (2 x 850.0000 = 1700.0000)',
  itemInsert.data?.line_total === '1700.0000', String(itemInsert.data?.line_total));

// The sequence row the old constraint made unstorable now exists.
const seq = await supabase
  .from('document_sequences').select('doc_type,prefix,current_value')
  .eq('doc_type', 'ticket').maybeSingle();
check("document_sequences now holds a 'ticket' counter with the TKT prefix",
  seq.data?.doc_type === 'ticket' && seq.data?.prefix === 'TKT' && seq.data?.current_value >= 1,
  JSON.stringify(seq.data));

// Read it back through the sales read projection — same ::text casts as queries/sales.ts.
const readBack = await supabase
  .from('tickets')
  .select('id,tenant_id,branch_id,ticket_number,status,fulfilment_type,subtotal_amount::text,' +
          'discount_amount::text,tax_amount::text,total_amount::text,amount_paid::text,created_at,updated_at')
  .eq('id', ticket?.id).is('deleted_at', null).maybeSingle();
check('the new ticket is readable through the sales read path',
  readBack.data?.ticket_number === ticket?.ticket_number &&
    typeof readBack.data?.total_amount === 'string',
  JSON.stringify({ number: readBack.data?.ticket_number, total: readBack.data?.total_amount }));
// recalculate_ticket_totals() ran on the item insert: the header now carries the line.
check('the ticket header totals were RECALCULATED by the database (1700.0000)',
  readBack.data?.subtotal_amount === '1700.0000' && readBack.data?.total_amount === '1700.0000',
  JSON.stringify({ subtotal: readBack.data?.subtotal_amount, total: readBack.data?.total_amount }));

// ------------------------------------------------ deliveries (P9.6) --
// A delivery hangs off a ticket, which is why none of this could run until BLOCKER-012 and
// BLOCKER-015 were both resolved. `authenticated` holds INSERT + SELECT on deliveries
// (grants read live) and deliveries_insert requires an owner/admin/branch_manager/cashier
// role, so this is RLS authorizing a real signed-in write — not a service key.
const deliveryTicket = await supabase
  .from('tickets')
  .insert({ tenant_id: ORG_A, branch_id: BRANCH_A, fulfilment_type: 'delivery' })
  .select('id,ticket_number,fulfilment_type')
  .single();
check('a ticket can be raised with fulfilment_type = delivery',
  deliveryTicket.error === null && deliveryTicket.data?.fulfilment_type === 'delivery',
  deliveryTicket.error ? `${deliveryTicket.error.code} ${deliveryTicket.error.message}` : '');

const deliveryInsert = await supabase
  .from('deliveries')
  .insert({
    tenant_id: ORG_A,
    branch_id: BRANCH_A,
    ticket_id: deliveryTicket.data?.id,
    address_line: '12 Adeola Odeku Street, Victoria Island, Lagos',
    contact_phone: '+2348012345678',
  })
  .select(DELIVERY_COLUMNS)
  .single();
check('a delivery can be CREATED against that ticket',
  deliveryInsert.error === null,
  deliveryInsert.error ? `${deliveryInsert.error.code} ${deliveryInsert.error.message}` : '');

const delivery = deliveryInsert.data;
check('a new delivery starts pending with no driver',
  delivery?.status === 'pending' && delivery?.driver_id === null,
  JSON.stringify({ status: delivery?.status, driver: delivery?.driver_id }));

// deliveries_ticket_id_key is UNIQUE (ticket_id) — read live. One delivery per ticket, which
// is why a failed delivery is routed failed -> returned rather than re-raised as a new row.
const secondDelivery = await supabase
  .from('deliveries')
  .insert({
    tenant_id: ORG_A,
    branch_id: BRANCH_A,
    ticket_id: deliveryTicket.data?.id,
    address_line: 'Somewhere else entirely',
  })
  .select('id').single();
check('a SECOND delivery on the same ticket is REFUSED (one delivery per ticket)',
  secondDelivery.error !== null,
  secondDelivery.error ? `${secondDelivery.error.code} ${secondDelivery.error.message}` : 'NO ERROR (unexpected)');

// The three standing CHECK constraints the Zod reader mirrors. Each is asserted against a
// ticket that has NO delivery, so a refusal is the CHECK talking and not the unique index.
const assignedNoDriver = await supabase
  .from('deliveries')
  .insert({ tenant_id: ORG_A, branch_id: BRANCH_A, ticket_id: ticket?.id,
            address_line: 'A', status: 'assigned' })
  .select('id').single();
check('an ASSIGNED delivery with no driver is REFUSED (deliveries_assigned_needs_driver)',
  assignedNoDriver.error !== null,
  assignedNoDriver.error ? assignedNoDriver.error.code : 'NO ERROR (unexpected)');

const failedNoReason = await supabase
  .from('deliveries')
  .insert({ tenant_id: ORG_A, branch_id: BRANCH_A, ticket_id: ticket?.id,
            address_line: 'A', status: 'failed' })
  .select('id').single();
check('a FAILED delivery with no reason is REFUSED (deliveries_failed_needs_reason)',
  failedNoReason.error !== null,
  failedNoReason.error ? failedNoReason.error.code : 'NO ERROR (unexpected)');

const deliveredNoProof = await supabase
  .from('deliveries')
  .insert({ tenant_id: ORG_A, branch_id: BRANCH_A, ticket_id: ticket?.id,
            address_line: 'A', status: 'delivered' })
  .select('id').single();
check('a DELIVERED delivery with neither proof nor recipient is REFUSED (deliveries_delivered_needs_proof)',
  deliveredNoProof.error !== null,
  deliveredNoProof.error ? deliveredNoProof.error.code : 'NO ERROR (unexpected)');

// Read back through the same projection queries/delivery.ts uses. No ::text cast anywhere:
// deliveries carries no NUMERIC column at all, which is why this domain is untouched by
// BLOCKER-003.
const deliveryRead = await supabase
  .from('deliveries').select(DELIVERY_COLUMNS)
  .eq('id', delivery?.id).is('deleted_at', null).maybeSingle();
check('the new delivery is readable through the delivery read path',
  deliveryRead.data?.id === delivery?.id &&
    deliveryRead.data?.address_line === '12 Adeola Odeku Street, Victoria Island, Lagos',
  JSON.stringify({ id: deliveryRead.data?.id, address: deliveryRead.data?.address_line }));

// openOnly in listDeliveries() is `status IN (pending, assigned, in_transit, failed)`.
// `failed` is deliberately in that set: its only exit is `returned`, and that hop writes a
// return stock movement, so a board that hid it would hide the goods still unaccounted for.
const openDeliveries = await supabase
  .from('deliveries').select(DELIVERY_COLUMNS)
  .in('status', ['pending', 'assigned', 'in_transit', 'failed'])
  .is('deleted_at', null);
check('the pending delivery appears in the OPEN set',
  (openDeliveries.data ?? []).some((d) => d.id === delivery?.id),
  `open rows=${openDeliveries.data?.length}`);

// The screens claim every delivery transition is RPC-only. That is a GRANT-level fact, not a
// policy one: `authenticated` holds INSERT + SELECT and no UPDATE on deliveries, so PostgREST
// refuses before RLS is consulted. Asserted behaviourally rather than by reading the grant,
// because the claim is load-bearing — it is why the UI has no dispatch button.
const transitionAttempt = await supabase
  .from('deliveries')
  .update({ status: 'in_transit' })
  .eq('id', delivery?.id)
  .select('id');
check('a delivery transition through PostgREST is REFUSED — transitions are RPC-only',
  transitionAttempt.error !== null,
  transitionAttempt.error
    ? `${transitionAttempt.error.code} ${transitionAttempt.error.message}`
    : 'NO ERROR (unexpected)');

// The two write RPCs the a1985a29 commit added (`@bakeflow/api` mutations/delivery.ts).
// Landed with a docstring describing their contracts from the live function bodies, but
// never previously exercised against the live project — closing that gap here.

// transition_delivery() checks the nominated assignee holds 'driver' in THIS tenant before
// the trigger ever runs. SMOKE_UID is an owner, not a driver, so this must be refused by
// the RPC's own guard, not by guard_delivery_transition().
const assignNonDriver = await supabase.rpc('transition_delivery', {
  p_delivery_id: delivery?.id,
  p_to_status: 'assigned',
  p_proof_url: null,
  p_recipient_name: null,
  p_reason: null,
  p_driver_id: SMOKE_UID,
});
check('transition_delivery(assigned, non-driver assignee) is REFUSED (insufficient_role)',
  assignNonDriver.error !== null,
  assignNonDriver.error ? assignNonDriver.error.message : 'NO ERROR (unexpected)');

// deliveryTicket was just raised and is still 'draft' (the column default), not 'ready'.
// transition_delivery() reads the parent ticket and refuses in_transit itself — a
// precondition check in the RPC, ahead of and independent from the trigger's legal-hop
// graph (which would refuse this same call anyway, since pending's only exit is assigned).
const dispatchNotReady = await supabase.rpc('transition_delivery', {
  p_delivery_id: delivery?.id,
  p_to_status: 'in_transit',
  p_proof_url: null,
  p_recipient_name: null,
  p_reason: null,
  p_driver_id: null,
});
check('transition_delivery(in_transit, ticket not ready) is REFUSED (invalid_transition)',
  dispatchNotReady.error !== null,
  dispatchNotReady.error ? dispatchNotReady.error.message : 'NO ERROR (unexpected)');

// update_delivery_details() is the other RPC the commit added — owner/admin/branch_manager/
// cashier may correct address/phone/schedule on any hop, not just pending. Exercised end to
// end: call it, then read the row back through the same projection the detail screen uses.
const detailsUpdate = await supabase.rpc('update_delivery_details', {
  p_delivery_id: delivery?.id,
  p_address_line: '45 Broad Street, Lagos Island, Lagos',
  p_contact_phone: '+2348099999999',
  p_scheduled_at: null,
});
check('update_delivery_details() succeeds for an owner',
  detailsUpdate.error === null && detailsUpdate.data?.delivery?.address_line === '45 Broad Street, Lagos Island, Lagos',
  detailsUpdate.error ? detailsUpdate.error.message : JSON.stringify(detailsUpdate.data?.delivery?.address_line));

const detailsReadBack = await supabase
  .from('deliveries').select(DELIVERY_COLUMNS)
  .eq('id', delivery?.id).is('deleted_at', null).maybeSingle();
check('the address/phone correction is visible through the delivery read path',
  detailsReadBack.data?.address_line === '45 Broad Street, Lagos Island, Lagos' &&
    detailsReadBack.data?.contact_phone === '+2348099999999',
  JSON.stringify({ address: detailsReadBack.data?.address_line, phone: detailsReadBack.data?.contact_phone }));

// COALESCE means a call that supplies none of the three fields rewrites the row to its
// current values rather than erroring — the client wrapper refuses this case locally
// (mutations/delivery.ts), but the database itself has no such guard, so the RPC still
// succeeds and leaves the just-corrected values untouched.
const detailsNoop = await supabase.rpc('update_delivery_details', {
  p_delivery_id: delivery?.id,
  p_address_line: null,
  p_contact_phone: null,
  p_scheduled_at: null,
});
check('update_delivery_details() with all-null args is a DB-level no-op, not an error',
  detailsNoop.error === null && detailsNoop.data?.delivery?.address_line === '45 Broad Street, Lagos Island, Lagos',
  detailsNoop.error ? detailsNoop.error.message : JSON.stringify(detailsNoop.data?.delivery?.address_line));

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

// Production isolates on the same boundary, and on the branch axis too: the batch is
// asked for by A's primary key, so this is RLS refusing rather than a filter narrowing.
const aBatchFromB = await supabase
  .from('production_batches').select(BATCH_COLUMNS).eq('id', BATCH_A2)
  .is('deleted_at', null).maybeSingle();
check("A's batch is invisible by direct id while B is active", aBatchFromB.data === null,
  JSON.stringify(aBatchFromB.data));

const aLinesFromB = await supabase
  .from('production_batch_ingredients').select(BATCH_LINE_COLUMNS)
  .eq('batch_id', BATCH_A2).is('deleted_at', null);
check("A's batch ingredient lines are invisible through the parent batch",
  aLinesFromB.error === null && (aLinesFromB.data ?? []).length === 0,
  aLinesFromB.error ? aLinesFromB.error.message : `rows=${aLinesFromB.data?.length}`);

// Document numbers are per tenant: A and B each own a BATCH-000001, and they are
// different batches. A global sequence would leak how much other bakeries produce.
const batchesB = await supabase
  .from('production_batches').select(BATCH_COLUMNS).is('deleted_at', null);
check('B sees exactly its own 1 batch, numbered from its OWN sequence',
  (batchesB.data ?? []).length === 1 &&
    batchesB.data[0].batch_number === 'BATCH-000001' &&
    batchesB.data[0].id !== BATCH_A2 &&
    batchesB.data[0].tenant_id === ORG_B,
  (batchesB.data ?? []).map((b) => `${b.batch_number}:${b.tenant_id}`).join(' '));

const aTicketFromB = await supabase
  .from('tickets').select('id,ticket_number').eq('id', ticket?.id)
  .is('deleted_at', null).maybeSingle();
check("A's ticket is invisible by direct id while B is active", aTicketFromB.data === null,
  JSON.stringify(aTicketFromB.data));

// deliveries_select is the ONE policy in the system with a disjunction —
//   tenant_id = current_tenant_id() AND (driver_id = auth.uid() OR has_branch_access(branch_id))
// — so a driver sees their own drop even outside their branches. This proves the tenant
// clause is still conjoined: the smoke user is an owner of BOTH organizations, and A's
// delivery is still invisible under B's claim. The driver escape hatch does not cross tenants.
const aDeliveryFromB = await supabase
  .from('deliveries').select(DELIVERY_COLUMNS).eq('id', delivery?.id)
  .is('deleted_at', null).maybeSingle();
check("A's delivery is invisible by direct id while B is active", aDeliveryFromB.data === null,
  JSON.stringify(aDeliveryFromB.data));

const deliveriesFromB = await supabase
  .from('deliveries').select('id,tenant_id').is('deleted_at', null);
check('B sees none of A’s deliveries in a full list',
  !(deliveriesFromB.data ?? []).some((d) => d.tenant_id === ORG_A),
  `rows=${deliveriesFromB.data?.length}`);

// A ticket for A's branch cannot be written while B's claim is in force. tickets_insert
// checks tenant_id = current_tenant_id() AND has_branch_access(branch_id), so this is the
// WITH CHECK clause refusing a cross-organization write, not a filter.
const crossTicket = await supabase
  .from('tickets')
  .insert({ tenant_id: ORG_A, branch_id: BRANCH_A, fulfilment_type: 'pickup' })
  .select('id').single();
check("creating a ticket in A's branch is REFUSED while B is active",
  crossTicket.error !== null,
  crossTicket.error ? `${crossTicket.error.code} ${crossTicket.error.message}` : 'NO ERROR (unexpected)');

// The BLOCKER-015 regression guard. This user belongs to A AND B. Before the fix the
// actor guard resolved membership through profiles.tenant_id — one home organization —
// so a ticket could only ever be created in whichever organization that column named.
// Creating in the SECOND organization is the case that used to be impossible.
const ticketB = await supabase
  .from('tickets')
  .insert({ tenant_id: ORG_B, branch_id: BRANCH_B, fulfilment_type: 'pickup' })
  .select('id,ticket_number,tenant_id,created_by,status')
  .single();
check('the same user CAN create a ticket in their SECOND organization (BLOCKER-015)',
  ticketB.error === null,
  ticketB.error ? `${ticketB.error.code} ${ticketB.error.message}` : String(ticketB.data?.ticket_number));
check("B's ticket is numbered from B's OWN sequence and stamped with B's tenant",
  /^TKT-\d{6}$/.test(ticketB.data?.ticket_number ?? '') &&
    ticketB.data?.tenant_id === ORG_B &&
    ticketB.data?.created_by === SMOKE_UID,
  JSON.stringify({ number: ticketB.data?.ticket_number, tenant: ticketB.data?.tenant_id }));

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
