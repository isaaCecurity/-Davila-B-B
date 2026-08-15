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

console.log(failures === 0 ? '\nAll cache-isolation checks passed.' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
