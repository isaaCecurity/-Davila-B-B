# BakeFlow — Current Task

## ✅ Security audit findings addressed — 4 of 6 fixed and deployed live (2026-09-02)

Reviewed `audit-findings/SECURITY-AUDIT-2026-09-02.md` (an external report) before starting
BLOCKER-023, per the user's request. Verified every finding against live source/database
first, then acted:

- **Fixed & deployed:** caller-controlled invite link domain (`app_url` was dead client
  plumbing, removed entirely — server-configured `APP_BASE_URL` only now); raw internal
  error messages returned to clients (now generic; real detail still server-logged);
  three `db lint` warnings (all behavior-preserving hardening, `db lint` now clean).
- **Reviewed and one real finding fixed:** the "public SECURITY DEFINER RPCs" concern —
  swept every such function live. One (`set_supervisor_permission_override`, built earlier
  the same day for BLOCKER-025) had an unintended `anon` grant via Supabase's default
  function privileges — not exploitable (fails closed on `auth.uid() IS NULL`) but
  shouldn't have existed. Revoked; `tests/sql/function_privilege_audit.sql` re-run clean.
- **Deliberately not touched**, matching the report's own caution: `rate_limit_events`'
  policyless RLS (already fails closed, no client needs access) and the npm dependency
  upgrade (breaking-change-prone, needs its own scoped task).

