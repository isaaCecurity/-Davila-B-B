# BakeFlow Read-Only Test Campaign

Date: 2026-09-02
Scope: repository, frontend, Edge Functions, linked Supabase production schema, security advisors, database integrity, and operational signals.

No migrations, inserts, updates, deletes, installs, deployments, or source edits were performed by this campaign. Existing user edits in `bakeflow-frontend/packages/api/mutations/invitations.ts`, `supabase/functions/_shared/errors.ts`, and `supabase/functions/send-invite-email/index.ts` were preserved and not attributed to this campaign.

## Test strategy

The order is risk-driven:

1. Run cheap deterministic local gates first to catch syntax, type, lint, and unit regressions.
2. Run dependency and static security probes to identify vulnerable libraries and dangerous code patterns without executing business mutations.
3. Query the linked database catalogs and advisors to test the deployed security posture, because committed migrations are not authoritative for this repository's production schema.
4. Run read-only data integrity and business invariant queries against live data.
5. Exercise only safe adversarial paths, such as an anonymous call expected to fail before mutation.
6. Record limitations separately so an absence of evidence is not treated as a passing security test.

The highest-value failure signals are cross-tenant rows, missing RLS/policies, client bypass grants, anonymous privileged RPC access, stock reconciliation mismatches, invalid money totals, and unauthorized state transitions.

## Executed tests and results

### 1. Repository specification tests

Command:

```text
.venv\Scripts\python.exe -m pytest -q
```

Why: validates documented naming, requirement-ID, and specification invariants.

Result: **PASS**, `12 passed in 3.47s`.

### 2. Frontend unit tests

Command:

```text
cd bakeflow-frontend
npm test -- --runInBand
```

Why: validates pure decimal, scalar, and frontend utility behavior without a live database.

Result: **PASS**, `2` suites and `39` tests passed.

### 3. Mobile typecheck, lint, and Expo dependency consistency

Commands:

```text
npm run typecheck --workspace apps/mobile
npm run lint --workspace apps/mobile
npm run deps:check --workspace apps/mobile
```

Why: catches compile-time contract errors, lint-detectable defects, and Expo package drift.

Result: **PASS** for all three. Expo dependency validation used the local bundled dependency map because networking was disabled, so this does not replace an online dependency check.

### 4. Invitation safety regression checks

Command:

```text
node scripts/verify-invite-delivery.mjs
```

Why: verifies SHA-256 token hashing, deep-link construction, and HTML escaping.

Result: **PASS**, all 3 checks passed.

### 5. npm dependency vulnerability audit

Command:

```text
npm audit --audit-level=moderate
```

Why: identifies known vulnerabilities in direct and transitive packages.

Result: **FAIL**, `18 vulnerabilities`: `4 high`, `14 moderate`.

Affected paths include:

- `image-size` through React Native/Metro; high severity parser denial-of-service advisories.
- `decode-uri-component` through Expo Router/query-string.
- `@xmldom/xmldom` through Expo CLI/config tooling.
- `uuid` through Expo config plugins/xcode.

`npm audit fix --force` proposes breaking framework changes. No fix was applied.

### 6. Dependency tree and duplication checks

Commands:

```text
npm ls image-size decode-uri-component @xmldom/xmldom uuid --all
npm ls react react-dom @types/react --depth=0
```

Why: determines whether findings are direct or transitive and detects duplicate core React packages.

Results:

- Vulnerable packages are transitive, mainly through Expo/Metro tooling.
- **PASS** for the duplicate React check: one React, one React DOM, and one top-level React types package were resolved.

### 7. Static dangerous-pattern scan

Scanned tracked source excluding `node_modules`, `dist`, `.git`, and `.venv` for:

- dynamic execution (`eval`, `new Function`, shell execution)
- unsafe HTML assignment
- user-editable JWT metadata authorization
- token/password/secret logging
- caller-controlled URLs and raw invite tokens
- `SECURITY DEFINER`, views, and RLS constructs

Results:

- No runtime `eval`, `new Function`, child-process, or shell execution pattern found.
- No `dangerouslySetInnerHTML` in application source.
- No `raw_user_meta_data`/user-metadata authorization pattern found.
- Sensitive invite/token handling and generic error-return paths were identified for manual review.

### 8. Live RLS coverage query

Read-only catalog query checked every public table for RLS enabled and at least one policy.

Result: **one finding**:

```text
public.rate_limit_events: RLS enabled, no policy
```

All other public tables had RLS enabled with policies. A no-policy table fails closed for client roles, but the deliberate posture should be documented and privileged access verified.

### 9. Live force-RLS query

Read-only catalog query checked every public table for `FORCE ROW LEVEL SECURITY`.

Result: **PASS**, no public tables were returned without force RLS.

### 10. Live client privilege query

Checked `anon` and `authenticated` for table-level SELECT/INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER privileges.

Result: **PASS**, no suspicious client table grants were returned.

### 11. Live tenant-column nullability query

Checked tenant-owned tables for nullable `tenant_id`.

Result: only `profiles.tenant_id` is nullable. This matches the documented pre-membership state for profiles.

### 12. Live money precision query

Checked monetary columns including amounts, prices, costs, balances, taxes, variances, floats, and opening balances.

Result: **PASS**, every returned monetary column was `numeric(19,4)`.

### 13. Live SECURITY DEFINER privilege query

Checked public/private security-definer functions for pinned search paths and client execute privileges.

Results:

- **PASS**: no unpinned security-definer functions.
- **PASS**: no anonymous-executable security-definer function should exist according to the repository allowlist, except one actual live finding below.
- **FINDING**: `public.set_supervisor_permission_override(uuid,text,boolean)` is executable by `anon`.
- The function body begins with `auth.uid() IS NULL` -> `authentication required`, so the adversarial call failed closed. The grant remains unnecessary attack surface and privilege drift.

### 14. Anonymous adversarial RPC call

Read-only invocation under `anon`:

```sql
select public.set_supervisor_permission_override(
  '00000000-0000-0000-0000-000000000000',
  'tickets.view',
  true
);
```

Result: **PASS for fail-closed behavior**. It returned SQLSTATE `28000` with `authentication required` before mutation.

Security conclusion: the anonymous execute grant should still be revoked, because the function is not an anonymous feature and future body changes could turn an unnecessary grant into an exploit path.

### 15. Live function search-path and trigger exposure checks

Checked all public/private security-definer functions for `search_path`, and all public trigger functions for client execute privileges.

Results:

- **PASS**: zero unpinned security-definer functions.
- **PASS**: zero directly executable public trigger functions for `anon` or `authenticated`.

### 16. Stock reconciliation

Compared `ingredient_stock_levels` and `product_stock_levels` against grouped immutable `stock_movements` totals.

Result: **PASS**, `0` ingredient mismatches and `0` product mismatches.

### 17. Stock/status/required-field invariants

Checked:

- negative ingredient stock
- negative finished-goods stock
- invalid ticket statuses
- invalid delivery statuses
- cancelled tickets without a reason
- failed deliveries without a reason

Result: **PASS**, all six failure counts were zero.

### 18. Financial ticket total invariant

Checked `total_amount = subtotal_amount - discount_amount + tax_amount`, plus non-negative ticket monetary values.

Result: **PASS**, `0` invalid ticket totals.

### 19. Referential integrity spot checks

Checked orphaned rows for ticket items, recipe ingredients, and production batch ingredients.

Result: **PASS**, all three orphan counts were zero.

### 20. Uniqueness/business consistency spot checks

Checked:

- duplicate active product SKUs within a tenant
- more than one active recipe per variant
- more than one open cash session per branch

Result: **PASS**, all three duplicate groups were zero.

### 21. Linked Supabase security advisors

The live security advisor reported:

- `rate_limit_events` has RLS enabled but no policies.
- Multiple public security-definer RPCs are callable by `authenticated`, including invite acceptance, stock adjustment, ticket cancellation/archive, cash closing, driver sale completion, and other business operations.

These RPCs may be intentionally exposed, but every one is a privileged security boundary and must enforce tenant and role/permission checks internally.

### 22. Linked Supabase performance advisors

The live performance advisor reported unindexed foreign keys on `public.driver_trips`, including foreign keys for branch, driver, and loading verifier references.

Severity: informational/performance, not a demonstrated correctness or confidentiality defect.

Recommended action: add covering indexes after confirming query patterns and migration ownership.

### 23. Live logs availability check

Queried the unified logs stream for the prior 24-hour window.

Result: logs were available from `edge_logs`, `postgres_logs`, and `postgrest_logs`. A more selective error-message query returned a backend error from the logs service, so no conclusion about error frequency is recorded.

## Findings requiring action

### High: dependency vulnerabilities

The current lockfile resolves 18 known vulnerable packages, including four high-severity advisories through the Metro/Expo toolchain. Plan a compatible Expo/React Native/Metro upgrade and rerun the full gates.

### Medium: anonymous execute grant on privileged RPC

`public.set_supervisor_permission_override` is callable by `anon` even though its body rejects unauthenticated callers. Revoke the unnecessary grant and add the function to the privilege audit regression path.

### Medium: public SECURITY DEFINER RPC attack surface

Multiple authenticated users can execute public security-definer business functions. No bypass was demonstrated in this campaign, but these functions bypass ordinary RLS and must be reviewed body-by-body for tenant, actor, branch, role, permission, input, and transaction checks.

### Medium: policyless `rate_limit_events`

The table fails closed, but zero policies is ambiguous for a security-sensitive rate-limit ledger. Verify that only the intended privileged function can access it and document the no-client-access design.

### Medium: caller-controlled invite URL and error disclosure status

The current working tree contains user changes that remove caller-supplied `app_url` and make unexpected error responses generic. Those changes were already present when this campaign inspected the worktree and were not made or validated as part of this campaign. They address the previously identified concerns, but should be included in the user's own change review and deployment validation.

### Low: SQL lint warnings

The linked CLI lint produced warnings for type assignments in `custom_access_token_hook` and `apply_ticket_item_update`, plus an unused variable in `sync_pull`. These did not fail the lint command but should be cleaned up.

## Coverage gaps and why they remain open

- Full tenant isolation against every table and every role was not run because the repository's comprehensive SQL fixtures contain writes and the request prohibited changing live data. The existing scripts should be run against an isolated database clone or disposable branch.
- Financial randomized rounding, payment/refund invariants, concurrency tests, state-machine transition matrices, and rollback atomicity were not executed against production because they require writes or controlled fixtures.
- The live logs service returned an error for the filtered error query, so error-rate analysis is incomplete.
- GitHub secret-scanning MCP was not available in this session. Local tracked-file scans found no service-role credential in source or built artifacts, but this is not equivalent to scanning repository history.
- Dependency advisories may be tooling-only at runtime; production reachability should be confirmed during the upgrade.

## Final state

No application or database code was changed by this campaign. The only intended new artifact is this report plus the prior audit report in `audit-findings/`. Existing user modifications were preserved.
