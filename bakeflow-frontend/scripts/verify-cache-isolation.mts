/**
 * Executable verification of the P8.1 cache-isolation property.
 *
 * **This is not a unit test and the repository has no test runner** — there is no jest,
 * vitest or react-test-renderer in the dependency set, so component behaviour cannot be
 * asserted here. What this file does assert is the one claim in P8.1 that is pure logic
 * over a real `QueryClient`, and the one whose failure mode is a user seeing another
 * bakery's data:
 *
 *   1. organization-scoped keys differ per organization;
 *   2. a cache holding organization A's catalog returns NOTHING for organization B's key;
 *   3. `clearOrganizationScopedCache` evicts organization-scoped entries and keeps the
 *      organization list (which is user-scoped, not organization-scoped);
 *   4. `clearAllCache` — the sign-out path — leaves nothing at all.
 *
 * Run: `npm run verify:cache` from `bakeflow-frontend`.
 */

import { activeTenantIdFromSession, rolesFromSession } from '../packages/auth/claims';
import { CHUNK_SIZE, createChunkedStorage } from '../packages/auth/chunked-storage';
import { formatNaira, formatQuantity } from '../packages/utils/money';
import { QueryClient } from '@tanstack/react-query';

import {
  clearAllCache,
  clearOrganizationScopedCache,
  queryKeys,
} from '../packages/hooks/index';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