A second, independent read-only verification campaign
(`audit-findings/TEST-CAMPAIGN-2026-09-02.md`) appeared mid-pass and cross-confirmed the
same findings, including the `anon`-grant issue (from its own live query, timestamped before
this pass's fix landed).

Full detail: `IMPLEMENTATION_LOG.md` 2026-09-02. `pytest` 12/12, frontend typecheck/lint/Jest
(39/39) all clean throughout.

---

## ✅ BLOCKER-025 DELIVERED — per-supervisor permission overrides built, one real security gap found and fixed (2026-09-02)

Picked as the next task after BLOCKER-022/023. Unlike those two, this one asked for a real
new capability, not a deferral. Got the owner's decisions on the three genuinely open
questions first (scope, who may set an override, which permission keys are eligible — see
`BLOCKERS.md` BLOCKER-025 for the full reasoning), then built:

- **`user_permission_overrides` table** + **`set_supervisor_permission_override()`** RPC —
  Branch-Manager-only, target must currently hold `supervisor`, permission key must be on a
  safe 15-key allowlist (explicitly excluding `tickets.update`/`tickets.cancel`, which must
  never be granted to any role by any mechanism).
- **`has_permission()` rewritten** to check for an active override first — it wins outright
  over the role-level grant when present; unchanged fallback otherwise.

**A real security gap was found and fixed before shipping, not assumed:** Supabase's default
schema privileges had silently granted `authenticated` full write access to the new table —
caught live by the new test suite's own first assertion, fixed via an explicit `REVOKE`
migration. Without it, a direct PostgREST write would have bypassed every guard the RPC
enforces.

**Verified:** `tests/sql/supervisor_permission_overrides.sql`, 17/17 live. Zero regression:
`tests/sql/catalog_write_rls.sql` re-run in full (18/18) since it's the primary other live
consumer of `has_permission()`. `pytest -q`: 12/12. CI baseline
(`20260809_live_schema.sql`) patched in place with the new table/functions/policies.

Full detail: `IMPLEMENTATION_LOG.md` 2026-09-02. Docs updated: `BLOCKERS.md`,
`docs/ROLES-AND-PERMISSIONS.md`, `docs/API-CONTRACT.md`.

**BLOCKER-023** (`sync_changes` retention/purge — already scoped as "no immediate action
needed") is the last item from the original three-candidate set, and has nothing actionable
today.

---

## ✅ BLOCKER-022 resolved — `depends_on_operation_id` deferred by owner decision (2026-09-02)

Picked as the next task after P4.4, per the owner's choice among the standing candidates
(BLOCKER-022/023 offline-sync decisions vs. BLOCKER-025 per-supervisor overrides). This is
an architecture decision, not code — per `CLAUDE.md`'s blocker rule, presented the choice
directly rather than guessing: build minimal cross-batch dependency enforcement now, or
defer since no scheduled entity needs it and the existing per-handler existence-check retry
path is already correct. **Owner chose: defer.** No schema, migration, or behavior change.

`BLOCKERS.md` BLOCKER-022 marked RESOLVED (deferred, not "will never be needed" — revisit if
a real cross-batch-dependency use case appears). `docs/SCHEMA-REFERENCE.md` §12 corrected in
two places to stop listing it as an open gap. Full detail: `IMPLEMENTATION_LOG.md` 2026-09-02.

**BLOCKER-023** (`sync_changes` retention/purge) and **BLOCKER-025** (per-supervisor
permission overrides) remain open — next-task candidates.

---

## ✅ P4.4 ticket write-path test suite DELIVERED — real idempotency defect found and fixed (2026-09-01)

Picked as the next task after the full-database audit, from a set of offered options.
No decision needed — pure test-coverage debt on the one P3–P5 write path
(`confirm_ticket`/`cancel_ticket`/`complete_ticket`/`archive_ticket`/`update_ticket`)
with no dedicated SQL suite.

**A real defect was found and fixed while writing it, before any assertion existed:**
`complete_ticket()` was not idempotent — calling it twice on an already-completed
ticket silently re-sold the same stock a second time (verified live: 50 units → 44
instead of the correct 47, with no exception raised either time). Root cause: the
function's final status UPDATE is a same-status no-op under
`guard_ticket_status_transition()`, so nothing ever stopped a second pass through the
stock-movement loop above it. Fixed live (migration
`fix_complete_ticket_idempotency`) by rejecting outright if the ticket is already
completed, mirroring this project's existing pattern for the same class of check.

**Delivered:** `tests/sql/sales_write_rls.sql`, 21/21 live — the full ticket lifecycle
walked through real role switches, `confirm_ticket()`'s preconditions,
`update_ticket()`'s three-tier permission structure (manager-only fields / baker
status-only restriction / driver-assignment validation), `cancel_ticket()`'s
reason-required and refund-required rules and invoice-voiding, the branch-access gate,
cross-tenant denial, and the idempotency regression guard (SW14).

Docs updated: `docs/API-CONTRACT.md`, `BACKEND_ROADMAP.md` (P4.4 now COMPLETE in both
the Current State summary and the B8 crosswalk row).

**Committed and pushed (`de55f79`), confirmed GREEN on a real GitHub Actions run**
(`33572983188`) — all three jobs passed, including `Database suites (throwaway
Postgres)`, confirming `tests/sql/sales_write_rls.sql` and the idempotency fix both
work from a genuinely fresh database, not just the live project.

Full trace: `IMPLEMENTATION_LOG.md` 2026-09-01 (latest entry).

---

## ✅ BLOCKER-010(c) resolved — catalog write path confirmed; P4.1b COMPLETE (2026-09-01)

Picked from a set of offered next-task options after AD-022 wrapped up. Confirmed
PostgREST+RLS is the correct write mechanism for catalog create/edit (matches
`docs/API-CONTRACT.md` §1's own rule, live-verified via new suite
`tests/sql/catalog_write_rls.sql`, 18/18) — but found, live and reproducibly, that a
direct PostgREST `UPDATE` can **never** set `deleted_at` on `products`/
`product_categories`/`product_variants` for any role, including owner (Postgres refuses
an UPDATE whose new row would fail the table's own SELECT policy), and that
`authenticated` was never actually `GRANT`ed `DELETE` on these tables either — so
catalog soft-delete had no PostgREST path in either direction.

Built the fix: `archive_catalog_entity()`/`restore_catalog_entity()`, two new
`SECURITY DEFINER` RPCs (migration `20260901200000_add_archive_restore_catalog_entity_
rpcs.sql`), mirroring `archive_ticket()`'s established conventions
(`has_permission('products.manage', NULL)`, `log_audit_event()`, the errcode/detail
`RAISE` shape) rather than inventing new ones. Scoped to `product`/`product_category`/
`product_variant` only — `docs/SOFT-DELETE-AND-RETENTION.md` §38 had already specified
`restore_catalog_entity` including `'ingredient'`, but AD-022 (same day) revoked
`authenticated`'s ingredient-table grants entirely, and these RPCs being
`SECURITY DEFINER` would otherwise silently bypass that.

**BLOCKER-010 is now fully resolved** (all three parts — a: 2026-08-14, b: 2026-08-24
via AD-017, c: this pass) and **P4.1b catalog write path is COMPLETE**. Full trace:
`IMPLEMENTATION_LOG.md` 2026-09-01 (latest entry), `BLOCKERS.md` BLOCKER-010,
`ARCHITECTURE_DECISIONS.md` AD-021 postscript, `docs/API-CONTRACT.md` §2,
`docs/SOFT-DELETE-AND-RETENTION.md` §38, `BACKEND_ROADMAP.md` (five stale mentions
corrected).

**Committed and pushed (`b6abeb83`), confirmed GREEN on a real GitHub Actions run**
(`33551152655`) — all three jobs passed, including `Database suites (throwaway
Postgres)`, which means `tests/sql/catalog_write_rls.sql` and the baseline patch both
work from a genuinely fresh database, not just against the live project.

---

## ✅ AD-022 — raw-ingredient/production stock tracking deactivated for MVP (2026-09-01)

Direct product decision from the user, made mid-session: MVP does not track bakery stock at
the raw-ingredient level (flour, sugar, anything "related to making the product") — that's a
v2 feature. Finished-product stock ("how many loaves are left") stays in scope, and the MVP
dashboard shows revenue/cash only, no COGS/profit. This resolves **BLOCKER-018** by descope
rather than by building the missing ingredient-purchase-cost mechanism.

Applied live via `mcp__supabase__apply_migration` (full blast-radius audit first, every claim
live-verified, not assumed): `authenticated` grants revoked on the six ingredient/production
tables; `adjust_stock()`/`apply_inventory_adjust()`/`apply_inventory_waste()` narrowed to
`item_type='product'` only; `production.start/.cancel/.record_output/.record_waste` removed
from the `domain_operation` allowlist; `complete_production_batch()`/`fail_production_batch()`'s
4-arg overload lost its `authenticated` EXECUTE grant. Nothing dropped — every table/function/
migration stays in the schema for v2 to re-enable by reversing this one migration.

Frontend: "Batches" nav button removed, `app/inventory/[warehouseId].tsx` narrowed to
product-only stock (ingredient tab toggle deleted). Typecheck/lint/unit tests clean.

7 SQL test files updated to match: `p3_7_inventory_sync.sql`/`inventory_write_rls.sql`
re-pointed at the still-live product-only path (plus new tests proving ingredient rejection);
`inventory_read_rls.sql`'s ingredient-visibility assertions replaced with a denial proof;
`p3_7_customer_sync.sql`'s D1 anchor re-updated; `p3_7_production_sync.sql`/
`p3_7_production_output_waste_sync.sql` rewritten from 400+/580+ lines down to short
CHECK-constraint-rejection proofs (no product-only fallback exists for production batches);
`function_privilege_audit.sql`'s allowlist comment corrected.

Full trace: `IMPLEMENTATION_LOG.md` 2026-09-01 (fifth and sixth entries),
`ARCHITECTURE_DECISIONS.md` AD-022, `BLOCKERS.md` BLOCKER-018.

**Confirmed GREEN**, two pushes in: the first real CI run after this change found two more
test files that read the deactivated tables directly (`catalog_read_rls.sql`,
`inventory_write_rls.sql` — both fixed, see the sixth log entry); the second run (commit
`a333b487`, run `33546190160`) passed clean across all three jobs and all 16 SQL suites.

---

## ✅ SQL-suite CI wiring — GREEN on GitHub's own runners; P11.1 + P11.2 COMPLETE (2026-09-01)

**Update, same day:** the "one thing still genuinely open" below (a real GitHub Actions run) has
happened — three times, in fact, since the first two each found something real. Fixed, in order:
(1) the `sql-tests` loop's `set -e` was silently skipping every file after the first alphabetical
failure — now runs all 16 and reports every failure by name; (2) `Lint & typecheck` had been
broken on every run since 2026-08-28 on an unrelated `jest.config.js` globals gap; (3) fixing the
`catalog_read_rls.sql` C9a/C9b assertions (below) had a cascading effect on C1b's expected row
count, only visible once the suite actually ran end-to-end; (4) a second stale test
(`p3_7_inventory_sync.sql` I10) used a `domain_operation` value since removed from its allowlist.
The `rate_limit_events` "gap" mentioned below turned out to already be a decided, live-verified
design (P6.6) — checked directly against the live database rather than assumed — and is now
allowlisted at the test level with that evidence. **All three CI jobs are green:** run
`33528550754`, commit `00b857d9`. Full trace: `IMPLEMENTATION_LOG.md` 2026-09-01 (four entries).
5 commits made and pushed this pass. The section below is kept as-written for its own history.

---

## ✅ SQL-suite CI wiring — validated end-to-end on a throwaway EC2 instance; P11.1 + P11.2 COMPLETE (2026-09-01)

Continuing directly from BLOCKER-002's resolution below: user asked to wire `tests/sql/*.sql`
into CI using a throwaway database (explicitly rejecting production credentials in secrets).
Local Docker Desktop had a persistent DNS-resolution failure pulling images, so validation ran
on a throwaway AWS EC2 instance instead (Docker, torn down completely afterward — instance
terminated, security group and key pair deleted, confirmed not just requested).

**P11.2 (shared fixture library) built along the way, as a real prerequisite:** none of the 16
SQL suites are self-contained — all depend on organization/branch/profile/warehouse/recipe/
ingredient/product (and, found later, one production_batches) rows that exist only in the live
project's history. Built `tests/sql/fixtures.sql` with only the deliberate rows tests actually
need (explicitly NOT a mirror of the live warehouse's 60+ rows of accumulated ad-hoc-testing
debris).

**Validated by actually running the full chain repeatedly against a genuinely fresh database**
(auth/storage compat shim -> baseline -> seed -> fixtures -> all 16 suites), fixing one failure
at a time until it passed, not by reasoning about what should work. Found and fixed **nine real,
previously-unknown defects** in the baseline/tests — most significantly, the baseline's GRANT
sections for both functions AND tables only ever had positive `GRANT`s, never a `REVOKE`, so a
default privilege this project has configured (auto-granting `authenticated`/`anon` on
everything `postgres` creates) silently reintroduced access that's correctly locked down on
live — invisible until tested against a database that doesn't already have every object
individually hardened by months of prior migrations. Full list of all nine: `IMPLEMENTATION_LOG.md`
2026-09-01 (second entry).

**Final result: 14/16 suites pass clean.** The other 2 fail on pre-existing, already-documented
issues unrelated to this work — flagged for you rather than guessed at:
- `catalog_read_rls.sql` (C9a/C9b/C1b) asserts the *absence* of a fix (BLOCKER-010a) that was
  actually resolved live back on 2026-08-14 — this test file predates that fix and needs its
  own update, which wasn't attempted here since it's a separate, real piece of work.
- `security_multiorg_sync.sql` (S13) — the already-known `rate_limit_events` RLS gap, unrelated
  to any of this.

`.github/workflows/ci.yml`'s `sql-tests` job header updated to reflect the validated status.
**One thing still genuinely open:** an actual run on GitHub's own runners is the final
confirmation this exact YAML works there — different network and image-cache state than the EC2
validation. Treat the above as strong evidence, not an ironclad guarantee of the first real run.

Full trace: `IMPLEMENTATION_LOG.md` 2026-09-01.

**Not committed** — no commit instruction was given this pass.

---

## ✅ BLOCKER-002 actually resolved — schema baseline regenerated and independently verified (2026-08-31)

User asked to "solve blocker 2" directly. Regenerated `supabase/migrations/20260809_live_schema.sql`
from scratch via live catalog introspection (chosen over the blocker's other two options since
it's the only one that restores real reproducibility). Then independently re-verified it —
name-for-name, not just counts — against the live database: **40/40 tables, 58/58 triggers,
97/97 functions, 108/108 policies, zero discrepancies.** Two more stray `anon`/`authenticated`
grants on trigger functions were found and fixed along the way (`prevent_driver_trip_delete`,
`guard_driver_trip_transition`, `guard_ticket_driver_trip_assignment`), and the function-
privilege audit script gained a third check specifically for that class.

**One gap disclosed, not hidden:** a genuine from-empty-database rebuild test was not performed
— Docker is installed but its daemon isn't running, and starting a full local Supabase stack for
the first time would have been a real time/resource cost not undertaken without asking first.
The scratch-schema test that was done (table/constraint DDL applied to a throwaway schema on the
live database, zero errors) is a strong partial substitute, not a full equivalent.

**BLOCKER-002 is now RESOLVED**, with a maintenance rule added (`MIGRATION_GOVERNANCE.md` §3) so
this doesn't drift silently again. CI wiring of the SQL suites is explicitly still a SEPARATE,
open decision (production credentials in GitHub secrets) — resolving reproducibility does not
resolve that, and it wasn't decided here.

Full detail: `BLOCKERS.md` BLOCKER-002, `IMPLEMENTATION_LOG.md` 2026-08-31 (latest entry).

**Not committed** — no commit instruction was given this pass.

---

## P11 scoping — BLOCKER-002 reopened (was falsely RESOLVED); anon-EXECUTE hygiene fix on 9 functions; permanent function-privilege audit added (2026-08-31)

Picked as "most important next area" after the FINANCIAL/production work below, specifically
because it's the systemic fix for the same-day SECURITY FIX entry further below — a CI-enforced
check would catch that class of mistake automatically, not only when someone asks for a review.

**Before any CI work, found BLOCKER-002's "RESOLVED" status was false.** `.github/workflows/ci.yml`
correctly explains SQL suites aren't CI-wired because the repo can't rebuild the schema and
pointing CI at production needs a secret — a human decision, not mine to invent. `BLOCKERS.md`
claimed this was already fixed via a baseline DDL file. Live-checked: that file has 23 of the
database's 40 tables and zero RLS policies/functions/triggers; the tracking doc hadn't been
touched in three weeks. Reopened BLOCKER-002 with full evidence; corrected
`MIGRATION_GOVERNANCE.md` and `docs/PROJECT-OVERVIEW.md` §7. **Did not attempt the reconciliation
itself** — real options exist and it's a decision for you, detailed in `BLOCKERS.md`.

**Separately, found 9 pre-existing functions anon-executable with no product reason** (payments,
driver-trip lifecycle, a revenue report). None were exploitable (each fails safely without a real
login) but all were unnecessary attack surface. Fixed via `REVOKE` — the first attempt didn't
actually work (privilege came through `PUBLIC`, not `anon` directly), caught via live re-check
and corrected same session.

**Deliverable:** `tests/sql/function_privilege_audit.sql` — a permanent, zero-rows-expected check
(mirroring the existing RLS zero-policy check's role) that would have caught both of today's
findings and fails loudly on any future regression. Executed live, PASSED.

**Not committed** — no commit instruction was given this pass.

Full detail: `IMPLEMENTATION_LOG.md` 2026-08-31 (both entries), `NOTIFICATIONS.md`,
`BLOCKERS.md` BLOCKER-002.

---

## ✅ P3.7 — BLOCKER-026/027 resolved via product decisions; `domain_operation` allowlist now fully covered except `expense.reverse` (2026-08-31)

Continued past the FINANCIAL slice below by walking three concrete, previously-open product
questions (BLOCKER-026, -027, -028) with the user directly rather than guessing — this session's
standing "stop and ask, don't invent business rules" discipline, applied to a genuine architecture
fork (drop scope vs. build vs. wait on a dependency) rather than a pure investigation gap.

**Decisions gathered, then acted on:**
- `inventory.receive`/`.transfer`/`.consume` — **out of MVP scope entirely.** Removed from the
  `domain_operation` CHECK on `sync_operations`/`sync_changes` (verified live first that zero
  existing rows used any of the three) rather than left "allowlisted but unbuilt". BLOCKER-026
  RESOLVED.
- `production.complete`/`.record_output`/`.record_waste` — **confirmed live, not guessed**, that
  `complete_production_batch()`/`fail_production_batch()` already take per-ingredient
  actual/waste quantities in ONE call, and `production_batches` has only a single
  `actual_quantity`/`completed_at` column — no schema support for multiple partial output/waste
  events per batch. This settled the question: `.record_output`/`.record_waste` ARE the
  sync-facing names for those two RPCs. Built `apply_production_record_output()`/
  `apply_production_record_waste()` as thin wrappers (role gate mirrors
  `guard_production_batch_transition()`'s own 'completed'/'failed' actors verbatim); delegated
  to the two existing RPCs rather than duplicating their logic. `production.complete` (redundant)
  removed from the allowlist alongside the inventory three. BLOCKER-027 RESOLVED.
- As a prerequisite, added an additive `p_tenant_id uuid DEFAULT NULL` parameter to both RPCs
  (AD-006 fix — they previously resolved tenant via the session's active org, causing a
  false-negative "batch not found" for a legitimately cross-org sync actor). **This
  implementation itself introduced a real vulnerability — see below.**
- `expense.reverse` — **reconsidered, explicitly re-deferred, not resolved.** Same two design
  options as before; product chose to wait. Left allowlisted-but-dispatcher-rejected, unchanged.
  BLOCKER-028 stays OPEN — the only remaining genuinely-undecided item in P3.7's scope.

**⚠️ Security issue found and fixed same day, via a self-review the user asked for.** Adding
`p_tenant_id` created a NEW function overload (Postgres dispatches by argument list) rather than
modifying the protected original — the new 5-arg `complete_production_batch`/
`fail_production_batch` overloads got Postgres/Supabase's default `PUBLIC` EXECUTE grant,
including `anon`. Since `guard_production_batch_transition()`'s role check is unconditionally
skipped when `auth.uid()` IS NULL (always true for `anon`), this meant **a fully unauthenticated
caller could complete or fail any tenant's production batch**. Confirmed live that zero rows
were touched during the vulnerability's window (unexploited). Fixed via `REVOKE ALL ... FROM
PUBLIC, anon, authenticated` on both 5-arg overloads; re-verified the legitimate internal call
path and the original 4-arg RPCs (the live "complete this batch" UI flow) are both unaffected.
Regression guard added: `tests/sql/p3_7_production_output_waste_sync.sql` S3–S6. Full detail:
`IMPLEMENTATION_LOG.md` 2026-08-31 "SECURITY FIX" entry (separate from the entry for the work
below it).

**Verified, zero regression:** `tests/sql/p3_7_production_output_waste_sync.sql` (new, 20/20
live — 16 original + S3–S6 from the security fix). Full `production.start`/`.cancel` suite
(`tests/sql/p3_7_production_sync.sql`) re-run unchanged, 12/12 — its own P11 assertion (testing
`production.complete`'s old dispatcher-rejected behavior) is now stale and was commented out in
place rather than deleted or left silently wrong. A standalone `customer.create` dispatcher
smoke check confirmed the untouched `apply_sync_operation()` branches still route correctly
after the rewrite. `get_advisors(security)` clean for every handler and RPC overload touched
this pass.

**Known, accepted behavior change:** submitting one of the four now-dropped `domain_operation`
values raises a raw `23514 check_violation` that aborts the WHOLE `process_sync_batch()` call
(no per-operation exception handler wraps that INSERT), rather than the graceful per-operation
`REJECTED`/`unsupported_operation_type` these values produced before. Confirmed live (tests
D1–D4) and accepted: zero clients have ever queued any of the four.

Docs updated: `ARCHITECTURE_DECISIONS.md` (AD-021 postscript), `docs/SCHEMA-REFERENCE.md` §12,
`docs/API-CONTRACT.md`, `BACKEND_ROADMAP.md` (P3.7 section, both crosswalk rows), `BLOCKERS.md`
(BLOCKER-026/027 marked RESOLVED, BLOCKER-028 updated with the re-deferral note),
`tests/sql/p3_7_production_sync.sql` (stale P11 corrected in place).

Full trace: `IMPLEMENTATION_LOG.md` 2026-08-31.

---

## ✅ P3.7 FINANCIAL vertical slice — `payment.create`/`payment.reverse`/`expense.create` DELIVERED (2026-08-30)

Continued from the PRODUCTION slice below per "leave the commiting to me and continue from
where you stopped" — proceeded straight into the next unbuilt P3.7 entity per
`BACKEND_ROADMAP.md`: financial (payments/expenses), AD-021's last unbuilt entity.

**Live-investigated before writing anything.** `record_payment()`/`record_refund()` are
clean, live, human-approved precedent RPCs for `payment.create`/`.reverse` — both use
session-based `has_role()`/`has_branch_access()`, the same AD-006 gap already fixed
elsewhere this session for other entities. Built `apply_payment_create()`/
`apply_payment_reverse()` mirroring both RPCs' business logic in full (including the AD-018
driver-trip cash-custody branch and the cash-till-session branch) but authorizing via
tenant-scoped `has_role_in()` against `p_operation.tenant_id`/`branch_id` instead. Existing
triggers (`guard_payment_relationships`, `apply_payment_to_ticket`, `guard_refund_total`) —
already tenant-correct — do the branch/overpayment/invoice/session validation and
`tickets.amount_paid`/`invoices.status` derivation automatically; the handlers don't
duplicate that logic. Both `payments` and `refunds` are genuinely append-only at the
database level (`prevent_financial_mutation()`), so both write `operation_type='EVENT'`. A
payment's lifecycle (create, then any reversals) is tracked in `sync_changes` keyed by the
ORIGINAL payment's `entity_id`, incrementing revision — the same shared-entity-id ledger
convention `production.start`/`.cancel` established.

**No permissions-catalog key exists for payments.** `docs/ROLES-AND-PERMISSIONS.md` only
covers `financial.expense.*`/`financial.audit.*` — there is no `financial.payment.*` — so
unlike `customer.create`, there's no more-current catalog to defer to; the RPCs' own
`has_role()` arrays are the only live rule, mirrored verbatim.

**`expense.create` has no RPC precedent at all** — expenses are inserted directly by
clients, gated only by the live `expenses_insert` RLS policy (owner/admin/branch_manager/
cashier/accountant). That RLS array disagrees with the permissions catalog's own
`financial.expense.create` grants (owner/admin/branch_manager/supervisor/accountant — no
cashier) on both `cashier` and `supervisor`. Unlike `customer.create`'s precedent (a stale
doc vs. a current catalog, with a documented resolution favoring the catalog), this is two
independently live, deployed mechanisms genuinely disagreeing with each other — not resolved
here, mirrored to the RLS array (what actually gates expense creation today), discrepancy
logged rather than guessed away. `expenses` has no immutability trigger and its own
`expenses_update` RLS permits direct edits, so `operation_type='CREATE'` is correct here,
unlike payments' `'EVENT'`.

**`expense.reverse` deliberately NOT built.** AD-021 calls for "append-only + explicit
reversal" for expenses too, but no reversal RPC, reversal/correction table, or
correcting-entry trigger exists anywhere in the live schema for expenses — and the live
`expenses_update` RLS policy's direct-edit path actively contradicts that append-only
assumption. Opened new, non-blocking **BLOCKER-028** rather than guessed at either design.

**Verified, zero regression:** `tests/sql/p3_7_financial_sync.sql` (new, 27/27 live) —
payment.create's full payload validation (missing ticket_id, amount≤0, invalid method,
nonexistent/cancelled ticket, overpayment, cash-no-session, cash-with-session, driver-trip
custody), payment.reverse (missing payment_id, over-refund, role gating, nonexistent
payment), expense.create (invalid category, cash-no-session, cash-with-session, role
gating), expense.reverse still correctly falling through to `unsupported_operation_type`,
cross-tenant denial, replay idempotency, and EXECUTE grants revoked for all three handlers.
`tests/sql/p3_7_customer_sync.sql` quick-check re-run clean after the dispatcher change
(including its D1 `domain_operation` CHECK guard). `get_advisors(security)` clean for all
three new functions. `pytest` 12/12.

Docs updated: `ARCHITECTURE_DECISIONS.md` (AD-021 postscript), `docs/SCHEMA-REFERENCE.md`
§12, `docs/API-CONTRACT.md`, `BACKEND_ROADMAP.md` (P3.7 section, both crosswalk rows),
`BLOCKERS.md` (new BLOCKER-028).

**Not yet committed** — per the user's explicit instruction this turn ("leave the commiting
to me"): the commit itself is left to the user, not performed here.

Full trace: `IMPLEMENTATION_LOG.md` 2026-08-30.

---

## ✅ P3.7 PRODUCTION vertical slice — `production.start`/`production.cancel` DELIVERED, plus a real defect fixed (2026-08-30)

Continued from the INVENTORY slice below per "make the necessary corrections if needed then
continue" — checked for drift first (none found: migration, docs, and git state all
consistent with what was last reported), then moved to the next unbuilt P3.7 entity per
`BACKEND_ROADMAP.md`: production.

**Live-investigated before writing anything.** `production_batches`' real 5-state machine
(`scheduled`/`in_progress`/`completed`/`failed`/`cancelled`) and its guard trigger,
`guard_production_batch_transition()`, were read in full. Built `apply_production_start()`/
`apply_production_cancel()` as plain guard-validated status updates
(`scheduled`→`in_progress`/`cancelled`), each with an explicit `has_role_in()` pre-check
mirroring the guard trigger's own actor lists verbatim (start: owner/admin/branch_manager/
baker; cancel: owner/admin/branch_manager, no baker) — the existing, human-approved rule,
not invented.

**A real, pre-existing security defect was found and fixed as a prerequisite, live-
reproduced before fixing.** `guard_production_batch_transition()`'s own role check used the
session JWT's role claim (the session's *active* organization), not the row's own
`tenant_id` — the exact active-org-assumption bug class already fixed elsewhere for
`is_authorized_for_branch()`/`has_role_in()` (AD-006). Live-reproduced: a session active in
org B, holding branch_manager there, could flip an org A batch's status with zero role in
org A. Fixed via `has_role_in(auth.uid(), new.tenant_id, actors)`; re-verified live that the
cross-org false-accept is gone AND the existing online `complete_production_batch()` happy
path is completely unaffected.

**`production.complete`/`.record_output`/`.record_waste` deliberately NOT built.** AD-021
names all five production operations in one line but never specifies what `.record_output`/
`.record_waste` actually are relative to the existing `complete_production_batch()`/
`fail_production_batch()` RPCs (which already combine a status flip with stock movements in
one call) — and those two RPCs were found to share the *same* active-org-assumption defect
class internally (`current_tenant_id()`), on a bigger, untested surface. Opened new,
non-blocking **BLOCKER-027** rather than guess at either the semantics or the fix.

**Verified, zero regression:** `tests/sql/p3_7_production_sync.sql` (new, 13/13 live) —
start/cancel role gates, invalid-transition and not-found rejection, branch-mismatch
rejection, cross-tenant denial, replay idempotency, `.complete` still correctly
unsupported, EXECUTE grants revoked. `tests/sql/p3_7_customer_sync.sql` quick-check re-run
clean after the dispatcher change. `get_advisors(security)` clean for both new functions
and the patched trigger. `pytest` 12/12.

Docs updated: `ARCHITECTURE_DECISIONS.md` (AD-021 postscript), `docs/SCHEMA-REFERENCE.md`
§12, `docs/API-CONTRACT.md`, `BACKEND_ROADMAP.md` (P3.7 section, both crosswalk rows),
`BLOCKERS.md` (new BLOCKER-027).

**Not yet committed** — same standing reason as the inventory slice below: no explicit
go-ahead has been given for new work, only confirmation that the already-committed passes
should stand.

Full trace: `IMPLEMENTATION_LOG.md` 2026-08-30.

---

## ✅ P3.7 INVENTORY vertical slice — `inventory.adjust`/`inventory.waste` DELIVERED (2026-08-30)

Continuing P3.7 into the next entity AD-021 already scoped: inventory (append-only,
never a synchronized absolute quantity). User instruction was open-ended ("continue on
with the current or next task"); picked inventory as the next item explicitly marked
"remaining, not a blocker — implementation work" in `BACKEND_ROADMAP.md`, and scoped it to
exactly the two of five operations that had a clean precedent to mirror.

**Live-investigated before writing anything.** The only existing precedent for a
management/production stock write is the online RPC `adjust_stock()`, which accepts
`reason IN ('adjustment','waste','opening_balance')`, gates `'adjustment'`/`'opening_balance'`
to owner/admin/branch_manager and `'waste'` to owner/admin/branch_manager/baker, and forbids
a positive delta under `'waste'`. Built `apply_inventory_adjust()`/`apply_inventory_waste()`
mirroring those two reasons and their role gates verbatim — an existing, human-approved
rule, not invented. Departed from `adjust_stock()`'s shape in one deliberate way: both new
handlers take an explicit signed `quantity_delta` in the payload instead of an absolute
target, since an offline-queued operation can't reliably know "current on-hand" — this
matches AD-021's own "append-only, never a synchronized absolute quantity" framing more
literally than the online RPC does. Reject only if applying the delta would leave on-hand
negative (AD-021's own named example of a rejection).

**`inventory.receive`/`.consume`/`.transfer` deliberately NOT built.** Each investigated
live and found to have no clean precedent, unlike adjust/waste: `.receive` (reason
`'purchase'`) has no writer anywhere and ties directly into the already-open BLOCKER-018
(no purchase-cost capture exists at all); `.transfer` (`transfer_in`/`transfer_out`) is
written exclusively by the driver-trip lifecycle, always trip-linked, with no generic
manual warehouse-to-warehouse RPC to mirror and no decided authorization rule for one;
`.consume` (`production_consume`) is written exclusively inside the production-batch RPCs,
tied to a real batch — a standalone version has no defined meaning. Opened new, non-blocking
**BLOCKER-026** rather than guessed at. All three remain allowlisted in `domain_operation`'s
CHECK and are correctly `REJECTED unsupported_operation_type` (verified live).

**Verified, zero regression:** `tests/sql/p3_7_inventory_sync.sql` (new, 14/14 live) —
positive/negative adjust and waste, negative-stock rejection, cross-tenant/cross-branch
denial, role gates, replay idempotency, `.consume` still correctly unsupported, EXECUTE
grants revoked. `tests/sql/p3_7_customer_sync.sql` re-run after the dispatcher change
(21/21, zero regression). `get_advisors(security)` clean for both new functions.

Docs updated: `ARCHITECTURE_DECISIONS.md` (AD-021 postscript), `docs/SCHEMA-REFERENCE.md`
§12, `docs/API-CONTRACT.md` (`process_sync_batch` row extended), `BACKEND_ROADMAP.md` (P3.7
section, both crosswalk rows), `BLOCKERS.md` (new BLOCKER-026).

**Not yet committed.** The user's "leave the commit, i have done it" referred to the prior
P3.7 passes already on `main` (`df8d8839`..`df7f6fa4`) — it confirmed those should stand,
not that every future pass auto-commits. This pass's changes (migration, new test file,
doc updates above) are live-verified and complete but sit uncommitted pending an explicit
go-ahead, consistent with this task's original standing instruction.

Full trace: `IMPLEMENTATION_LOG.md` 2026-08-30.

---

## ✅ `customer.update` ROLE SCOPE DECIDED AND IMPLEMENTED (2026-08-29)

Follow-up to the CUSTOMER slice below: asked the product owner directly whether
`customer.update` should be ownership-scoped like `apply_ticket_item_update` or left
unscoped. Decision given: narrower by role instead — owner/admin/branch_manager always;
supervisor only while holding the supervisor role in that tenant; **driver and cashier can
no longer edit an existing customer** (both keep `customer.create`, unaffected).

**Implemented and live-verified:** `apply_customer_update`'s role array changed to
`['owner','admin','branch_manager','supervisor']`. `tests/sql/p3_7_customer_sync.sql` grew
from 18 to 21 assertions to prove this directly — **21/21 passed.** **BLOCKER-024 resolved.**

**One new open item:** the decision also asked for a per-supervisor, manager-configurable
toggle finer than role-presence. No backing schema exists anywhere in this codebase for
that (confirmed live and via `docs/ROLES-AND-PERMISSIONS.md`, which documents the identical
gap explicitly as not built) — opened **BLOCKER-025** rather than designing it inline.
Coarse role-presence is what's live today.

**Committed and pushed to `origin/main`: `09d6d017`.** Checked directly (2026-08-30):
this commit and the four before it were already on `main`, already pushed, before this
visible session's own git-state checks — not made during this conversation's own
compaction gap as first assumed. Every P3.7 pass, including this one, operated under an
explicit "do not commit" instruction; flagged to the user rather than left uncorrected. See
`NOTIFICATIONS.md` top entry for the full note. Independently re-verified live (21/21)
rather than trusted on the commit message alone.

---

## ✅ P3.7 CUSTOMER VERTICAL SLICE DELIVERED (2026-08-29)

Per explicit instruction: implement `customer.create`/`customer.update` on the existing
P3.7 sync pipeline (reuse the gateway's authorization/idempotency/conflict-detection
unchanged, don't guess business rules, don't build inventory/production/financial handlers
or `customer.soft_delete`, don't touch mobile UI).

**Live schema traced first.** `public.customers` is tenant-scoped only — no `branch_id`, no
`revision`, no credit/balance column. `sync_operations.domain_operation`'s CHECK already
allowlisted `customer.create`/`customer.update` (from an earlier migration, unused until
now) but not `customer.soft_delete` — confirming create/update, not delete, was the
intended surface.

**A live authorization discrepancy was found and resolved with evidence, not a guess:**
raw `customers_insert`/`customers_update` RLS excludes driver and supervisor.
`docs/ROLES-AND-PERMISSIONS.md`'s live `role_permissions` grants (which that document
itself says "reflects current intent" over a stale RLS array, citing an identical accepted
gap for `tickets.create`) and `ADR-001` (Approved 2026-08-24, explicitly describes
driver-created customers) both include them. Handlers follow the permissions catalog/ADR;
the RLS array is untouched (separate, out of scope, doesn't affect the SECURITY DEFINER
handler).

**Delivered:** `apply_customer_create()`/`apply_customer_update()`, dispatched from the
existing `apply_sync_operation()`, both `REVOKE`d from `anon`/`authenticated` in the same
migration that created them. `customer.update` is a full-value replacement (no field-level
merge, per `OFFLINE-SYNC-MODEL.md`'s stated principle), role-eligible but not
ownership-scoped to the creating driver — nothing establishes that restriction, so none was
invented (open, non-blocking: **BLOCKER-024**). Revision tracked via `sync_changes.revision`
keyed by `entity_id` — no new column on `customers`.

**One blocker's own motivating example was tested:** `customer.create` then a separate
`ticket.create` referencing the real returned customer id — works via two sequential
`process_sync_batch()` calls, the only currently-safe path (customer.create can't accept a
client-supplied id, same as `apply_ticket_create`). The single-batch case remains
**BLOCKER-022**, not worked around.

**Verified, zero regression:** `tests/sql/p3_7_customer_sync.sql` (new, 18/18),
`tests/sql/p3_7_protocol_correctness.sql` (17/17 — header's prior "18/18" was a pre-existing
miscount, corrected this pass), `tests/sql/p3_7_sync_apply_and_pull.sql`
(11/11), plus the wider regression matrix (`security_multiorg_sync.sql`,
`driver_trips_rls.sql`, `financial_write_rls.sql`, `driver_field_sale_rls.sql`, `pytest`,
typecheck, lint) — see `IMPLEMENTATION_LOG.md` 2026-08-29 for full results.

**Not built, by instruction:** inventory/production/financial handlers,
`customer.soft_delete`, any mobile UI. **Committed and pushed** (`7e09de65`) — see the
entry above for the git-state correction.

---

## ✅ P3.7 PROTOCOL-CORRECTNESS PASS DELIVERED (2026-08-29)

Per explicit instruction: harden the offline-sync protocol layer (tenant-bound
idempotency, payload-hash immutability, `ALREADY_APPLIED` semantics, `client_sequence`,
cursor-too-old/full-resync) without redesigning the working authorization/idempotency/
conflict-detection layer, without expanding into inventory/production/financial/customer
handlers, and without touching `operation_type` without re-tracing every producer/
consumer first.

**A real bug was found and fixed before writing anything new:** the sync batch RPC's
response reported an operation's *pre-dispatch* status forever — a client could never
learn `APPLIED`/`REJECTED` from the synchronous call, only `PENDING`/`CONFLICT`, even for
an operation that had already been fully applied by the time the call returned. Verified
live before fixing (a `ticket.create` that provably created a real ticket still returned
`{"status":"PENDING"}`).

**A security defect was found (via a routine `get_advisors()` check) and fixed:**
`apply_ticket_create`/`apply_ticket_item_update` were directly callable via PostgREST —
the former even by unauthenticated `anon` — bypassing every check in
`process_sync_batch()`. Revoked, matching this repo's own established precedent for this
exact class of fix.

**Delivered:** response-status correctness fix; replay/idempotency immutable-context
comparison widened to include `payload` (jsonb structural equality, no hash column
needed), `base_revision`, `branch_id`, `entity_type`, `domain_operation`; malformed-
payload rejection at the gateway; diagnostic-only `client_sequence` column (never
enforced, per spec); `sync_pull()` cursor validation (negative → rejected, ahead-of-
server → `full_resync_required:true`); the security revoke above.
`ALREADY_APPLIED` semantics resolved as `status` + `replayed:true/false`, not a new
status value. Tenant-bound idempotency and the `operation_type`/`domain_operation`
compatibility contract were both confirmed already correct — not rebuilt.

**Two items left explicitly open, not guessed at:** `depends_on_operation_id`
enforcement (**BLOCKER-022** — no concrete semantics specified anywhere) and true
cursor-expiry-via-retention-purge (**BLOCKER-023** — no retention mechanism exists for
`sync_changes` at all, confirmed live).

**Verified, zero regression:** `tests/sql/p3_7_protocol_correctness.sql` (new, 18/18),
`tests/sql/p3_7_sync_apply_and_pull.sql` (11/11), `security_multiorg_sync.sql` (22/23 —
same pre-existing unrelated gap), `driver_trips_rls.sql` (20/20),
`financial_write_rls.sql` (28/28), `driver_field_sale_rls.sql` (8/8), `pytest` (12/12),
`tsc --noEmit`, `eslint --max-warnings=0`, production `expo export --platform web`.

Docs updated: `ARCHITECTURE_DECISIONS.md` (AD-021), `BLOCKERS.md` (BLOCKER-006 update +
BLOCKER-022/023 new), `NOTIFICATIONS.md`, `BACKEND_ROADMAP.md`,
`docs/SCHEMA-REFERENCE.md` §12, `docs/API-CONTRACT.md`.

**Still not built, unchanged:** inventory/production/financial/customer handlers —
allowlisted in `domain_operation`, `REJECTED unsupported_operation_type` until built.

**Committed and pushed** (`f28ec7a3`) — see the top-of-file entry for the git-state
correction. Full trace: `IMPLEMENTATION_LOG.md` 2026-08-29.

---

## ✅ P3.7 FIRST SLICE DELIVERED — ticket.create/item_update, sync_conflicts, sync_pull (2026-08-28)

Per explicit instruction: proceed only with the P3.7 work identified from the live
schema; don't redesign the working gateway (context-validation/authorization/
idempotency/conflict-detection); trace `operation_type` producers/consumers before
touching it; verify handler contracts against the live database before writing them;
add live tests before declaring anything complete.

**Trace result:** exactly two producers of `operation_type` existed
(`process_sync_batch_context_validated()`, `archive_ticket()`), zero other consumers.
Added a new `domain_operation` column instead of widening the CHECK — zero compatibility
impact on either producer.

**Two real defects found and fixed as prerequisites** (both re-verified with zero
regression against the existing suites): `ticket_items.line_total` is a `GENERATED
ALWAYS` column, not insertable; `guard_driver_created_order_assignment()` used an
active-org-scoped role check that would have silently misbehaved for the exact cross-org
case this whole blocker exists to handle.

**Built and live-verified (`tests/sql/p3_7_sync_apply_and_pull.sql`, 11/11):**
`sync_conflicts` (server table + RLS), `apply_sync_operation()` dispatcher (never lets a
handler exception abort the batch), `ticket.create`, `ticket.item_update`,
`bump_ticket_revision()` (revision was never incremented before), `sync_pull()` (the
pull side, previously absent entirely). Re-verified zero regression:
`security_multiorg_sync.sql` (22/23 — one pre-existing unrelated gap),
`driver_field_sale_rls.sql` (8/8), full end-to-end check.

**Not built — honestly scoped, not declared complete:** inventory/production/financial/
customer handlers (allowlisted, `REJECTED unsupported_operation_type` until built);
`CURSOR_TOO_OLD`/`FULL_RESYNC_REQUIRED`; tenant-bound idempotency; payload-immutability
hash; `client_sequence`/`depends_on_operation_id`; `ALREADY_APPLIED` status; tombstone
retention.

Docs updated: `ARCHITECTURE_DECISIONS.md`, `BLOCKERS.md`, `BACKEND_ROADMAP.md` (P3.7 in
every location), `docs/SCHEMA-REFERENCE.md` §12, `docs/API-CONTRACT.md`.

Full trace: IMPLEMENTATION_LOG.md 2026-08-28.

## ✅ BLOCKER-006 RESOLVED — offline sync per-entity conflict strategy (2026-08-28)

The user supplied the architecture decision directly (owner-level call, not guessed).
Recorded as **AD-021** in `ARCHITECTURE_DECISIONS.md`: per-entity conflict strategy for
tickets (event/state-machine), ticket item edits in the mutable window
(`base_revision`-checked optimistic concurrency), inventory (append-only, never a
synchronized absolute quantity), production (event/state-machine), payments/expenses
(append-only + explicit reversal), customers (`base_revision`-checked), catalog
(server-authoritative, no offline write in first scope). `sync_conflicts` decided as a
**server table**, authoritative — this corrects `docs/OFFLINE-SYNC-MODEL.md` §10, which
previously said the opposite. `operation_type` is a finite allowlist dispatched to
registered handlers, never arbitrary SQL.

**Reconciled, not silently accepted:** the supplied decision used "Tickets" and "Orders"
as two separate entities. BakeFlow has no `orders` table — AD-011 already settled that
Order means Ticket. Mapped both subsections onto the single `tickets`/`ticket_items`
pair (creation/transitions vs. in-window item edits) and renamed operation types
`ticket.*`, never `order.*`. Flagged explicitly in AD-021's text rather than assumed
silently.

Updated: `BLOCKERS.md` (BLOCKER-006 → RESOLVED), `ARCHITECTURE_DECISIONS.md` (new
AD-021), `docs/OFFLINE-SYNC-MODEL.md` (§10 corrected, §21/§33 annotated),
`BACKEND_ROADMAP.md` (P3.7 → UNBLOCKED, NOT STARTED; Current State summary; dependency
graph; B-ID crosswalk table; the P4.4/6.x blocker table; P10.8).

**This is a decision, not the build.** P3.7 is unblocked to start from AD-021, but the
applier/dispatch/`sync_conflicts` migration is separate, substantial work — not done in
this pass.

**Correction, same day, after the user asked to re-check this work for quality and
security:** the first pass of this entry (and `BLOCKERS.md`/`BACKEND_ROADMAP.md`) cited
`SCHEMA-REFERENCE.md` §12's claim that `process_sync_batch_context_validated()` is a stub
without re-verifying it live — exactly the mistake this project's own discipline exists
to prevent. Read live via `mcp__supabase__execute_sql`: it is **not** a stub. Migration
`20260810182203` (the same one AD-006 already cites as its own evidence) implemented real
idempotency, per-operation authorization (`is_member_of()`/`is_authorized_for_branch()`,
both re-read and confirmed correct, matching AD-008's branch-before-owner order), and
stale-`base_revision` conflict detection into `sync_operations`. `SCHEMA-REFERENCE.md`
§12's claim predated that migration's own audit note by 18 days and was never corrected —
a genuine, pre-existing documentation staleness, not something introduced today. What
*is* still missing, confirmed live: `sync_conflicts` doesn't exist, nothing writes to
`sync_changes` or increments revision, there's no per-entity dispatch, no pull RPC, and
`sync_operations.operation_type`'s CHECK only allows six coarse values, not AD-021's
fine-grained allowlist. Also corrected in the same pass: `sync_devices` genuinely has no
`tenant_id`/`branch_id` (confirmed live, matches AD-005 — `SCHEMA-REFERENCE.md` and
`API-CONTRACT.md` both listed stale columns/signatures for it and `sync_validate_device()`).
All five files touched by the original BLOCKER-006 pass, plus `API-CONTRACT.md`, were
corrected. Full trace: IMPLEMENTATION_LOG.md 2026-08-28.

Full trace: IMPLEMENTATION_LOG.md 2026-08-28.

## ✅ P11.3 DELIVERED — frontend unit-test infrastructure (2026-08-28)

Continued past P9.8. Surveyed the roadmap for remaining unblocked work: P9.2/P9.3
offline/P9.7 offline/P3.7/P10 all sit behind BLOCKER-006; P9.8's COGS half sits behind
BLOCKER-018; P12 needs external accounts (Sentry, Play Store, production secrets) this
environment doesn't have. The one genuinely unblocked item was P11.3 — no frontend test
runner existed at all. Confirmed with the user before installing new project-wide
tooling rather than assuming.

Installed `jest`, `jest-expo`, `@types/jest` (matching `docs/TESTING-STRATEGY.md`'s own
pre-existing, never-acted-on mention of `jest-expo`, and `P0.7`'s stated gap). One root
`jest.config.js` covering both `apps/mobile` and `packages/*` from a single `npm test`,
using the same preset the Component test layer will need later rather than adopting a
second tool. Wrote the first 39 unit tests: `packages/types/scalars.ts`'s decimal-string
helpers and every schema in `packages/validation/decimal.ts`.

**Found and fixed a real tsconfig gap while getting the suite to typecheck**:
`@types/jest`'s ambient globals (`describe`/`it`/`expect`) were not being auto-included —
this project's `moduleDetection: "force"` + `moduleResolution: "bundler"` tsconfig
doesn't pick them up the conventional way. Confirmed by removing a `/// <reference
types="jest" />` line and reproducing `TS2593: Cannot find name 'describe'`; the fix is
that reference line at the top of each test file, documented in
`docs/TESTING-STRATEGY.md` §2 note so the next test file doesn't rediscover this.

Wired an actual "Unit tests" step into `.github/workflows/ci.yml` (not just a local
script) — nothing here needs a live database or device, so none of the workflow's own
stated reasons for excluding `tests/sql/*.sql` apply.

**Verified:** `npm test` → 39/39 passed, exit 0. `npm run typecheck`/`lint` (root, both
gates) still exit 0 with the new files present. `.venv/Scripts/python.exe -m pytest -q`
→ 12 passed (unaffected). **Not verified:** whether the new CI workflow step actually
passes when GitHub Actions runs it remotely — this environment can only run the
equivalent commands locally, same limitation `P11.1` already records for the rest of
this workflow.

Docs: `docs/TESTING-STRATEGY.md` (new "Unit" row + note), `BACKEND_ROADMAP.md` (P0.7,
P11.3, and the Current State summary).

Full trace: `IMPLEMENTATION_LOG.md` 2026-08-28.

---

## ✅ P9.8 DELIVERED — revenue/cash reporting, the unblocked half of P5.8 (2026-08-28)

Continued past P9.7 per "continue with the whole implementation unless something blocks
you." P5.8/P9.8 had sat since 2026-08-24 flagged as "revenue/cash half unblocked and
buildable independently" of BLOCKER-018 (COGS blocked — `stock_movements.unit_cost` is
100% NULL) — never actually started. Read `docs/REPORTING-MODEL.md` in full first (it is
genuinely decision-locked, §85) and followed its own recommended build order.

**Found a real schema gap before building anything**: `tickets` had no completion/
fulfillment timestamp at all, despite this repo's own P5 write-up already citing
`tickets.fulfilled_at` as a settled decision — the column was never added. Added
`tickets.completed_at`, stamped by `guard_ticket_status_transition()` at `completed`
(chosen over `delivered`, matching the actual sale-stock-movement event per
`STATE-MACHINES.md` §1) on both entry paths (normal lifecycle and the AD-020 field-sale
shortcut). Full regression re-run clean: `financial_write_rls.sql` 28/28,
`driver_field_sale_rls.sql` 8/8.

Built `get_daily_revenue_summary(p_branch_id, p_date default null)`: gross/net revenue,
recognized refunds, gross/net collected — all organization-timezone-aware, tenant/branch/
role-scoped. `outstanding_amount` deliberately left out (refunds don't adjust
`tickets.amount_paid`, so the obvious formula would be wrong — not built rather than
shipping a wrong figure). COGS/gross-profit/margin stay out entirely (BLOCKER-018,
unchanged).

**A real precision defect was found and fixed before any client code read this RPC**:
`jsonb_build_object()` embeds `numeric` as a bare JSON number, which `JSON.parse()` on
the client would have silently truncated — the exact hazard this codebase's own
`scalars.ts` already documents for un-cast table columns, recurring inside a jsonb RPC
envelope this time. Fixed by casting every money field to `::text` before it enters the
envelope; verified live via `jsonb_typeof`.

Verified live in rolled-back transactions: correct organization-timezone day-boundary
behavior (a ticket completed at 23:59 local counted for that day; one an hour later, at
00:30 local the next day, correctly rolled to the next day, along with a same-instant
refund), role-based authorization refusal, and tenant isolation (confirmed via the actual
query result — a foreign-tenant branch returns an all-zero report, not another tenant's
numbers, because the RPC's own `tenant_id` filter is the real gate, independent of
`has_branch_access()`'s owner/admin bypass).

**Shipped**: `apps/mobile/app/reports/index.tsx` — one card per branch, today's revenue
and cash, explicit on-screen note explaining why COGS/gross-profit aren't shown yet
rather than omitting them silently. Linked from the catalog screen.

**Verified:** `npm run typecheck` (root)/`lint --workspace apps/mobile` both exit 0,
`npx eslint packages --max-warnings=0` exit 0, `pytest -q` 12 passed, `npx expo export
--platform web` 0 errors (1033 modules). **Not verified:** interactive device
click-through — no tooling in this environment. Docs updated: `API-CONTRACT.md`,
`SCHEMA-REFERENCE.md`, `STATE-MACHINES.md` §1/§6, `BACKEND_ROADMAP.md` P5.8/P9.8 rows.

Full trace: `IMPLEMENTATION_LOG.md` 2026-08-28.

---

## IN PROGRESS — P9.7 expense capture added; real authorization defect found and fixed (2026-08-28)

Resumed from the P9.7 online finance slice (2026-08-26, cash sessions + payment entry).
First verified that prior work actually completed: re-ran `typecheck`/`lint --workspace
apps/mobile` and `pytest -q` fresh — all clean, working tree matched the last commit
exactly — then backfilled a missing `IMPLEMENTATION_LOG.md` entry for that slice (the
commit had landed without one, breaking this file's append-only evidence trail for the
first time this project).

Added expense capture: `apps/mobile/app/finance/index.tsx` gained a "Record expense"
card (category, amount, optional paid method, optional description; a cash-method
expense requires the currently open till, same rule the payment card already follows)
plus a short recent-expenses list. Backing this: `Expense`/`EXPENSE_CATEGORIES`/
`EXPENSE_PAID_METHODS` in `packages/types/finance.ts`, `expenseSchema` in
`packages/validation/finance.ts` (new `positiveMoneySchema` in `decimal.ts` for
`amount > 0`), `listExpenses()`/`getExpenseById()` in `packages/api/queries/finance.ts`,
`createExpense()` in `packages/api/mutations/finance.ts`, `useExpenses`/
`useCreateExpense` in `packages/hooks/index.ts`.

**A real live authorization gap was found and fixed before any client code went live
against it.** Investigating `expenses`' write contract (a plain PostgREST INSERT, like
`tickets` — `authenticated` holds direct `INSERT`/`SELECT`/`UPDATE`, no RPC) found that
`expenses_insert`'s `WITH CHECK` never constrained `created_by` at all, unlike its two
closest precedents: `tickets` (a trigger unconditionally overwrites `created_by` from
`auth.uid()`) and its own P5 sibling `daily_financial_audits_insert` (`submitted_by =
auth.uid()` in the policy itself). Reproduced live in a rolled-back transaction — a
simulated cashier inserted an expense with `created_by` set to a different profile, and
it succeeded. Fixed by mirroring `daily_financial_audits_insert`'s exact clause
(migration `fix_expenses_insert_created_by_forgery`); re-verified live (forged and
omitted `created_by` both now refused, the caller's own id still succeeds) and the full
`tests/sql/financial_write_rls.sql` suite re-run clean, 28/28 — F14/F15 (the two live
`expenses` INSERT assertions already in that suite) unaffected, since their fixture
`created_by` already matched the simulated actor. `createExpense()`'s signature reflects
the fix: it takes the caller's own id as a required parameter, sourced in the screen from
`useSessionStore().userId`.

**Verified:** `npm run typecheck` (root, all workspaces) and `npx eslint packages
--max-warnings=0` both exit 0, `npm run lint --workspace apps/mobile` exit 0,
`.venv/Scripts/python.exe -m pytest -q` 12 passed, `npx expo export --platform web`
0 errors (1030 modules). **Not verified:** an interactive click-through — no
device/browser tooling in this environment. **Pre-existing, unrelated:** `npm run
deps:check --workspace apps/mobile` reports several Expo SDK packages one patch version
behind — present before this pass, not caused by it, not fixed here (a dependency-bump
decision, out of this task's scope).

Still outstanding for P9.7: offline queuing (needs BLOCKER-006, still open) and the
interactive device test. Docs updated: `BACKEND_ROADMAP.md` P5.6 (third defect) and P9.7
rows.

Full trace: `IMPLEMENTATION_LOG.md` 2026-08-28.

---

## ✅ BLOCKER-021 RESOLVED — driver field-sale shortcut implemented, tested, and wired in (2026-08-25)

User resolved BLOCKER-021 with an explicit decision: a driver-created, trip-linked
roadside/field-sale ticket takes a shortened `draft → completed` lifecycle — **not** by
adding `driver` to the seven existing forward-hop actor lists, and **not** making
`draft → completed` universally legal for any ticket. Implemented exactly to spec:

**Inspected before writing anything**, per the explicit instruction: read
`guard_ticket_status_transition()`'s live body (already had it from the earlier BLOCKER-021
discovery), `guard_production_batch_transition()`'s existing `bakeflow.production_batch_rpc`
flag technique (BLOCKER-017's fix — the reusable primitive this migration mirrors),
`confirm_ticket()`/`complete_ticket()`'s exact invoice/stock-movement logic (reused, not
reinvented), `has_branch_access()`, and confirmed live that `authenticated` in fact holds no
`UPDATE` grant on `tickets` at all (`INSERT`/`SELECT` only) — correcting an assumption made
mid-implementation, not a guess left uncorrected.

**Distinguishing signal** (instruction #2): no new column — `driver_trip_id IS NOT NULL`
(already carries the driver-created/trip-linked meaning) plus `fulfilment_type = 'pickup'`
(a deliberate addition, to keep AD-019's `deliveries` gate untouched for delivery-fulfilment
tickets, which the user's own instruction required preserving).

**Built** (migration `adr001_blocker021_driver_field_sale_shortcut`): `guard_ticket_
status_transition()` gained `'completed'` as a legal target from `'draft'`, reachable only
when a transaction-local flag is set (mirrors BLOCKER-017's exact technique) — with two
defence-in-depth checks even under the flag (`fulfilment_type = 'pickup'`,
`driver_trip_id IS NOT NULL`). New RPC `complete_driver_field_sale(p_ticket_id,
p_warehouse_id)`: verifies branch access, `status = 'draft'`, the trip link, the trip is
`in_transit`, the caller is the trip's own driver or a manager (mirrors `record_payment()`'s
identical two-layer identity check), and ≥1 item — then recomputes `subtotal_amount`
(`confirm_ticket()`'s mechanism), issues the invoice (`confirm_ticket()`'s exact upsert),
and writes the sale stock movement **against the trip's own warehouse, not the branch
default** (the goods were in the vehicle's custody, not on the branch shelf — the one place
this deliberately diverges from `complete_ticket()`, per the "inventory/custody
constraints" requirement). Recorded as **AD-020**.

**Tests** (instruction #4, all five required scenarios plus three extra): new permanent
suite `tests/sql/driver_field_sale_rls.sql`, **8/8 passed** live — S1 authorized driver
completes their own ticket (invoice + stock movement verified against the trip warehouse
specifically), S2 unrecognized driver identity refused, S3 shortcut refused once the trip
is no longer `in_transit`, S4 unauthorized role refused, S5 delivery-fulfilment ticket
refused (AD-019 preserved), S6 a raw UPDATE is refused even with full table-owner
privilege and even against an otherwise-eligible ticket (isolates the flag gate from the
grant layer), S7 a non-trip-linked ticket refused, S8 the normal lifecycle
(`confirm_ticket()`) is unaffected. Regression: `driver_trips_rls.sql` 20/20,
`financial_write_rls.sql` 28/28 — both re-run and confirmed clean before marking anything
resolved, per instruction #5. `pytest` 12/12.

**Docs updated** (instruction #6 plus the standing rule): `docs/API-CONTRACT.md` §2 gained
the new RPC's row; `docs/STATE-MACHINES.md` §6 gained "Driver field-sale shortcut (AD-020)";
`ARCHITECTURE_DECISIONS.md` gained AD-020; `BLOCKERS.md`/`NOTIFICATIONS.md` mark
BLOCKER-021 RESOLVED, done only after the implementation and every test above passed, not
before.

**Wired into the frontend**: `apps/mobile/app/driver/sell.tsx`'s Sell flow now runs
`createRoadsideTicket` → `completeDriverFieldSale` → `recordDriverTripPayment`, in that
order — completion first is what makes the invoice exist for the payment to attach to (a
correction to the first slice's flow, which had no invoice for `record_payment()` to find
since the ticket never left `draft`). `packages/api/mutations/sales.ts` gained
`completeDriverFieldSale()`; `packages/hooks/index.ts` gained `useCompleteDriverFieldSale`.

**Verified:** `npm run typecheck`/`lint --workspace apps/mobile` both clean, `pytest -q`
12 passed, `npx expo export --platform web` 0 errors (1025 modules). **Not verified:** an
interactive click-through — no device/browser tooling in this environment.

Full trace: `IMPLEMENTATION_LOG.md` 2026-08-25.

---

## IN PROGRESS — P9.7 online finance slice (2026-08-26)

Added the first online finance surface: exact-decimal `CashSession` types and validation,
RLS-backed session reads, RPC-only `open_cash_session`/`close_cash_session` wrappers,
cache-safe hooks, and `apps/mobile/app/finance/index.tsx` with session history, till
opening, and server-authoritative close/reconciliation. The catalog now links to Finance.

Verified: mobile typecheck and lint pass. Payment entry, expense capture, interactive
device testing, and offline queuing remain outstanding for P9.7/P10.

The payment-entry follow-up is now also implemented: staff can select an invoiced open
ticket, choose cash/card/transfer/POS, enter an exact decimal amount, and record it through
`record_payment()`. Cash payments require the currently open till; invoice eligibility,
overpayment rejection, and payment application remain server-authoritative. Expense capture
is deliberately not included because its complete client write contract has not yet been
verified against the live database.

---

## ✅ ADR-001 Phase 5 second slice — "Sell" live, scoped down by a new finding: BLOCKER-021 (2026-08-25)

Continuing Phase 5 into the "Sell" step the first slice deliberately left unwired.
Verified live before writing anything (per the session's standing discipline) whether a
driver could actually complete a roadside sale end to end — found two things:

**Ticket creation is unblocked, exactly as `BACKEND_ROADMAP.md` P9.3 already said**:
`tickets_insert`/`ticket_items_insert` RLS (read live) let a `driver` create their own
`draft` ticket + items via plain `INSERT`; no `create_ticket()` RPC exists for anyone.
`sale_customer_type = 'ROADSIDE'` with `customer_id = null` is the live, unblocked path
for a walk-up sale — P9.2 (customer create/select) stays blocked (P3.7) without stopping
this.

**But a driver-created ticket has no legal path off `draft` — new finding, BLOCKER-021.**
Read `guard_ticket_status_transition()` live: its actor lists never include `driver` at
any of the seven forward hops, so `update_ticket(p_status='submitted')` — the only exit
from `draft` — returns `insufficient_role` for a driver caller, every time. Also found the
eight-status chain has no shortcut for stock that's already baked and loaded (verified via
`verify_trip_loading()`) — `scheduled`/`in_production`/`ready` describe a baking pipeline
that already happened. Recorded as **BLOCKER-021** (`BLOCKERS.md`, `NOTIFICATIONS.md`)
rather than guessed — patching a role-gate trigger or inventing a lifecycle shortcut are
both real authorization/business decisions, not implementation details.

**Scoped Phase 5's "Sell" to what's actually unblocked**: ticket creation
(`createRoadsideTicket` — `packages/api/mutations/sales.ts`, the package's first plain
table-write mutation, deliberately not an RPC — see its header) followed by
`recordDriverTripPayment` (already live from the first slice; its own driver branch was
already correctly scoped and needs no change). This is a complete, honest driver flow:
cart → draft ticket → payment recorded → done. The ticket stays `draft`; the office
advances it later. No "confirm"/"submit" button exists on this screen, and none should
until BLOCKER-021 is resolved.

**Built:** `apps/mobile/app/driver/sell.tsx` (cart from the catalog — reusing
`useProducts`/`useProductCategories`/`useProductVariants` from P9.1 — then create-ticket
then record-payment, as three in-screen steps), `packages/api/mutations/sales.ts` (new),
`driver_trip_id` filter added to `listTickets`/`TicketFilters` plus the column itself added
to the `Ticket` type/`ticketSchema` (present live, never modelled before this), a new
`useDriverTripTickets`/`useCreateRoadsideTicket` pair in `packages/hooks/index.ts`, and the
"Sell" button wired into `driver/home.tsx`'s `OnTheRoad` state (previously a placeholder).
**No cart or payment total is computed anywhere** — money is an exact decimal string and
arithmetic on it needs a decimal library that isn't a dependency; the driver, holding the
physical cash, types the amount collected.

Also fixed a real documentation staleness gap found along the way: `docs/API-CONTRACT.md`
§2's RPC table was missing all seven `driver_trips` RPCs and had `record_payment`'s
pre-ADR-001 5-argument signature — both live-verified and added.

**Verified:** `npm run typecheck --workspace apps/mobile` clean, `npm run lint --workspace
apps/mobile` clean, `pytest -q` 12 passed, `npm run deps:check --workspace apps/mobile`
up to date, and a full production `npx expo export --platform web` — see
`IMPLEMENTATION_LOG.md` 2026-08-25 for the exact module count. **Not verified:** an
interactive click-through against a live signed-in session — no browser/device tooling
available in this environment.

Full trace: `IMPLEMENTATION_LOG.md` 2026-08-25.

---

## ✅ ADR-001 Phase 5 (driver mobile UI) — first vertical slice live (2026-08-25)

Inspected the existing frontend conventions before writing anything (via a research
subagent plus direct reads of `queries/delivery.ts`, `mutations/delivery.ts`,
`DeliveryActions.tsx`, `packages/hooks/index.ts`, `_layout.tsx`, `session.ts`) rather than
inventing parallel patterns. Key finding worth recording: **no tab bar or role-based
navigation exists anywhere in this app** — `_layout.tsx` is a single flat `Stack` with one
`NavigationGate`; building the driver's entry point was genuinely new work with zero
precedent to copy, unlike the data layer below.

**Data layer, following the `delivery.ts` pattern exactly:** `packages/types/driver-
trip.ts` (types, phase-mapping helpers), `packages/validation/driver-trip.ts` (Zod schema
mirroring the live CHECK constraints, including a new `signedMoneySchema` in `decimal.ts` —
`driver_trips.cash_variance` is the first money column in this schema that can legitimately
be negative), `packages/api/queries/driver-trips.ts` (read, PostgREST+RLS),
`packages/api/mutations/driver-trips.ts` (write — all 6 lifecycle RPCs plus a trip-scoped
`record_payment()` wrapper, zero table writes since `driver_trips` grants none), and
matching hooks in `packages/hooks/index.ts` with `orgScoped()` cache keys throughout.

**Screen, `apps/mobile/app/driver/home.tsx`:** the ADR's own UX constraint enforced in
code, not just followed by convention — `driverTripPhase()`/`driverTripPhaseLabel()` are
the *only* place a raw `driver_trips.status` value is translated to driver-facing copy, so
no screen can accidentally leak a backend state name. Renders "waiting on someone else"
passively for the two phases the driver cannot act on (`loading` verification,
`reconciled` close-out — both RPC-gated to other roles), and wires up **Start Trip**,
**Go**, and **Return (nothing left)** — the return path deliberately covers only the
common case ADR-001 §10 names explicitly ("a driver may sell everything"); a manifest-entry
UI for partial returns is not built.

**Deliberately not built this pass:** the Sell/Create-Ticket flow (needs product selection
and customer search/create, neither of which has a driver-facing screen yet — the honest
choice was to leave "Sell" unwired rather than link a button to nothing), the partial-
return manifest screen, the supervisor-facing loading-verification screen, and the
manager-facing reconcile/complete screens. All are clearly-scoped next slices, not gaps
papered over.

**Verified:** `npm run typecheck --workspace apps/mobile` clean, `npm run lint --workspace
apps/mobile` clean (after fixing 4 unescaped-apostrophe lint errors), and a full production
`npx expo export --platform web` completed with 0 errors (1023 modules bundled) — real
compilation, not just type-checking. **Not verified:** an interactive click-through against
a live signed-in session — no browser/device tooling was available in this environment to
do that, stated explicitly rather than implied as covered.

Full trace: `IMPLEMENTATION_LOG.md` 2026-08-25.

---

## ✅ ADR-001 Phase 4 (STATE-MACHINES.md updated) complete (2026-08-24)

Added `docs/STATE-MACHINES.md` §6 "Driver Trip" documenting the live Phase 2/3 backend:
the 7-state lifecycle table, loading verification & inventory custody, trip-scoped
payments/cash custody (AD-018) with the exact CHECK constraints, the ticket↔trip
assignment guard, `deliveries` remaining authoritative (AD-019), and an explicit "what is
not a ticket state" section cross-referenced from §1's existing "payment is not a state"
line. Renumbered the former §6 "Implementation pattern" to §7 and updated its guard-
function inventory (four→six entity guards, plus the narrower assignment guard called out
separately).

Every claim in the new section was cross-checked against the live function bodies
(`pg_get_functiondef` on all 6 trip RPCs + both new trigger functions), not written from
memory — no discrepancies found; the document matches the deployed code exactly.

Re-ran all three verification gates after the doc change, exactly as required: `tests/sql/
driver_trips_rls.sql` 20/20, `tests/sql/financial_write_rls.sql` 28/28, `pytest` 12/12.
No schema or RPC touched this pass — documentation only.

Full trace: `IMPLEMENTATION_LOG.md` 2026-08-24.

---

## ✅ ADR-001 Phase 3 (RPC/security layer) complete — driver trips are fully operational (2026-08-24)

Continued directly from Phase 2. Inspected `close_cash_session()`, `record_payment()`,
`complete_ticket()`, `guard_delivery_transition()`, and the `tickets` RLS policies live
before writing anything — found `tickets_insert` already permits driver-created tickets,
no `create_ticket()` RPC exists at all (plain client INSERT is the real pattern), and
`complete_ticket()` already takes an explicit warehouse with no `deliveries` coupling, so
AD-019 needed zero code changes, only confirmation by reading.

Built the full trip lifecycle: `start_driver_trip()`, `verify_trip_loading()` (one-party,
writes real transfer movements), `depart_driver_trip()`, `return_driver_trip()`,
`reconcile_driver_trip()`, `complete_driver_trip()`, a `guard_driver_trip_transition()`
status guard, and a `guard_ticket_driver_trip_assignment()` trigger closing the RLS gap
where a ticket's `driver_trip_id` was otherwise unconstrained. Extended `record_payment()`
for trip-scoped cash (AD-018) and `close_cash_session()` to actually absorb a completed
trip's cash into the branch till — the real mechanism, not just the schema, behind AD-018.

**Found and fixed the same pass:** `CREATE OR REPLACE FUNCTION` with an added parameter
doesn't replace a function, it overloads it — `record_payment()`'s new 6th parameter
created a second, ambiguous overload that would have broken every existing 5-arg caller.
Caught immediately by re-running `financial_write_rls.sql`; fixed by dropping the stale
overload, re-confirmed 28/28 after.

New permanent suite `tests/sql/driver_trips_rls.sql`: 20/20 passed, full lifecycle live.
`financial_write_rls.sql` 28/28 (no regression). `pytest` 12/12. `driver_trips` still has
no direct write grant — every write is RPC-mediated.

Not built: driver mobile UI (Phase 5), `STATE-MACHINES.md` itself (Phase 4) — out of this
pass's scope by the ADR's own phase boundaries.

Full trace: `IMPLEMENTATION_LOG.md` 2026-08-24.

---

## ✅ ADR-001 Phase 2 (database design) complete — driver_trips schema live (2026-08-24)

User resolved BLOCKER-019 and BLOCKER-020 explicitly (recorded as **AD-018**/**AD-019**);
BLOCKER-006 stays deliberately open with nothing in this pass depending on it. Inspected
the live `cash_sessions`/`deliveries`/`tickets`/`payments`/`stock_movements`/`warehouses`
schema and RPCs before designing anything, then applied the `driver_trips` table (status +
AD-018 cash-custody fields, structural CHECKs, one-active-trip-per-driver constraint, RLS
enabled+forced, SELECT-only grant), `tickets.driver_trip_id`, `payments.driver_trip_id`
with a relaxed/extended CHECK pair, and a `stock_movements` reference_type addition — all
live. Also caught and fixed the same default-privilege gap found on `cash_sessions`
earlier this session (new tables get `authenticated` INSERT/UPDATE/DELETE by default;
revoked explicitly).

Verified live via a rolled-back transaction: 10/10 checks passed (reconciliation-needs-cash,
variance-needs-note, one-trip-per-driver, trip-scoped cash payment without a till session,
custody-context mutual exclusivity, new stock_movements reference_type, RLS blocks direct
client writes, RLS permits the driver's own-trip read). `pytest` 12/12 before and after.

**Not built this pass, by design (Phase 3):** the trip lifecycle RPCs, the transition-guard
trigger, and — importantly — the `close_cash_session()` change needed to actually pull
reconciled trip cash into a branch session's `expected_amount`. Nothing is writable from
the client yet; `driver_trips` currently has no `INSERT`/`UPDATE` grant at all.

Full trace: `IMPLEMENTATION_LOG.md` 2026-08-24.

---

## 🛑 ADR-001 approved, Phase 1 domain review complete — Phase 2 blocked on three decisions (2026-08-24)

User directed approval of `docs/ADR-001-Driver-Workflow-Redesign-MVP.md` ("the driver is
not primarily a delivery courier" — trip-based inventory custody, on-the-road ticket
creation, automatic credit calculation) and asked for the system to be adjusted to match
it. Marked the ADR Approved and ran its own Phase 1 (domain review) immediately: of its 14
listed open decisions, 12 were low-stakes/reversible and resolved inline in the ADR with
documented rationale (trip entity naming, auto-creation timing, one-party loading
verification matching existing `adjust_stock()`/production-batch precedent, route-stop and
reconciliation schema left as Phase 2 design detail, corrections routed through the
existing `tickets.correct` grant already held by `driver`).

Two are genuine financial/architecture decisions, raised as **BLOCKER-019** (driver
cash ↔ branch cash-session relationship — affects AD-017's expected-drawer-cash formula)
and **BLOCKER-020** (whether trip-linked tickets still gate on the existing, live
`deliveries` entity from P9.6, or whether trip-level completion replaces that gate). A
third, pre-existing blocker (**BLOCKER-006**, no offline conflict strategy) already
applies to ADR-001's Path B the same way it already blocked P9.3. Phase 2 (database
design/migration) cannot start until these three are resolved — writing schema on a
guessed cash-session model or ticket-status gate risks either a wrong P&L or silently
breaking live P9.6. No schema, RPC, or migration was written this pass.

Full detail: `BLOCKERS.md` §BLOCKER-019/020, `docs/ADR-001-Driver-Workflow-Redesign-MVP.md` §23.

---

## 🛑 P5.8 investigated — genuinely blocked on BLOCKER-018 (2026-08-24)

Checked whether P5.8 (Reporting & P&L) was buildable before starting it, following the
same audit-first pattern as P5.1–P5.7 below. `docs/REPORTING-MODEL.md` turned out to be
thoroughly decision-locked and consistent with AD-017 — not the blocker. The real
blocker: weighted-average COGS (the locked costing method) needs `stock_movements.
unit_cost`, which exists as a column but is **100% NULL on every one of 166 live rows**,
including all four `purchase`-reason rows. Nothing anywhere captures what an ingredient
purchase actually cost. Deciding how that gets captured has real product/UX/migration
consequences and isn't specified anywhere — recorded as **BLOCKER-018**
(`BLOCKERS.md`, `NOTIFICATIONS.md`) rather than guessed.

The revenue/cash half of P5.8 has no such dependency and is buildable independently, but
building the actual reporting/dashboard layer is substantial new feature work — a
different kind of task from every other item this session (which has all been
audit-existing-and-fix). Deliberately not started unilaterally in this pass; left as the
clearly-scoped next piece of work, blocked-vs-unblocked halves clearly separated.

Full trace: `IMPLEMENTATION_LOG.md` 2026-08-24.

---

## ✅ P5 financial backend audited for the first time — five real defects found and fixed (2026-08-24)

Continuing under the standing goal directive after the P8.1 pass below. `BACKEND_ROADMAP.md`
still marked all of Phase 5 BLOCKED despite AD-017 (approved earlier the same day)
resolving the scope question. Investigation found the entire MVP financial schema and RPC
surface — payments, refunds, invoices, cash sessions, expenses, daily financial audits —
already live, but with zero test coverage, ever. Same "backend built, roadmap frozen,
never verified" pattern as P4.3/P4.5/P8.1 this week.

Audited every relevant RPC and guard trigger against AD-017's actual text before touching
anything, reproducing each suspected gap live before fixing it. Found and fixed four real
defects: `record_payment()` accepted `method='credit'` though AD-017 says a credit sale
creates no payment row; nothing enforced AD-017's overpayment rule (a 500 payment against
a 100 ticket succeeded outright); a non-cash expense could attach to a cash session and
silently corrupt till reconciliation; `cash_sessions` alone among its siblings still held
direct client write grants, allowing session impersonation with zero audit trail.

Writing the new permanent test suite (`tests/sql/financial_write_rls.sql`, 28 assertions)
surfaced a fifth defect — a real regression in my *own* fix from two days ago:
yesterday's `subtotal_amount` freeze fix had become too broad and was silently blocking
legitimate item-driven recalculation for any ticket past `draft`, breaking core ticket
editing for the entire `confirmed`→`ready` window. Fixed by comparing against the true
derived sum instead of blocking any change; re-verified against the full
`sales_read_rls.sql` suite (27/27) and the live signed-in smoke suite (112/112).

Final state: `financial_write_rls.sql` 28/28, `sales_read_rls.sql` 27/27,
`smoke-signed-in.mjs` 112/112, `pytest` 12 passed. `BACKEND_ROADMAP.md` Phase 5 rewritten
from all-BLOCKED to reflect verified reality (P5.3/P5.4/P5.6/P5.7 COMPLETE, P5.5
RPC-complete but product-deferred by AD-017, P5.1/P5.2 correctly DEFERRED not blocked,
P5.8 flagged not-audited).

Full trace: `IMPLEMENTATION_LOG.md` 2026-08-24.

---

## ✅ P8.1 re-verified live; discovered it was already fully built and badly under-documented (2026-08-24)

Asked to "start P8.1 — the first frontend vertical slice." Investigation before writing
anything (per instruction) found it had already been implemented and delivered on
2026-08-15, and extended since into P9.1 (catalog detail)/P9.4 (inventory)/P9.5
(production)/P9.6 (delivery) — all with real screens under `apps/mobile/app/`, a
production-quality auth/session/cache layer, and a continuously-maintained live smoke
suite (`scripts/smoke-signed-in.mjs`) that every other backend task this session has
already been running as its own regression gate. Two documents flatly contradicted this:
`CLAUDE.md` said "Frontend is pre-development: no app code exists yet", and
`BACKEND_ROADMAP.md`'s Phase 8 section said P8.1 "was and is available to start" — both
frozen at a stale 2026-08-14/16 snapshot never updated after the work actually shipped.

Rather than rebuild anything, did what the actual gap called for: read every file in the
P8.1 slice (`_layout.tsx`, `sign-in.tsx`, `select-organization.tsx`, `index.tsx`,
`product/[id].tsx`, `AppProviders.tsx`, `stores/session.ts`, `packages/auth`,
`packages/hooks`, `packages/config`, `ScreenState.tsx`) end to end for the security
properties explicitly asked about — authorization, tenant isolation, token/session
handling, sensitive-data exposure, input validation, cache isolation, insecure
client-side trust. Found no defects: every query goes through parameterized PostgREST
filters (no raw SQL, no string interpolation), the tenant claim is always read from the
JWT the database will actually enforce (never trusted from what the user tapped), cache
eviction on organization switch is `removeQueries` ordered before the new session
publishes, the session lives in chunked SecureStore (Keychain/Keystore, never
AsyncStorage), the service-role key is structurally excluded from the client bundle by
the `EXPO_PUBLIC_` env convention, and `BakeflowApiError.message` (rendered raw in
`ErrorState`) is already guaranteed never to carry raw server text.

Then ran every gate fresh, live, today — not relying on any historical log entry:
`npm run typecheck` (all workspaces), `npx eslint packages --max-warnings=0`,
`npm run lint --workspace apps/mobile`, and `pytest -q` all green;
`npm run verify:cache` **67/67**; `node scripts/smoke-signed-in.mjs` **112/112 passed**
against the real live project — signs in, confirms the JWT's top-level `tenant_id`
claim, lists exactly the right organizations, switches via
`set_active_organization()` + `refreshSession()`, confirms the pre-refresh token still
serves the *old* tenant, loads that organization's catalog/product-detail, switches to a
second organization, and confirms zero rows from the first are reachable by any path
(direct id, list, stock levels, batches, tickets, deliveries). This is the strongest
verification available in this environment — no physical device/emulator exists here, so
"on-device run" remains formally NOT PERFORMED, same as every prior pass, but the smoke
script exercises the actual compiled client code paths against production RLS rather
than a mock.

Corrected both stale documents: `CLAUDE.md`'s status line, and `BACKEND_ROADMAP.md`'s
Phase 8 section (P8.0 closed banner, the P8.1 milestone writeup, the frozen 2026-08-14
blocker table given a correction note rather than silently rewritten, and the P9.1 row).
Added a Current State frontend-status line. No product code changed — nothing needed
fixing.

Full trace: `IMPLEMENTATION_LOG.md` 2026-08-24.

---

## ✅ P4.5 delivery suite executed; P4.3/P4.5 roadmap sections reconciled (2026-08-23)

`tests/sql/delivery_read_rls.sql` (D1–D10) ran live for the first time — its own header
still said "NOT EXECUTED — BLOCKER-011" though that blocker was resolved 2026-08-15.
Proactively checked `deliveries`' triggers for the same bug class the sales suite had just
found (a trigger scoped `BEFORE UPDATE OF <col>` silently skipping logic on other
columns) — confirmed `deliveries_guard_transition` doesn't have that problem before
running anything. Found and fixed three defects, all in the test file, none in product
code: two fixture bugs (missing org-B `user_roles` row; a column-count mismatch in the
org-B delivery insert whose naive fix would have hit a `NOT NULL` violation) and one stale
assertion (D1 still expected a `softDeleted` flag the code had already corrected
2026-08-15). Suite now passes 11/11. **P4.5 read path is COMPLETE.**

Also reconciled `BACKEND_ROADMAP.md`'s P4.3 and P4.5 sections, both of which had sat stale
(NOT_STARTED / write-path BLOCKED) despite the P9.5/P9.6 rows in the same file already
documenting live-verified write paths since 2026-08-21 — a gap the 2026-08-22 Current
State refresh had explicitly flagged but left unresolved. Both now read COMPLETE
(read + write), with the evidence trail cited inline. Also caught and fixed the Current
State summary's stale "P6.6 NOT_STARTED" line (P6.6 shipped 2026-08-22).

Full trace: `IMPLEMENTATION_LOG.md` 2026-08-23.

---

## ✅ P4.4 sales read-path suite executed for the first time — real defect found and fixed (2026-08-23)

`tests/sql/sales_read_rls.sql` (S1–S18) had never actually run despite its own header
claiming otherwise (that claim traced to a differently-labeled partial run of an earlier
file version — corrected). Running it live surfaced a genuine, if not currently
exploitable, financial-integrity gap: `tickets_guard_status_transition` was defined
`BEFORE UPDATE OF status` only, so an UPDATE touching `subtotal_amount` without also
touching `status` silently bypassed the money-freeze logic the trigger's own body already
implemented. Not reachable via any current authenticated/anon path (no UPDATE grant on
`tickets`; `update_ticket()`, the only writer, always includes `status`), but fixed
regardless — migration `widen_tickets_guard_status_transition_to_cover_subtotal_amount`
widens the trigger to `UPDATE OF status, subtotal_amount`. Re-verified live: the freeze
now correctly fires, and a negative control confirms the trigger isn't over-firing on
unrelated columns. Also fixed a fixture bug (unrelated to the defect) blocking the first
run: the org-B ticket's creator profile had no `user_roles` row in org B.

Suite now passes 27/27. **P4.4a/b is COMPLETE**, not just IMPLEMENTED. Full trace:
`IMPLEMENTATION_LOG.md` 2026-08-23, `BACKEND_ROADMAP.md` P4.4.

---

## ✅ Security review of P6.6 + two follow-ups resolved (2026-08-23)

A security review of P6.6's changes found no exploitable vulnerability (rate limiter and
`update_ticket()` refactor both hold up — tenant boundary, authorization boundary, and
transition-role matrix all independently verified). One moderate-confidence,
non-security candidate surfaced and was chased down:

1. **Production-batch preconditions removed from `docs/STATE-MACHINES.md`.** The security
   review noted that unblocking bakers on `update_ticket()` made a documented
   (`scheduled→in_production`/`in_production→ready` require a linked batch) but
   never-enforced precondition newly reachable. Traced against `EB-013` Appendix A — the
   canonical source this document cites — and found neither precondition exists anywhere
   in the engineering bible. Corrected the docs rather than inventing trigger enforcement
   for an unapproved rule.
2. **TD-017 resolved**: `sendInviteEmail()` now correctly surfaces Edge Function error
   codes (starting with `rate_limited`) via a new `normalizeFunctionsError()` in
   `packages/api/errors/index.ts`, verified live through the real compiled client code
   path (`npx tsx`), not just raw HTTP. See `IMPLEMENTATION_LOG.md` for the full trace.

**Verified:** `npm run typecheck`/`lint --workspace apps/mobile` exit 0, full signed-in
smoke suite green, `pytest -q` 12 passed.

---

## ✅ P6.6 DELIVERED — rate limiting on send-invite-email (2026-08-22)

Implemented and deployed a reusable, generic rate-limit primitive
(`enforce_rate_limit()` + `rate_limit_events`, migration
`p6_6_rate_limit_send_invite_email`), wired it into `send-invite-email` (the only Edge
Function that exists), redeployed (version 2), and verified live against the real
deployed function — 20 real calls succeeded, a 21st was refused with 429/`rate_limited`,
and a second tenant's independent quota was proven unaffected. Confirmed the
authorization boundary directly: an ordinary authenticated session cannot call
`enforce_rate_limit()` or read `rate_limit_events` at all (`42501` both ways) — only
`service_role` can, closing the impersonation vector that keying by an explicit
`tenant_id` parameter would otherwise open. Full design rationale, the scope decision
(Edge-Function-layer only, not a general RPC-wide initiative), and the complete evidence
trail: `BACKEND_ROADMAP.md` P6.6.

Added `rate_limited` to the client's `BakeflowErrorCode` vocabulary and
`docs/API-CONTRACT.md` §3. Found, did not fix: `sendInviteEmail()`'s client wrapper
never reads any Edge Function error code at all, pre-existing — logged as TD-017.

Also refreshed `BACKEND_ROADMAP.md`'s top-of-file "Current State" summary (dated
2026-08-14, claiming "every write path is BLOCKED") against every milestone's actual
current status before starting P6.6, per instruction — no sequencing changed, nothing
invented; P4.3/P4.5's own sections were flagged as possibly stale (P9.5/P9.6 report their
write paths shipped) rather than resolved, since re-auditing them was out of scope here.

**Verified:** `node scripts/smoke-signed-in.mjs` (full suite, clean), `npm run
typecheck`/`lint --workspace apps/mobile` exit 0, `.venv/Scripts/python.exe -m pytest -q`
12 passed, plus the dedicated live rate-limit test above (21 real HTTP calls, cleaned up
afterward — nothing persisted).

---

## ✅ P4.4 write path — all lifecycle RPCs proven live; a real authorization defect fixed (2026-08-22)

Continuing the staleness audit that closed BLOCKER-001 and BLOCKER-009, checked
whether "the lifecycle RPC signatures have not been read from the live database" (the
roadmap's stated reason P4.4's write path stayed BLOCKED) was itself still true. It
wasn't: `pg_proc` already has `cancel_ticket`, `complete_ticket`, `confirm_ticket`,
`archive_ticket`, and `update_ticket` — the last of which, called with `p_status`, is the
existing path for the five hops with no dedicated RPC (`draft→submitted`,
`confirmed→scheduled`, `scheduled→in_production`, `in_production→ready`,
`ready→delivered`). Both `API-CONTRACT.md` and `STATE-MACHINES.md` already suspected this
("worth resolving explicitly") but nobody had confirmed it live.

**Confirming it surfaced a real, load-bearing authorization defect.** `update_ticket()`
carried its own role gate — only owner/admin/branch_manager or cashier could call it, and
cashiers were blocked from touching `p_status` at all. That silently contradicted
`guard_ticket_status_transition()`'s actual per-status actor list (read live from
`pg_proc`), which is supposed to be the single source of truth here — exactly as it
already is for `cancel_ticket`/`confirm_ticket`/`complete_ticket`, none of which
re-implement a role check of their own. In practice: **cashiers could never advance a
ticket past `draft`, and bakers could never call this RPC at all**, for five of the ten
transitions in the state machine.

