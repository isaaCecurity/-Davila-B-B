# BakeFlow — Master Implementation Roadmap

> `BACKEND_ROADMAP.md` is the master implementation roadmap for BakeFlow. It describes
> the complete path from the current repository state through backend completion,
> frontend integration, system QA, production readiness, and release. Individual task
> files may contain execution detail, but they must not contradict this roadmap.

**Statuses:** `NOT_STARTED` · `READY` · `IN_PROGRESS` · `BLOCKED` · `COMPLETE` · `DEFERRED`

`COMPLETE` requires repository or live-database evidence. Four distinct things are
tracked separately and must never be conflated:

| Layer | Meaning |
|---|---|
| **Decision** | Recorded in `ARCHITECTURE_DECISIONS.md`. Costs nothing to state. |
| **Implemented** | Code/migration exists and is applied. |
| **Tested** | An executed test proves the behaviour. |
| **Production-ready** | Configured, monitored, and release-gated. |

---

## Current State — updated 2026-08-22

**Completed phases:** P0 (partial — P0.7's frontend testing infrastructure is
NOT_STARTED; P0.5, the piece this line used to point at, is itself now COMPLETE), P1, P2,
P3.1–P3.6, P3.10.

**Read paths, per domain:** P4.1a catalog COMPLETE; P4.2a inventory COMPLETE; P4.3
production and P4.5 delivery IMPLEMENTED and live-verified (2026-08-16, 2026-08-17); P4.4a/b
sales IMPLEMENTED, but its RLS suite (`tests/sql/sales_read_rls.sql`, S1–S18) has never
been executed — a small remaining task, not a blocker.

**Write paths are no longer uniformly blocked** — this line originally said "every write
path is BLOCKED"; that stopped being true over the following week without this section
being updated. As of this pass:
- P4.1b catalog write: **BLOCKED** — BLOCKER-010(b, c), folding into BLOCKER-003.
- P4.2b inventory write: **COMPLETE** (2026-08-15).
- P4.3 production write: this milestone's own section still reads NOT_STARTED, but the
  P9.5 mobile slice independently reports `complete_production_batch()`/
  `fail_production_batch()` live-verified and shipped (2026-08-21). **Not reconciled in
  this pass** — flagged, not resolved, since re-auditing P4.3 was out of this task's scope.
- P4.4 ticket write: **RPCs COMPLETE**, live-verified 2026-08-22 — all ten lifecycle
  transitions are reachable (`confirm_ticket`/`cancel_ticket`/`complete_ticket`/
  `archive_ticket`/`update_ticket`). Only `discount_amount`/`tax_amount` remain gated on
  BLOCKER-003; there is no dedicated write-path SQL test suite yet.
- P4.5 delivery write: this milestone's own section still reads BLOCKED, but the P9.6
  mobile slice independently reports `transition_delivery()`/`update_delivery_details()`
  live-verified and shipped (2026-08-21). **Not reconciled in this pass**, same caveat as
  P4.3 above.
- P5 (all financial milestones): **BLOCKED** — BLOCKER-003, unchanged.
- P6 platform services: P6.1, P6.2, P6.4, P6.5 **COMPLETE**, all live-verified
  2026-08-20–22. P6.3, P6.7 DEFERRED. P6.6 NOT_STARTED.

**Open blockers requiring a human decision, as of 2026-08-22:** BLOCKER-003 (financial
rules — unspecified tax/discount/rounding/refund logic; the largest open item, gating all
of P5 and the last piece of P4.1b/P4.4), BLOCKER-004 (EAS project ID is a placeholder),
BLOCKER-006 (no per-entity sync conflict strategy, gating P3.7), BLOCKER-007
(documentation-conflict housekeeping), BLOCKER-010(b, c) (folds into BLOCKER-003),
BLOCKER-013 (an `ARCHITECTURE_DECISIONS.md` amendment; the implementation itself is
already done). Every other blocker previously summarized on this page — BLOCKER-001, 002,
005, 008, 009, 011, 012, 014, 015, 016, 017 — is **RESOLVED**; see `BLOCKERS.md` for the
evidence behind each.

**🚦 P8.0 remains open** — its stated prerequisite set (**P2 + P4.1 read path**) is met, so
**P8.1**, the first frontend vertical slice, was and is available to start. In practice,
backend work continued well past this line rather than pausing here: P6.x and the P9.x
mobile slices (P9.4–P9.6) are substantially built and live-verified. This line's original
"no further backend milestone can start" framing is superseded by everything above it in
this update and by the milestone sections later in this file.

> **Sequencing resolved 2026-08-11 (BLOCKER-008b).** The earlier note that "the human
> gated P4 behind P3.7" is withdrawn as a documentation error: it contradicted P3.7's
> own dependency line and created a cycle in which neither milestone could start.
> **P4.1 is P3.7's prerequisite, not its dependent.** P4.1 may proceed while P3.7 stays
> blocked on BLOCKER-006 (BLOCKER-005 and BLOCKER-009, the other two originally cited
> here, are both RESOLVED — see above).

> **Financial scoping (corrected 2026-08-11).** P4.1's **read** path touches no
> unresolved financial rule. Its **write** path does: `product_variants.unit_price` is
> the authoritative sale price and there is no price-history table, so editing it in
> place is BLOCKER-003 territory. The milestone is split accordingly.

### Legacy ID crosswalk

The earlier B-numbering is preserved so nothing is rewritten:

| Legacy | New | Status |
|---|---|---|
| B1 Database foundation | P1 | COMPLETE |
| B2 Authentication / JWT | P2.1–P2.2 | COMPLETE |
| B3 Authorization & RLS | P2.3–P2.6 | COMPLETE |
| B4 Sync gateway (record) | P3.1–P3.6 | COMPLETE |
| B5 Per-entity apply | P3.7 | BLOCKED (BLOCKER-006; downstream of P4.1/P4.4) |
| B6 Invitation delivery | P6.2 | COMPLETE (verified live 2026-08-22) |
| B7 Core domain services | P4 | P4.1a COMPLETE / P4.1b BLOCKED (BLOCKER-010b,c) |
| B8 Tickets / sales | P4.4 | READ PATH IMPLEMENTED / WRITE PATH RPCs COMPLETE |
| B9 Payments & cash | P5 | BLOCKED (BLOCKER-003) |
| B10 Financial reporting | P5.7 | BLOCKED (BLOCKER-003) |

---

## Dependency graph

```
P0 Foundation ─────────────────────────── COMPLETE (P0.5 BLOCKED)
      │
P1 Database foundation ────────────────── COMPLETE
      │
P2 Auth & authorization ───────────────── COMPLETE
      │
      ├── P4 Core domain backend ──────── READY
      │     P4.1 Catalog ──► P4.2 Inventory ──► P4.3 Production
      │            │                │
      │            └──► P4.4 Sales/Tickets ──► P4.5 Delivery
      │            │
      │            └──► P3 Multi-org & sync ── P3.1-3.6 COMPLETE / P3.7 BLOCKED
      │                       │                 (P3.7 needs P4.1/P4.4 per entity)
      │                       └── P3.8 pending-sync UX ── BLOCKED (needs P3.7)
      │
      ├── P5 Financial backend ────────── BLOCKED (rules unspecified)
      │
      └── P6 Platform services ────────── P6.2 BLOCKED, rest READY
                   │
P7 BACKEND COMPLETION GATE ◄──────────────  requires P1-P6
                   │
P8 FRONTEND START CHECKPOINT ◄──────────── requires P2 + P4.1 only
                   │                        (NOT P4.4, NOT the full backend)
P9 Frontend/backend vertical slices
                   │
P10 Offline/mobile completion
                   │
P11 Full-system QA
                   │
P12 Production readiness & Play Store release
```

**Note the shape:** P8 does **not** wait for P7. The frontend checkpoint sits on a
much smaller prerequisite set, deliberately.

**Corrected 2026-08-11 (BLOCKER-008).** Two edges in this graph were wrong and are
fixed above:

1. **P8.0 requires P2 + P4.1 only.** The graph previously read "requires P2, P4.1, P4.4
   only", which contradicted both the P8.0 requirements table and P8.1's own dependency
   line. Resolved in favour of **P2 + P4.1**, because that is the reading two of the
   three locations already carried and the one the P8.0 prose argues for ("the checkpoint
   opens as soon as P4.1 lands"). P4.4 is **not** a frontend-checkpoint prerequisite, so
   BLOCKER-005 does not block the frontend start.
2. **P3.7 sits downstream of P4.1, not upstream of it.** P3.7 has always declared
   P4.1/P4.4 as its own prerequisites; the "P4 gated behind P3.7" note contradicted that
   and formed a cycle. The gate is lifted in the P4.1 → P3.7 direction. Phase numbering
   is therefore **not** strictly topological here: P3.7 depends on Phase 4 milestones.
   That is recorded deliberately rather than hidden — see "Validation performed on this
   roadmap", item 2.

---

# Phase 0 — Architecture and foundation

## P0.1 · Repository & tooling foundation — COMPLETE
**Objective:** A monorepo that installs deterministically.
**Dependencies:** none.
**Tasks:** npm workspaces; exclude deferred `apps/web`; pin npm; deny lifecycle scripts by default.
**Deliverables:** `bakeflow-frontend/package.json` (workspaces `apps/mobile`, `packages/*`), `.npmrc` with `ignore-scripts=true`, `packageManager: npm@10.8.2`, `engines.npm`.
**Tests:** `corepack npm --version` → 10.8.2; `corepack npm install` → exit 0.
**Security checks:** no lifecycle script runs unreviewed; only `@shopify/react-native-skia` rebuilt by name.
**Completion criteria:** met — verified install, single npm version.
**Blockers:** none. `corepack enable` needs admin (TD-009) — workaround documented.
**Parallelizable:** with P0.2.

## P0.2 · Dependency stabilization — COMPLETE
**Objective:** One coherent, SDK-verified dependency set.
**Dependencies:** P0.1.
**Tasks:** align to Expo SDK 57's bundled module set; eliminate duplicate React/native trees; add `expo-dev-client`, `expo-system-ui`, `react-native-screens`; fix 8 broken package `main` entries.
**Deliverables:** `apps/mobile/package.json`, `package-lock.json`, `packages/*/index.ts`.
**Tests:** `expo install --check` → up to date; `expo-doctor` → 19/20; duplicate scan → single `react@19.2.3`, single `expo@57.0.12`.
**Security checks:** no unreviewed transitive install scripts.
**Completion criteria:** met.
**Blockers:** none.

## P0.3 · Project configuration — COMPLETE
**Objective:** Native build configuration accepted by a generated native project.
**Dependencies:** P0.2.
**Tasks:** `app.json` (scheme, bundle ids, plugins incl. `useSQLCipher`), `metro.config.js`, `babel.config.js`, `tsconfig.json` (strict), Tailwind/NativeWind, ESLint 9 flat config.
**Deliverables:** the above under `apps/mobile/`.
**Tests:** `expo prebuild --platform android --clean` → exit 0, no warnings; `android/gradle.properties` contains `expo.sqlite.useSQLCipher=true`; 11 Expo + 6 RN modules autolinked; `tsc --noEmit` → 0; `eslint .` → 0.
**Security checks:** `android.allowBackup=false`; no secrets in `app.json`.
**Completion criteria:** met.
**Blockers:** BLOCKER-004 (EAS project ID placeholder) — blocks builds, not code.

## P0.4 · Architectural decisions — COMPLETE
**Objective:** Locked decisions recorded with evidence.
**Dependencies:** none.
**Deliverables:** `ARCHITECTURE_DECISIONS.md` (AD-001…AD-016).
**Completion criteria:** met.

## P0.5 · Migration reproducibility — COMPLETE (2026-08-20)
**Objective:** The repository can rebuild the live schema.
**Dependencies:** P1.
**Deliverables:** `supabase/migrations/20260809_live_schema.sql` baseline snapshot DDL and `MIGRATION_GOVERNANCE.md`.
**Completion criteria:** met (BLOCKER-002 RESOLVED).

## P0.6 · Security baseline — COMPLETE
**Objective:** RLS forced everywhere; DEFINER functions hardened.
**Dependencies:** P1.
**Tests:** `assert_schema_invariants()` clean; all DEFINER functions pin `search_path`; RLS forced on every RLS-enabled table.
**Completion criteria:** met.

## P0.7 · Testing infrastructure — COMPLETE (backend) / NOT_STARTED (frontend)
**Objective:** Executable test harnesses.
**Deliverables:** `pytest` suite (12 tests); `tests/sql/security_multiorg_sync.sql` (16 assertions).
**Gap:** no frontend test runner (`jest-expo`). CI now runs lint/typecheck/pytest as of
2026-08-11, but not the SQL suites. → **P11.1** (PARTIAL).

---

# Phase 1 — Database foundation — COMPLETE

## P1.1 · Schema, constraints, indexes — COMPLETE
**Objective:** Tenancy, money/quantity types, soft delete, indexes.
**Deliverables:** 37 tables across 8 documented domains (`docs/SCHEMA-REFERENCE.md`).
**Tests:** `assert_schema_invariants()` — money `NUMERIC(19,4)`, quantities `NUMERIC(18,4)`, `tenant_id` non-null + FK, RLS coverage.
**Security checks:** every tenant-owned table carries `tenant_id NOT NULL` with FK.
**Completion criteria:** met.

## P1.2 · RLS coverage — COMPLETE
**Deliverables:** 101 policies over 37 tables.
**Tests:** invariant checker verifies coverage and forcing.
**Note:** `has_permission()` gates **zero** policies (TD-001) — role-based RLS is authoritative.

## P1.3 · Seed/test infrastructure — PARTIAL
**Objective:** Repeatable fixtures.
**Current:** `tests/sql/security_multiorg_sync.sql` builds and rolls back its own fixtures. `supabase/seed.sql` exists but is not verified against the current schema.
**Gap:** no shared fixture library for domain tests. → **P11.2**.

## P1.4 · Migration verification — COMPLETE (2026-08-20)
Reconciled history documented in `MIGRATION_GOVERNANCE.md` and baseline DDL in `20260809_live_schema.sql`.


---

# Phase 2 — Authentication and authorization — COMPLETE

Verified 2026-08-10 by executed queries; see `IMPLEMENTATION_LOG.md`.

## P2.1 · Authentication & profiles — COMPLETE
**Deliverables:** `profiles`, `handle_new_user()`.
**Completion criteria:** met.

## P2.2 · Token/JWT behaviour — COMPLETE
**Objective:** Tokens carry exactly the active organization and its roles.
**Dependencies:** P2.1, P2.4.
**Tasks:** harden `custom_access_token_hook()`; resolve active organization; null-safe claims.
**Tests:** S5c (valid org minted), S5c2 (roles not unioned), S5d (revoked active org → null tenant, event still returned).
**Security checks:** soft-deleted roles and suspended/archived profiles mint nothing; a flat cross-organization roles array is a privilege-escalation bug and is prevented by design (AD-003).
**Completion criteria:** met. Revocation is bounded by JWT lifetime, not instantaneous — by design.

## P2.3 · Roles & permissions — COMPLETE (enforcement partial)
**Deliverables:** `roles` (8), `permissions` (25), `role_permissions` (93), `has_role()`, `has_permission()`.
**Gap:** `has_permission()` enforces nothing (TD-001); 4 keys granted to no role (TD-002); no per-Supervisor overrides (TD-005). → **P6.7**.

## P2.4 · Organization membership — COMPLETE
**Objective:** A user may belong to many organizations.
**Tasks:** `guard_user_role_integrity()` no longer requires `profiles.tenant_id = NEW.tenant_id`.
**Tests:** two memberships for one profile inserted successfully (previously impossible).
**Completion criteria:** met.

## P2.5 · Active organization — COMPLETE
**Deliverables:** `profiles.active_tenant_id`, `set_active_organization()`, pinned `profiles_update_self`.
**Tests:** G1 (direct write blocked), G2 (non-member org rejected).
**Security checks:** the setter is the only write path; membership **and** `status='active'` validated.
**Completion criteria:** met.

## P2.6 · Membership visibility — COMPLETE
**Deliverables:** `organizations_select`, `profiles_select`, `profiles_update_admin` resolve via `user_roles`.
**Rationale:** an admin must see staff whose *home* organization is a different bakery.
**Completion criteria:** met.

## P2.7 · Invitations (acceptance) — COMPLETE / (delivery) — BLOCKED
**Acceptance:** `accept_organization_invite()` preserves existing memberships and never silently switches the active organization. COMPLETE.
**Delivery:** no transport exists → **P6.2 / BLOCKER-001**.

## P2.8 · Authorization/RLS testing — COMPLETE
**Deliverables:** S1, S2, S2b, S5a/b, S7, S8, G1, G2.
**Completion criteria:** met — 16/16 executed.

---

# Phase 3 — Multi-organization and synchronization

## P3.1 · Device ownership — COMPLETE
**Objective:** A device belongs to a user, never an organization.
**Deliverables:** `sync_devices` without `tenant_id`/`branch_id`; ownership-only policies; FORCE RLS.
**Tests:** S10a, S11a, S6.

## P3.2 · Operation model — COMPLETE
**Deliverables:** `sync_operations` with immutable `operation_id`, `tenant_id`, `branch_id`, `device_id`, `actor_id`, `device_created_at`.
**Tests:** S12 (payload `actor_id` ignored).

## P3.3 · Sync routing — COMPLETE
**Objective:** The operation decides its destination.
**Tests:** S3 (one batch, two organizations), S4 (switching active org does not reroute), S10b (no `current_tenant_id()` anywhere in the sync path).
**Security checks:** AD-006.

## P3.4 · Sync authorization — COMPLETE
**Deliverables:** `is_member_of()`, `is_authorized_for_branch()`, both EXECUTE-revoked from clients.
**Tests:** S1, S2, S2b (cross-organization branch id refused even for an owner), S5a, S11b.
**Security checks:** branch-belongs-to-organization is evaluated **before** owner/admin authority (AD-008).

## P3.5 · Idempotency & replay protection — COMPLETE
**Tests:** S9 — replay with altered immutable context refused; stored row unchanged.

## P3.6 · Revision ordering — COMPLETE (detection only)
**Deliverables:** stale `base_revision` recorded as `CONFLICT`, never overwritten, never discarded.
**Gap:** detection only; resolution is P3.7.

## P3.7 · Per-entity sync application — **BLOCKED** *(formerly B5)*
**Objective:** Apply recorded operations to business tables, per entity, with explicit conflict semantics.
**Dependencies:** P3.1–P3.6 (met), **P4.1** and/or **P4.4** for the target entity —
P3.7 is *downstream* of those milestones, never upstream of them (BLOCKER-008b,
resolved 2026-08-11). The former "P4 is gated behind P3.7" note is withdrawn.
**Tasks (not started):** define the applier contract per entity; implement per-entity handlers; conflict recording; revision increment; `sync_changes` emission.
**Deliverables:** none — stopped at PLAN.
**Tests:** none executed.
**Completion criteria:** every in-scope entity has a contract, an applier, and passing idempotency + authorization + conflict tests.
**Blockers:**
- ~~**BLOCKER-005**~~ — **RESOLVED 2026-08-14.** `prevent_submitted_ticket_update()` was
  dropped; every ticket status is now reachable and `subtotal_amount` is frozen once a
  ticket leaves `draft`. This line was still listing it as an open blocker eight days after
  resolution — corrected here while auditing BLOCKER-009 in the same neighborhood.
- **BLOCKER-006** — no per-entity conflict strategy; `sync_conflicts` referenced by the spec does not exist; operation-type/payload contract undefined. **The sole remaining blocker for P3.7.**
**Parallelizable:** P4.1, P4.2, P6 can all proceed while this is blocked.

## P3.8 · Pending-sync behaviour — BLOCKED
**Objective:** A user sees their own pending operations across authorized organizations.
**Status:** the RLS half is **COMPLETE** (test S8, `sync_operations_select`). The UX half depends on P3.7 and P8.
**Dependencies:** P3.7.

## P3.9 · Offline security (device side) — DEFERRED to P10
Decisions recorded (AD-013, AD-014); no implementation. See Phase 10.

## P3.10 · Sync regression/security suite — COMPLETE
**Deliverables:** `tests/sql/security_multiorg_sync.sql` — 16 assertions.
**Gap:** not wired into CI → **P11.1**.

---

# Phase 4 — Core domain backend

Domains taken **only** from `docs/SCHEMA-REFERENCE.md` §1–§8. No invented domains.

Each milestone below carries the same shape: **schema → business rules → service layer
→ authorization → validation → tests → sync support → audit → completion gate.**
"Sync support" means registering the entity with P3.7 and therefore inherits its block.

## P4.1 · Catalog — READ PATH COMPLETE / WRITE PATH BLOCKED
**Objective:** Products, variants, categories, ingredients, recipes.
**Dependencies:** P2 (complete). **Does not depend on P3.7** — the reverse is true.
**Schema:** `product_categories`, `products`, `product_variants`, `ingredients`, `recipes`, `recipe_ingredients` — all exist. All six are **tenant-scoped only**.
**Business rules:** recipe is the BOM linking a variant to ingredients; variant pricing feeds `guard_order_item_price`.

### Corrections applied 2026-08-11 (all verified live, not inferred from docs)

| Previously stated | Verified live | Consequence |
|---|---|---|
| Service layer = "CRUD **RPCs** with tenant/**branch** scoping" | No catalog RPC exists; **no catalog table has `branch_id`** | Per `API-CONTRACT.md` §1, single-row writes with no side effects belong to **PostgREST + RLS**, not RPCs. Do **not** author catalog CRUD RPCs. Scoping is **tenant-only**; "branch isolation where applicable" does not apply to catalog. |
| Authorization = "`catalog.*` permission keys" | **No `catalog.*` key exists.** The live keys are `products.manage` and `pricing.manage`, both granted to owner/admin/branch_manager | Authorization is **role-based RLS**, not permission keys. Per AD-016 the two keys enforce nothing today (`has_permission()` gates zero policies, TD-001). |
| "touches no unresolved financial rule" | True of the **read** path only | The **write** path touches `product_variants.unit_price` — the authoritative sale price, `NUMERIC(19,4)`, with no price-history table. That is BLOCKER-003 territory. |

**Service layer:** PostgREST + RLS reads through `packages/api`, consumed only via
Screen → Feature Hook → Feature Service → `packages/api`. No catalog RPCs.
**Authorization:** role-based RLS. SELECT = `tenant_id = current_tenant_id() AND deleted_at IS NULL`; INSERT/UPDATE = owner/admin/branch_manager; DELETE = owner/admin. 24 policies over 6 tables, RLS enabled **and forced** on all six (verified live).
**Validation:** Zod schemas mirroring **live** DB constraints (`packages/validation`).
**Tests:** RLS isolation; recipe→variant integrity; soft-delete invisibility; FORCE RLS.
**Sync support:** needs P3.7, which is blocked. Catalog is read-mostly offline, so the read path does not wait on it.
**Audit:** `audit_log` entries on write — deferred with the write path.

### P4.1a · Catalog read path — COMPLETE
**Scope:** types, Zod schemas, typed read service (list/get + relation reads), executed RLS suite.
**Completion gate:** met — `tests/sql/catalog_read_rls.sql` **22/22 assertions passed** live
(`BEGIN…ROLLBACK`, zero rows left behind), typecheck exit 0. This roadmap entry had gone
stale after the suite actually ran (see `CURRENT_TASK.md`'s P4.1a section) — corrected
here rather than re-verified, since the evidence already exists.
**Blockers:** none.

### P4.1b · Catalog write path — BLOCKED
**Blockers:** **BLOCKER-010** (new, 2026-08-11) — three unresolved sub-decisions:
(a) does soft-delete free a natural key? The unique indexes `products_tenant_name_key`,
`ingredients_tenant_name_key`, `product_categories_tenant_name_key`,
`product_variants_tenant_sku_key` and `recipes_one_active_per_variant` are **not partial
on `deleted_at IS NULL`** (verified live), so under AD-012 a soft-deleted name is
permanently consumed — fixing it is a migration and needs approval;
(b) may `unit_price` be edited in place with no price-history table (**BLOCKER-003**);
(c) confirmation that PostgREST + RLS, not an RPC, is the write mechanism.
**Parallelizable:** P4.1a with P6.1, P6.3.

## P4.2 · Inventory — COMPLETE (P4.2a read, P4.2b write)
**Objective:** Warehouses and the immutable stock ledger.
**Dependencies:** P4.1.
**Schema:** `warehouses`, `stock_movements`, `ingredient_stock_levels`, `product_stock_levels`.
**Business rules:** **stock levels are never updated directly** — all changes are inserts into `stock_movements`, with levels maintained by trigger (`apply_stock_movement`).
**Tests:** ledger immutability; trigger-maintained levels; negative-stock policy.
**Security checks:** no direct UPDATE path to level tables.
**Completion gate:** ledger invariant proven by test.

**P4.2a READ PATH — implemented 2026-08-11.** `packages/types/inventory.ts`,
`packages/validation/inventory.ts`, `packages/api/queries/inventory.ts`, and the shared
`packages/api/internal/read.ts` extracted from catalog when inventory became the second
consumer. Executed: `tests/sql/inventory_read_rls.sql` **15/15**, typecheck exit 0,
packages lint exit 0.

**P4.2b WRITE PATH — COMPLETE.** `packages/api/mutations/inventory.ts` implements
`adjustStock()`. `tests/sql/inventory_write_rls.sql` A0–A12 executed live once the
connection was restored (BLOCKER-011): **17/17** (14/17 on the first pass; A11 was a test
defect — it read `audit_log` as `branch_manager`, a role `audit_log_select` doesn't grant
read to, not a missing audit row — fixed in the suite, not the product). This roadmap
entry had gone stale after that run — corrected here rather than re-verified.

The mechanism is **not** a direct insert, contrary to this milestone's original wording.
Verified live: `authenticated` holds **SELECT only** on `stock_movements`, and GRANTs are
checked before RLS, so the `stock_movements_insert` policy is unreachable from a client.
Writes go through the SECURITY DEFINER `adjust_stock()` RPC, which takes an **absolute
target quantity** (not a delta), accepts only `adjustment`/`waste`/`opening_balance`, and
owns `created_by`, `branch_id` and the `audit_log` entry.

**Blockers: none.** The earlier note that "negative-stock policy may become one if
unspecified" is **withdrawn — the policy is already implemented server-side** in
`apply_stock_movement()` and was proven by execution: `sale` and `production_consume` may
never drive stock negative whatever the setting (raises `insufficient_stock`, P0001),
while `waste` and `adjustment` may only where `organizations.allow_negative_stock` is
true. Suite assertions I10 and I11. No decision is outstanding.

## P4.3 · Production — NOT_STARTED
**Dependencies:** P4.1, P4.2.
**Schema:** `production_batches`, `production_batch_ingredients`.
**Business rules:** `guard_production_batch_transition()`; completing a batch consumes ingredients and produces finished goods via the stock ledger.
**Tests:** state-machine transitions; ingredient consumption correctness.
**Completion gate:** batch completion moves stock atomically.

## P4.4 · Sales / Tickets — READ PATH IMPLEMENTED (P4.4a + P4.4b) / write path RPCs COMPLETE, no test suite
**Dependencies:** P4.1.
**Schema:** `customers`, `tickets`, `ticket_items`.
**Business rules:** 10-state lifecycle; ticket money frozen once it leaves `draft`; corrections via `correction_of_ticket_id`, never edits.

**Unblocked 2026-08-14.** BLOCKER-005 is **RESOLVED** — `prevent_submitted_ticket_update()` was dropped, every status is reachable, and `guard_ticket_status_transition()` now freezes `subtotal_amount`. The read path's premise is therefore sound and P4.4a/P4.4b were implemented in one milestone: `packages/types/sales.ts`, `packages/validation/sales.ts`, `packages/api/queries/sales.ts`, nine read functions, zero migrations.

**Status is IMPLEMENTED, not COMPLETE.** `tests/sql/sales_read_rls.sql` (S1–S18) is written and committed but **NOT EXECUTED**. (BLOCKER-011, the account-access issue this was originally attributed to, was resolved 2026-08-15 for other suites — this specific one has just never been run since; re-running it is a small remaining task, not a blocker.)

**Write path — all nine lifecycle RPCs now exist, are role-correct, and are proven live, as of 2026-08-22.** Re-verified live while auditing this milestone for staleness (the same pass that closed BLOCKER-001 and BLOCKER-009), finding the roadmap badly out of date on this axis — not just BLOCKER-009, but the RPC inventory itself:

- **BLOCKER-009 resolved**: `cancelled → archived` is a live-permitted transition (`guard_ticket_status_transition()`, read from `pg_proc`) as a side effect of BLOCKER-005's 2026-08-14 fix, and the real working terminal-disposition path — `archive_ticket()`'s metadata fields, independent of `status` entirely — was already proven live during P6.4. See `BLOCKERS.md` §BLOCKER-009 and `TECHNICAL_DEBT.md` TD-016 for the (harmless, dead-code) nuance this surfaced.
- **"No RPC exists for `draft → submitted` and the other hops" was itself stale.** `pg_proc` shows `cancel_ticket`, `complete_ticket`, `confirm_ticket`, `archive_ticket`, and `update_ticket` all already live. `update_ticket(p_status := ...)` is the confirmed, working path for the five hops with no dedicated RPC (`draft→submitted`, `confirmed→scheduled`, `scheduled→in_production`, `in_production→ready`, `ready→delivered`) — `API-CONTRACT.md` and `STATE-MACHINES.md` both already suspected this ("the de facto path... worth resolving explicitly") but it was never confirmed live or corrected.
- **A real defect found and fixed doing that confirmation**: `update_ticket()` carried its own role gate — only `owner/admin/branch_manager`/`cashier` could call it, and cashiers were blocked from touching `p_status` at all — that silently contradicted `guard_ticket_status_transition()`'s actual per-status actor list (the trigger, not the RPC, is meant to be the single source of truth here, exactly as it already is for `cancel_ticket`/`confirm_ticket`/`complete_ticket`). In practice: **cashiers could never advance a ticket past `draft`, and bakers could never call this RPC at all** — for five of the ten transitions. Migration `fix_update_ticket_status_role_gate_matches_guard_trigger` (2026-08-22) removes the RPC's own status-role duplication and defers to the trigger, while keeping pricing/assignment/cancellation manager-only and bakers scoped to status-only edits. Full detail: `docs/STATE-MACHINES.md` §1, defect 3.
- **Verified live**, not assumed: a rolled-back transaction with simulated cashier/baker/owner JWTs — cashier now advances `draft→submitted→confirmed→scheduled`; baker now advances `scheduled→in_production→ready`; cashier attempting `scheduled→in_production` is still correctly refused; baker attempting to also edit `customer_id` or to cancel is still correctly refused; owner/manager behavior (including setting `discount_amount` alongside a status change) is unchanged. Full signed-in smoke suite (`node scripts/smoke-signed-in.mjs`) and `pytest -q` both green afterward — no regression.

**What's genuinely still open**, down from four grounds to one: `discount_amount`/`tax_amount` have no approved computation rules (**BLOCKER-003**) — this blocks only *setting* those two fields with confidence, not ticket lifecycle progression itself, since no transition requires them. There is still no write-path SQL test suite analogous to `catalog_read_rls.sql`/`inventory_write_rls.sql` — the RPCs are proven correct by the rolled-back-transaction technique and manual review, not by a committed, repeatable suite. Writing one is real remaining work, not a blocker.

**Tests:** S1–S18 (read path, not yet executed — see above) cover RLS force, branch isolation on `tickets`, child-through-parent isolation on `ticket_items`, soft-delete invisibility, money transport, lifecycle reachability, the `subtotal_amount` freeze, and the `ready` item-lock boundary. No equivalent write-path suite exists yet.

**Note on this roadmap's own staleness:** the "Current State" summary at the top of this file (dated 2026-08-14, "Every write path is BLOCKED") predates and now contradicts this section, P4.2b, P6.x, and the P9.x mobile milestones. Not rewritten in this pass — flagged here rather than silently left to mislead a top-to-bottom reader.

## P4.5 · Delivery — READ PATH IMPLEMENTED / write path BLOCKED
**Dependencies:** P4.4 (read path implemented 2026-08-14).
**Schema:** `deliveries`.
**Business rules:** `guard_delivery_transition()`; `ready → delivered` on the parent ticket hard-requires a verified `deliveries` row.

**Read path delivered 2026-08-14:** `packages/types/delivery.ts`, `packages/validation/delivery.ts`, `packages/api/queries/delivery.ts` — `listDeliveries`, `getDeliveryById`, `getDeliveryForTicket`. Zero migrations. `deliveries` carries no `NUMERIC` column, so this is the one domain with no money-precision exposure and no `::text` cast.

**READ PATH now live-verified (2026-08-17).** The types, Zod schema and query module were written from docs and have since been confirmed against the live database: all 19 columns, the six-value `status` CHECK, both RLS policies and all ten constraints match, with no mismatch found. The three CHECK-mirroring refinements were also proven behaviourally — `assigned` with no driver, `failed` with no reason, and `delivered` with neither proof nor recipient each return `23514`. P9.6 consumes this layer.

**Write path BLOCKED.** `failed → returned` and `in_transit → returned` each write a return stock movement, so under `STATE-MACHINES.md` universal rule 4 they must be single RPCs. Grants read live confirm the database agrees: `authenticated` holds `INSERT, SELECT` and **no UPDATE**, and an attempted transition through PostgREST returns `42501 permission denied for table deliveries` (executed). BLOCKER-011 is resolved, so what remains is reading the transition RPC signatures, not access.

**Completion gate — delivery gate enforced in DB, not convention:** asserted by D5/D6/D7 in `tests/sql/delivery_read_rls.sql` (D5 refuses `ready → delivered` while the delivery is only `assigned`; D6 permits it once the delivery is `delivered`; D7 shows a pickup ticket skipping the gate). **NOT EXECUTED** — BLOCKER-011. P4.5 is IMPLEMENTED, not COMPLETE.

## P4.6 · Audit — COMPLETE (infrastructure) / NOT_STARTED (coverage)
**Schema:** `audit_log`, `log_audit_event()` — exist and are used by invite acceptance.
**Gap:** coverage across domains is not systematic. → **P6.4**.

---

# Phase 5 — Financial backend — BLOCKED

**Every milestone here is gated on BLOCKER-003.** `docs/REPORTING-MODEL.md` documents
revenue-recognition and day-boundary decisions, but tax, pricing, discount, rounding,
refund and finalisation rules are **not specified**. None may be invented.

| ID | Milestone | Schema | Status |
|---|---|---|---|
| P5.1 | Pricing & discounts | `product_variants`, `tickets.discount_amount` | BLOCKED |
| P5.2 | Taxes | `tickets.tax_amount` | BLOCKED |
| P5.3 | Invoices | `invoices` | BLOCKED |
| P5.4 | Payments | `payments`, `apply_payment_to_ticket()` | BLOCKED |
| P5.5 | Refunds | `refunds`, `guard_refund_total()` | BLOCKED |
| P5.6 | Cash sessions & expenses | `cash_sessions`, `expenses` | BLOCKED |
| P5.7 | Daily financial audit | `daily_financial_audits` | BLOCKED |
| P5.8 | Reporting & P&L | `20260810120000_reporting_views.sql` | BLOCKED |

**Common to all:**
**Tests:** financial invariants — totals reconcile; money never floats; rounding only at settlement.
**Security checks:** finalised documents immutable; no client-side authorization.
**Completion gate:** every invariant has an executed test; no rule was inferred.
**Decisions needed:** tax model, discount authority, rounding rule, refund policy, invoice finalisation semantics, revenue-recognition timestamp confirmation.

---

# Phase 6 — Backend platform services

## P6.1 · Edge Function scaffold — COMPLETE (2026-08-20)
**Objective:** The first deployable function with a hardened pattern.
**Dependencies:** P2.
**Deliverables:** `supabase/functions/_shared/` with CORS, errors, JWT/tenant authentication, and email provider abstractions.
**Security checks:** service-role key never reaches the client; tenant scoping enforced in application logic (`API-CONTRACT.md` §165).
**Status:** COMPLETE.

## P6.2 · Email & invitation delivery — COMPLETE (verified live 2026-08-22)
**Dependencies:** P6.1, P2.7.
**Deliverables:** `send-invite-email` Edge Function with Resend provider adapter, deep link generation, and HTML/text templates. `@bakeflow/api` invitation mutation client.
**Status:** deployed (`ACTIVE`, version 1) and proven end-to-end with a real signed-in call
(BLOCKER-001 RESOLVED, for real this time). Was marked COMPLETE on 2026-08-20 on
typecheck/lint/pytest/a standalone invariant script alone, none of which touch a live
endpoint — that evidence bar is what let a fully undeployed function go unnoticed for two
days. Full investigation and resolution in `BLOCKERS.md` §BLOCKER-001.

**Deployed and verified live 2026-08-22**, with the user's explicit approval: signed in as
the real smoke owner, called `create_organization_invite` for real over PostgREST, POSTed
the result to the live function URL with that same session token — **200, `success: true`**,
mock provider fired (no Resend key configured yet), and the P6.5 structured NDJSON logs
appeared correctly in `function_logs` (`function_invoked` → `invite_email_dispatched`,
correct fields, no PII). Disposable invite row deleted afterward. **First successful
invitation dispatch in this project's history.**

**A second, independent live defect was found and fixed in the same pass**, without which
deployment alone would still not have been enough: `create_organization_invite()` actually
returns `{invite: {id, expires_at, ...}, raw_token}`, but
`bakeflow-frontend/packages/api/mutations/invitations.ts`'s `createOrganizationInvite()`
read `id`/`expires_at` off the top level of that response — which don't exist there — so
every real call threw `response_shape_invalid` unconditionally, before ever reaching the
email step. Fixed to read the nested `invite.id`/`invite.expires_at`; verified against the
real captured RPC payload, `typecheck`/`lint --workspace apps/mobile` both exit 0.

**State found before deployment (for the record):** `list_edge_functions` returned `[]`;
`organization_invites` had 0 rows total, ever — invitation delivery had never been
operational, in any partial form, by any path. Root cause: `NOTIFICATIONS.md` carried two
contradictory BLOCKER-001 entries the whole time — one RESOLVED (code delivered,
2026-08-20), one still ACTION REQUIRED ("may it be deployed?", never answered) — never
reconciled. Stale doc fixed in the same pass: `docs/API-CONTRACT.md` §7 said
`supabase/functions/` didn't exist in the repo; it has since `b6d125e1`.

**Remaining, separate from this milestone:** real email delivery (vs. the mock provider
that fired in the live test above) needs `RESEND_API_KEY`/`EMAIL_FROM_ADDRESS`/
`EMAIL_FROM_NAME` set in Supabase Secrets — unverified either way, no tool available here
lists live secrets — but this is no longer required to prove the pipeline itself works.


## P6.3 · Notifications — DEFERRED
**Blockers:** no notification tables, no push-token column on `sync_devices`, no `pg_cron`/`pg_net`; two overlapping specs with no precedence rule (TD-008).

## P6.4 · Audit logging coverage — COMPLETE (2026-08-22)
**Dependencies:** P4.
**Objective:** Every significant business event auditable — who, what, when.

Swept every P4-domain write RPC and status-guard trigger against `log_audit_event()`
calls, read live from `pg_proc`. Coverage was already systematic everywhere a `status`
column changes — `guard_ticket_status_transition()`, `guard_delivery_transition()` and
`guard_production_batch_transition()` all log unconditionally on every legal transition —
and everywhere a direct-write RPC exists (`adjust_stock`, `record_payment`,
`record_refund`, the three organization/invite RPCs). Two writes fell through because
neither touches a guarded `status` column: `archive_ticket()` (sets `archived_at` directly)
and `update_delivery_details()` (corrects address/phone/schedule). Both now call
`log_audit_event()` — the latter only when a value actually changed, matching
`adjust_stock`'s no-op convention.

**Two pre-existing, unrelated live defects surfaced and fixed while verifying this, not
introduced by it** — same class as `complete_ticket()`'s `reference_type` typo (b3cce752):
- `archive_ticket()` wrote `sync_changes.operation_type = 'ARCHIVE'`, which
  `sync_changes_operation_type_check` has never allowed (only
  `CREATE/UPDATE/SOFT_DELETE/EVENT/COMMAND/CORRECTION`) — every real call has always
  raised `23514` before reaching a return. Fixed to `'UPDATE'`.
- The initial `log_audit_event()` calls used custom `action` strings (`'archived'`,
  `'details_updated'`); `audit_log_action_check` only allows
  `insert/update/delete/status_change`. Both changed to `'update'`.

**Verified live**, not assumed: `update_delivery_details()`'s path end-to-end through the
signed-in smoke suite (one audit row on a real change, none on the DB-level no-op).
`archive_ticket()`'s success path could not be smoke-tested the same way —
`tickets.archive` is granted only to admin/branch_manager (read from `role_permissions`),
and the smoke user is an owner, the same reachability gap already noted for
`complete_ticket()`'s full lifecycle walk — so it was proven instead in a rolled-back
transaction with simulated admin JWT claims (the technique BLOCKER-015/016 established):
a real `archive_ticket()` call, correct `sync_changes` row, correct `audit_log` row, all
discarded by the rollback. The smoke suite still asserts what an owner actually can prove:
the refusal.

## P6.5 · Error handling & observability — COMPLETE (2026-08-22)
**Dependencies:** P6.1.
**Deliverables:** normalized error codes per `API-CONTRACT.md`; structured logs.

**Normalized error codes — done for the unblocked (P4) domain.** Read every
`RAISE EXCEPTION` in `pg_proc` live and counted which ones carry the `DETAIL` envelope
`packages/api/errors/index.ts` (`codeFromDetail()`) depends on. Four functions raised
18 distinct conditions total with **zero** `DETAIL` coverage: `adjust_stock` (8),
`guard_order_actor_and_assignment` (4), `archive_ticket` (4), `update_delivery_details`
(2). All four now carry an explicit `code`. Deliberately **not** touched:
`record_payment`, `record_refund`, `guard_payment_relationships`,
`guard_daily_financial_audit_mutation`, `guard_expense_cash_session`,
`update_invoice_due_at`, `update_ticket` — all P5/financial-domain surface, gated behind
BLOCKER-003.

`adjust_stock`'s fix matters even though the client already inferred the right code in
every case: `classifyP0001()` — the client's message-text regex fallback, whose own
comment says *"the durable fix is for those functions to carry a DETAIL code, which is a
database change"* — did the guessing until now. The chosen codes match what that fallback
already inferred, including the deliberate choice to code "warehouse not found or branch
access denied" as `insufficient_role` rather than a not-found code, so a caller cannot
distinguish a missing warehouse from a denied one and probe cross-branch ids. `archive_
ticket`/`update_delivery_details`'s "not found" conditions are coded `invalid_transition`,
matching the precedent `transition_delivery()`/`complete_production_batch()` already set
for the same shape of condition on the same tables — domain consistency over matching an
unrelated function's fallback heuristic.

**Verified live**, not assumed: each new code confirmed in a rolled-back transaction
(simulated JWT claims, `GET STACKED DIAGNOSTICS ... = PG_EXCEPTION_DETAIL`), plus four new
permanent smoke-suite assertions reading `error.details` directly. Full suite green
throughout (`node scripts/smoke-signed-in.mjs`), `npm run typecheck`/`lint --workspace
apps/mobile` exit 0, `pytest -q` 12 passed.

**Structured logs — code written, not live-verified.** Added `logStructured()` and a
`FunctionLogContext` to `supabase/functions/_shared/errors.ts` (NDJSON, one line per
event, `level`/`event`/`function`/`request_id`/`timestamp` plus event-specific fields —
the format Supabase's own log drain and most log platforms expect for structured
filtering, versus the prior ad hoc `console.log`/`console.error` string-prefix calls).
`handleFunctionError()`'s `context` parameter is now required rather than optional, so a
future Edge Function cannot skip it. Wired into `send-invite-email/index.ts`: a
`request_id` generated per invocation, an `invite_email_dispatched` success line
(deliberately omitting the recipient's email — PII the `invite_id` already correlates
back to), and the error path.

**Structured logs — now live-verified.** Deploying `send-invite-email` was discovered to
be an entirely separate, pre-existing gap (see `BLOCKERS.md` §BLOCKER-001), stopped
mid-session on 2026-08-22, then approved and completed later the same day. Invoked with a
real signed-in call, `mcp__supabase__query_logs` against `function_logs` (the correct
source name — `function_edge_logs` returns nothing; discovered via `select distinct source
from logs`) shows the exact NDJSON lines this deliverable added, in order:
`function_invoked` → `invite_email_dispatched` with correct `tenant_id`/`invite_id`/
`provider`/`delivery_id` fields and no recipient email. Both halves of P6.5 are now proven
live, not just reviewed.

## P6.6 · Rate limiting & production configuration — NOT_STARTED
**Dependencies:** P6.1. Feeds P12.

## P6.7 · Permission enforcement decision — DEFERRED
**Objective:** Decide whether the 25 permission keys become the server-side enforcement layer, stay UI-only, or are removed (TD-001, TD-002, AD-016).

---

# Phase 7 — BACKEND COMPLETION GATE

**P7.1 — Backend cannot be declared complete until every line below is true and evidenced.**

| # | Criterion | Current |
|---|---|---|
| 1 | All required domain services exist (P4.1–P4.6) | ✗ |
| 2 | Migrations reproducible from the repository | ✗ BLOCKER-002 |
| 3 | RLS/security tests pass | ✓ 16/16 |
| 4 | Sync tests pass | ✓ (record path only) |
| 5 | Authorization tests pass | ✓ |
| 6 | Financial invariants pass | ✗ BLOCKER-003 |
| 7 | API/service tests pass | ✗ none exist |
| 8 | Error paths tested | ✗ |
| 9 | Documentation current | ✓ |
| 10 | No critical blockers remain | ✗ **8 open** (001, 002, 003, 004, 005, 006, 007, 009) — 008 RESOLVED 2026-08-11; 010 is scoped to P4.1b, not to this gate |
| 11 | No unresolved critical security issues | ✓ |
| 12 | Production configuration verified | ✗ P12 |

**This gate governs P12, not P8.** Frontend work does not wait for it.

---

# Phase 8 — FRONTEND START CHECKPOINT

**P8.0 — the point at which broad backend expansion pauses and frontend begins.**

Building the entire backend before any UI would mean discovering integration and
offline-model mistakes at the most expensive possible moment. The checkpoint therefore
sits on a deliberately small prerequisite set.

### Backend capabilities required before frontend starts

| Requirement | Milestone | Status |
|---|---|---|
| Authentication + session | P2.1 | COMPLETE |
| JWT active-organization claims | P2.2 | COMPLETE |
| Membership + active-org switching RPC | P2.4, P2.5 | COMPLETE |
| Organization enumeration for the switcher | P2.6 | COMPLETE |
| Role/permission read model | P2.3 | COMPLETE |
| At least one readable domain | P4.1 Catalog (**read path**) | **IMPLEMENTED** — 15/15 executed |

## ✅ P8.0 IS OPEN — 2026-08-14

**All six requirements are met.** The last one, P4.1's catalog read path, landed and was
executed live (15/15, `tests/sql/catalog_read_rls.sql`). Four domains are now readable, not
one: catalog (P4.1a), inventory (P4.2a), production (P4.3a), sales (P4.4a/b) and delivery
(P4.5).

**Backend implementation work that is genuinely unblocked is exhausted.** Every remaining
milestone is stopped on either an unmade business decision or live-database access:

| Remaining backend milestone | Stopped on |
|---|---|
| P4.1b catalog write | BLOCKER-003 (pricing), BLOCKER-010b/c |
| P4.2b inventory write | ✅ **COMPLETE** — 17/17 executed live 2026-08-15 |
| P4.3 production | types/schemas **live-verified**; the `complete_production_batch()` and `fail_production_batch()` signatures were **read live 2026-08-16** and the completion path executed once under ROLLBACK, so the write path is now startable — no decision outstanding |
| P4.4a customers | ✅ **COMPLETE** — 6/6 RLS + 12/12 structural executed live |
| P4.4b ticket read/write | creation **unblocked 2026-08-16** (012 + 015 resolved; `TKT-000001` created live). Pricing is catalog-authoritative, set by `guard_order_item_price()`. BLOCKER-009 (archive dead end) **resolved 2026-08-22** — see `BLOCKERS.md`. Remaining: BLOCKER-003 on discount/tax/rounding, and no RPC yet for `draft → submitted`/the other lifecycle hops |
| P4.5 delivery | schema live-verified; **unblocked 2026-08-16** — a ticket to hang a delivery from can now be created. All six lifecycle RPC signatures were read live |
| P5 (all financial) | BLOCKER-003 |
| P6.1 Edge Function scaffold | writable, but its only approved consumer P6.2 is blocked on BLOCKER-001 |
| P6.2 invitations | BLOCKER-001 |
| P6.4 audit coverage | needs migrations |
| P6.6 rate limiting / prod config | needs Supabase project config |
| P3.7 per-entity sync | BLOCKER-006 (BLOCKER-009 resolved 2026-08-22) |
| P0.5 migration reproducibility | BLOCKER-002 (Docker + a decision on 14 stale files) |

**Frontend work (P8.1) is therefore the next thing to build**, exactly as this phase was
designed to allow. It does not wait on any of the above.

---

**Five of six were already met before 2026-08-14.** The checkpoint opens as soon as
**P4.1's read path** lands. **P4.4 is not a prerequisite** — confirmed 2026-08-11 in resolving BLOCKER-008(a).
The full prerequisite set is therefore **P2 + P4.1**, stated identically here, in the
dependency graph above, and in P8.1 below. A catalog *list and detail* screen needs the
read path only, so P4.1b's block does not hold the checkpoint shut either.

### P8.1 · First frontend vertical slice — "Sign in → pick organization → see catalog"
**Objective:** Prove the whole spine end-to-end on a real device before broadening.
**Dependencies:** **P2 + P4.1** (read path). Not P4.4, not P7.
**Screens:** sign-in; organization switcher; catalog list; catalog detail.
**APIs/services consumed:** Supabase auth; `set_active_organization()`; `organizations_select`; catalog reads.
**Authentication flow:** encrypted session storage per AD-014 (`expo-crypto` AES-GCM + SecureStore key + `expo-file-system` blob) — **no AsyncStorage**.
**Organization switching:** calling the RPC must force a **token refresh**; `tenant_id` only changes on the new JWT. Every cached query must be invalidated on switch, or one bakery's data will render under another's name.
**Error/loading states:** offline, no-organization-selected, revoked-membership (null tenant → every policy denies), expired session.
**Testing:** component tests; an integration test proving a switch re-fetches; a manual device pass on a dev build.
**Completion gate:** a real user signs in, switches organizations, and sees only that organization's catalog.

### Backend work that continues in parallel with P8.1
P4.2 Inventory · P4.3 Production · P6.1 Edge Functions · P6.4 Audit coverage · P0.5
migration reproducibility. **Not** P5 (blocked) and **not** P3.7 (blocked).

---

# Phase 9 — Frontend/backend integration

Vertical slices. Each: **backend capability → API/service → screen → state → offline
behaviour → tests → acceptance gate.**

| ID | Slice | Backend dep | Offline behaviour | Status |
|---|---|---|---|---|
| P9.1 | Catalog browse | P4.1 | read-through cache | READY after P8.1 |
| P9.2 | Customer create/select | P4.4a | queued create | BLOCKED (P3.7) |
| P9.3 | Ticket creation (driver) | P4.4 | queued, immutable | BLOCKED (005, 006) |
| P9.4 | Inventory view & adjust | P4.2 | online-only for now — queuing needs P10 | **READ PATH COMPLETE / WRITE PATH COMPLETE 2026-08-21.** `AdjustStockAction` on each stock row calls the already-existing `adjust_stock()` RPC (P4.2b) — an absolute target, not a delta; three reasons (`adjustment`, `waste`, `opening_balance`), role-gated per reason server-side. The RPC contract itself was proven live in the P9.5 smoke work (an opening-balance call against a disposable fixture); this slice is the hook + UI wiring around it |
| P9.5 | Production batches | P4.3 | online-only for now — queuing needs P10 | **READ PATH COMPLETE 2026-08-16 / WRITE PATH COMPLETE 2026-08-21.** Detail screen shipped with transition controls, live-verified: `scheduled`'s two exits are plain PostgREST updates (`authenticated` holds `UPDATE` here, unlike `deliveries`); `in_progress`'s two exits are the SECURITY DEFINER RPCs `complete_production_batch()`/`fail_production_batch()`, which atomically write `stock_movements`. BLOCKER-017 (a raw update could reach `completed`/`failed` without the RPC) resolved 2026-08-22 with a trigger-side guard flag — see `BLOCKERS.md` |
| P9.6 | Delivery workflow | P4.5 | online-only for now — queuing needs P10 | **READ PATH COMPLETE 2026-08-17 / WRITE PATH COMPLETE 2026-08-21.** Board + detail + transitions shipped, live-verified: `transition_delivery()` and `update_delivery_details()` RPCs (no client UPDATE grant on `deliveries`, so PostgREST is not the write path). `DeliveryActions` renders the legal hops per the live trigger graph; `delivered`/`failed` gate on the CHECK-required field first. No "assign driver" control yet — needs a driver-picker read path that doesn't exist. BLOCKER-016 (`returned` writes no stock movement) closed 2026-08-22 as not-a-bug — the state machine makes it unreachable that a returned delivery's stock was ever deducted — see `BLOCKERS.md`, which also records the real defect found alongside it (`complete_ticket()`'s sale deduction had never worked) |
| P9.7 | Cash session & payments | P5.4, P5.6 | queued | BLOCKED |
| P9.8 | Reports (mobile-light) | P5.8 | online-only | BLOCKED |

**State management:** Zustand stores per `FRONTEND-STRUCTURE.md` §3 — `auth`,
`organization`, `branch`, `permissions`, `settings`, `sync`, `ui`.
**Rule:** screens never call Supabase directly — Screen → Feature Hook → Feature
Service → `packages/api`.

---

# Phase 10 — Offline / mobile completion

Decisions are recorded (AD-013, AD-014); **none are implemented.**

| ID | Milestone | Status | Notes |
|---|---|---|---|
| P10.1 | SQLCipher database | NOT_STARTED | config verified working (P0.3); no code |
| P10.2 | Per-user isolation | NOT_STARTED | one DB per authenticated user (AD-013) |
| P10.3 | Key lifecycle | NOT_STARTED | 13 scenarios documented; CSPRNG only, never derived |
| P10.4 | Logout / account switching | NOT_STARTED | retain data, close DB, release key; a different user must not decrypt |
| P10.5 | Recovery state | NOT_STARTED | never silently re-key; show pending count before any reset |
| P10.6 | Pending operations & outbox | NOT_STARTED | encrypted; immutable org/branch context |
| P10.7 | Synchronization client | BLOCKED | needs P3.7 |
| P10.8 | Conflict handling (client) | BLOCKED | needs BLOCKER-006 |
| P10.9 | Reconnect behaviour | NOT_STARTED | on-reconnect, no background task in spec |
| P10.10 | Device replacement | NOT_STARTED | unsynced work on a lost device is unrecoverable — must be stated in-product |

**Security checks:** business data never in SecureStore; auth session ≠ SQLCipher key ≠
business database; backups must not yield readable data (AD-013).

---

# Phase 11 — Full-system QA

| ID | Type | Status |
|---|---|---|
| P11.1 | CI pipeline (runs pytest + SQL suite + typecheck + lint) | **PARTIAL** — see below |
| P11.2 | Shared DB fixture library | NOT_STARTED |
| P11.3 | Unit tests (frontend) | NOT_STARTED — no runner yet |
| P11.4 | Integration tests | NOT_STARTED |
| P11.5 | API/service tests | NOT_STARTED |
| P11.6 | Database/RLS tests | COMPLETE (16 assertions) |
| P11.7 | Sync tests | COMPLETE for the record path |
| P11.8 | Security tests (cross-org, cross-branch, escalation) | COMPLETE |
| P11.9 | Offline tests | NOT_STARTED |
| P11.10 | Financial invariant tests | BLOCKED |
| P11.11 | End-to-end tests | NOT_STARTED |
| P11.12 | Performance tests | NOT_STARTED |
| P11.13 | Failure/recovery tests | NOT_STARTED |

**P11.1 is the highest-value item here** — the suites exist but nothing runs them
automatically, so a regression would go unnoticed.

### P11.1 · Lint/typecheck/spec CI gate — PARTIAL (2026-08-11)

**Delivered.** `.github/workflows/ci.yml` runs lint, typecheck and `pytest` on push to
`main` and on every pull request. Two ESLint flat configs now own disjoint paths —
`apps/mobile/eslint.config.js` for the app, a new root `bakeflow-frontend/eslint.config.js`
for `packages/*` — because flat config does not merge across directories. Both run with
`--max-warnings=0`.

**What this closed.** Before today **zero files in the repository were linted**:
`expo lint` aborted on a hard-coded `apps/mobile/components` glob that does not exist
(TD-011), and `packages/*` lay outside the only config's base path (TD-010). Both are
now RESOLVED. Coverage was verified by counting linted files, not by trusting exit 0 —
**24 files** (7 app + 17 root).

**Still open, deliberately.** The **SQL suites are not in CI** and P11.1 cannot be
COMPLETE until they are. They need a live Postgres and credentials; the repository
cannot rebuild the schema (**BLOCKER-002**), and pointing CI at production would mean
storing a privileged key in GitHub secrets. Both halves are human decisions, so they
were left undone rather than guessed. `tests/sql/*.sql` remain a manual local gate.

**Verified on GitHub 2026-08-11.** Run **31822495609** is green: `Typecheck` and `Lint`
both executed and passed on a Linux runner with `--max-warnings=0` and the npm pin intact.

Getting there took two fixes, because **every earlier run had failed at the install step,
so lint and typecheck had never once executed remotely** — the red check was never about
production code. `corepack npm ci` without a prior `corepack enable` fails on the runner,
and after enabling, `corepack enable` does not win the PATH race (bare `npm` still reports
the version Node 22.13 ships), so the pinned npm is now invoked through `corepack npm`
explicitly and asserted before install.

**Blockers:** BLOCKER-002 (for the SQL half only).
**Parallelizable:** with everything — it changes no runtime code.

---

# Phase 12 — Production readiness & Play Store release

| ID | Milestone | Status | Blocker |
|---|---|---|---|
| P12.1 | Supabase production configuration | NOT_STARTED | |
| P12.2 | Secrets management | NOT_STARTED | `SUPABASE_*` are auto-injected and must not be set |
| P12.3 | Migration deployment process | BLOCKED | BLOCKER-002 |
| P12.4 | Monitoring & logging | NOT_STARTED | |
| P12.5 | Crash/error reporting | NOT_STARTED | no Sentry package installed |
| P12.6 | Performance checks | NOT_STARTED | |
| P12.7 | EAS build configuration | BLOCKED | BLOCKER-004 (project ID) |
| P12.8 | Android production build | NOT_STARTED | needs P12.7 |
| P12.9 | Release testing on device | NOT_STARTED | |
| P12.10 | Play Store requirements | NOT_STARTED | privacy policy, data-safety form, signing |
| P12.11 | Rollout checklist | NOT_STARTED | staged rollout, rollback plan |

**P12.0 — Release gate:** requires **P7.1 fully green**, P11 green, and P12.1–P12.10
complete. No release with an open critical blocker.

---

## Validation performed on this roadmap

1. **Capability coverage** — every domain in `SCHEMA-REFERENCE.md` §1–§8 has a milestone; every `docs/` specification maps to a phase (reporting → P5.8, storage → P4/P12, notifications → P6.3, roles → P2.3, state machines → P4.4/P4.5, offline sync → P3/P10, testing strategy → P11, design tokens → P8/P9).
2. **Ordering** — ~~no milestone depends on a later one~~. **This claim was false and is
   withdrawn (2026-08-11).** One milestone genuinely does depend on a later-numbered one:
   **P3.7 depends on P4.1/P4.4**, because a sync applier cannot exist for an entity whose
   domain milestone has not been built. That is a legitimate dependency, so the correct
   fix was to state it rather than to renumber. **Phase numbers are a reading order, not
   a topological sort.** The accurate claim is: *the dependency graph is acyclic, and the
   single backward edge (P3.7 → P4.1/P4.4) is documented at both ends.* The cycle that
   previously existed — P3.7 declaring P4.1 as a prerequisite while Current State gated
   P4 behind P3.7 — is removed; see BLOCKER-008(b).
   P8 deliberately depends on a subset of P2/P4.1 rather than on P7.
3. **Frontend checkpoint** — explicit at **P8.0**, opens when P4.1 lands.
4. **Backend completion** — explicit at **P7.1**, twelve criteria.
5. **Release gate** — explicit at **P12.0**.
6. **Duplicates/contradictions** — P3.8's RLS half is complete while its UX half is
   blocked; recorded as a split rather than duplicated. P4.6 audit infrastructure vs P6.4
   coverage are distinct. ~~No contradictions found.~~ **This claim was false and is
   withdrawn (2026-08-11).** Contradictions were present in this file at the time the
   claim was written, and the validation pass did not catch them:
   - **P8.0 had two different prerequisite sets.** The graph said "P2, P4.1, P4.4"; the
     P8.0 table and P8.1 said P2 + P4.1. Resolved to **P2 + P4.1** and now stated
     identically in all three places. *(BLOCKER-008a)*
   - **P3.7 and P4 gated each other**, a true cycle in which neither could start.
     Resolved: **P4.1 is P3.7's prerequisite.** *(BLOCKER-008b)*
   - **Four P4.1/P0.5 statements contradicted the live database** — migration count
     (11 vs **17** live), `catalog.*` permission keys (**none exist**; the live keys are
     `products.manage`/`pricing.manage`), "branch scoping" (**no catalog table has
     `branch_id`**), and "touches no unresolved financial rule" (true of the read path
     only; the write path touches `product_variants.unit_price`). All four corrected in
     place against live verification.
   The honest statement is therefore: *contradictions were found and are recorded above
   with their resolutions; this section is not evidence that none remain.*
7. **New conflict identified** — see BLOCKER-007 below.
8. **How this section is to be used** — it records what was checked and what was found,
   never a clean bill of health. An item here must name its evidence or say it is
   unverified.

### Conflict found during reconciliation

**BLOCKER-007 (new)** — `docs/OFFLINE-SYNC-MODEL.md` §335 references a `sync_conflicts`
table that does not exist in the live database, and `docs/STATE-MACHINES.md` §63–70
documents two ticket defects as known-and-deferred while `docs/API-CONTRACT.md`
describes ticket RPCs as usable. These cannot both be true. Recorded rather than
resolved.

---

## Roadmap Change Log

| Date | Change | By |
|---|---|---|
| 2026-08-10 | Created as a narrow 10-item backend list (B1–B10). | setup |
| 2026-08-10 | Expanded into the master roadmap: 13 phases (P0–P12), legacy B-ID crosswalk preserved, explicit frontend checkpoint at P8.0, backend gate at P7.1, release gate at P12.0. Recorded BLOCKER-007. No status was upgraded; P3.7/P4.4 remain BLOCKED and B5/B7 ordering is unchanged. | roadmap update |
| 2026-08-11 | **Dependency + factual correction, documentation only — no code, migration, schema or database change.** Resolved **BLOCKER-008**: (a) P8.0's prerequisite set fixed to **P2 + P4.1** and now stated identically in the dependency graph, the P8.0 requirements table and P8.1 — P4.4 is *not* a frontend-checkpoint prerequisite, so BLOCKER-005 no longer appears to block the frontend start; (b) the P3.7 ↔ P4 cycle broken by recording **P4.1 as P3.7's prerequisite** and withdrawing the "P4 gated behind P3.7" note. **No status was upgraded by this change** — P3.7 remains BLOCKED on BLOCKER-005/006/009, all of which are untouched and still OPEN. The "Validation performed on this roadmap" section was corrected rather than deleted: items 2 ("no milestone depends on a later one") and 6 ("No contradictions found") were both false and are now withdrawn with the evidence stated. Four roadmap-vs-live factual errors corrected against the live database: P0.5 migration count 11 → **17**; P4.1 authorization `catalog.*` → **`products.manage`/`pricing.manage`** (AD-016: enforce nothing today); P4.1 "tenant/**branch** scoping" → **tenant-only, no catalog table has `branch_id`**; P4.1 "touches no unresolved financial rule" → **true of the read path only**. P4.1 split into **P4.1a read (IN_PROGRESS)** and **P4.1b write (BLOCKED, BLOCKER-010)**. P7.1 criterion 10 open-blocker count 6 → **8**. | BLOCKER-008 resolution |

**How to record a change here:** date, what moved and why, and whether any status
changed. Never upgrade a status in this log without linking the evidence.
