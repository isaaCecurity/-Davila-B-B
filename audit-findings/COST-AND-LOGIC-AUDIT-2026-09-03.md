# BakeFlow Cost & Logic Audit

Date: 2026-09-03
Repository: `isaaCecurity/-Davila-B-B`
Scope: requested directly by the project owner ("perform audits and new tests on this
codebase to catch errors, bugs, logical problems, or future cost problems"), as a
follow-up pass distinct from the two prior audit reports in this folder (which covered
security posture and data integrity). This pass targets what neither of those covered:
storage/compute growth patterns and a further sweep of state-machine logic for the two
lifecycle entities (production, delivery) not yet audited that way.

Every finding below was checked against the live database (`tvfyxpafbpnkneujcnvr`) and
the actual RLS/query patterns that hit it — nothing here is inferred from a generic
linter finding without independently confirming it's real for this schema.

## Findings — fixed

### Future cost: 23 RLS policies re-evaluated `auth.uid()` per row instead of per query

Supabase's performance advisor flagged 23 policies across 15 tables with the
`auth_rls_initplan` issue — a bare `auth.uid()` call inside a policy's `USING`/`WITH
CHECK` is evaluated once per row scanned rather than once per query, unless wrapped in a
scalar subquery `(select auth.uid())`, which lets Postgres cache it as an InitPlan. This
compounds with table size — the busier the table, the worse it gets — and directly hit
`tickets`/`ticket_items`, the two busiest tables in the app (scanned on every sale).

Fixed as a mechanical, semantically-identical substitution (same single value either
way) across all 23: `tickets_insert/update`, `ticket_items_insert/update/delete`,
`sync_changes_select`, `sync_devices_select/insert/update`, `sync_operations_select`,
`user_roles_insert/update/delete`, `expenses_insert`, `sync_conflicts_select/resolve`,
`daily_financial_audits_select/insert/update_own_open`,
`role_permissions_select_authenticated`, `permanent_deletion_challenges_owner`,
`profiles_update_self`, `organizations_select`. `has_role()`/`has_branch_access()`/
`current_tenant_id()` were deliberately left untouched — the advisor didn't flag them,
and `has_branch_access()` takes a row-varying argument so can't be hoisted regardless.

**Verified zero-regression, not assumed:** advisor's `auth_rls_initplan` count dropped
23 → 0. Re-ran `tests/sql/sales_write_rls.sql` (21/21), a new direct-path `ticket_items`
INSERT/UPDATE check (5/5 — the RPC-based suites above don't actually exercise this
policy at all, since `SECURITY DEFINER` RPCs bypass RLS; this had to be tested via a raw
`INSERT`/`UPDATE` as `authenticated`), `tests/sql/p3_7_sync_apply_and_pull.sql` (11/11),
`tests/sql/financial_write_rls.sql` (28/28), `tests/sql/security_multiorg_sync.sql`
(22/22), and a targeted direct check of the remaining five policies (7/7).

### Future cost: one duplicate index

`idx_audit_log_entity` and `idx_audit_log_tenant_entity_time` were byte-for-byte
identical (`tenant_id, entity_type, entity_id, occurred_at DESC`) — pure write/storage
cost with zero read benefit. Dropped the less-descriptively-named one.

### Future cost: 3 real missing indexes (out of 18 candidates — 15 correctly left alone)

A blanket "index every unindexed FK" pass would have been noise: this codebase already
deliberately indexes only FK columns actually hit by a `WHERE`/`USING` clause —
confirmed by grep that `archived_by`/`loading_verified_by`/`reconciled_by` (and similar
audit-trail columns) are write-only across every migration in the repo, matching this
project's own established convention. The three that ARE real, each confirmed against
the actual live RLS policy text before adding anything:

- `sync_conflicts.actor_id` — `sync_conflicts_select`'s own-actor branch filters
  `actor_id = auth.uid()` directly, no other predicate on this table in that branch. An
  offline-first app's conflict table only grows over time, so this compounds.
- `permanent_deletion_challenges.requested_by` — its own RLS filters
  `requested_by = auth.uid() AND tenant_id = current_tenant_id()` directly.
- `user_permission_overrides.profile_id` — the own-profile RLS branch
  (`profile_id = auth.uid()`) has no `tenant_id` in that branch; the existing
  `(tenant_id, profile_id)` composite index doesn't help it. (This table was built
  earlier the same session, for BLOCKER-025 — a gap in that same day's own work.)

## Findings — reviewed, no action taken (by design, not oversight)

- **`unused_index` (75 findings):** this is a pre-launch database with almost no real
  traffic yet (test suites and synthetic fixtures only) — the advisor flags any index
  with zero recorded scans, which is expected and not meaningful at this stage. Acting
  on it now would mean removing indexes deliberately added for known future query
  patterns, including several added in this very session. Revisit after real usage data
  exists.
- **`multiple_permissive_policies` (7 findings, on `profiles` and
  `daily_financial_audits`):** each pair is two distinctly-named, intentional policies
  (e.g. `profiles_update_self` vs `profiles_update_admin` — self-service OR
  admin-override). This is standard, correct RLS design, not accidental duplication.
  Merging them into one compound policy is a valid *optional* micro-optimization but
  adds maintenance risk for marginal gain on a database this size — not worth the
  trade-off here.
- **`production_batches` has zero `authenticated` grants at all**, including `SELECT` —
  initially looked like a broken read path (the "production board" is documented in
  `docs/API-CONTRACT.md` as a direct PostgREST read). Traced to migration
  `20260901160000_deactivate_ingredient_tracking_for_mvp.sql` (AD-022): a deliberate,
  fully-documented, already-live-verified product decision to deactivate production
  tracking for MVP alongside raw-ingredient tracking, since production batches can't be
  created without ingredients anyway. Not a bug — confirmed against the migration's own
  extensive blast-radius audit before concluding this.

## Logic-bug sweep: state-machine reachability (the `BLOCKER-005`/`009` bug class)

Tickets previously had two real defects of this shape: unreachable status values caused
by competing/misordered triggers. Checked the two other lifecycle entities that had
never been swept this way:

- **`production_batches`** (`scheduled → in_progress → {completed, failed}`,
  `scheduled → cancelled`): single guard trigger, no competing trigger, every declared
  status value reachable. Clean.
- **`deliveries`** (`pending → assigned → in_transit → {delivered, failed, returned}`,
  `failed → returned`): single guard trigger, every declared status value reachable,
  RPC-gated (`transition_delivery()`) since `authenticated` has no direct `UPDATE` grant
  on the table. Clean.

## New permanent regression test

`tests/sql/rls_performance_audit.sql` — read-only, catalog-only (no fixtures, no
transaction needed, same shape as `tests/sql/function_privilege_audit.sql`). CHECK 1
flags any RLS policy with an unwrapped `auth.uid()`/`auth.jwt()`/`auth.role()` call
(correctly handles a policy that mixes wrapped and unwrapped calls, not just a substring
match). CHECK 2 flags any two indexes on the same table with byte-for-byte identical
definitions. Both zero rows live today. This is the permanent guard so a future
migration can't silently reintroduce either class without the test suite catching it —
previously only the Supabase performance advisor would have, and only if someone
happened to check it.

## What this pass did not cover

- The npm dependency upgrade (already flagged in the prior security audit, still
  deliberately deferred — breaking-change-prone, needs its own scoped task).
- A full body-by-body review of every `SECURITY DEFINER` RPC for tenant/role/branch/
  input checks — the grant-*surface* was swept (via `function_privilege_audit.sql`), but
  not every function's internal logic. Several were already spot-checked live earlier
  this session (`archive_catalog_entity`, `complete_ticket`, etc.), not the full set.
- Supabase project-level infrastructure cost concerns (log retention, connection pooling
  tier, compute size) — outside what's checkable via SQL/MCP tools from here.
- `unused_index` findings — explicitly deferred to a post-launch pass, see above.

Full narrative and live verification detail: `IMPLEMENTATION_LOG.md` 2026-09-03.