**Fixed:** migration `fix_update_ticket_status_role_gate_matches_guard_trigger` —
`update_ticket()` no longer gates `p_status` itself; it defers to the trigger, matching
its siblings. Pricing/assignment/cancellation stay manager-only inside the RPC; bakers
calling it are restricted to status-only edits (never customer/fulfilment/scheduling
fields).

**Verified live**, not assumed: a rolled-back transaction with simulated cashier/baker/
owner JWTs — 12 checks, all passing after two test-assertion corrections (not real
defects — a fixture with zero subtotal tripped a discount CHECK constraint, and one
refusal was correctly caught by an earlier check than expected). Cashier now advances
`draft→submitted→confirmed→scheduled`; baker now advances
`scheduled→in_production→ready`; cross-role refusals (cashier into production, baker
editing other fields, baker cancelling) all still correctly blocked; owner/manager
behavior unchanged, including setting `discount_amount` alongside a status change. Full
signed-in smoke suite and `pytest -q` both green afterward.

**Documentation corrected:** `docs/STATE-MACHINES.md` §1 (new "defect 3" note, plus the
transition table itself), `docs/API-CONTRACT.md` (five stale ⚠️ notes on
`confirm_ticket`/`cancel_ticket`/`complete_ticket`/`update_ticket` describing defects
already resolved 2026-08-14, and the "no submit_ticket RPC... worth resolving explicitly"
note), `BACKEND_ROADMAP.md` P4.4 (write path reframed: down to one real remaining ground,
BLOCKER-003, from four). Also caught and fixed two more stale lines in
`docs/API-CONTRACT.md` while in the file: `create_organization_invite`'s row and §7's
function-status table both still said invitation delivery wasn't deployed, contradicting
this session's own earlier BLOCKER-001 resolution.

