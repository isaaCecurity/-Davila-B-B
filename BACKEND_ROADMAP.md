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

## Current State

**Completed phases:** P0 (partial — see P0.5), P1, P2, P3.1–P3.6
**Active work:** P3.7 (per-entity sync application) — **BLOCKED at PLAN**
**Blocked:** P3.7, P6.2 (invitations), P5.x (financial rules), P0.5 (migration reproducibility)
**Upcoming:** P4.1 Catalog — unblocked, awaiting go-ahead

**Current recommended next task:** **P4.1 — Catalog domain** (`product_categories`,
`products`, `product_variants`). Its prerequisites (P1, P2) are verified complete, it
touches no unresolved financial rule, and it is a prerequisite for most of Phase 4.

> The human previously gated P4 behind P3.7. P3.7 is blocked on decisions
> (BLOCKER-005, BLOCKER-006), so P4.1 needs an explicit go-ahead to start.

### Legacy ID crosswalk

The earlier B-numbering is preserved so nothing is rewritten:

| Legacy | New | Status |
|---|---|---|
| B1 Database foundation | P1 | COMPLETE |
| B2 Authentication / JWT | P2.1–P2.2 | COMPLETE |
| B3 Authorization & RLS | P2.3–P2.6 | COMPLETE |
| B4 Sync gateway (record) | P3.1–P3.6 | COMPLETE |
| B5 Per-entity apply | P3.7 | BLOCKED |
| B6 Invitation delivery | P6.2 | BLOCKED |
| B7 Core domain services | P4 | READY |
| B8 Tickets / sales | P4.4 | NOT_STARTED |
| B9 Payments & cash | P5 | BLOCKED |
| B10 Financial reporting | P5.7 | BLOCKED |

---

## Dependency graph

