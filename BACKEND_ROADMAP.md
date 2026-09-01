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

## Current State — updated 2026-08-24

**Completed phases:** P0 (P0.7's frontend testing infrastructure delivered 2026-08-28 —
see P11.3; P0.5, the piece this line used to point at earlier, is itself now COMPLETE),
P1, P2, P3.1–P3.6, P3.10.

**Read paths, per domain:** P4.1a catalog COMPLETE; P4.2a inventory COMPLETE; P4.3
production and P4.4a/b sales and P4.5 delivery all **COMPLETE**, every one now backed by
an executed SQL suite (`inventory_read_rls.sql` 2026-08-15, production live-verified
2026-08-16, `sales_read_rls.sql` 27/27 2026-08-23, `delivery_read_rls.sql` 11/11
2026-08-23).

**Write paths are no longer uniformly blocked** — this line originally said "every write
path is BLOCKED"; that stopped being true over the following week without this section
being updated. As of this pass:
- P4.1b catalog write: **BLOCKED** — BLOCKER-010(c); pricing policy is resolved by AD-017.
- P4.2b inventory write: **COMPLETE** (2026-08-15).
- P4.3 production write: **COMPLETE** (2026-08-21) — `complete_production_batch()`/
  `fail_production_batch()` live-verified; the milestone's own section previously still read
  NOT_STARTED against this, reconciled 2026-08-23.
- P4.4 ticket write: **RPCs COMPLETE**, live-verified 2026-08-22 — all ten lifecycle
  transitions are reachable (`confirm_ticket`/`cancel_ticket`/`complete_ticket`/
  `archive_ticket`/`update_ticket`). Tax and discounts are deferred by AD-017; there is
  no dedicated write-path SQL test suite yet.
- P4.5 delivery write: **COMPLETE** (2026-08-21) — `transition_delivery()`/
  `update_delivery_details()` live-verified; the milestone's own section previously still
  read BLOCKED against this, reconciled 2026-08-23.
- P5 (financial, MVP slice): **COMPLETE and live-verified 2026-08-24** — invoices,
  payments, cash sessions/expenses, and daily financial audits (P5.3/P5.4/P5.6/P5.7) all
  proven live by the new `tests/sql/financial_write_rls.sql` (28/28), after finding and
  fixing four real defects the schema/RPCs had carried since before this session
  (overpayment and `credit`-method gaps in `record_payment()`, a non-cash-expense gap in
  `guard_expense_cash_session()`, and an unneeded direct-write grant on `cash_sessions`).
  Refunds (P5.5) are RPC-complete and tested but deferred from the MVP product surface by
  AD-017. Tax/discounts (P5.1/P5.2) remain deferred by the same decision; the
  price-history mechanism for non-discount pricing is still open (BLOCKER-010b/c).
  Reporting (P5.8) not audited this pass.
- P6 platform services: P6.1, P6.2, P6.4, P6.5, **P6.6 COMPLETE** (rate limiting,
  2026-08-22). P6.3, P6.7 DEFERRED.

**Frontend (P8.1 + P9.1/P9.4/P9.5/P9.6): COMPLETE, re-verified live 2026-08-24.** This
line previously did not exist here; `CLAUDE.md` separately claimed "no app code exists
yet", which was wrong and has been corrected in the same pass. Sign in → pick
organization → catalog (P8.1) plus catalog detail, inventory, production, and delivery
(P9.1/P9.4/P9.5/P9.6) are implemented and gated. Fresh evidence today: `typecheck`,
`eslint packages`, `lint --workspace apps/mobile` all exit 0; `npm run verify:cache`
67/67; `node scripts/smoke-signed-in.mjs` 112/112 against the live project — the
strongest verification available without a physical device/emulator, which this
environment does not have. Full detail: P8.1 section under Phase 8.

**Open blockers requiring a human decision, as of 2026-08-28:** BLOCKER-010(c) (catalog
write mechanism confirmation) and BLOCKER-018 (ingredient cost capture workflow, gating
COGS/gross-profit reporting only — revenue/cash reporting already shipped in P9.8).
BLOCKER-006 (per-entity sync conflict strategy, was gating P3.7) is now **RESOLVED** —
see AD-021. Every other blocker previously summarized on this page —
BLOCKER-001, 002, 003, 004, 005, 006, 007, 008, 009, 011, 012, 013, 014, 015, 016, 017,
019, 020, 021 — is **RESOLVED**; see `BLOCKERS.md` for the evidence behind each.

**✅ P8.0 is CLOSED — P8.1 was delivered 2026-08-15 and re-verified live 2026-08-24.**
This line previously read "P8.0 remains open... P8.1 was and is available to start",
which had been stale for over a week: the first frontend vertical slice (sign in → pick
organization → catalog) shipped 2026-08-15, and the mobile app has since grown well past
it into the P9.1/P9.4/P9.5/P9.6 slices (catalog detail, inventory, production, delivery),
all substantially built and live-verified. Re-verified fresh 2026-08-24: `typecheck`,
`eslint packages`, `lint --workspace apps/mobile` all exit 0; `npm run verify:cache`
67/67; `node scripts/smoke-signed-in.mjs` **112/112 passed** against the real project,
covering sign-in, tenant-claim derivation from the live JWT hook, organization switching
with a forced token refresh, and cross-organization cache/data isolation end-to-end. See
the P8.1 section below and `CURRENT_TASK.md` for the full evidence trail. This line's
"no further backend milestone can start" framing was already withdrawn in an earlier
pass and remains withdrawn.

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
| B5 Per-entity apply | P3.7 | PARTIAL — tickets slice IMPLEMENTED 2026-08-28, protocol layer hardened 2026-08-29, customer slice IMPLEMENTED 2026-08-29 (BLOCKER-006 resolved via AD-021), inventory.adjust/.waste + production.start/.cancel + payment.create/.reverse + expense.create IMPLEMENTED 2026-08-30, production.record_output/.record_waste IMPLEMENTED 2026-08-31; inventory.receive/.transfer/.consume + production.complete decided OUT OF MVP SCOPE 2026-08-31 and removed from the allowlist (BLOCKER-026/027 RESOLVED); expense.reverse (BLOCKER-028) is the only remaining deliberately-unbuilt item |
| B6 Invitation delivery | P6.2 | COMPLETE (verified live 2026-08-22) |
| B7 Core domain services | P4 | P4.1a COMPLETE / P4.1b BLOCKED (BLOCKER-010b,c) |
| B8 Tickets / sales | P4.4 | READ PATH COMPLETE / WRITE PATH RPCs COMPLETE |
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
      │            └──► P3 Multi-org & sync ── P3.1-3.6 COMPLETE / P3.7 PARTIAL (tickets slice done)
      │                       │                 (BLOCKER-006 resolved via AD-021; other entities not started)
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
**Blockers:** none. EAS project ID configured and linked 2026-08-24; native build work
may proceed.

## P0.4 · Architectural decisions — COMPLETE
**Objective:** Locked decisions recorded with evidence.
**Dependencies:** none.
**Deliverables:** `ARCHITECTURE_DECISIONS.md` (AD-001…AD-016).
**Completion criteria:** met.

## P0.5 · Migration reproducibility — COMPLETE (2026-08-20, falsely; REOPENED and genuinely RESOLVED 2026-08-31)
**Objective:** The repository can rebuild the live schema.
**Dependencies:** P1.
**Deliverables:** `supabase/migrations/20260809_live_schema.sql` — regenerated 2026-08-31 via live
catalog introspection after the 2026-08-20 version was found to be false (23 of 40 tables, zero
RLS/functions/triggers, undetected for ~3 weeks). The new version was independently re-verified
name-for-name against the live database (40/40 tables, 58/58 triggers, 97/97 functions, 108/108
policies, zero discrepancies) rather than merely regenerated and trusted. `MIGRATION_GOVERNANCE.md`
rewritten to match and to add a maintenance rule (regenerate after schema changes; never restate
a coverage count without verifying it that session) so this doesn't drift silently again.
**Completion criteria:** met — see `BLOCKERS.md` BLOCKER-002 (RESOLVED 2026-08-31) for full
evidence. Do not trust the 2026-08-20 date alone as evidence of anything; that version's claims
were checked and found false.

## P0.6 · Security baseline — COMPLETE
**Objective:** RLS forced everywhere; DEFINER functions hardened.
**Dependencies:** P1.
**Tests:** `assert_schema_invariants()` clean; all DEFINER functions pin `search_path`; RLS forced on every RLS-enabled table.
**Completion criteria:** met.