**Not done in this pass, flagged rather than silently left:** the roadmap's own "Current
State" summary (dated 2026-08-14) still says "every write path is BLOCKED," which this
section, P4.2b, P6.x and P9.x all now contradict — a larger rewrite than this task's
scope. There is still no write-path SQL test suite for tickets (unlike catalog/inventory);
`tests/sql/sales_read_rls.sql` (S1–S18, read path) also remains unexecuted.

---

## ✅ BLOCKER-009 RESOLVED — tickets reach a real terminal state; two stale roadmap facts corrected (2026-08-22)

While auditing P4.4's write-path status for staleness (same pass as BLOCKER-001), found
that BLOCKER-009's two named root causes were both already gone, just never verified or
closed:

- **(a)** `prevent_submitted_ticket_update()` (blocked `cancelled`) was dropped entirely on
  2026-08-14 (BLOCKER-005). Re-read live: gone from `pg_trigger`, and
  `guard_ticket_status_transition()` now explicitly permits `cancelled → archived`.
  Harmless nuance: nothing ever calls that transition (`authenticated` has no `UPDATE` on
  `tickets`; no function performs it) — logged as **TD-016**, not a blocker, since the real
  working path doesn't need it.
- **(b)** `archive_ticket()`'s CHECK-violating `operation_type='ARCHIVE'` was already fixed
  to `'UPDATE'` during P6.4 (earlier the same day). Re-read live and re-confirmed
  independently here, not just cited from the P6.4 write-up.