let failures = 0;
function check(name: string, passed: boolean, detail = ''): void {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : ` — ${detail}`}`);
  if (!passed) failures += 1;
}

// 1 — keys are distinct per organization.
const keyA = JSON.stringify(queryKeys.products(ORG_A));
const keyB = JSON.stringify(queryKeys.products(ORG_B));
check('product keys differ between organizations', keyA !== keyB, `${keyA} vs ${keyB}`);
check(
  'organization-scoped keys start with the org scope and tenant id',
  keyA.startsWith(`["org","${ORG_A}"`),
  keyA,
);
check(
  'the organization list is NOT organization-scoped (it must load with a null claim)',
  !JSON.stringify(queryKeys.myOrganizations(USER)).startsWith('["org"'),
  JSON.stringify(queryKeys.myOrganizations(USER)),
);

// 2 — organization A's data is unreachable under organization B's key.
const client = new QueryClient();
client.setQueryData(queryKeys.products(ORG_A), { rows: [{ id: 'p1', name: 'Agege Bread' }] });
client.setQueryData(queryKeys.productCategories(ORG_A), [{ id: 'c1', name: 'Breads' }]);
client.setQueryData(queryKeys.myOrganizations(USER), [{ id: ORG_A }, { id: ORG_B }]);

check(
  "organization B's key returns nothing while A's data is cached",
  client.getQueryData(queryKeys.products(ORG_B)) === undefined,
);
check(
  "organization A's own key still returns A's data",
  client.getQueryData(queryKeys.products(ORG_A)) !== undefined,
);

// 3 — the switch evicts organization-scoped entries only.
clearOrganizationScopedCache(client);
check(
  'switching evicts the previous organization catalog',
  client.getQueryData(queryKeys.products(ORG_A)) === undefined,
);
check(
  'switching evicts organization-scoped categories too',
  client.getQueryData(queryKeys.productCategories(ORG_A)) === undefined,
);
check(
  'switching KEEPS the organization list (it is user-scoped)',
  client.getQueryData(queryKeys.myOrganizations(USER)) !== undefined,
);

// 4 — sign-out leaves nothing behind for the next user of the device.
client.setQueryData(queryKeys.products(ORG_B), { rows: [] });
clearAllCache(client);
check(
  'sign-out clears organization-scoped data',
  client.getQueryData(queryKeys.products(ORG_B)) === undefined,
);
check(
  'sign-out clears the organization list too',
  client.getQueryData(queryKeys.myOrganizations(USER)) === undefined,
);
check('sign-out leaves an empty cache', client.getQueryCache().getAll().length === 0);


/* ---------------------------------------------------------------------------
 * JWT claim location — the P8.1 bug this exists to stop recurring.
 *
 * The live custom_access_token_hook writes tenant_id and roles as TOP-LEVEL claims.
 * The first implementation read session.user.app_metadata.tenant_id, which is not where
 * they land, so every signed-in user had a null tenant: the app was stuck on the
 * organization picker with every catalog query disabled. Typecheck, lint and the cache
 * checks above all passed anyway, because none of them touches a real token.
 * ------------------------------------------------------------------------- */

function fakeJwt(payload: Record<string, unknown>): string {
  const b64url = (o: unknown): string =>
    Buffer.from(JSON.stringify(o))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return b64url({ alg: 'HS256', typ: 'JWT' }) + '.' + b64url(payload) + '.sig';
}

const sess = (payload: Record<string, unknown>, appMetadata: object = {}): never =>
  ({ access_token: fakeJwt(payload), user: { id: USER, app_metadata: appMetadata } }) as never;

check(
  'tenant_id is read from the TOP-LEVEL claim, as the live hook writes it',
  activeTenantIdFromSession(sess({ sub: USER, tenant_id: ORG_A })) === ORG_A,
);
check(
  'a null tenant_id claim yields null (no active org / revoked membership)',
  activeTenantIdFromSession(sess({ sub: USER, tenant_id: null })) === null,
);
check(
  'app_metadata remains a fallback if the hook ever mirrors it there',
  activeTenantIdFromSession(sess({ sub: USER }, { tenant_id: ORG_B })) === ORG_B,
);
check('a null session yields null', activeTenantIdFromSession(null) === null);
check(
  'roles come from the top-level claim',
  JSON.stringify(rolesFromSession(sess({ sub: USER, roles: ['owner', 'baker'] }))) ===
    '["owner","baker"]',
);
check(
  'a malformed token does not throw',
  activeTenantIdFromSession({
    access_token: 'not-a-jwt',
    user: { id: USER, app_metadata: {} },
  } as never) === null,
);

/* --------------------------------------------------------------------------
 * Money display for P9.1 variant prices — exact decimal strings, never doubles.
 * ------------------------------------------------------------------------ */

check(
  'money formats with grouping at 2dp',
  formatNaira('184500.0000' as never) === '₦184,500.00',
  formatNaira('184500.0000' as never),
);
check(
  'a 15-digit price survives exactly (a double would not)',
  formatNaira('12345678901234.5678' as never) === '₦12,345,678,901,234.56',
  formatNaira('12345678901234.5678' as never),
);
check(
  'display truncates rather than rounds (settlement rule is BLOCKER-003)',
  formatNaira('0.9999' as never) === '₦0.99',
  formatNaira('0.9999' as never),
);
check(
  'negative zero shows no minus sign',
  formatNaira('-0.0000' as never) === '₦0.00',
  formatNaira('-0.0000' as never),
);
check(
  'quantities keep their full stored scale',
  formatQuantity('2.5000' as never) === '2.5000',
  formatQuantity('2.5000' as never),
);


/* --------------------------------------------------------------------------
 * Chunked session storage (BLOCKER-013's implementation half).
 *
 * SecureStore rejects values over ~2KB on Android and a Supabase session exceeds that, so
 * the session is split across numbered keys with the count written LAST as the commit
 * point. The failure modes worth proving are the ones that produce a *plausible but wrong*
 * session: an orphaned tail chunk from a longer previous value, and a torn write.
 * ------------------------------------------------------------------------ */

function memoryBackend() {
  const store = new Map<string, string>();
  return {
    store,
    getItemAsync: (k: string) => Promise.resolve(store.get(k) ?? null),
    setItemAsync: (k: string, v: string) => {
      if (v.length > 2048) throw new Error(`SecureStore would reject ${v.length} bytes`);
      store.set(k, v);
      return Promise.resolve();
    },
    deleteItemAsync: (k: string) => {
      store.delete(k);
      return Promise.resolve();
    },
  };
}

const backend = memoryBackend();
const storage = createChunkedStorage(backend);

const bigSession = JSON.stringify({
  access_token: 'x'.repeat(3000),
  refresh_token: 'y'.repeat(600),
  user: { id: USER },
});

await storage.setItem('bakeflow.session', bigSession);
check(
  'a >2KB session round-trips exactly',
  (await storage.getItem('bakeflow.session')) === bigSession,
);
check(
  'it was actually split (a single value would have been rejected)',
  backend.store.size > 2,
  `keys=${backend.store.size}`,
);
check(
  'every stored chunk is within the SecureStore limit',
  [...backend.store.values()].every((v) => v.length <= CHUNK_SIZE),
);

// A shorter value must not leave the previous tail readable.
await storage.setItem('bakeflow.session', 'short');
check('overwriting with a shorter value returns only the new value',
  (await storage.getItem('bakeflow.session')) === 'short');
check('no orphaned tail chunks remain', backend.store.size === 2, `keys=${backend.store.size}`);

// A torn write (count present, an interior chunk missing) must read as absent.
await storage.setItem('bakeflow.session', bigSession);
backend.store.delete('bakeflow.session.1');
check('a torn write reads as NO session rather than a truncated one',
  (await storage.getItem('bakeflow.session')) === null);

await storage.setItem('bakeflow.session', bigSession);
await storage.removeItem('bakeflow.session');
check('removeItem clears every chunk and the count', backend.store.size === 0,
  `keys=${backend.store.size}`);
check('reading a missing key yields null', (await storage.getItem('nope')) === null);

console.log(failures === 0 ? '\nAll checks passed.' : '\n' + failures + ' FAILED');
process.exit(failures === 0 ? 0 : 1);