## P0.7 · Testing infrastructure — COMPLETE (backend and frontend)
**Objective:** Executable test harnesses.
**Deliverables:** `pytest` suite (12 tests); `tests/sql/security_multiorg_sync.sql` (16 assertions); frontend `jest-expo` runner, delivered 2026-08-28 — see **P11.3**.
**Gap:** `.github/workflows/ci.yml` now has a lint/typecheck/`npm test`/pytest gate,
including the new "Unit tests" step added 2026-08-28 — but per P11.1, this workflow's
actual execution on GitHub (as opposed to the equivalent commands run locally) remains
unproven. The SQL suites still have no CI path at all — BLOCKER-002 (the schema-
reproducibility half of the reason) is now RESOLVED (2026-08-31), but a separate,
still-open decision remains (would CI build a throwaway Postgres, or point at
production with a secrets-stored key?) — see the workflow file's own header.

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

## P3.7 · Per-entity sync application — **PARTIAL: tickets + customer slices, plus protocol layer, IMPLEMENTED; inventory.adjust/.waste + production.start/.cancel + payment.create/.reverse + expense.create IMPLEMENTED 2026-08-30; production.record_output/.record_waste IMPLEMENTED 2026-08-31; inventory.receive/.transfer/.consume + production.complete decided OUT OF MVP SCOPE 2026-08-31 (removed from the domain_operation allowlist); expense.reverse remains the only deliberately-unbuilt item** *(formerly B5)*
**Objective:** Apply recorded operations to business tables, per entity, with explicit conflict semantics.
**Dependencies:** P3.1–P3.6 (met), **P4.1** and/or **P4.4** for the target entity —
P3.7 is *downstream* of those milestones, never upstream of them (BLOCKER-008b,
resolved 2026-08-11). The former "P4 is gated behind P3.7" note is withdrawn.
**Tasks:** ~~define the applier contract per entity~~ (AD-021); ~~implement handler dispatch~~;
tickets: ~~`ticket.create`~~, ~~`ticket.item_update`~~ done; customers: ~~`customer.create`~~,
~~`customer.update`~~ done (2026-08-29), `customer.soft_delete` deliberately not started (not
in `domain_operation`'s CHECK allowlist); inventory/production/financial handlers not
started; `sync_changes` emission and revision increment done for tickets and customers;
the pull RPC (`sync_pull`) is generic, done for all entities.
**Deliverables (2026-08-28, tickets slice):** `sync_conflicts` table + RLS; `domain_operation`
columns; `apply_sync_operation()` dispatcher; `apply_ticket_create()`/`apply_ticket_item_update()`;
`has_role_in()`; `bump_ticket_revision()`; `sync_pull()`. See AD-021 and
`IMPLEMENTATION_LOG.md` 2026-08-28 for the full build record, including two real defects
found and fixed as prerequisites (`ticket_items.line_total` is `GENERATED ALWAYS`;
`guard_driver_created_order_assignment()`'s active-org-scoped role check).
**Deliverables (2026-08-29, protocol-correctness pass):** fixed a real bug where the batch
response reported the operation's pre-dispatch status (`PENDING`/`CONFLICT`) instead of its
actual post-dispatch outcome — a client could never learn `APPLIED`/`REJECTED` from the
synchronous response at all; widened the replay/idempotency immutable-context comparison to
include `payload`, `base_revision`, `branch_id`, `entity_type`, `domain_operation` (previously
a same-`operation_id` replay with a *different* payload was silently accepted as identical);
rejected malformed (non-object) payloads at the gateway boundary; added a diagnostic-only
`client_sequence` column (OFFLINE-SYNC-MODEL.md §16: informational, never enforced —
inventing gap/ordering rejection would have broken legitimate offline retries); added
`sync_pull()` cursor validation (negative → rejected, ahead-of-server →
`full_resync_required:true`, never a silently-incomplete page); found and fixed a real
security defect (`apply_ticket_create`/`apply_ticket_item_update` were directly callable via
PostgREST, the former even by `anon`, since they re-derive authorization from a caller-supplied
`actor_id`/`tenant_id` and were only meant to be reachable through the dispatch trigger — see
`p3_7_revoke_public_execute_on_internal_sync_handlers`). Tenant-bound idempotency and the
`operation_type`/`domain_operation` compatibility contract were both confirmed already correct,
not rebuilt. Full detail: AD-021 and `IMPLEMENTATION_LOG.md` 2026-08-29.
**Deliverables (2026-08-29, later same day — customer slice):** `apply_customer_create()`/
`apply_customer_update()`, dispatched from the same `apply_sync_operation()`, same
`REVOKE`-from-`anon`/`authenticated` security pattern as the protocol pass. Role eligibility
(owner/admin/branch_manager/supervisor/cashier/driver) resolved a live discrepancy between
`customers_insert`/`customers_update` RLS (stale, excludes driver/supervisor) and
`docs/ROLES-AND-PERMISSIONS.md`'s live `role_permissions` grants plus ADR-001 (both agree
driver-created customers are required) — handlers follow the permissions catalog/ADR, RLS
left as-is (out of scope, doesn't affect the SECURITY DEFINER handler). `customer.update` is
a full-value replacement (no field-level merge, per OFFLINE-SYNC-MODEL.md). Revision tracked
purely via `sync_changes.revision` keyed by `entity_id` — no new column on `customers`
itself. Full detail: AD-021 and `IMPLEMENTATION_LOG.md` 2026-08-29.
**Deliverables (2026-08-29, later still — `customer.update` role scope decided,
BLOCKER-024 resolved):** the product owner was asked directly whether `customer.update`
should be ownership-scoped like `apply_ticket_item_update`, and answered with a role-based
restriction instead, narrower than `customer.create`: owner/admin/branch_manager always;
supervisor only while holding the supervisor role in that tenant; driver and cashier
excluded from `customer.update` entirely (both keep `customer.create`). Implemented:
`apply_customer_update`'s role array changed to `['owner','admin','branch_manager',
'supervisor']`. A further per-supervisor, manager-configurable toggle was requested but has
no backing schema anywhere in this codebase (see `docs/ROLES-AND-PERMISSIONS.md`, which
documents the identical gap as not built) — opened as new **BLOCKER-025** rather than
invented.
**Deliverables (2026-08-30, INVENTORY slice — partial, by finding, not by instruction):**
`apply_inventory_adjust()`/`apply_inventory_waste()`, dispatched from the same
`apply_sync_operation()`, same `REVOKE`-from-`anon`/`authenticated` pattern. Role gates and
the two reasons they write (`'adjustment'`, `'waste'`) mirror the live `adjust_stock()` RPC
verbatim — an existing, human-approved rule, not invented. Unlike `adjust_stock()`'s
absolute-target shape, both handlers take an explicit `quantity_delta` directly (AD-021's
own "append-only, never a synchronized absolute quantity" framing) and reject only when
applying it would drive on-hand negative — AD-021's own named example of a rejection.
`inventory.receive`/`.consume`/`.transfer` were investigated live and found to have no clean
precedent to mirror (unlike adjust/waste) — each ties into a real, undecided business/
architecture question (purchase-cost capture already tracked as BLOCKER-018; a
non-trip-linked manual warehouse transfer's authorization; whether a standalone "consume"
op is even needed alongside adjust/waste) — opened as new, non-blocking **BLOCKER-026**
rather than guessed at. All three remain allowlisted in `domain_operation`'s CHECK and are
correctly `REJECTED unsupported_operation_type` by the existing dispatcher fallback.
**Deliverables (2026-08-30, later same day — PRODUCTION slice, partial):**
`apply_production_start()`/`apply_production_cancel()`, dispatched from the same
`apply_sync_operation()`. Both perform a plain guard-validated `UPDATE` on
`production_batches.status` (`scheduled`→`in_progress`/`cancelled`), with an explicit
`has_role_in()` pre-check mirroring `guard_production_batch_transition()`'s own actor lists
verbatim (`in_progress`: owner/admin/branch_manager/baker; `cancelled`: owner/admin/
branch_manager, no baker). **A real, pre-existing defect was found and fixed as a
prerequisite:** the guard trigger's own role check used the session JWT's role claim
(reflecting the session's *active* org), not the row's own `tenant_id` — the same
active-org-assumption bug class AD-006 already fixed elsewhere, live-reproduced (a session
active in org B could flip an org A batch with zero role in org A) before fixing via
`has_role_in(auth.uid(), new.tenant_id, actors)`. `production.complete`/`.record_output`/
`.record_waste` were investigated and NOT built — AD-021 names all five production
operations in one line but never specifies `.record_output`/`.record_waste`'s relationship
to the existing `complete_production_batch()`/`fail_production_batch()` RPCs, and those two
RPCs were found to share the same active-org-assumption defect class (via
`current_tenant_id()`) on a bigger, untested surface — opened new, non-blocking
**BLOCKER-027** rather than guessed at.
**Deliverables (2026-08-30, later same day — FINANCIAL slice, partial):**
`apply_payment_create()`/`apply_payment_reverse()`, dispatched from the same
`apply_sync_operation()`, mirror the live `record_payment()`/`record_refund()` RPCs' business
logic in full (including the AD-018 driver-trip cash-custody branch and the cash-till-session
branch) but authorize via tenant-scoped `has_role_in()` rather than those RPCs' own
session-based `has_role()`/`has_branch_access()` — the same AD-006 gap already fixed elsewhere
this session. Role lists mirror the RPCs' own arrays verbatim (no `financial.payment.*`
permissions-catalog key exists to defer to, unlike `customer.create`). Existing triggers
(`guard_payment_relationships`, `apply_payment_to_ticket`, `guard_refund_total`) — already
tenant-correct, keyed off `NEW.tenant_id` — do the branch/overpayment/invoice/session
validation and `tickets.amount_paid`/`invoices.status` derivation automatically.
`apply_expense_create()` has no RPC precedent; mirrors the live `expenses_insert` RLS role
array (owner/admin/branch_manager/cashier/accountant), which disagrees with the
`role_permissions` catalog's `financial.expense.create` grants on both `cashier` and
`supervisor` — logged as an unresolved discrepancy (`IMPLEMENTATION_LOG.md` 2026-08-30), not
invented around. `expense.reverse` was investigated and NOT built — no reversal RPC, table, or
trigger exists anywhere in the live schema for expenses, and the live `expenses_update` RLS
policy's direct-edit path actively contradicts AD-021's append-only-plus-reversal model for
this entity — opened new, non-blocking **BLOCKER-028** rather than guessed at.
**Tests:** `tests/sql/p3_7_sync_apply_and_pull.sql` — 11/11, live, re-run clean (zero
regression). `tests/sql/p3_7_protocol_correctness.sql` — 17/17, live, re-run clean (header
previously said 18/18, a pre-existing miscount corrected the same pass this was noticed).
`tests/sql/p3_7_customer_sync.sql` — 21/21, live (grew from 18 after the role-scope
decision: driver-only/cashier-only now proven `REJECTED`, branch_manager-only/
supervisor-only proven `APPLIED`); re-run clean again 2026-08-30 after the inventory AND
production dispatcher changes (zero regression each time). `tests/sql/p3_7_inventory_sync.sql`
— new, 14/14, live (covers `inventory.adjust`/`.waste`, negative-stock rejection,
cross-tenant/cross-branch denial, replay idempotency, and confirms `.receive`/`.consume`/
`.transfer` still correctly fall through to `unsupported_operation_type`).
`tests/sql/p3_7_production_sync.sql` — 13/13 as originally run 2026-08-30 (covers
`production.start`/`.cancel`, role gates matching the fixed guard trigger,
invalid-transition/not-found rejection, cross-tenant denial, replay idempotency); **re-run
2026-08-31, 12/12 — its own P11 assertion (which tested `production.complete`'s old
dispatcher-rejected behavior) is now stale after the allowlist tightening below and was
commented out in place, pointing to the new file, rather than deleted or left silently
wrong.** `tests/sql/p3_7_financial_sync.sql` — new, 27/27,
live (covers `payment.create`/`.reverse`/`expense.create`'s full payload validation, the
driver-trip custody path, the cash-session path, overpayment/over-refund rejection,
cancelled-ticket rejection, role gating for all three operations, cross-tenant denial, replay
idempotency, and confirms `expense.reverse` still correctly falls through to
`unsupported_operation_type`). **`tests/sql/p3_7_production_output_waste_sync.sql`** — new,
2026-08-31, 20/20 live (16 original + S3–S6 added same day; covers `production.record_output`/
`.record_waste` happy paths with exact stock-movement counts, role gating, payload validation,
not-found, branch-mismatch, cross-tenant denial, replay idempotency, EXECUTE-grant checks for
the sync handlers AND the underlying tenant-scoped RPC overloads, and the four now-dropped
`domain_operation` values each correctly aborting the whole batch call with a `23514`
check_violation). **A same-day self-review (requested by the user) found and fixed a real
vulnerability this pass introduced: adding `p_tenant_id` to `complete_production_batch()`/
`fail_production_batch()` created a new function overload left `anon`-executable by default,
letting an unauthenticated caller complete/fail any tenant's production batch — confirmed
unexploited (zero rows touched in the window), fixed same day via `REVOKE`, re-verified.** See
`IMPLEMENTATION_LOG.md` 2026-08-31 "SECURITY FIX" entry. Re-verified with zero regression:
`tests/sql/security_multiorg_sync.sql` (22/23 — one pre-existing, unrelated
`rate_limit_events` RLS gap), `tests/sql/driver_trips_rls.sql` (20/20),
`tests/sql/financial_write_rls.sql` (28/28), `tests/sql/driver_field_sale_rls.sql` (8/8), the
online `complete_production_batch()` happy path (re-tested live end to end after the guard
trigger fix), `tests/sql/p3_7_customer_sync.sql` (quick-check re-run after the financial
dispatcher change, including its D1 `domain_operation` CHECK constraint guard), and a
standalone `customer.create` dispatcher smoke check after the 2026-08-31 `apply_sync_operation()`
rewrite. `get_advisors(security)` clean for every new handler across all passes. Also clean:
`pytest` (12/12).
**Completion criteria:** every in-scope entity has a contract, an applier, and passing
idempotency + authorization + conflict tests. **Tickets and customers both meet this, and the
shared protocol layer (idempotency, payload immutability, response-status correctness,
cursor validation) is hardened for whichever entity comes next. Inventory, production, and
financial now meet this for their in-scope operations** (inventory: `adjust`/`waste` built
and tested; `receive`/`transfer`/`consume` decided OUT OF MVP SCOPE 2026-08-31 and removed
from the allowlist, `BLOCKER-026` RESOLVED; production: `start`/`cancel`/`record_output`/
`record_waste` all built and tested, `complete` decided redundant and removed from the
allowlist, `BLOCKER-027` RESOLVED; financial: `payment.create`/`.reverse`/`expense.create`
built and tested, `expense.reverse` reconsidered 2026-08-31 and explicitly re-deferred — the
only remaining genuinely-undecided item, `BLOCKER-028` still OPEN). `customer.soft_delete` is
deliberately not allowlisted at all yet (see `docs/SCHEMA-REFERENCE.md` §12). **P3.7's
`domain_operation` allowlist is now fully covered except `expense.reverse`.**
**Blockers:**
- ~~**BLOCKER-005**~~ — **RESOLVED 2026-08-14.** `prevent_submitted_ticket_update()` was
  dropped; every ticket status is now reachable and `subtotal_amount` is frozen once a
  ticket leaves `draft`. This line was still listing it as an open blocker eight days after
  resolution — corrected here while auditing BLOCKER-009 in the same neighborhood.
- ~~**BLOCKER-006**~~ — **RESOLVED 2026-08-28.** Per-entity conflict strategy decided,
  `sync_conflicts` confirmed as a server table, `operation_type` allowlist contract set —
  see **AD-021**. **No blocker remains for P3.7.**
**Remaining, not a blocker — implementation work:** `expense.reverse` (BLOCKER-028, the only
remaining genuinely-undecided business rule — reconsidered and explicitly re-deferred
2026-08-31, not resolved); `customer.soft_delete` (not yet allowlisted); `ALREADY_APPLIED` as a status value
was deliberately NOT added (see AD-021 — `status` + `replayed` already give full
distinguishability); tombstone retention / true cursor-expiry-via-purge (no retention
mechanism exists at all yet — see BLOCKERS.md); `depends_on_operation_id` enforcement
(existing per-handler existence checks already give correct safety for the realistic case —
its own motivating example, customer-then-ticket, was tested via two sequential
`process_sync_batch()` calls; blocking/queuing semantics for a single atomic batch are
unspecified and need a fresh architecture decision if ever required — see BLOCKERS.md);
per-supervisor manager-configurable permission overrides (BLOCKER-025, non-blocking, opened
by the resolved `customer.update` role-scope decision — BLOCKER-024).
**Parallelizable:** P4.1, P4.2, P6 can all proceed independently of this.

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
**Blockers:** **BLOCKER-010** — one unresolved sub-decision:
(a) does soft-delete free a natural key? The unique indexes `products_tenant_name_key`,
`ingredients_tenant_name_key`, `product_categories_tenant_name_key`,
`product_variants_tenant_sku_key` and `recipes_one_active_per_variant` are **not partial
on `deleted_at IS NULL`** (verified live), so under AD-012 a soft-deleted name is
permanently consumed — fixing it is a migration and needs approval;
(b) may `unit_price` be edited in place with no price-history table (**resolved by AD-017**);
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

## P4.3 · Production — COMPLETE (read + write)
**Dependencies:** P4.1, P4.2.
**Schema:** `production_batches`, `production_batch_ingredients`.
**Business rules:** `guard_production_batch_transition()`; completing a batch consumes ingredients and produces finished goods via the stock ledger.
**Tests:** state-machine transitions; ingredient consumption correctness.
**Completion gate:** batch completion moves stock atomically.

**Reconciled 2026-08-23** — this section had read "NOT_STARTED" long after the work
actually shipped, contradicted by the P9.5 row below it in this same file. Corrected against
that row rather than re-verified independently, since P9.5 already carries live evidence:

- **Read path COMPLETE 2026-08-16.** `packages/types/production.ts`,
  `packages/validation/production.ts`, `packages/api/queries/production.ts`.
- **Write path COMPLETE 2026-08-21.** `scheduled`'s two exits (`in_progress`, `cancelled`)
  are plain PostgREST updates — `authenticated` holds `UPDATE` on `production_batches`,
  unlike `deliveries`. `in_progress`'s two exits are the SECURITY DEFINER RPCs
  `complete_production_batch()`/`fail_production_batch()`, which atomically write
  `stock_movements` alongside the status change — the actual mechanism satisfying this
  section's own completion gate.
- **BLOCKER-017 resolved 2026-08-22.** A raw UPDATE could reach `completed`/`failed`
  without going through either RPC, silently skipping the stock-movement write. Fixed by
  migration `fix_complete_ticket_reference_type_and_guard_batch_rpc_only`; the bypass is now
  a permanent regression check in `scripts/smoke-signed-in.mjs`, not just a one-time fix.

## P4.4 · Sales / Tickets — COMPLETE (read path) / write path RPCs COMPLETE, no write-path test suite
**Dependencies:** P4.1.
**Schema:** `customers`, `tickets`, `ticket_items`.
**Business rules:** 10-state lifecycle; ticket money frozen once it leaves `draft`; corrections via `correction_of_ticket_id`, never edits.

**Unblocked 2026-08-14.** BLOCKER-005 is **RESOLVED** — `prevent_submitted_ticket_update()` was dropped, every status is reachable, and `guard_ticket_status_transition()` now freezes `subtotal_amount`. The read path's premise is therefore sound and P4.4a/P4.4b were implemented in one milestone: `packages/types/sales.ts`, `packages/validation/sales.ts`, `packages/api/queries/sales.ts`, nine read functions, zero migrations.

**`tests/sql/sales_read_rls.sql` (S1–S18) executed live 2026-08-23 — 27/27 passed. P4.4a/b is COMPLETE.** Its own header previously claimed "EXECUTED 2026-08-15", which was wrong: that date's run (`IMPLEMENTATION_LOG.md`) covered only a partial, differently-labeled subset of an earlier version of this file (structural + customers-only RLS), never the S13–S18 ticket/ticket_items assertions or the S9–S11 lifecycle checks. Running the suite as actually committed surfaced two things, both fixed the same pass:

- **A fixture bug**, not a product defect: the org-B ticket's `created_by` (profile `...0002`) had no `user_roles` row scoped to org B, and `guard_order_actor_and_assignment()` correctly rejected the INSERT. Fixed by adding that membership row — the system supports multi-org profiles by design.
- **A real product defect, S10 caught it**: `tickets_guard_status_transition` was defined `BEFORE UPDATE OF status` only, so an UPDATE touching `subtotal_amount` without also including `status` in its SET list never invoked the trigger at all — silently bypassing the money-freeze logic the trigger's own body already implemented and documented ("Once a ticket leaves draft, subtotal_amount... must not change"). Not currently reachable by any authenticated/anon path — `authenticated` holds no UPDATE grant on `tickets`, and `update_ticket()`, the only writer, always includes `status` in its SET clause — but a latent gap against any future or service-role write path. Fixed live via migration `widen_tickets_guard_status_transition_to_cover_subtotal_amount` (2026-08-23): trigger now fires on `UPDATE OF status, subtotal_amount`. Re-verified: a direct `subtotal_amount`-only UPDATE is now correctly refused, and a negative control (an unrelated column UPDATE) confirms the trigger isn't over-firing.

**Write path — all nine lifecycle RPCs now exist, are role-correct, and are proven live, as of 2026-08-22.** Re-verified live while auditing this milestone for staleness (the same pass that closed BLOCKER-001 and BLOCKER-009), finding the roadmap badly out of date on this axis — not just BLOCKER-009, but the RPC inventory itself:

- **BLOCKER-009 resolved**: `cancelled → archived` is a live-permitted transition (`guard_ticket_status_transition()`, read from `pg_proc`) as a side effect of BLOCKER-005's 2026-08-14 fix, and the real working terminal-disposition path — `archive_ticket()`'s metadata fields, independent of `status` entirely — was already proven live during P6.4. See `BLOCKERS.md` §BLOCKER-009 and `TECHNICAL_DEBT.md` TD-016 for the (harmless, dead-code) nuance this surfaced.
- **"No RPC exists for `draft → submitted` and the other hops" was itself stale.** `pg_proc` shows `cancel_ticket`, `complete_ticket`, `confirm_ticket`, `archive_ticket`, and `update_ticket` all already live. `update_ticket(p_status := ...)` is the confirmed, working path for the five hops with no dedicated RPC (`draft→submitted`, `confirmed→scheduled`, `scheduled→in_production`, `in_production→ready`, `ready→delivered`) — `API-CONTRACT.md` and `STATE-MACHINES.md` both already suspected this ("the de facto path... worth resolving explicitly") but it was never confirmed live or corrected.
- **A real defect found and fixed doing that confirmation**: `update_ticket()` carried its own role gate — only `owner/admin/branch_manager`/`cashier` could call it, and cashiers were blocked from touching `p_status` at all — that silently contradicted `guard_ticket_status_transition()`'s actual per-status actor list (the trigger, not the RPC, is meant to be the single source of truth here, exactly as it already is for `cancel_ticket`/`confirm_ticket`/`complete_ticket`). In practice: **cashiers could never advance a ticket past `draft`, and bakers could never call this RPC at all** — for five of the ten transitions. Migration `fix_update_ticket_status_role_gate_matches_guard_trigger` (2026-08-22) removes the RPC's own status-role duplication and defers to the trigger, while keeping pricing/assignment/cancellation manager-only and bakers scoped to status-only edits. Full detail: `docs/STATE-MACHINES.md` §1, defect 3.
- **Verified live**, not assumed: a rolled-back transaction with simulated cashier/baker/owner JWTs — cashier now advances `draft→submitted→confirmed→scheduled`; baker now advances `scheduled→in_production→ready`; cashier attempting `scheduled→in_production` is still correctly refused; baker attempting to also edit `customer_id` or to cancel is still correctly refused; owner/manager behavior (including setting `discount_amount` alongside a status change) is unchanged. Full signed-in smoke suite (`node scripts/smoke-signed-in.mjs`) and `pytest -q` both green afterward — no regression.

**What's genuinely still open**, down from four grounds to one: `discount_amount`/`tax_amount` have no approved computation rules (**BLOCKER-003**) — this blocks only *setting* those two fields with confidence, not ticket lifecycle progression itself, since no transition requires them. There is still no write-path SQL test suite analogous to `catalog_read_rls.sql`/`inventory_write_rls.sql` — the RPCs are proven correct by the rolled-back-transaction technique and manual review, not by a committed, repeatable suite. Writing one is real remaining work, not a blocker.

**Tests:** S1–S18 (read path, executed 2026-08-23 — see above) cover RLS force, branch isolation on `tickets`, child-through-parent isolation on `ticket_items`, soft-delete invisibility, money transport, lifecycle reachability, the `subtotal_amount` freeze, and the `ready` item-lock boundary. No equivalent write-path suite exists yet.

**Note on this roadmap's own staleness:** the "Current State" summary at the top of this file (dated 2026-08-14, "Every write path is BLOCKED") predates and now contradicts this section, P4.2b, P6.x, and the P9.x mobile milestones. Not rewritten in this pass — flagged here rather than silently left to mislead a top-to-bottom reader.

## P4.5 · Delivery — COMPLETE (read + write)
**Dependencies:** P4.4 (read path implemented 2026-08-14).
**Schema:** `deliveries`.
**Business rules:** `guard_delivery_transition()`; `ready → delivered` on the parent ticket hard-requires a verified `deliveries` row.

**Read path delivered 2026-08-14:** `packages/types/delivery.ts`, `packages/validation/delivery.ts`, `packages/api/queries/delivery.ts` — `listDeliveries`, `getDeliveryById`, `getDeliveryForTicket`. Zero migrations. `deliveries` carries no `NUMERIC` column, so this is the one domain with no money-precision exposure and no `::text` cast.

**READ PATH now live-verified (2026-08-17).** The types, Zod schema and query module were written from docs and have since been confirmed against the live database: all 19 columns, the six-value `status` CHECK, both RLS policies and all ten constraints match, with no mismatch found. The three CHECK-mirroring refinements were also proven behaviourally — `assigned` with no driver, `failed` with no reason, and `delivered` with neither proof nor recipient each return `23514`. P9.6 consumes this layer.

**Write path COMPLETE 2026-08-21 — reconciled 2026-08-23.** This section previously read
"BLOCKED", stale against the P9.6 row below it in this same file, which already documents
the live-verified `transition_delivery()`/`update_delivery_details()` RPCs.
`authenticated` genuinely holds no `UPDATE` on `deliveries` (confirmed), so those two
SECURITY DEFINER RPCs are the only write path — not a gap, the intended mechanism, matching
the "return-writes-a-movement" rule this section already stated. BLOCKER-016 (`returned`
appearing not to restore stock) was closed 2026-08-22 as not-a-bug — the state machine makes
the scenario it describes unreachable — surfacing instead a real, adjacent defect
(`complete_ticket()`'s sale deduction had never worked), fixed the same pass; see
`BLOCKERS.md`.

**Completion gate — delivery gate enforced in DB, not convention: PROVEN.**
`tests/sql/delivery_read_rls.sql` (D1–D10) executed live 2026-08-23, **11/11 passed**. D5
refuses `ready → delivered` while the delivery is only `assigned`; D6 permits it once the
delivery reaches `delivered`; D7 shows a pickup ticket skipping the gate entirely — all
three confirmed, not assumed. The suite's own header previously claimed "NOT EXECUTED —
BLOCKER-011" (stale; BLOCKER-011 was resolved 2026-08-15 for other suites and this one just
never re-ran). Running it for the first time surfaced three defects, all in the test file
itself, none in product code: two fixture bugs (a missing org-B `user_roles` membership row,
and a column-count mismatch in the org-B delivery insert that a naive NULL-fill would have
put in the wrong — `NOT NULL` — column) and one stale assertion (D1 still expected
`deliveries.deleted_at` to be absent, a claim the 2026-08-15 pass had already corrected in
`queries/delivery.ts` without updating this test to match). All three fixed in the suite;
zero product changes needed. Full trace: `IMPLEMENTATION_LOG.md` 2026-08-23.

**P4.5 is COMPLETE**, not IMPLEMENTED.

## P4.6 · Audit — COMPLETE (infrastructure) / NOT_STARTED (coverage)
**Schema:** `audit_log`, `log_audit_event()` — exist and are used by invite acceptance.
**Gap:** coverage across domains is not systematic. → **P6.4**.

---

# Phase 5 — Financial backend — MVP slice COMPLETE and live-verified 2026-08-24

**The MVP scope is governed by AD-017** (APPROVED — tax, discounts, COGS, gross profit,
margin and refunds are explicitly **deferred**; existing schema/RPCs for deferred
capabilities stay dormant, not exposed by MVP workflows). This table previously read
"BLOCKED" across every row, and the section text below still asked for decisions AD-017
had already made — both stale since AD-017 landed; reconciled here against a full live
audit, not assumed.

| ID | Milestone | Schema | Status |
|---|---|---|---|
| P5.1 | Pricing & discounts | `product_variants`, `tickets.discount_amount` | **PARTIAL.** No effective-dated price-history table exists yet (AD-017 requires one for the catalog write path — see BLOCKER-010b/c); discounts are explicitly deferred from MVP scope by AD-017, not blocked. |
| P5.2 | Taxes | `tickets.tax_amount` | **DEFERRED by AD-017** — a scope decision, not an open blocker. The column exists and is dormant. |
| P5.3 | Invoices | `invoices` | ✅ **COMPLETE.** `confirm_ticket()` issues one on confirmation with the frozen ticket total; status derives automatically (`issued`→`partially_paid`→`paid`) as `apply_payment_to_ticket()` accrues payments. Verified live: F7/F8a–c. |
| P5.4 | Payments | `payments`, `apply_payment_to_ticket()`, `record_payment()` | ✅ **COMPLETE**, two real defects found and fixed 2026-08-24: `record_payment()` actively offered `'credit'` as a method, though AD-017 states a credit sale creates **no** payment row; and nothing enforced AD-017's "overpayments are rejected against the outstanding balance" — a 500 payment against a 100 total succeeded outright. Both fixed (`record_payment()`'s allowed-method list; `guard_payment_relationships()` gained the overpayment check so it holds regardless of write path). Verified live: F2–F6, F9/F10. |
| P5.5 | Refunds | `refunds`, `record_refund()`, `guard_refund_total()` | **RPC-level COMPLETE and correct** (cumulative-refund-exceeds-payment-balance guard verified live: F9/F10a–c) — built and tested ahead of MVP product scope; AD-017 defers the refund *workflow* from MVP, so this stays dormant/unexposed by design, not because anything is broken. |
| P5.6 | Cash sessions & expenses | `cash_sessions`, `expenses`, `open_cash_session()`, `close_cash_session()` | ✅ **COMPLETE**, two real defects found and fixed 2026-08-24: `guard_expense_cash_session()` never checked `paid_method='cash'` when a `cash_session_id` was attached (AD-017: "non-cash expenses do not reduce expected drawer cash") — a transfer-method expense could silently corrupt the till reconciliation; fixed to mirror `guard_payment_relationships()`'s identical check. Separately, `cash_sessions` was the one P5 table still holding direct `INSERT`/`UPDATE` grants for `authenticated` (its siblings are all `SELECT`-only, RPC-gated) — a live gap allowing session-impersonation with zero audit trail; revoked. Verified live: F11–F17, including an end-to-end reconciliation (`expected = opening_float + cash_in − cash_out`, non-cash expenses correctly excluded). **A third defect found and fixed 2026-08-28**, while building the P9.7 expense-capture client: `expenses_insert`'s `WITH CHECK` never constrained `created_by` at all — unlike `tickets` (trigger-derived) and its own P5 sibling `daily_financial_audits_insert` (`submitted_by = auth.uid()`) — so any caller holding an eligible role could misattribute an expense to a different profile. Reproduced live in a rolled-back transaction, then fixed by mirroring `daily_financial_audits_insert`'s exact clause (migration `fix_expenses_insert_created_by_forgery`); `financial_write_rls.sql` re-run clean, 28/28. |
| P5.7 | Daily financial audit | `daily_financial_audits`, `guard_daily_financial_audit_mutation()` | ✅ **COMPLETE.** Four-eyes rule (the submitter cannot confirm/reject their own audit; a different owner/admin/branch_manager can) and post-confirmation immutability both verified live: F21–F23. No defect found here. |
| P5.8 | Reporting & P&L | `get_daily_revenue_summary()` | **REVENUE/CASH HALF DELIVERED 2026-08-28.** The COGS/gross-profit half stays **NOT_STARTED — BLOCKER-018 unresolved**: `stock_movements.unit_cost` is still 100% NULL on every row, including `purchase`-reason movements, so weighted-average COGS cannot be computed from live data. The revenue/cash half `docs/REPORTING-MODEL.md` §85 locks — gross/net revenue, refunds, gross/net collected — is now live: `get_daily_revenue_summary(p_branch_id, p_date default null)`, tenant/branch/role-gated, organization-timezone-aware (half-open day boundary per §15/16), every money field `::text`-cast in its jsonb envelope (a real precision hazard found and fixed before any client code read it). Required a genuine schema gap first: `tickets` had no fulfillment/completion timestamp at all despite `REPORTING-MODEL.md` §78 naming one as required and this file's own P5 write-up already citing "`tickets.fulfilled_at`" as decided — the column had never actually been added. Added as `tickets.completed_at`, stamped by `guard_ticket_status_transition()` at `completed` (STATE-MACHINES.md §1: the sale stock movement's own event, chosen over `delivered` so a later COGS calculation shares the same trigger event). Verified live: timezone day-boundary correctness (23:59/00:30 local split across the UTC day), tenant/branch/role authorization, and the money-precision fix, plus full regression (`financial_write_rls.sql` 28/28, `driver_field_sale_rls.sql` 8/8 — both exercise the changed trigger). See `IMPLEMENTATION_LOG.md` 2026-08-28. |

**Verified 2026-08-24, not assumed:** `tests/sql/financial_write_rls.sql` (F1–F23, 28
assertions) — the first test suite this domain has ever had — executed live, 28/28
passed after the four fixes above. Covers the full ticket→confirm→invoice→payment→refund
lifecycle, cash-session open/close/reconciliation, expense method-consistency, the
four-eyes audit rule, and tenant isolation across all six financial tables. A fifth,
unrelated regression from the previous day's own work (`sales_read_rls.sql` S10's
`subtotal_amount` freeze fix had become too broad, silently blocking legitimate
`ticket_items`-driven recalculation once a ticket left `draft`) was found while writing
this suite's F19 and fixed in `guard_ticket_status_transition()`; F18/F19 are now the
permanent regression guard for both directions of that fix.

**Common to all:**
**Tests:** financial invariants — totals reconcile; money never floats; rounding only at settlement. Now backed by `tests/sql/financial_write_rls.sql`, not just declared.
**Security checks:** finalised documents immutable (verified: F23); no client-side authorization (all six tables are either RPC-only or RLS+trigger-guarded, verified: F1, F17, F20).
**Completion gate:** every invariant has an executed test; no rule was inferred — met for P5.3/P5.4/P5.6/P5.7 and the RPC layer of P5.5.
**Decisions already made by AD-017** (superseding the stale line that used to sit here): tax and discounts deferred from MVP; rounding is truncation at display only, never mid-calculation; refund *policy* exists at the RPC level (cumulative-cannot-exceed-payment) though the *workflow* is deferred; invoice finalisation semantics are exactly the confirm→issued/partially_paid/paid chain verified above; revenue recognition is `tickets.fulfilled_at` at `delivered`/`completed`. **Still open:** the price-history mechanism for P5.1 (folds into BLOCKER-010b/c).

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

## P6.6 · Rate limiting & production configuration — COMPLETE (2026-08-22)
**Dependencies:** P6.1. Feeds P12.
**Deliverables:** `enforce_rate_limit()` — a reusable, generic rate-limit primitive — plus
`send-invite-email` wired to it, the only Edge Function that currently exists.

**Scope decision, made explicitly rather than guessed:** "Rate limiting & production
configuration" as a milestone name spans a lot of ground. Read against its own dependency
(P6.1, Edge Function scaffold — not any Postgres RPC) and its place in Phase 6 alongside
P6.2/P6.4/P6.5 (all Edge-Function/observability hardening for the one function that
exists), this milestone's scope is the Edge Function layer, not a general RPC-wide
rate-limiting initiative — extending it to arbitrary write RPCs (`adjust_stock`,
`record_payment`, ...) would be new, unrequested scope with its own authorization
questions, better left as a deliberate follow-up than invented here. Supabase's own
platform-level Auth rate limits (`supabase/config.toml`'s `[auth.rate_limit]`) are a
separate, already-partially-configured layer this repo does not control the live values
of from here (no available tool pushes `config.toml` to the hosted project) — out of
scope for the same reason. "Production configuration" narrows, in practice, to the same
effort: this is the only Edge Function that has ever needed hardening before real traffic.

**Design — reused existing architecture, no new dependency:**
- `rate_limit_events`: a small append-only ledger table (`tenant_id`, `scope`, `actor_id`,
  `occurred_at`), the same shape as `audit_log`/`stock_movements`/`sync_changes`. RLS
  enabled and forced; **zero grants to `authenticated`/`anon`** — no client read or write
  surface at all, tighter even than `audit_log` (which grants `authenticated` `SELECT`).
- `enforce_rate_limit(p_tenant_id, p_actor_id, p_scope, p_limit, p_window_minutes)`:
  `SECURITY DEFINER`, counts events for `(tenant_id, scope)` in the trailing window, raises
  `code: 'rate_limited'` at the cap, otherwise records this call and returns. **`EXECUTE`
  granted only to `service_role`** — deliberately not `authenticated`, and this is a real
  security boundary, not a formality: the function trusts `p_tenant_id`/`p_actor_id` as
  explicit parameters rather than deriving them from the JWT
  (`current_tenant_id()`/`auth.uid()`), so broader `EXECUTE` would let any authenticated
  caller pollute or exhaust *another* tenant's quota by simply passing its id. Migration:
  `p6_6_rate_limit_send_invite_email`.
- `send-invite-email/index.ts` (redeployed as version 2) calls it immediately before
  dispatch, after every other check (auth, membership, role, invite status/expiry/token) —
  so a malformed or unauthorized request never consumes a legitimate caller's quota — using
  the invite's actual `tenant_id` (authoritative) and the already-authenticated caller's id.
  Over the cap: HTTP 429, `code: 'rate_limited'`.
- **Limit chosen: 20 calls per tenant per rolling hour.** An engineering/operational
  parameter, not a business rule requiring sign-off (unlike tax/discount/refund logic) —
  set by analogy to `supabase/config.toml`'s own local-dev `auth.rate_limit.email_sent = 2`
  (per hour), loosened because inviting a whole staff at once is a real, legitimate burst
  BakeFlow's small-bakery tenants can hit, which the platform's own default does not need
  to accommodate. Easily adjusted — a named constant in one file, not a schema commitment.
- **Counted per `(tenant, scope)`, not per caller**, because the resource being protected —
  a transactional provider's per-recipient sending reputation and rate quota — is a
  tenant-level concern; one compromised or careless member should not be able to dodge the
  cap alone while the tenant's Resend standing still absorbs the damage. `actor_id` is
  still recorded on every ledger row for traceability, just not part of the enforcement key.

**Verified live, 2026-08-22, against the actually-deployed function — not simulated:**
- 20 real HTTP calls to `send-invite-email` for one disposable invite, one tenant: **all
  20 succeeded** (mock provider, `status: "simulated"` each time, as expected with no
  `RESEND_API_KEY` configured).
- **21st call: refused**, `429`, body `{"error":{"code":"rate_limited","message":"This
  organization has sent too many invitation emails in the last 60 minutes. Try again
  later.","details":"rate limit exceeded for scope send_invite_email: 20 of 20 calls used
  in the last 60 minutes"}}`.
- **Tenant isolation**: switched to the smoke user's second organization, created a fresh
  disposable invite there, called the function once — **succeeded**, proving one tenant
  exhausting its quota does not affect another's, exactly as the `(tenant_id, scope)`
  keying is meant to guarantee.
- **Authorization/tenant boundary** (the specific thing that makes this safe to key by an
  explicit, trusted `tenant_id` parameter): in a rolled-back transaction, simulated an
  ordinary `authenticated` session (owner role) and confirmed directly — `SELECT
  enforce_rate_limit(...)` → `42501 permission denied for function enforce_rate_limit`;
  `SELECT count(*) FROM rate_limit_events` → `42501 permission denied for table
  rate_limit_events`. Neither the function nor its backing table has any surface an
  ordinary authenticated caller can reach at all, closing the impersonation vector the
  design note above describes.
- **Failure behavior**: confirmed via `mcp__supabase__query_logs` (`function_logs`) that
  the refusal produced a correctly structured `function_error` log line
  (`status:429, code:"rate_limited"`), matching P6.5's structured-logging contract — this
  failure path is observable the same way every other one already is.
- Cleanup: the 21 ledger rows and both disposable `organization_invites` rows this test
  created were deleted afterward (`delete from rate_limit_events where
  scope='send_invite_email'`; `delete from organization_invites where id in (...)`) —
  nothing persisted from the test itself.
- Regression: full signed-in smoke suite green, `npm run typecheck`/`lint --workspace
  apps/mobile` exit 0, `pytest -q` 12 passed, after the migration and redeploy.

**Client vocabulary**: added `rate_limited` to `BakeflowErrorCode` in
`packages/api/errors/index.ts` and to `docs/API-CONTRACT.md` §3's code table, matching the
existing envelope pattern. **Found, not fixed, in the same pass**: `sendInviteEmail()`'s
client wrapper never reads *any* Edge Function error code (not just this new one) — logged
as **TD-017**, a pre-existing client-side gap, verified independent of this change.

**Two more stale lines in `docs/API-CONTRACT.md` §7 fixed in passing**: a status row
already said "Deployed and live-verified" while the explanatory paragraph directly under
it still said "has never been deployed" and "zero rows, ever" — both true only until
earlier the same day. Corrected to match.

## P6.7 · Permission enforcement decision — DEFERRED
**Objective:** Decide whether the 25 permission keys become the server-side enforcement layer, stay UI-only, or are removed (TD-001, TD-002, AD-016).

---

# Phase 7 — BACKEND COMPLETION GATE

**P7.1 — Backend cannot be declared complete until every line below is true and evidenced.**

| # | Criterion | Current |
|---|---|---|
| 1 | All required domain services exist (P4.1–P4.6) | ✗ |
| 2 | Migrations reproducible from the repository | ✓ BLOCKER-002 RESOLVED 2026-08-31 |
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

**Frozen snapshot — read the top-of-file "Current State" section for the live picture,
not the table below.** Most of this table's blocker citations (BLOCKER-001, 010b/c
partially, and the P4.4b/P4.5 "remaining" notes) were resolved days to weeks after this
was written and never updated here; only BLOCKER-003 (financial rules) is still
genuinely open as of 2026-08-23. Left as-written for the historical record of what was
known at P8.0's opening, per this file's own convention elsewhere of correcting via a
note rather than silently rewriting history.

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
| P3.7 per-entity sync | PARTIAL — tickets slice IMPLEMENTED 2026-08-28, protocol layer hardened 2026-08-29, customer slice IMPLEMENTED 2026-08-29, inventory.adjust/.waste + production.start/.cancel + payment.create/.reverse + expense.create IMPLEMENTED 2026-08-30, production.record_output/.record_waste IMPLEMENTED 2026-08-31; BLOCKER-006 resolved via AD-021 (BLOCKER-009 resolved 2026-08-22); inventory.receive/.transfer/.consume + production.complete decided OUT OF MVP SCOPE 2026-08-31, removed from allowlist (BLOCKER-026/027 RESOLVED); expense.reverse (BLOCKER-028) is the only remaining deliberately-unbuilt item |
| P0.5 migration reproducibility | BLOCKER-002 — RESOLVED 2026-08-31, see below (this row is a historical snapshot from earlier in the project and was left as originally written elsewhere in this table; do not trust it as current) |

**Frontend work (P8.1) was the next thing built**, exactly as this phase was designed to
allow, and has since grown well beyond it — see below.

---

**Five of six were already met before 2026-08-14.** The checkpoint opened as soon as
**P4.1's read path** landed. **P4.4 is not a prerequisite** — confirmed 2026-08-11 in resolving BLOCKER-008(a).
The full prerequisite set was therefore **P2 + P4.1**, stated identically here, in the
dependency graph above, and in P8.1 below. A catalog *list and detail* screen needed the
read path only, so P4.1b's block did not hold the checkpoint shut either.

### P8.1 · First frontend vertical slice — "Sign in → pick organization → see catalog" — ✅ DELIVERED 2026-08-15, re-verified live 2026-08-24
**Objective:** Prove the whole spine end-to-end on a real device before broadening.
**Dependencies:** **P2 + P4.1** (read path). Not P4.4, not P7.
**Screens:** sign-in (`apps/mobile/app/sign-in.tsx`); organization switcher
(`select-organization.tsx`); catalog list (`index.tsx`); catalog detail
(`product/[id].tsx`, shipped same day as part of the immediate P9.1 follow-on).
**APIs/services consumed:** Supabase auth; `set_active_organization()`; `organizations_select`; catalog reads.
**Authentication flow:** session storage per AD-014 using chunked SecureStore entries
protected by the platform Keychain/Keystore — **no AsyncStorage**. Implemented in
`packages/auth` (`index.ts` + `chunked-storage.ts`), 8 executed round-trip/chunking
checks in `verify:cache`.
**Organization switching:** `setActiveOrganization()` calls the RPC **and** forces a
token refresh in one function — splitting them was identified during implementation as
the one way this slice could silently half-switch. `AppProviders`' `onAuthStateChange`
listener evicts every organization-scoped cache entry (`clearOrganizationScopedCache`,
keyed by `orgScoped()` prefix) before publishing the new session, so no render can land
between a token change and cache eviction.
**Error/loading states:** implemented via `components/ScreenState.tsx` — loading, empty,
error-with-retry, and a distinct "no organization selected" state (a null tenant claim
denies every policy, so this is deliberately not conflated with "empty catalog").
Revoked-membership and expired-session both resolve through the same session-store gate
in `_layout.tsx`.
**Testing:** no component-test runner exists in this repo (`TECHNICAL_DEBT.md`), so
verification is via `scripts/verify-cache-isolation.mts` (67 executable checks: query-key
scoping, cache eviction ordering, JWT claim decoding, money formatting, chunked storage)
and `scripts/smoke-signed-in.mjs` (a real signed-in run against the live project — the
manual-device-pass substitute this environment cannot perform). **On-device run: still
NOT PERFORMED** — no physical device or emulator is available in this environment; the
smoke script is the strongest verification actually achievable here, exercising the real
`packages/api`/`packages/auth`/`packages/hooks` code paths against production RLS rather
than a mock.
**Completion gate — MET, live-verified 2026-08-24:** `node scripts/smoke-signed-in.mjs`
signs in, confirms the JWT carries a top-level `tenant_id` claim (not `app_metadata` —
the bug the 2026-08-15 review found and fixed, see `packages/auth/claims.ts`), lists
exactly the organizations the user belongs to, switches via
`set_active_organization()` + `refreshSession()`, confirms the catalog before the
refresh still serves the *previous* tenant and only the *new* token unlocks the new
one, loads that organization's catalog and product detail, then switches to a second
organization and confirms **zero** rows from the first are visible by any path
(direct id, list, stock levels, batches, tickets, deliveries) — 112/112 assertions
passed. Prior known defects, all found and fixed during the original 2026-08-15 build
(not open now): the `app_metadata` claim-reading bug above, a missing
`SafeAreaProvider`, and a non-deterministic `verify:cache` invocation.

### Backend work that continued in parallel with P8.1
P4.2 Inventory · P4.3 Production · P6.1 Edge Functions · P6.4 Audit coverage · P0.5
migration reproducibility — all since COMPLETE or resolved, see their own sections.

### What shipped beyond P8.1's original scope
P9.1 (catalog detail with variants/prices), P9.4 (inventory read + write), P9.5
(production read + write), P9.6 (delivery read + write) are all implemented under
`apps/mobile/app/{inventory,production,delivery}/` and exercised by the same smoke
suite above. See their respective P9.x rows for individual evidence.

---

# Phase 9 — Frontend/backend integration

Vertical slices. Each: **backend capability → API/service → screen → state → offline
behaviour → tests → acceptance gate.**

| ID | Slice | Backend dep | Offline behaviour | Status |
|---|---|---|---|---|
| P9.1 | Catalog browse | P4.1 | read-through cache | **COMPLETE 2026-08-15, re-verified live 2026-08-24.** `app/index.tsx` (list) + `app/product/[id].tsx` (detail with priced variants, shipped same day as the immediate P9.1 follow-on to P8.1). Money is never summarised across variants (no "from ₦X") — comparing `NUMERIC(19,4)` strings needs a decimal library not yet a dependency, and `formatNaira` truncates rather than rounds pending BLOCKER-003. |
| P9.2 | Customer create/select | P4.4a | queued create | **Backend unblocked 2026-08-29** — `customer.create`/`customer.update` sync handlers exist and are live-verified (P3.7). No frontend work done in this pass (out of scope by instruction — see `docs/API-CONTRACT.md` for the `process_sync_batch` payload/result contract this screen would call against). Still not started: screen, hooks, offline queue wiring. |
| P9.3 | Ticket creation (driver) | P4.4 | queued, immutable | **ONLINE-COMPLETE 2026-08-25, including completion.** `apps/mobile/app/driver/sell.tsx`: cart from the catalog → `createRoadsideTicket()` (plain INSERT, RLS-verified live) → `completeDriverFieldSale()` (AD-020, resolving **BLOCKER-021**: a driver-created, trip-linked pickup ticket takes `draft → completed` directly via a narrowly-gated new RPC, instead of the seven-hop production lifecycle or adding `driver` to its actor lists) → `recordDriverTripPayment()` (unchanged, already correctly scoped). Live-verified: `tests/sql/driver_field_sale_rls.sql` 8/8, `driver_trips_rls.sql` 20/20 and `financial_write_rls.sql` 28/28 confirmed unaffected. Still BLOCKED on **BLOCKER-006** for the *offline* half (queued/sync behavior) — unchanged; the online path has no dependency on it. See `ARCHITECTURE_DECISIONS.md` AD-020, `BLOCKERS.md` §BLOCKER-021 (RESOLVED), `IMPLEMENTATION_LOG.md` 2026-08-25. |
| P9.4 | Inventory view & adjust | P4.2 | online-only for now — queuing needs P10 | **READ PATH COMPLETE / WRITE PATH COMPLETE 2026-08-21.** `AdjustStockAction` on each stock row calls the already-existing `adjust_stock()` RPC (P4.2b) — an absolute target, not a delta; three reasons (`adjustment`, `waste`, `opening_balance`), role-gated per reason server-side. The RPC contract itself was proven live in the P9.5 smoke work (an opening-balance call against a disposable fixture); this slice is the hook + UI wiring around it |
| P9.5 | Production batches | P4.3 | online-only for now — queuing needs P10 | **READ PATH COMPLETE 2026-08-16 / WRITE PATH COMPLETE 2026-08-21.** Detail screen shipped with transition controls, live-verified: `scheduled`'s two exits are plain PostgREST updates (`authenticated` holds `UPDATE` here, unlike `deliveries`); `in_progress`'s two exits are the SECURITY DEFINER RPCs `complete_production_batch()`/`fail_production_batch()`, which atomically write `stock_movements`. BLOCKER-017 (a raw update could reach `completed`/`failed` without the RPC) resolved 2026-08-22 with a trigger-side guard flag — see `BLOCKERS.md` |
| P9.6 | Delivery workflow | P4.5 | online-only for now — queuing needs P10 | ✅ **COMPLETE.** READ PATH 2026-08-17 / WRITE PATH 2026-08-21 / driver assignment 2026-08-22. Board + detail + transitions shipped, live-verified: `transition_delivery()` and `update_delivery_details()` RPCs (no client UPDATE grant on `deliveries`, so PostgREST is not the write path). `DeliveryActions` renders the legal hops per the live trigger graph; `delivered`/`failed` gate on the CHECK-required field first. `DriverPicker` (`listDrivers()` read path + UI, commit `5b95770e`) closed the one gap this row used to flag — a `pending` delivery now assigns a real driver rather than dead-ending; stale six days, corrected 2026-08-28. BLOCKER-016 (`returned` writes no stock movement) closed 2026-08-22 as not-a-bug — the state machine makes it unreachable that a returned delivery's stock was ever deducted — see `BLOCKERS.md`, which also records the real defect found alongside it (`complete_ticket()`'s sale deduction had never worked) |
| P9.7 | Cash session & payments | P5.4, P5.6 | queued | **ONLINE IN PROGRESS 2026-08-28.** Cash-session listing/open/close, till-scoped payment entry, and expense capture are all implemented in `apps/mobile/app/finance/` and `packages/api`/`packages/hooks`. Expense capture surfaced and fixed a real `expenses_insert` authorization gap — see the P5.6 row. Offline queuing and an interactive device click-through remain outstanding. |
| P9.8 | Reports (mobile-light) | P5.8 | online-only | **REVENUE/CASH HALF DELIVERED 2026-08-28.** `apps/mobile/app/reports/index.tsx` — one card per branch, "today" resolved server-side against the organization's own timezone, showing gross/net revenue and gross/net collected via `useDailyRevenueSummary()`. COGS/gross-profit/margin explicitly not shown (BLOCKER-018, unchanged) — the screen says so rather than omitting silently. Linked from the catalog screen. |

**State management:** Zustand stores per `FRONTEND-STRUCTURE.md` §3 — `auth`,
`organization`, `branch`, `permissions`, `settings`, `sync`, `ui`.
**Rule:** screens never call Supabase directly — Screen → Feature Hook → Feature
Service → `packages/api`.

---

# Phase 10 — Offline / mobile completion

Decisions are recorded (AD-013, AD-014). AD-014 session storage is implemented; the
remaining offline/mobile decisions are not yet implemented.

| ID | Milestone | Status | Notes |
|---|---|---|---|
| P10.1 | SQLCipher database | NOT_STARTED | config verified working (P0.3); no code |
| P10.2 | Per-user isolation | NOT_STARTED | one DB per authenticated user (AD-013) |
| P10.3 | Key lifecycle | NOT_STARTED | 13 scenarios documented; CSPRNG only, never derived |
| P10.4 | Logout / account switching | NOT_STARTED | retain data, close DB, release key; a different user must not decrypt |
| P10.5 | Recovery state | NOT_STARTED | never silently re-key; show pending count before any reset |
| P10.6 | Pending operations & outbox | NOT_STARTED | encrypted; immutable org/branch context |
| P10.7 | Synchronization client | BLOCKED | needs P3.7 |
| P10.8 | Conflict handling (client) | BLOCKED | needs P3.7's server `sync_conflicts` (BLOCKER-006 resolved via AD-021; P3.7 itself not yet built) |
| P10.9 | Reconnect behaviour | NOT_STARTED | on-reconnect, no background task in spec |
| P10.10 | Device replacement | NOT_STARTED | unsynced work on a lost device is unrecoverable — must be stated in-product |

**Security checks:** business data never in SecureStore; auth session ≠ SQLCipher key ≠
business database; backups must not yield readable data (AD-013).

---

# Phase 11 — Full-system QA

| ID | Type | Status |
|---|---|---|
| P11.1 | CI pipeline (runs pytest + SQL suite + typecheck + lint) | **COMPLETE** (2026-09-01) — confirmed GREEN on a real GitHub Actions run (run 33528550754, commit 00b857d9), all 3 jobs and all 16 SQL suites passing; see below |
| P11.2 | Shared DB fixture library | **COMPLETE** (2026-09-01) — `tests/sql/fixtures.sql` |
| P11.3 | Unit tests (frontend) | ✅ **DELIVERED 2026-08-28.** `jest-expo` runner (`bakeflow-frontend/jest.config.js`, `npm test`), wired into `.github/workflows/ci.yml`. 39 assertions covering `packages/types/scalars.ts` (`isZeroDecimalString`/`isNegativeDecimalString`/`compareDecimalStrings`) and `packages/validation/decimal.ts` (every money/quantity schema). A real tsconfig quirk found and fixed: `@types/jest`'s ambient globals were not auto-included under this project's `moduleDetection: "force"` + `moduleResolution: "bundler"` config — each test file needs an explicit `/// <reference types="jest" />`, documented in `docs/TESTING-STRATEGY.md`. |
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

**Validated end-to-end, 2026-09-01.** User decided: a throwaway Postgres in the CI runner, not
production credentials. Local Docker Desktop hit a persistent DNS-resolution failure pulling
images (unrelated to GitHub's own runner network), so validation ran instead on a throwaway AWS
EC2 instance (Docker, torn down completely afterward — instance terminated, security group and
key pair deleted, confirmed not just requested).

Building this surfaced a real prerequisite gap — none of the 16 `tests/sql/*.sql` suites are
actually self-contained; all of them reference a small set of organization/branch/profile/
warehouse/recipe/ingredient/product rows that exist only in the live project's history and were
never captured anywhere in the repo (this is `P11.2`, previously NOT_STARTED, now addressed via
`tests/sql/fixtures.sql`). Running the full chain (auth/storage compat shim -> baseline -> seed
-> fixtures -> all suites) against a genuinely fresh database repeatedly, fixing one failure at
a time, found **nine real, previously-unknown defects** — most significantly, two missing
`REVOKE` statements in the baseline's own GRANT sections (this project has a default privilege
that auto-grants `authenticated`/`anon` on every new function/table `postgres` creates; the
baseline only ever captured positive `GRANT`s, invisible on live only because everything had
already been individually locked down over many prior migrations) — plus a function-ordering
bug, a missing `private` schema, a missing `storage` stub, and several stale test assumptions.
Full list: `IMPLEMENTATION_LOG.md` 2026-09-01 (second entry that day).

**Confirmed GREEN on GitHub's own runners, 2026-09-01 (run 33528550754, commit 00b857d9) —
all 16 SQL suites pass.** The EC2 pass above got to 14/16; three real GitHub Actions runs after
that found and fixed what EC2 couldn't have: the `sql-tests` loop's `set -e` was silently
skipping every file after the first alphabetical failure (fixed — it now runs all 16 and reports
every failure by name), a Lint config gap broken on every run since `jest.config.js` was added
(fixed — a `*.config.js` Node-globals override), a cascading fixture side effect from the
BLOCKER-010a stale-test fix (C1b's expected row count), and a second stale test using a
`domain_operation` value since removed from its allowlist. The `rate_limit_events` "gap" turned
out, on inspection, to already be a decided and live-verified design (P6.6) — re-confirmed
directly against the live project via `mcp__supabase__execute_sql`, not just trusted — and is now
allowlisted at the test level with that evidence. Full trace: `IMPLEMENTATION_LOG.md` 2026-09-01
(four entries).

**Verified on GitHub 2026-08-11.** Run **31822495609** is green: `Typecheck` and `Lint`
both executed and passed on a Linux runner with `--max-warnings=0` and the npm pin intact.

Getting there took two fixes, because **every earlier run had failed at the install step,
so lint and typecheck had never once executed remotely** — the red check was never about
production code. `corepack npm ci` without a prior `corepack enable` fails on the runner,
and after enabling, `corepack enable` does not win the PATH race (bare `npm` still reports
the version Node 22.13 ships), so the pinned npm is now invoked through `corepack npm`
explicitly and asserted before install.

**Blockers:** none for schema reproducibility (BLOCKER-002 RESOLVED 2026-08-31); the
CI-database-approach decision above remains open but is not itself a numbered blocker.
**Parallelizable:** with everything — it changes no runtime code.

---

# Phase 12 — Production readiness & Play Store release

| ID | Milestone | Status | Blocker |
|---|---|---|---|
| P12.1 | Supabase production configuration | NOT_STARTED | |
| P12.2 | Secrets management | NOT_STARTED | `SUPABASE_*` are auto-injected and must not be set |
| P12.3 | Migration deployment process | NOT_STARTED | BLOCKER-002 (schema reproducibility) RESOLVED 2026-08-31; the deployment *process* itself (how a migration reaches production safely) is still not built, a distinct piece of work from reproducibility |
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