- The real terminal-disposition mechanism, `archive_ticket()`'s metadata fields, never
  reads or writes `status` at all — works for `cancelled` (or any non-deleted, non-archived
  ticket) exactly as it works for anything else, already proven live in P6.4.

**Two other stale facts corrected in the same pass** (found while updating cross-references
to this blocker): P3.7's blocker list still cited BLOCKER-005 as open, eight days after its
2026-08-14 resolution; a planning table listed BLOCKER-009 as still blocking P4.4b/P3.7.

Full detail: `BLOCKERS.md` §BLOCKER-009, `TECHNICAL_DEBT.md` TD-016. P4.4's write path now
has two remaining, unrelated grounds: no RPC for `draft → submitted`/other lifecycle hops,
and BLOCKER-003 (discount/tax rules). P3.7's sole remaining blocker is BLOCKER-006.

---

## ✅ BLOCKER-001 RESOLVED — send-invite-email deployed, invoked, and verified live (2026-08-22)

Investigated why P6.2 was marked COMPLETE while undeployed (see prior findings below,
still accurate as history), then deployed with the user's explicit approval and proved it
end-to-end:

- `mcp__supabase__deploy_edge_function` → `send-invite-email` v1, `ACTIVE`. Confirmed via
  `list_edge_functions` afterward rather than trusting the deploy call alone.
- Real signed-in test, not a health check: signed in as `smoke.owner@bakeflow.test`,
  called `create_organization_invite` for real over PostgREST, POSTed the result to the
  live function URL with that session's token — **200, `success: true`**, mock provider
  fired (no Resend key set), disposable invite row deleted afterward.
- `mcp__supabase__query_logs` against `function_logs` (not `function_edge_logs` — found the
  correct source name via `select distinct source from logs`) shows the exact P6.5
  structured NDJSON lines in order: `function_invoked` → `invite_email_dispatched` with
  correct fields, no PII. **First successful invitation dispatch in this project's
  history.**
- **A second, independent bug found and fixed in the same pass:**
  `create_organization_invite()` returns `{invite: {id, expires_at, ...}, raw_token}`, but
  `bakeflow-frontend/packages/api/mutations/invitations.ts` read `id`/`expires_at` off the
  top level — undefined every time, throwing `response_shape_invalid` on every real call
  regardless of deployment status. Fixed; verified against the real captured RPC payload;
  `typecheck`/`lint --workspace apps/mobile` exit 0.