```
P0 Foundation ─────────────────────────── COMPLETE (P0.5 BLOCKED)
      │
P1 Database foundation ────────────────── COMPLETE
      │
P2 Auth & authorization ───────────────── COMPLETE
      │
      ├── P3 Multi-org & sync ─────────── P3.1-3.6 COMPLETE / P3.7 BLOCKED
      │        │
      │        └── P3.8 pending-sync UX ── BLOCKED (needs P3.7)
      │
      ├── P4 Core domain backend ──────── READY
      │     P4.1 Catalog ──► P4.2 Inventory ──► P4.3 Production
      │            │                │
      │            └──► P4.4 Sales/Tickets ──► P4.5 Delivery
      │
      ├── P5 Financial backend ────────── BLOCKED (rules unspecified)
      │
      └── P6 Platform services ────────── P6.2 BLOCKED, rest READY
                   │
P7 BACKEND COMPLETION GATE ◄──────────────  requires P1-P6
                   │
P8 FRONTEND START CHECKPOINT ◄──────────── requires P2, P4.1, P4.4 only
                   │                        (NOT the full backend)
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

## P0.5 · Migration reproducibility — BLOCKED
**Objective:** The repository can rebuild the live schema.
**Dependencies:** P1.
**Tasks:** resolve the 14 stale unapplied migration files; materialise the 11 applied migrations as repo files.
**Deliverables:** a coherent `supabase/migrations/` set.
**Tests:** `supabase db pull` succeeds; a fresh `db reset` reproduces the live schema.
**Completion criteria:** repo and live histories agree.
**Blockers:** **BLOCKER-002.** `db pull` fails on history mismatch; `db dump` needs Docker. Do **not** run `migration repair --status applied`.
**Parallelizable:** with everything — it blocks no other milestone.

## P0.6 · Security baseline — COMPLETE
**Objective:** RLS forced everywhere; DEFINER functions hardened.
**Dependencies:** P1.
**Tests:** `assert_schema_invariants()` clean; all DEFINER functions pin `search_path`; RLS forced on every RLS-enabled table.
**Completion criteria:** met.

## P0.7 · Testing infrastructure — COMPLETE (backend) / NOT_STARTED (frontend)
**Objective:** Executable test harnesses.
**Deliverables:** `pytest` suite (12 tests); `tests/sql/security_multiorg_sync.sql` (16 assertions).
**Gap:** no frontend test runner (`jest-expo`) and no CI pipeline. → **P11.1**.

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

## P1.4 · Migration verification — BLOCKED
Same as **P0.5 / BLOCKER-002**.

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
**Dependencies:** P3.1–P3.6 (met), P4.1/P4.4 for the target entity.
**Tasks (not started):** define the applier contract per entity; implement per-entity handlers; conflict recording; revision increment; `sync_changes` emission.
**Deliverables:** none — stopped at PLAN.
**Tests:** none executed.
**Completion criteria:** every in-scope entity has a contract, an applier, and passing idempotency + authorization + conflict tests.
**Blockers:**
- **BLOCKER-005** — ticket lifecycle unreachable past `submitted`, and a submitted ticket's money is not frozen (both verified live). Remediation deferred by owner decision 2026-08-10.
- **BLOCKER-006** — no per-entity conflict strategy; `sync_conflicts` referenced by the spec does not exist; operation-type/payload contract undefined.
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

## P4.1 · Catalog — READY ◄ recommended next
**Objective:** Products, variants, categories, ingredients, recipes.
**Dependencies:** P2 (complete).
**Schema:** `product_categories`, `products`, `product_variants`, `ingredients`, `recipes`, `recipe_ingredients` — all exist.
**Business rules:** recipe is the BOM linking a variant to ingredients; variant pricing feeds `guard_order_item_price`.
**Service layer:** CRUD RPCs with tenant/branch scoping.
**Authorization:** `catalog.*` permission keys; owner/admin/branch_manager write, others read.
**Validation:** Zod schemas mirroring DB constraints (`packages/validation`).
**Tests:** RLS isolation; recipe→variant integrity; soft-delete behaviour.
**Sync support:** blocked by P3.7 — catalog is read-mostly offline, so this is acceptable.
**Audit:** `audit_log` entries on write.
**Completion gate:** CRUD + RLS tests pass; no cross-organization read.
**Blockers:** none.
**Parallelizable:** with P6.1, P6.3.

## P4.2 · Inventory — NOT_STARTED
**Objective:** Warehouses and the immutable stock ledger.
**Dependencies:** P4.1.
**Schema:** `warehouses`, `stock_movements`, `ingredient_stock_levels`, `product_stock_levels`.
**Business rules:** **stock levels are never updated directly** — all changes are inserts into `stock_movements`, with levels maintained by trigger (`apply_stock_movement`).
**Tests:** ledger immutability; trigger-maintained levels; negative-stock policy.
**Security checks:** no direct UPDATE path to level tables.
**Completion gate:** ledger invariant proven by test.
**Blockers:** none known. Negative-stock policy may become one if unspecified.

## P4.3 · Production — NOT_STARTED
**Dependencies:** P4.1, P4.2.
**Schema:** `production_batches`, `production_batch_ingredients`.
**Business rules:** `guard_production_batch_transition()`; completing a batch consumes ingredients and produces finished goods via the stock ledger.
**Tests:** state-machine transitions; ingredient consumption correctness.
**Completion gate:** batch completion moves stock atomically.

## P4.4 · Sales / Tickets — BLOCKED
**Dependencies:** P4.1.
**Schema:** `customers`, `tickets`, `ticket_items`.
**Business rules:** 8-state lifecycle; ticket immutable once submitted; corrections via `correction_of_ticket_id`, never edits.
**Blockers:** **BLOCKER-005** — `confirmed`…`completed` are unreachable and submitted-ticket money is not frozen. Any ticket service built now would be built on a broken lifecycle.
**Note:** `customers` alone is *not* blocked and may be split out as **P4.4a** if a customer-only milestone is wanted (drivers create customers offline per clarification §11).

## P4.5 · Delivery — NOT_STARTED
**Dependencies:** P4.4.
**Schema:** `deliveries`.
**Business rules:** `guard_delivery_transition()`; `ready → delivered` on the parent ticket hard-requires a verified `deliveries` row.
**Completion gate:** delivery gate enforced in DB, not convention.

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

## P6.1 · Edge Function scaffold — READY
**Objective:** The first deployable function with a hardened pattern.
**Dependencies:** P2.
**Deliverables:** `supabase/functions/` (currently only `import_map.json`).
**Security checks:** service-role key never reaches the client; every function re-implements tenant scoping in code because **RLS does not protect a service-role caller** (`API-CONTRACT.md` §165).
**Blockers:** none.

## P6.2 · Email & invitation delivery — BLOCKED
**Dependencies:** P6.1, P2.7.
**Blockers:** **BLOCKER-001** — no provider approved, no function deployed. Minting a token is not delivering an invitation.

## P6.3 · Notifications — DEFERRED
**Blockers:** no notification tables, no push-token column on `sync_devices`, no `pg_cron`/`pg_net`; two overlapping specs with no precedence rule (TD-008).

## P6.4 · Audit logging coverage — NOT_STARTED
**Dependencies:** P4.
**Objective:** Every significant business event auditable — who, what, when.

## P6.5 · Error handling & observability — NOT_STARTED
**Dependencies:** P6.1.
**Deliverables:** normalized error codes per `API-CONTRACT.md`; structured logs.

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
| 10 | No critical blockers remain | ✗ 6 open |
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
| At least one readable domain | P4.1 Catalog | READY |

**Five of six are already met.** The checkpoint opens as soon as **P4.1** lands.

### P8.1 · First frontend vertical slice — "Sign in → pick organization → see catalog"
**Objective:** Prove the whole spine end-to-end on a real device before broadening.
**Dependencies:** P2, P4.1.
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
| P9.4 | Inventory view & adjust | P4.2 | queued movement | NOT_STARTED |
| P9.5 | Production batches | P4.3 | online-first | NOT_STARTED |
| P9.6 | Delivery workflow | P4.5 | queued transitions | NOT_STARTED |
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
| P11.1 | CI pipeline (runs pytest + SQL suite + typecheck + lint) | NOT_STARTED |
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
2. **Ordering** — no milestone depends on a later one. P8 deliberately depends on a subset of P2/P4.1 rather than on P7.
3. **Frontend checkpoint** — explicit at **P8.0**, opens when P4.1 lands.
4. **Backend completion** — explicit at **P7.1**, twelve criteria.
5. **Release gate** — explicit at **P12.0**.
6. **Duplicates/contradictions** — P3.8's RLS half is complete while its UX half is blocked; recorded as a split rather than duplicated. P4.6 audit infrastructure vs P6.4 coverage are distinct. No contradictions found.
7. **New conflict identified** — see BLOCKER-007 below.

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

**How to record a change here:** date, what moved and why, and whether any status
changed. Never upgrade a status in this log without linking the evidence.