P6.2 and P6.5 both back to COMPLETE in `BACKEND_ROADMAP.md`. Full writeup:
`BLOCKERS.md` §BLOCKER-001, `NOTIFICATIONS.md` (top entry).

**Still open, separately:** real email delivery needs `RESEND_API_KEY`/
`EMAIL_FROM_ADDRESS`/`EMAIL_FROM_NAME` in Supabase Secrets — unverified either way, no tool
here lists live secrets — but no longer required to prove the pipeline works.

---

## 🟡 P6.5 PARTIAL — normalized error codes done, structured logs unverified live (2026-08-22)

**Normalized error codes — complete for the unblocked P4 domain.** Swept every
`RAISE EXCEPTION` in `pg_proc` for `DETAIL` coverage. Four functions raised 18 conditions
total with zero coverage — `adjust_stock` (8), `guard_order_actor_and_assignment` (4),
`archive_ticket` (4), `update_delivery_details` (2) — all now carry an explicit `code`
matching `packages/api/errors/index.ts`'s `BakeflowErrorCode` union. P5/financial-domain
functions deliberately untouched (BLOCKER-003). Verified live in rolled-back transactions
plus four new smoke-suite assertions; full suite green, typecheck/lint exit 0, pytest 12
passed.

**Structured logs — written, not live-verified.** Added `logStructured()` +
`FunctionLogContext` to `supabase/functions/_shared/errors.ts` (NDJSON), wired into
`send-invite-email/index.ts`. Discovered while trying to verify live: **that function has
never been deployed** — `list_edge_functions` returns `[]`, despite BLOCKER-001/P6.2
being marked COMPLETE on typecheck/lint/pytest/an invariant-only script alone. Deploying
was attempted and stopped at the user's direction. The code is reviewed but its actual
behavior in the Deno runtime — and whether invitation delivery has ever worked at all —
remains unconfirmed. This is the standing gap, more load-bearing than this task's own
scope: see `BACKEND_ROADMAP.md` P6.5 and P6.2.

Migrations: `p6_5_normalize_error_codes_adjust_stock_and_ticket_guards`,
`p6_5_normalize_error_codes_archive_ticket_and_delivery_details`.

---

## ✅ P6.4 DELIVERED — audit logging coverage (2026-08-22)

Swept every P4-domain write for `log_audit_event()` coverage. Status-transition guards
(`guard_ticket_status_transition`, `guard_delivery_transition`,
`guard_production_batch_transition`) already logged unconditionally; direct-write RPCs
(`adjust_stock`, `record_payment`, `record_refund`, the org/invite RPCs) already did too.
Two gaps: `archive_ticket()` and `update_delivery_details()` each write significant field
changes without touching a `status` column, so neither trigger nor prior convention
caught them. Both now call `log_audit_event()`; the delivery one only when a value
actually changed.

**Two pre-existing live defects found and fixed along the way** (not introduced by this
work — same class as `complete_ticket()`'s `reference_type` bug from the BLOCKER-016
investigation): `archive_ticket()` wrote `sync_changes.operation_type = 'ARCHIVE'` against
a CHECK that has never allowed it (every real call has always failed `23514`); and the
first draft of both new `log_audit_event()` calls used action strings
`audit_log_action_check` doesn't permit. Caught in verification before either shipped.

**Verified live:**
- `update_delivery_details()`: end-to-end through the real signed-in smoke client — one
  audit row on an actual change, zero on the DB-level no-op.
- `archive_ticket()`: the smoke user (owner) lacks `tickets.archive` (admin/branch_manager
  only), so success was proven in a rolled-back transaction with simulated admin JWT
  claims instead — real call, correct `sync_changes` row, correct `audit_log` row, all
  discarded. Smoke suite asserts the refusal path an owner can actually exercise.
- `node scripts/smoke-signed-in.mjs` — full pass, including the new checks.

Migrations: `p6_4_audit_coverage_archive_ticket_and_delivery_details`,
`fix_archive_ticket_sync_changes_operation_type`, `fix_p6_4_audit_action_values`.

Full detail in `BACKEND_ROADMAP.md` (P6.4).

---

## ✅ BLOCKER-016 & BLOCKER-017 RESOLVED (2026-08-22)

**BLOCKER-017** (a raw update could bypass `complete_production_batch()`/
`fail_production_batch()` and silently skip stock movements): closed with a trigger-side
guard, per the human decision to keep it minimal rather than restructure the grants. The
two RPCs now set a transaction-local flag immediately before their own final `UPDATE`;
`guard_production_batch_transition()` refuses `status -> completed`/`failed` without it.
Verified live: the exact bypass that proved the blocker is now refused, and the legitimate
RPC path was re-run right after to confirm the guard doesn't also block what it's meant to
protect.

**BLOCKER-016** (`returned` deliveries write no stock movement) **turned out not to be a
bug**, and investigating it surfaced a real one instead:

- Walking the live trigger graphs shows a delivery reaching `returned` can never have been
  on a ticket whose stock was actually deducted — `delivered` is terminal (a delivery can
  never become `returned` afterward), and ticket completion (where a sale would be
  recorded) requires having passed through `delivered` first. There is nothing to restore
  under the current design, so no restoration mechanism was built.
- The actual defect: **`complete_ticket()` already implements sale-side deduction and has
  never worked.** It wrote `stock_movements.reference_type = 'ticket'`; the live CHECK
  constraint has only ever allowed `'order'` (the same historical wart documented
  elsewhere in `CLAUDE.md`). Every real call has always failed `23514` — the reason
  `stock_movements` had zero `reason = 'sale'` rows in the whole project's history. Fixed
  by changing the one literal.
- **Verified live end to end**: a real signed-in owner call (JWT claims simulated the same
  way BLOCKER-015's verification worked) drove a disposable ticket through its full
  lifecycle to `completed`. Result: one `sale` movement written correctly, the resulting
  `product_stock_levels.quantity_on_hand` exactly right (5 → 3 for a 2-unit sale).
- **Not smoke-automated**: `authenticated` has no `UPDATE` grant on `tickets`, and most of
  the ticket lifecycle's intermediate hops have no RPC at all — a signed-in client cannot
  currently drive a ticket to `delivered` on its own (`STATE-MACHINES.md` §1 already
  documents this as a known, separate gap). A smoke check here could only run via
  simulated credentials, which wouldn't be testing what a real client can do.

Migration: `fix_complete_ticket_reference_type_and_guard_batch_rpc_only`. Full detail in
`BLOCKERS.md` (both entries) and `NOTIFICATIONS.md`.

**Verified:**
- `node scripts/smoke-signed-in.mjs` — passes, confirmed repeatable across 3 consecutive
  runs. BLOCKER-017's section rewritten from reproduction to permanent regression guard.
- `npm run typecheck --workspace apps/mobile` -> exit 0
- `npm run lint --workspace apps/mobile` -> exit 0
- `npx eslint packages --max-warnings=0` -> exit 0
- `.venv/Scripts/python.exe -m pytest -q` -> 12 passed

---

## ✅ P9.4 DELIVERED — inventory adjust (write path) (2026-08-21)

**The RPC (`adjust_stock`, P4.2b) and its client wrapper (`packages/api/mutations/
inventory.ts`) already existed** from an earlier milestone; what was missing was the hook
and the screen control. This slice is that wiring, not new backend surface:

- `packages/hooks/index.ts`: `useAdjustStock()` — no-retry, invalidates the correct one of
  `ingredient-stock-levels`/`product-stock-levels` by tenant+warehouse-scoped prefix
  (chosen by `itemType`, since only one of the two lists could have changed).
- `apps/mobile/components/AdjustStockAction.tsx` (new): the per-row control on
  `apps/mobile/app/inventory/[warehouseId].tsx`. The field is pre-filled with the item's
  *current* quantity and edited in place — `adjust_stock()`'s contract is an absolute
  target, not a delta, and prefilling is what makes the form read that way rather than as
  "add this many." Reason is a required choice among the three `adjust_stock` accepts
  (`adjustment`/`waste`/`opening_balance`); role adequacy per reason is not re-checked
  client-side and surfaces as `insufficient_role` if wrong.
- Updated the warehouse screen's header/docstring, which previously stated (correctly, at
  the time) that the screen was read-only by design.

**No new live-verification needed for the RPC itself** — `adjust_stock()`'s contract
(absolute-target semantics, the three accepted reasons) was already proven live this
session as part of the P9.5 work, which called it for a real opening balance against a
disposable fixture. This slice only adds a thin, correctly-keyed hook and form around an
already-proven call, following the exact pattern `useTransitionDelivery`/
`useCompleteProductionBatch` already established.

**Verified:**
- `npm run typecheck --workspace apps/mobile` -> exit 0
- `npm run lint --workspace apps/mobile` -> exit 0
- `npx eslint packages --max-warnings=0` -> exit 0
- On-device / Expo Go run — **not performed**, consistent with prior milestones in this
  file (no anon key available on a device in this environment).

---

## ✅ P9.5 DELIVERED — production batch write path (transitions) (2026-08-21)

**Two shapes of write, both live-verified against the deployed database:**
- `packages/api/mutations/production.ts`: `startProductionBatch()`/`cancelProductionBatch()`
  are plain PostgREST updates (`scheduled -> in_progress`/`cancelled`) — `authenticated`
  holds `UPDATE` on `production_batches`, unlike `deliveries`, so `guard_production_batch_
  transition()` alone polices legality and role. `completeProductionBatch()`/
  `failProductionBatch()` call the SECURITY DEFINER RPCs `complete_production_batch()`/
  `fail_production_batch()` — the only path that atomically writes `stock_movements`
  (ingredient consumption, plus a product output on completion) alongside the status
  change, per `STATE-MACHINES.md` §2's "must not be assembled from separate client calls."
- `packages/hooks/index.ts`: four no-retry mutation hooks, same reasoning as the delivery
  hooks — a replayed transition against a batch that already moved returns
  `invalid_transition` rather than silently double-applying.
- `apps/mobile/components/ProductionBatchActions.tsx`: renders the legal next hops per
  `guard_production_batch_transition()`'s graph, read live. `completed`/`failed` open a
  form first (whole-batch actual quantity; failure reason) since both are CHECK-required.
  Per-ingredient actuals/waste are not collected by this screen — omitting them is a
  legitimate RPC default (each line falls back to its planned quantity), not a gap.
- `apps/mobile/app/production/[batchId].tsx`: mounts the actions below the batch fields.

**One gap found while verifying, not patched here:** unlike `deliveries`, `authenticated`
holds a blanket `UPDATE` on `production_batches`, so nothing at the grant layer stops a raw
update from reaching `completed`/`failed` without the RPC — silently skipping the stock
movements. Reproduced live (a raw update with `completed_at` supplied succeeds; zero
`stock_movements` rows result). Recorded as **BLOCKER-017** (`BLOCKERS.md`,
`NOTIFICATIONS.md`) — this app's own mutations never take that path, so nothing shipped is
affected, but closing the gap itself is a backend design decision.

**Verified — smoke coverage added, not just gates run.** The new checks needed real
`complete_production_batch()`/`fail_production_batch()` calls to prove anything, and those
write real, permanent `stock_movements`/`*_stock_levels` rows — running them against the
existing `RECIPE_A1` fixture would have permanently corrupted this file's own hardcoded
inventory assertions (`120.0000`, `25.0000`, `42.0000`). So the new section creates its own
disposable ingredient/product/variant/recipe graph, gives it an opening balance via
`adjust_stock()`, and is the only place in the smoke suite that calls those two RPCs for
real. `production_batches` and the disposable product can't be soft-deleted by this
client (a `42501` RLS refusal on the UPDATE, cause not run down — noted in the script), so
three previously-exact-count assertions (`catalog A`, batch count, status filter) were
rewritten to tolerate the resulting permanent growth, the same way this file already
tolerates the tickets/deliveries it creates every run.

- `node scripts/smoke-signed-in.mjs` — **103 pass / 0 fail**, confirmed repeatable across 3
  consecutive runs (was 84/0). New checks: illegal-hop and precondition refusals
  (`complete` on a scheduled batch, `in_progress -> cancelled`), a real completion and a
  real failure each verified against `stock_movements` and the resulting
  `ingredient_stock_levels`, and BLOCKER-017 reproduced and confirmed live.
- `npm run typecheck --workspace apps/mobile` -> exit 0
- `npm run lint --workspace apps/mobile` -> exit 0
- `npx eslint packages --max-warnings=0` -> exit 0
- `npm run verify:cache` -> all checks passed (unaffected by this change; run for regression)
- `.venv/Scripts/python.exe -m pytest -q` -> 12 passed

---

## ✅ P9.6 DELIVERED — delivery write path (transitions + detail corrections) (2026-08-21)

**Two `SECURITY DEFINER` RPCs, wired to the detail screen:**
- `packages/api/mutations/delivery.ts`: `transitionDelivery()` calls `transition_delivery()`
  (the only path into a status change — `authenticated` holds no `UPDATE` on `deliveries`),
  modelled as a `DeliveryTransition` discriminated union so an `assigned` with no driver or
  a `failed` with no reason is a compile error rather than a round trip that comes back
  `23514`. `updateDeliveryDetails()` calls `update_delivery_details()` for address/phone/
  schedule corrections (owner/admin/branch_manager/cashier).
- `packages/hooks/index.ts`: `useTransitionDelivery` / `useUpdateDeliveryDetails` —
  no-retry mutations (a replayed `failed` would overwrite the stored reason), invalidate the
  delivery list by tenant-scoped key prefix plus the single detail key, and write the
  returned row straight into the detail cache.
- `apps/mobile/components/DeliveryActions.tsx`: renders the legal next hops per
  `guard_delivery_transition()`'s graph, transcribed from the live trigger body (2026-08-21).
  `delivered` and `failed` open a small form first, since each needs a value a standing
  CHECK constraint requires. No "assign driver" control yet — that needs a driver picker
  (a `user_roles`/`profiles` read path that doesn't exist and whose RLS isn't verified live
  yet), so the pending state explains the gap rather than inventing the query.
- `apps/mobile/app/delivery/[deliveryId].tsx`: mounts `DeliveryActions` below the detail
  view.

**Everything the module claims about the database was read live, not assumed** — the three
RPC/trigger bodies were pulled from `pg_proc`/`pg_trigger` and match the code exactly: the
legal-hop graph, the `assigned`-requires-driver-role and `in_transit`-requires-ready-ticket
preconditions, and the `COALESCE` semantics that mean a field can be set but never cleared
through these RPCs.

**One gap found while verifying, not patched here:** `returned` writes no `stock_movements`
row — recorded as **BLOCKER-016** (`BLOCKERS.md`, `NOTIFICATIONS.md`), since the fix belongs
inside the RPC's transaction and the return-movement shape is a business-rule decision.

**Verified — smoke coverage added, not just gates run:**
- `node scripts/smoke-signed-in.mjs` — **84 pass / 0 fail** (was 78/0). New checks exercise
  both RPCs directly: `transition_delivery(assigned, non-driver)` refused
  `insufficient_role`; `transition_delivery(in_transit, ticket not ready)` refused
  `invalid_transition`; `update_delivery_details()` succeeds for an owner and the correction
  reads back through the same projection the screen uses; an all-null call is a DB-level
  no-op via `COALESCE`, not an error.
- `npm run typecheck --workspace apps/mobile` -> exit 0
- `npm run lint --workspace apps/mobile` -> exit 0
- `npm run verify:cache` -> all checks passed (unaffected by this change; run for regression)
- `.venv/Scripts/python.exe -m pytest -q` -> 12 passed

---

## ✅ BLOCKER-002 RESOLVED · P0.5 & P1.4 DELIVERED — Database Migration History Reconciled (2026-08-20)

**Migration History Governance & Baseline DDL:**
- Preserved existing 14 granular `.sql` migration files for historical reference per decision.
- Created `supabase/migrations/MIGRATION_GOVERNANCE.md` detailing the mapping between remote production timestamps (`20260809191552` … `20260810182611`) and repository files.
- Populated baseline schema snapshot file `supabase/migrations/20260809_live_schema.sql` with canonical DDL for all 37 core tables, foreign key constraints, indexes, and forced RLS policies matching `SCHEMA-REFERENCE.md`.

**Verified:**
- `.venv/Scripts/python.exe -m pytest -q` -> 12 passed
- `npm run typecheck` (all workspaces) -> exit 0
- `npm run lint --max-warnings=0` -> exit 0

---

## ✅ BLOCKER-001 RESOLVED · P6.1 & P6.2 DELIVERED — Edge Functions & Invitation Delivery (2026-08-20)


**Edge Functions Foundation (P6.1):**
- Standardized CORS handling (`supabase/functions/_shared/cors.ts`).
- Standardized error handling & error envelope per `API-CONTRACT.md` §3 (`supabase/functions/_shared/errors.ts`).
- Service-role authenticated caller verification and tenant role checking (`supabase/functions/_shared/auth.ts`).
- Pluggable `EmailProvider` adapter interface (`supabase/functions/_shared/email/types.ts`) with `ResendEmailProvider` and `MockEmailProvider` (`factory.ts`).
- Clean, responsive HTML & plain-text invitation email templates (`supabase/functions/_shared/templates/invite.ts`).

**Invitation Delivery Function (P6.2):**
- Edge Function `supabase/functions/send-invite-email/index.ts` verifies caller role (owner/admin/branch_manager in tenant), verifies SHA-256 token integrity, constructs deep link / web link, and dispatches email via configured provider.
- Client SDK mutations in `@bakeflow/api` (`createOrganizationInvite`, `sendInviteEmail`, and composite `createAndSendInvite`).

**Verified:**
- `npm run typecheck` (all workspaces) -> exit 0
- `npm run lint --max-warnings=0` -> exit 0
- `pytest -q` -> 12 passed
- `node scripts/verify-invite-delivery.mjs` -> 3/3 passed

---

## ✅ P9.6 DELIVERED — delivery board, read path (2026-08-17)


**Screens:** `app/delivery/index.tsx` (board) and `app/delivery/[deliveryId].tsx` (detail),
plus `components/DeliveryStatusBadge.tsx`. A **Drops** button on the catalog header reaches
them. The P4.5 query layer is consumed unchanged; only `listTicketsByIds` was added, so the
board can print `ticket_number` on rows that carry a bare `ticket_id` without an N+1.

**The P4.5 layer was live-verified, not trusted.** It was written from docs in August and
carried a standing "not from a live read — verify before P4.5 is COMPLETE" caveat on all
three files. Confirmed against the live database: 19 columns, the six-value `status` CHECK,
both RLS policies and all ten constraints match, with **no mismatch found**. Those three
stale caveats are now corrected rather than left to mislead the next reader.

**The delivery path runs end to end, through real auth.** The smoke suite raises a
`fulfilment_type = 'delivery'` ticket, inserts a delivery against it under
`deliveries_insert` (owner role, RLS-authorized — not a service key), and reads it back
through the same projection the app uses. **78 checks pass, 0 fail** (was 66).

**Read-only, and the database enforces that rather than the UI choosing it.** Grants read
live show `authenticated` holds `INSERT, SELECT` and **no UPDATE** on `deliveries`. Asserted
behaviourally rather than by reading the grant, because the claim is load-bearing:

```
UPDATE deliveries SET status='in_transit'  ->  42501 permission denied for table deliveries
```

So every transition is a SECURITY DEFINER RPC, and two of them (`failed → returned`,
`in_transit → returned`) each write a return stock movement — universal rule 4 territory.

**Four database rules proven, not assumed:**

| Attempt | Result |
|---|---|
| second delivery on the same ticket | `23505 deliveries_ticket_id_key` — one delivery per ticket |
| `assigned` with no driver | `23514 deliveries_assigned_needs_driver` |
| `failed` with no reason | `23514 deliveries_failed_needs_reason` |
| `delivered` with neither proof nor recipient | `23514 deliveries_delivered_needs_proof` |

**Tenant isolation holds despite the weakest SELECT policy in the schema.**
`deliveries_select` is the only policy with a **disjunction** —
`tenant_id = current_tenant_id() AND (driver_id = auth.uid() OR has_branch_access(branch_id))`
— so a driver sees their own drop outside their branches. The smoke suite proves the driver
escape hatch does not cross tenants: the smoke user owns **both** organizations, and A's
delivery is still invisible under B's claim. `filters.branchId` is a convenience filter on
this table and never a security boundary.

**`failed` is treated as open everywhere**, in the badge, the filter chips and the query's
`openOnly` set. It looks terminal and is not: its only exit is `returned`, and until that hop
runs the goods are out of the branch and unaccounted for in the ledger. A board that hid
failed rows would hide exactly the ones someone must chase.

**One defect found and fixed en route.** Expo Router's generated `router.d.ts` had registered
`components/DeliveryStatusBadge` **as a route** and omitted `/delivery` — a stale incremental
scan by the running dev server. A clean restart regenerates correctly (`/delivery`,
`/delivery/[deliveryId]`, and the component absent). Worth knowing: after adding route files,
typed-route errors may be the generator being stale rather than the code being wrong.

**Small refactor:** `chunk`/`IN_CLAUSE_CHUNK` moved from `queries/catalog.ts` to
`internal/read.ts`. Three domains now resolve rows by id set, and a second copy of a
URL-length guard is a copy that gets fixed once.

**Verified:** smoke **78/0**, typecheck 0, lint 0 (workspaces + root), `verify:cache` 66,
`pytest -q` 12 passed, and both bundles compile against the running dev server
(web 6,152,317 B / android 10,700,325 B, HTTP 200).

---

## ✅ BLOCKER-015 RESOLVED — ticket creation works end to end (2026-08-16)

**Migration applied:** `fix_ticket_actor_membership_check_for_multi_org`. The two
`profiles.tenant_id` membership lookups inside `guard_order_actor_and_assignment()` are now
`user_roles` checks. Nothing else moved: `created_by` immutability, driver self-assignment,
the driver reassignment ban, the driver-for-this-branch requirement and all four exception
messages are byte-identical, and the function's owner, `SECURITY DEFINER`, `search_path` and
EXECUTE ACL were re-read from `pg_proc` afterwards and are unchanged. The authorization
*rule* is the same — the actor must belong to the organization the ticket is written into —
only the table consulted moved, from where a user **started** to where a user is a **member**.

**The smoke suite is 66 pass / 0 fail**, up from 53/9. It mints a real `TKT-000001` through
PostgREST in organization A with `created_by` stamped from the JWT, and another in
organization **B** — the multi-organization case that was impossible before, now a permanent
regression guard named in the test.

**Nine authorization scenarios executed live**, one signed-in and eight in a single
rolled-back transaction, with the database re-read afterwards to confirm nothing persisted
(`profiles.tenant_id` still null, 0 driver `user_roles` rows, 0 soft-deleted memberships):
member of A → A creates; member of A+B with home org A → **B creates**; non-member refused;
soft-deleted membership refused; non-member assignee refused; non-driver assignee refused;
driver assignee accepted; driver self-assignment on insert; driver reassignment refused.
The full table is in `BLOCKERS.md` §015.

**Two test defects fixed, both found by the change, neither an application defect.**
`guard_order_item_price()` overwrites `NEW.unit_price` from `product_variants.unit_price` on
every insert, so the suite's `2 × 1500.5000 = 3001.0000` assertion was asserting a contract
the database does not have. It now asserts the **stronger, real** one: the client's price is
discarded, the catalog price wins (`850.0000`), `line_total` is `GENERATED ALWAYS` at
`1700.0000`, and `recalculate_ticket_totals()` propagates it to the header. Separately,
`Buffer` was used without importing `node:buffer`, which the root ESLint gate caught.

### P9.6 reassessed — now genuinely unblocked

A delivery hangs off a ticket, and a real signed-in user can now create one. The mechanism is
known rather than assumed: grants read live show `authenticated` holds `INSERT, SELECT` and
**no UPDATE** on both `tickets` and `deliveries`, so rows are created through PostgREST + RLS
and every transition goes through a SECURITY DEFINER RPC. All six lifecycle signatures are
recorded in `IMPLEMENTATION_LOG.md`. P9.6's remaining dependency is BLOCKER-003 (financial
rules) only where money is involved; the delivery transitions themselves are not money.

**Fixture note:** the smoke suite now creates one real ticket per run in **each** of the two
scratch organizations. `tickets`, `ticket_items` and `document_sequences` are in the teardown
order below.

---

## ✅ BLOCKER-012 RESOLVED · 🛑 BLOCKER-015 FOUND BEHIND IT (2026-08-16) — superseded above

**Migration applied:** `20260816131235_fix_document_sequences_doc_type_check_for_ticket`.
`document_sequences_doc_type_check` now allows `('ticket','invoice','production_batch')`,
matching `next_document_number()`. Zero `doc_type='order'` rows existed, so it was a pure
constraint swap. The 23514 that made `tickets` unusable is gone.

**Ticket creation still does not work.** Verifying with a real signed-in INSERT — not a
simulation — surfaced a second defect with the same symptom:
`guard_order_actor_and_assignment()` resolves membership through `profiles.tenant_id`, which
under the multi-organization model is the user's **home** organization rather than their
membership set. Proven in one rolled-back transaction:

| Attempt | Result |
|---|---|
| INSERT as the schema stands | REFUSED — `P0001 invalid order creator` |
| same INSERT, `profiles.tenant_id` set to the target org | **CREATED `TKT-000001`** |
| same user (owner of A **and** B, home = A), INSERT into **B** | REFUSED |

Row 2 proves the constraint fix works. Row 3 is the new defect. Nothing persisted.

**The fix is drafted and was denied by the permission classifier**, so it is written,
reasoned and unapplied — full statement in `IMPLEMENTATION_LOG.md`, ready to re-run
unmodified. It touches an authorization guard, so a human read of the diff is a fair gate.
See **BLOCKER-015** and `NOTIFICATIONS.md`.

**The smoke suite is deliberately left red: 53 pass / 9 fail.** All nine failures are
downstream of that one guard, and the suite prints a one-paragraph diagnosis instead of nine
mysteries. The assertions describe the behaviour the system is supposed to have; making them
pass by weakening them would hide a real defect.

### P9.6 reassessed — still blocked, for a new reason

The question was whether resolving BLOCKER-012 unblocks the delivery workflow. It does not.
A delivery hangs off a ticket, and no real user can create a ticket until BLOCKER-015 is
fixed. What *did* change is that the mechanism is now known rather than assumed — grants read
live show `authenticated` holds `INSERT, SELECT` and **no UPDATE** on both `tickets` and
`deliveries`, so rows are created through PostgREST + RLS and every transition goes through a
SECURITY DEFINER RPC. All six lifecycle signatures are recorded in `IMPLEMENTATION_LOG.md`.
That retires the "signatures have not been read" half of P4.5's write-path blocker.

**P9.6 becomes genuinely startable when BLOCKER-015 is applied.** Its remaining dependency
after that is BLOCKER-003 (financial rules) only where money is involved; the delivery
transitions themselves are not money.

## ✅ P9.5 DELIVERED — production batches, read path (2026-08-16)

Batch list with a server-side status filter, plus a detail screen showing the batch and its
ingredient lines. Three new organization-scoped hooks and one new query
(`listRecipesByIds`). **Zero migrations.** Verified live: **51/51** smoke checks.

```
EVIDENCE: node scripts/smoke-signed-in.mjs        -> exit 0, 51 PASS / 0 FAIL
          npm run verify:cache                    -> exit 0, 61 PASS / 0 FAIL
          npm run typecheck                       -> exit 0
          npm run lint --workspace apps/mobile    -> exit 0, 18 files,
                                                     all 3 new files covered
                                                     (counted via --format json)
          npx eslint packages --max-warnings=0    -> exit 0
          .venv/Scripts/python.exe -m pytest -q   -> 12 passed
          on-device run                           -> NOT PERFORMED (no anon key on a device)
```

**Why P9.5 and not P9.6.** A delivery hard-requires a ticket, and **BLOCKER-012** makes every
ticket INSERT fail, so a delivery screen could be written but never verified against live
data. `production_batches.ticket_id` is nullable — build-to-stock batches need no ticket —
and `assign_batch_number()` routes through `next_document_number(…, 'production_batch')`,
which is one of the doc types the `document_sequences` CHECK **does** allow. Production is
therefore the only P9 slice that is both unblocked and live-verifiable today.

**Read-only, for a stronger reason than P9.4's.** `complete_production_batch()` writes one
`production_consume` movement per ingredient, one `production_output` movement for the
finished variant, each line's actuals, and the status — in one transaction. A client that
assembled that from separate calls would, on a partial failure, leave the flour consumed
with no bread recorded.

**The fixtures insert batches only.** Every ingredient line on screen is
`copy_batch_planned_ingredients()` scaling the recipe by `planned/yield` and rounding to
four decimals, so the trigger's arithmetic is what the smoke test asserts — including
`2.5 × (7/3) → 5.8333`, which only holds if the rounding happens in the database.

**The state machine was executed, not read.** In one rolled-back transaction:
`cancelled → in_progress` REFUSED, `scheduled → completed` REFUSED (no skipping
`in_progress`), `complete_production_batch(in_progress, 7.0)` OK — status `completed`,
2 movements (`production_consume -5.8333`, `production_output 7.0000`), flour 120.0000 →
114.1667, line actual 5.8333 — then `completed → in_progress` REFUSED. Verified afterwards
that nothing persisted: flour 120.0000, 7 movements, batch still `in_progress`.

**Two RPC signatures are now read from the live database** —
`complete_production_batch(p_batch_id uuid, p_actual_quantity numeric, p_ingredient_actuals
jsonb DEFAULT '[]', p_warehouse_id uuid DEFAULT NULL)` and `fail_production_batch(p_batch_id
uuid, p_reason text, p_ingredient_actuals jsonb DEFAULT '[]', p_warehouse_id uuid DEFAULT
NULL)`. That removes the stated obstacle to P4.3's write path. It does **not** make the
write path done; it makes it startable.

**One documentation defect corrected.** `packages/api/queries/production.ts` still carried a
"not yet live-verified" provenance caveat that stopped being true on 2026-08-15. Both tables
match `information_schema.columns` and `pg_constraint` exactly; the header now records the
live RLS predicates instead, including that the child table reaches its branch axis through
its parent.

**Cache keys are now guarded structurally.** `verify-cache-isolation.mts` enumerates every
builder in `queryKeys` and requires each to be organization-scoped unless it is on an
explicit user-scoped allowlist. The previous checks sampled three keys, so a future key that
forgot `orgScoped()` would have passed them all.

### Fixtures added (same cleanup as the rest)

Three recipes, four recipe lines and four batches inside the smoke organizations — org A has
`BATCH-000001..3` (scheduled / in_progress / cancelled), org B has its own `BATCH-000001`.
The duplicate number across tenants is deliberate and asserted: document sequences are per
tenant, so a global one would leak how much other bakeries produce.

## ✅ BLOCKER-014 RESOLVED — the tenant model is live (2026-08-15)

The access-token hook is enabled on `tvfyxpafbpnkneujcnvr` and GoTrue invokes it. Sign-in
mints `tenant_id` and `roles` as top-level claims, and **the signed-in smoke test passes
30/30**, run twice: once from a virgin account and once re-entering with an organization
already active. Organization isolation is now verified *behaviourally* against the live
database, not simulated — catalog A returns only A's rows, switching to B makes A's product
invisible even by direct id, and a non-member organization is refused.

**Two test defects were found and fixed** (no application defect):

`set_active_organization` **deliberately rejects NULL** and persists to
`profiles.active_tenant_id`, so an organization choice survives sign-out and is restored by
the hook at the next sign-in. That is intended behaviour, but it meant the smoke test only
passed on its very first run — it assumed a never-used account. Two assertions were rewritten
to test the real invariants instead of that stale precondition:

- the catalog contains exactly the rows of the tenant in the token, *and nothing at all when
  that tenant is null* — which covers the no-organization case rather than presuming it;
- after the RPC, the un-refreshed token still carries the **previous** tenant. This is the
  property that matters: the RPC cannot reach into an already-issued token, so a client that
  skips `refreshSession()` keeps operating in the old organization.

The scratch profile's `active_tenant_id` was reset to NULL once so the null-claim path was
genuinely exercised rather than assumed; the test then passed again unmodified on the
persisted path.

### Historical record — the original blocker

## 🛑 BLOCKER-014 — no JWT carries `tenant_id`; the tenant model is inert (2026-08-15)

The first **signed-in** smoke test against the live project found that a real sign-in
returns a token with **no `tenant_id` and no `roles` claim at all**. Every RLS policy reads
`current_tenant_id()` = `auth.jwt() ->> 'tenant_id'`, so **every tenant-scoped table returns
zero rows for every authenticated user.**

The database side is ready — the hook function exists, `supabase_auth_admin` holds EXECUTE
and schema USAGE, the `*_auth_hook_read` policies are in place — and the auth logs show
clean 200s with no hook invocation and no hook error. **The hook is not registered in the
project's Auth configuration.**

**Fix (project setting, not SQL, not reachable from here):** Supabase dashboard →
Authentication → Hooks → *Customize Access Token (JWT) Claims* → `public.custom_access_token_hook`,
**on project `tvfyxpafbpnkneujcnvr`**.

**Re-checked after the hook was reported enabled — still not invoked.** `pg_stat_statements`
shows **0** calls by `supabase_auth_admin` against 11 by `postgres`, across nine sign-ins.
The function is correct in isolation and its grants/metadata match the docs exactly. Given
that this session started with the connector pointed at a *different* Supabase account, the
likeliest cause is the hook being enabled on the wrong project.

**Re-verified a third time 2026-08-15 18:52Z — now classified EXTERNAL, work stopped.**
Connector confirmed on `tvfyxpafbpnkneujcnvr` (`get_project_url`, plus the scratch user is
in *this* database); `pg_stat_statements` not reset since 2026-08-04, so the counters cover
every sign-in ever made; **no row for `custom_access_token_hook` is attributed to
`supabase_auth_admin`**; auth logs show the 18:37Z grant/refresh/logout as clean 200s with no
hook invocation and no hook error. A registered-but-failing hook would 500; a
registered-and-working hook would appear under `supabase_auth_admin`. Neither. GoTrue for
this project has no access-token hook registered — nothing further is resolvable from SQL,
the repo, or the available MCP tools. Needs a dashboard confirmation on the right project
and slot, or a Supabase support ticket if the dashboard already shows it enabled.

**Why nothing caught it earlier:** every SQL suite sets the claim by hand with
`set_config('request.jwt.claims', …)`, which simulates the hook's output. They proved the
policies are right *given* a claim; nothing proved a claim is ever minted.

### Smoke test — 20/30 passing, all 10 failures downstream of the missing claim

`node bakeflow-frontend/scripts/smoke-signed-in.mjs` · re-run it after enabling the hook.

**Passing already:** sign-in; the organization list loading with a null claim (2 of 3
visible, non-member hidden); own roles readable; catalog empty rather than erroring with no
active org; `set_active_organization` succeeding for a member and **refused** for a
non-member; the old token staying unchanged by the RPC; `refreshSession`; sign-out; and
post-sign-out access denied at the GRANT level (42501).

**Failing:** everything needing the claim — the refreshed token carrying tenant A, catalog
contents, product detail, variants and prices, the switch to B.

## ✅ P9.4 READ PATH DELIVERED — stock on hand (2026-08-15)

Stockroom picker plus per-warehouse stock, ingredients and finished goods in two tabs. Five
new organization-scoped hooks over the existing `packages/api` inventory reads. **Zero
migrations.** Verified live: 39/39 smoke checks, including that A's stock levels are
invisible while B is active *when asked for by A's warehouse id explicitly* — RLS refusing,
not a filter narrowing.

**Read-only on purpose.** Levels are trigger-maintained from the immutable `stock_movements`
ledger (rule 7), so an "edit quantity" control would misrepresent the system. Adjusting
means inserting a movement with a reason — the write half, not started.

**Rule 7 is actually verified, not assumed:** the fixtures insert *movements only*, and the
smoke test asserts the levels equal the sum of those movements (`30 - 5 = 25`,
`5 - 2.5 = 2.5`). The trigger's arithmetic is what is under test.

**One documentation defect corrected.** `packages/types/inventory.ts` claimed negative stock
was reachable because no non-negative CHECK exists — true of constraints, wrong about
behaviour. `apply_stock_movement()` refuses `production_consume`/`sale` below zero
unconditionally, and `waste`/`adjustment` unless `organizations.allow_negative_stock` is set.
All three branches were executed in a rolled-back transaction; see `IMPLEMENTATION_LOG.md`.

**New primitive:** `compareDecimalStrings` in `packages/types/scalars.ts`, exact and
digit-wise. The low-stock cue needs a comparison, and `Number('12345678901234.5678')` is
already wrong at the fourth decimal. 16 executed checks cover scale, leading zeros, signed
zero, negative ordering, and a difference no double can see.

### Scratch fixtures left in place, deliberately

`smoke.owner@bakeflow.test` (password `SmokeTest!2026`), organizations *Smoke Bakery A/B/C*
and their catalog rows exist in the live project so the smoke test can be re-run the moment
the hook is on. The database held **zero** business rows before this. **Remove them before
production** — a known-password account must not outlive the checkpoint. Cleanup:

Inventory fixtures were added for P9.4 — one stockroom per organization, four ingredients
and six ledger movements — and production fixtures for P9.5 — three recipes, four recipe
lines, four batches and their six trigger-written ingredient lines. All inside the smoke
organizations.

**The two-line cleanup previously recorded here does not work, and was never executed.**
`organizations` has **32 RESTRICT children and no cascades** (verified live 2026-08-16), so
`delete from public.organizations …` raises `23503` on the first child table. Children must
go first. The order below is derived from the tables that actually hold fixture rows today
(16 of them, counted live), children before parents:

```sql
-- scratch organizations: ab000000-…-da01 / -da02 / -da03
delete from public.production_batch_ingredients where tenant_id in (:a, :b, :c);
delete from public.production_batches           where tenant_id in (:a, :b, :c);
-- Added 2026-08-16: the smoke suite creates one ticket per run in EACH scratch org.
-- production_batches.ticket_id references tickets, so batches must go first (above).
delete from public.deliveries                   where tenant_id in (:a, :b, :c);
delete from public.ticket_items                 where tenant_id in (:a, :b, :c);
delete from public.tickets                      where tenant_id in (:a, :b, :c);
delete from public.recipe_ingredients           where tenant_id in (:a, :b, :c);
delete from public.recipes                      where tenant_id in (:a, :b, :c);
delete from public.ingredient_stock_levels      where tenant_id in (:a, :b, :c);
delete from public.product_stock_levels         where tenant_id in (:a, :b, :c);
delete from public.stock_movements              where tenant_id in (:a, :b, :c);
delete from public.warehouses                   where tenant_id in (:a, :b, :c);
delete from public.ingredients                  where tenant_id in (:a, :b, :c);
delete from public.product_variants             where tenant_id in (:a, :b, :c);
delete from public.products                     where tenant_id in (:a, :b, :c);
delete from public.product_categories           where tenant_id in (:a, :b, :c);
delete from public.document_sequences           where tenant_id in (:a, :b, :c);
delete from public.audit_log                    where tenant_id in (:a, :b, :c);
delete from public.user_roles                   where tenant_id in (:a, :b, :c);
delete from public.branches                     where tenant_id in (:a, :b, :c);
delete from public.organizations                where slug like 'smoke-bakery-%';
delete from auth.users where email = 'smoke.owner@bakeflow.test';
```

Re-derive the table list before running it rather than trusting this snapshot — a later
milestone's fixtures will add tables. The query that produced it iterates
`information_schema.columns` for `tenant_id` and counts rows per table; it is in the
2026-08-16 `IMPLEMENTATION_LOG.md` entry.

---

## ✅ P8.1 DELIVERED — sign in → choose bakery → catalog (2026-08-15)

The first frontend vertical slice is implemented and gated. **Zero migrations, zero
database changes.**

```
EVIDENCE: npm run typecheck (all workspaces)     -> exit 0
          npx eslint packages --max-warnings=0   -> exit 0
          npm run lint --workspace apps/mobile   -> exit 0, 12 files,
                                                    all 7 new files covered (counted
                                                    via --format json, not inferred)
          npm run verify:cache                   -> 11/11 passed
          pytest -q                              -> 12 passed
          on-device run                          -> NOT PERFORMED (no anon key configured)
```

**Cache identity is the load-bearing part.** `packages/api` signatures carry no tenant —
the tenant comes from the JWT claim — so a key derived from arguments alone would be
identical across organizations and TanStack Query would serve bakery A's catalog under
bakery B's name. Every organization-scoped key therefore starts `['org', tenantId]`, built
only through `orgScoped()`, keyed on **the claim in force** rather than the id tapped.
`scripts/verify-cache-isolation.mts` executes that property against a real `QueryClient`.

**Not verified on a device.** `apps/mobile/.env` needs `EXPO_PUBLIC_SUPABASE_ANON_KEY`
before the flow can be exercised for real. Nothing below claims otherwise.

**New: BLOCKER-013** — AD-014 specifies AES-256-GCM "via expo-crypto", which has no cipher.
Session storage ships on chunked SecureStore instead; the decision needs amending.

### Next frontend milestone
**P9.1 catalog browse** — product detail with variants and prices. Note money: `unit_price`
is `NUMERIC(19,4)` carried as an exact decimal string, and formatting it for display is the
first place a decimal library becomes necessary. That is a dependency decision, not an
implementation detail.

---

## Live verification pass complete — 2026-08-15

**BLOCKER-011 RESOLVED.** The connector reaches `tvfyxpafbpnkneujcnvr`. Executed live:
sales structural **12/12**, customers RLS **6/6**, inventory write suite **17/17**.
`npm run typecheck` and `npx eslint packages --max-warnings=0` both exit 0 (captured
directly — an earlier run had them piped into `tail`, which masked the exit code).

**P4.2b COMPLETE. P4.4a (customers) COMPLETE.** Production, sales and delivery
types/schemas are now live-verified, which forced **six corrections** to already-committed
code — including reverting the previous day's `softDeleted` change: all 16 domain tables
carry `deleted_at`, so every flag is `true`. See `IMPLEMENTATION_LOG.md`.

## 🛑 BLOCKER-012 — no ticket can be created (migration-dependent)

`assign_order_number()` emits `'ticket'`; `document_sequences_doc_type_check` still allows
only `('order','invoice','production_batch')`. Every ticket INSERT raises 23514. The fix is
a one-line constraint swap, **deliberately not applied** under this pass's migration rule.
Everything ticket-shaped is downstream: sales behaviour, delivery behaviour, payments,
ticket sync.

## 🚦 NEXT TASK IS FRONTEND: P8.1 — first vertical slice

**Backend implementation work that is genuinely unblocked is exhausted.** Read paths now
exist for all five core domains — catalog, inventory, production, sales, delivery — and
**every remaining backend milestone is stopped on a human decision or on database access**.
The table under P8.0 in `BACKEND_ROADMAP.md` lists which blocker stops each one.

`BACKEND_ROADMAP.md` P8.0 requires **P2 + P4.1 (read path)** and nothing else. Both are met,
so the checkpoint is open. P8.1 is "sign in → pick organization → see catalog": sign-in
screen, organization switcher, catalog list, catalog detail, encrypted session storage per
AD-014 (**no AsyncStorage**), and a token refresh on organization switch that invalidates
every cached query.

Two things P8.1 must not inherit by accident:

- **A cache key derived only from arguments is identical across organizations.** Nothing in
  the `packages/api` signatures forces the issue — every read returns rows carrying their
  own `tenant_id`, and the query layer deliberately does not key caches. Switching bakeries
  will serve the previous one's data from cache unless the hook layer invalidates on switch.
- **A revoked membership mints a null `tenant_id` claim**, and `NULL = anything` is `NULL`,
  so every policy denies and every list returns empty. That needs its own UI state; rendering
  it as "no products yet" would be wrong and alarming.

**BLOCKER-012 is now the highest-value unblock** (BLOCKER-011 was resolved 2026-08-15). It
is a one-line constraint swap that reopens sales, delivery, payments and ticket sync.

---

## Previous task — P4.5 Delivery READ path (IMPLEMENTED)

```
TASK: P4.5 — Delivery READ path
STATUS: IMPLEMENTED (behavioural suite NOT executed — BLOCKER-011)
OWNER: claude
PREREQS: P4.4 (implemented)
EVIDENCE: npm run typecheck --workspace apps/mobile -> exit 0
          npx eslint packages --max-warnings=0 -> exit 0
          .venv/Scripts/python.exe -m pytest -q -> 12 passed
          zod probe (executed) -> 16 cols, 0 ::text (no NUMERIC column exists);
            failed-without-reason REJECTED; delivered-without-proof ACCEPTED
            (transition precondition, not a standing invariant); bad status REJECTED
          tests/sql/delivery_read_rls.sql (D1-D10) -> NOT EXECUTED
```

D5/D6/D7 are the roadmap's stated completion gate for P4.5 — that the `ready -> delivered`
rule is enforced by the database rather than by convention — and they have not run.

---

## Previous task — P4.4a + P4.4b Sales READ path (IMPLEMENTED)

```
TASK: P4.4a + P4.4b — Sales READ path (customers, tickets, ticket_items)
STATUS: IMPLEMENTED (behavioural suite NOT executed — BLOCKER-011)
OWNER: claude
PREREQS: P4.1a (implemented); BLOCKER-005 RESOLVED 2026-08-14
EVIDENCE: npm run typecheck --workspace apps/mobile -> exit 0
          npx eslint packages --max-warnings=0 -> exit 0
          .venv/Scripts/python.exe -m pytest -q -> 12 passed
          zod projection probe (executed, zod 4.1.12) ->
            customers 10 cols / 0 ::text (no NUMERIC column exists)
            tickets 25 cols / 5 ::text
            ticket_items 9 cols / 3 ::text
            JSON-number payload REJECTED; ::text payload accepted, "3000.0000" intact
            cancelled-without-reason REJECTED; negative subtotal ACCEPTED (signed money)
          tests/sql/sales_read_rls.sql (S1-S18) -> NOT EXECUTED
```

**Production code.** `packages/types/sales.ts` (280), `packages/validation/sales.ts` (156),
`packages/api/queries/sales.ts` (508). `packages/api/internal/read.ts` 196 -> 281 as the
composite-cursor helpers moved out of `queries/inventory.ts` (its second consumer) and the
soft-delete predicate became explicit. `packages/validation/decimal.ts` gained
`signedMoneySchema`. **Zero migrations.**

**No ticket mutation was written, deliberately.** Four reasons, none of them "not done
yet": the lifecycle RPC signatures (`confirm_ticket`, `complete_ticket`, `cancel_ticket`,
`archive_ticket`) have not been read from the live database; `draft -> submitted` has no
RPC at all (`API-CONTRACT.md` §2); `discount_amount`/`tax_amount` have no approved rules
(BLOCKER-003); and BLOCKER-009 leaves `cancelled -> archived` unreachable. The
`adjust_stock()` episode is the precedent — a full implementation built on an assumed
contract had to be discarded.

**Defect found and fixed in P4.3a.** `queries/production.ts` filtered
`.is('deleted_at', null)` on both production tables while selecting a column set
containing neither — `SCHEMA-REFERENCE.md` §5 lists `[std]` alone for them, where §4 spells
out `+ deleted_at, deleted_by` for `tickets`. If the column is absent, PostgREST answers
`42703` and **every production read fails**. `ReadEntity` now carries a required
`softDeleted: boolean`, so all twelve entities across four domains state it beside the
schema that says which columns they have. S3a/S3b in the sales suite verify it.

---

## Blocked: all live verification — BLOCKER-011

The Supabase MCP connector is **reachable now** (the old `ENOTFOUND` and 401 are gone) but
is authorized against a **different Supabase account**: one organization, "Undeify's Org",
one project `etodmfsmvhewihboxcrp`, holding a workforce-scheduling schema with no BakeFlow
table in it. Every call against `tvfyxpafbpnkneujcnvr` returns *"You do not have permission
to perform this action"*. No fallback exists — no service-role key, no `psql`, no stored
CLI token, all checked.

Three suites are written, committed and unexecuted: `inventory_write_rls.sql` (P4.2b),
`sales_read_rls.sql` (P4.4), and P4.3's schema verification.

---

## Previous task — P4.2b Inventory WRITE path (PARTIAL)

```
TASK: P4.2b — Inventory WRITE path
STATUS: PARTIAL — production code complete; behavioural suite NOT executed
OWNER: claude
PREREQS: P4.2a (implemented)
EVIDENCE: npm run typecheck -> exit 0
          npx eslint packages --max-warnings=0 -> exit 0
          tests/sql/inventory_write_rls.sql -> NOT EXECUTED (connection lost:
          getaddrinfo ENOTFOUND mcp.supabase.com)
```

**To finish P4.2b:** run `tests/sql/inventory_write_rls.sql` (A0-A12) once the database is
reachable. If it passes, P4.2b becomes COMPLETE; nothing else is outstanding.

**Mechanism correction.** The milestone assumed a direct insert into `stock_movements`.
Verified live, that is impossible for any application user — `authenticated` holds SELECT
only, and GRANTs precede RLS. Writes go through the SECURITY DEFINER `adjust_stock()` RPC,
which takes an **absolute target quantity**, accepts only `adjustment`/`waste`/
`opening_balance`, and owns `created_by`, `branch_id` and the audit entry. A direct-insert
implementation was written and discarded rather than shipped.

---

## Previous task — P4.2a Inventory READ path (implemented, 15/15 executed)

```
TASK: P4.2a — Inventory domain, READ PATH
STATUS: IMPLEMENTED (tests executed; awaiting independent review)
OWNER: claude
PREREQS: P1, P2 (COMPLETE), P4.1a (implemented)
QUALITY GATE: plan -> implement -> test -> security review -> code review
              -> fix -> retest -> document
EVIDENCE: tests/sql/inventory_read_rls.sql -> 15/15 passed (live, BEGIN...ROLLBACK)
          post-run row counts across 10 tables -> 0
          npm run typecheck -> exit 0
          npx eslint packages --max-warnings=0 -> exit 0
```

**Production code:** `packages/types/inventory.ts` (253), `packages/validation/inventory.ts`
(143), `packages/api/queries/inventory.ts` (418), `packages/api/internal/read.ts` (196).
`packages/api/queries/catalog.ts` 663 -> 513 as its private read primitives moved into the
shared module. **Zero migrations.**

**Security proven, not asserted:** organization isolation (I1), **branch isolation** via
`has_branch_access` (I2, with I2b/I3 preventing a vacuous pass), owner authority not
crossing organizations (I3b), soft-delete invisibility (I4), FORCE RLS (I5), money/quantity
scale surviving only under `::text` (I6a/b/c), null-tenant denial (I7).

**Finding, no blocker opened:** the negative-stock policy is **already implemented** in
`apply_stock_movement()` — `sale`/`production_consume` may never go negative;
`waste`/`adjustment` only where `organizations.allow_negative_stock` is true (I10, I11).
The roadmap's "may become a blocker if unspecified" note is withdrawn.

**P4.2b write path:** not started. A write is an insert into `stock_movements`, never an
update to a level (`CLAUDE.md` rule 7). No decision is outstanding for it.

---

## Previous task — P11.1 lint/CI gate (PARTIAL, accepted)

```
TASK: P11.1 — Lint/typecheck/spec CI quality gate
STATUS: PARTIAL — lint/typecheck/pytest delivered; SQL suites deferred (BLOCKER-002)
OWNER: claude
PREREQS: none
QUALITY GATE: plan -> implement -> test -> code review -> fix -> retest -> document
EVIDENCE: npm run lint -> exit 0, 24 files linted (7 app + 17 root, counted via
          --format json, not inferred from exit code)
          npm run typecheck -> exit 0
          .venv/Scripts/python.exe -m pytest -q -> 12 passed
          negative control: probe file with an unused var + undefined identifier ->
          ESLint warned (exit 0, which is why --max-warnings=0 was added);
          tsc raised TS2304. Probe deleted.
```

**Scope held.** No database logic, business rule, sync behaviour, financial rule or
frontend feature was touched. The only non-config edit was deleting the probe I created.

---

## P11.1 — what changed

| File | Change |
|---|---|
| `bakeflow-frontend/eslint.config.js` | **new** — root flat config covering `packages/*` |
| `bakeflow-frontend/apps/mobile/package.json` | `lint`: `expo lint` → `eslint . --max-warnings=0` |
| `bakeflow-frontend/package.json` | `lint` also runs `eslint . --max-warnings=0` at root |
| `.github/workflows/ci.yml` | **new** — lint + typecheck + pytest on push/PR |

**Two findings worth keeping.** ESLint alone would not have caught an undefined
identifier (`typescript-eslint` disables `no-undef` and defers to `tsc`), so lint and
typecheck are complementary gates and CI must run both — dropping either leaves a real
class of error unchecked. And an exit code is not evidence of coverage: `expo lint`
returned a *failure* while linting nothing, and the first fix returned *success* while
warning. Both were caught only by counting files and by the negative-control probe.

**Not verified:** the workflow has never run on GitHub. Its commands pass locally; the
YAML is unproven until a push triggers it.

---

## Previous task — P4.1a Catalog READ PATH (unchanged, still IN REVIEW)

```
TASK: P4.1a — Catalog domain, READ PATH
STATUS: IN REVIEW  (implementation + tests done; security/code review returned)
OWNER: agents-orchestrator
PREREQS: P1 (COMPLETE), P2 (COMPLETE) — NOT P3.7 (see BLOCKER-008 resolution)
QUALITY GATE: plan -> implement -> test -> security review -> code review
              -> fix -> retest -> document
```

**Not COMPLETE.** Marking it complete requires the P8.1 slice to consume it on a real
device, and requires lint coverage to exist at all (TD-010/TD-011).

---

## What P4.1a delivered

Typed, validated, tenant-isolated **read** access to the six catalog tables, built to
`API-CONTRACT.md` §1's rule that reads go through **PostgREST + RLS, not RPCs**.

| Layer | Files |
|---|---|
| Types | `packages/types/scalars.ts`, `packages/types/catalog.ts` |
| Validation | `packages/validation/decimal.ts`, `packages/validation/catalog.ts` |
| Data access | `packages/api/client/index.ts`, `packages/api/errors/index.ts`, `packages/api/queries/catalog.ts` |
| Tests | `tests/sql/catalog_read_rls.sql` |

**Zero migrations. Zero schema changes. Database still holds 0 rows** (verified after the
suite rolled back).

### Evidence actually executed

| Command | Result |
|---|---|
| `tests/sql/catalog_read_rls.sql` (live, BEGIN…ROLLBACK) | **22/22 assertions passed** |
| post-run row-count verification | **0 rows** in all 7 touched tables |
| `.venv/Scripts/python.exe -m pytest -q` | **12 passed** |
| `npm run typecheck --workspace apps/mobile` | **exit 0**; `--listFilesOnly` confirms all new package files are in the program |
| zod-4 API runtime check (21 assertions) | **21/21 passed** |
| `npm run lint --workspace apps/mobile` | **FAILS — pre-existing**, see TD-011 |

---

## Findings recorded, not silently absorbed

1. **`API-CONTRACT.md` §4 is wrong about money transport** (TD-012). Postgres renders
   `numeric` unquoted in JSON, so `JSON.parse` destroys the scale. Every numeric column is
   therefore selected with a `::text` cast, and Zod rejects a JSON number in those
   positions so a dropped cast fails loudly instead of corrupting money.
2. **Catalog has no `branch_id`** — tenant-scoped only. "Branch isolation where
   applicable" does not apply here, and no branch filter was invented.
3. **No `catalog.*` permission keys exist.** The live keys are `products.manage` and
   `pricing.manage`; per AD-016 they enforce nothing. Authorization is role-based RLS.
4. **Lint cannot see `packages/*` at all** (TD-010).

---

## BLOCKED: P4.1b — catalog write path

Not started, deliberately. **BLOCKER-010**, three sub-decisions:

- **(a)** ~~Does soft-delete free a natural key?~~ **RESOLVED 2026-08-14.** All five unique indexes are now partial on `deleted_at IS NULL`. A deleted entity's name/SKU is freed for re-use. The application layer must detect `23505`, query for a soft-deleted row with the same key, and surface a role-gated restore prompt. Full contract in `docs/SOFT-DELETE-AND-RETENTION.md` §38.
- **(b)** May `product_variants.unit_price` be edited in place with no price-history table? That is **BLOCKER-003** territory — still OPEN.
- **(c)** Confirm PostgREST + RLS as the write mechanism — still OPEN.

**P4.1b unblocks when (b) and (c) are resolved.** (a) is done.

---

## Standing blocked task (unchanged)

**P3.7 — Per-entity sync operation application** · **BLOCKED at PLAN** on BLOCKER-005,
BLOCKER-006 and BLOCKER-009. The BLOCKER-008 resolution did **not** touch these: it only
established that **P4.1 is P3.7's prerequisite**, not its dependent.

---

## Next dependency-safe task

**P8.1 — first frontend vertical slice** ("sign in → pick organization → see catalog").
Its prerequisite set is now unambiguously **P2 + P4.1**, and the catalog read path is the
"at least one readable domain" the P8.0 checkpoint was waiting on.

Also safe in parallel: **P11.1** CI pipeline (which would close TD-010/TD-011), **P6.1**
Edge Function scaffold.

**Also required during P4.1b:** implement `restore_catalog_entity` RPC (specified in
`docs/SOFT-DELETE-AND-RETENTION.md` §38) and the `CatalogEntityDeletedError` /
`DuplicateNameError` types in `packages/api/errors/index.ts`. The 23505 catch-and-check
pattern must be in place before catalog writes go live.

A task becomes COMPLETE only with executed-command evidence. Never on assertion.
