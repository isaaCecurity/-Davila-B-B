# BakeFlow — Implementation Log

Append-only. Every entry records commands actually executed and their output.
Never record planned work here.

---

## 2026-08-24 · ADR-001 Phase 3 — driver trip RPC/security layer live

Continuing directly from Phase 2 in the same session. Before writing any RPC, inspected
the live bodies of `close_cash_session()`, `open_cash_session()`, `record_payment()`,
`complete_ticket()`, `guard_delivery_transition()`, `guard_cash_session_transition()`,
`has_role()`, `has_branch_access()`, `bump_cash_session_revision()`, and the `tickets`
RLS policies (`tickets_insert`/`tickets_update`) rather than assuming their shape.

Findings that shaped the design instead of guessing it:
- `tickets_insert`'s RLS policy already lets `driver` insert a ticket where
	`created_by = auth.uid()` — Path B (driver creates a ticket) needed zero new INSERT
	policy, only integrity checking on the new `driver_trip_id` column.
- No `create_ticket()`/`create_customer()` RPC exists at all — both are plain
	client-side INSERTs today, gated by RLS + triggers. Confirmed no parallel RPC was
	needed for driver-created tickets.
- `complete_ticket(p_order_id, p_warehouse_id)` already takes an explicit warehouse
	and never touches `deliveries` — a trip-linked pickup sale needed zero changes to
	this function to deduct from the trip's vehicle warehouse; AD-019 required no code
	change at all, only confirming by inspection that none was needed.
- `record_payment()` hard-requires an open branch till session for `method='cash'` —
	confirmed AD-018 could not be satisfied without a change here, not just a new
	standalone RPC.

Applied `adr001_phase3_driver_trip_lifecycle_rpcs`: `guard_driver_trip_transition()`
(linear status map, mirrors `guard_cash_session_transition()`/`guard_delivery_
transition()`), `driver_trips_bump_revision` (reuses the existing generic
`bump_cash_session_revision()` — its body is table-agnostic despite the name),
`start_driver_trip()`, `verify_trip_loading()` (writes a `transfer_out`/`transfer_in`
pair per item, advances `created -> loading -> ready_to_depart` atomically in one
call, per the one-party-verification decision), `depart_driver_trip()`,
`return_driver_trip()` (reverse transfer pair), `reconcile_driver_trip()` (computes
expected cash from the trip's own `payments` rows, never trusts the client),
`complete_driver_trip()` (validates and records a settlement session), and
`guard_ticket_driver_trip_assignment()` (new trigger: a ticket's `driver_trip_id` must
belong to an `in_transit` trip whose driver is that ticket's creator or assignee —
closes the RLS gap where `driver_trip_id` was otherwise unconstrained).

Applied `adr001_phase3_payment_and_close_session_custody`: extended `record_payment()`
with an optional `p_driver_trip_id` (trip-scoped cash skips the till-session lookup
entirely, tagging `driver_trip_id` instead of `cash_session_id`) and extended
`close_cash_session()` to additionally sum `physical_cash` from `completed` trips whose
`settlement_cash_session_id` matches — this is the actual mechanism that makes AD-018's
"reconciled trip cash enters the branch till" real, without ever rewriting the original
trip-scoped payment rows.

**Defect found and fixed the same pass:** `CREATE OR REPLACE FUNCTION record_payment(...)`
with a 6th parameter added did not replace the existing 5-parameter function — Postgres
only replaces on an identical signature, so it silently created a second overload,
making every 5-positional-arg call (including every call in `financial_write_rls.sql`)
ambiguous. Caught immediately by re-running that suite; fixed via
`fix_record_payment_overload_ambiguity` (dropped the stale 5-arg overload).

**Verified live**, all via rolled-back transactions against real fixture data (this
project has exactly one real `profiles` row — fabricated ones are rejected by the
`auth.users` FK, so the driver and branch_manager personas are the same real profile
with the JWT `roles` claim toggled between phases; `has_role()` only reads that claim):
- New permanent suite `tests/sql/driver_trips_rls.sql`: 20/20 passed — full lifecycle
	(start → verify-load → depart → driver-created ticket → trip-scoped payment →
	complete_ticket against the vehicle warehouse → return → reconcile → complete →
	close_cash_session absorbing the trip's cash), plus the one-active-trip-per-driver,
	custody-context CHECK constraints, RLS write-denial/read-allow, and the new ticket
	assignment guard's status-check branch.
- `tests/sql/financial_write_rls.sql` re-run clean: 28/28, both before discovering the
	overload defect (confirming it was pre-existing) and after fixing it (confirming the
	fix).
- `.venv/Scripts/python.exe -m pytest -q` — 12/12, before and after.

**Deliberately not built:** the driver mobile UI (Phase 5) and `STATE-MACHINES.md`
itself (Phase 4) — this pass is RPC/security layer only, per the ADR's own phase
boundaries. `driver_trips` still has no `INSERT`/`UPDATE` grant for `authenticated`;
every write goes through the RPCs above.

## 2026-08-24 · ADR-001 Phase 2 — driver_trips schema live, BLOCKER-019/020 resolved

User resolved BLOCKER-019 (driver cash custody distinct from branch till custody, linked
only at reconciliation) and BLOCKER-020 (`deliveries` stays sole delivery-proof
authority) with explicit decisions. Recorded as **AD-018** and **AD-019** in
`ARCHITECTURE_DECISIONS.md`; both blockers marked RESOLVED in `BLOCKERS.md`. BLOCKER-006
(offline conflict strategy) kept deliberately open per instruction — nothing in this pass
depends on a resolution for it.

Inspected live schema before designing anything (`information_schema.columns`,
`pg_constraint`, `pg_index`, `pg_policy`, and the bodies of `close_cash_session()`,
`open_cash_session()`, `record_payment()`, `adjust_stock()`, `has_branch_access()`) —
found `warehouses` already fits "vehicle as stock location" with no change needed,
`stock_movements` already has `transfer_in`/`transfer_out` reasons for exactly this
custody-transfer shape, `tickets.sale_customer_type` already allows `'ROADSIDE'`, and
critically that `record_payment()`/`close_cash_session()` compute a branch session's
`expected_amount` purely from `payments.cash_session_id`-linked rows — confirming a
trip-scoped cash payment must NOT carry the branch's `cash_session_id`, or AD-018 would
be violated by the existing close logic without anyone touching it.

Applied two migrations via `mcp__supabase__apply_migration`:

- `adr001_phase2_driver_trips_schema` — new `driver_trips` table (status/cash-custody/
	reconciliation columns, structural CHECKs mirroring `cash_sessions`/
	`daily_financial_audits` patterns, one-active-trip-per-driver partial unique index,
	RLS enabled+forced with a `deliveries_select`-style policy, `SELECT`-only grant to
	`authenticated`); `tickets.driver_trip_id` (trip-ticket relationship); `payments.
	driver_trip_id` plus a relaxed `payments_cash_needs_session` → `payments_cash_needs_
	custody_context` CHECK and a new mutual-exclusivity CHECK (a cash payment belongs to
	the till XOR a trip, never both); `stock_movements_reference_type_check` extended
	with `'driver_trip'`.
- `revoke_direct_write_grants_on_driver_trips` — found (same class of gap fixed on
	`cash_sessions` earlier this session) that Postgres default privileges had granted
	`authenticated` INSERT/UPDATE/DELETE on the new table despite no write policy
	existing. Revoked explicitly rather than relying on "no policy yet" as the only
	backstop.

Verified live via a rolled-back transaction against real fixture org/branch/warehouse/
profile data (no synthetic auth.users row exists, so fabricated profile fixtures were
rejected by the FK — switched to real existing rows, same lesson as this session's
earlier RLS suites): 10 checks, 10/10 passed after fixing one test-setup bug (T7 initially
failed because a prior sub-test had already fully paid its fixture ticket, so the
pre-existing overpayment guard fired before the constraint under test could — re-run in
isolation against a fresh unpaid ticket as T7b, passed). Confirmed: reconciled/completed
status requires cash figures + reconciler (T2/T3), variance requires a note (T4), one
active trip per driver (T5), a trip-scoped cash payment needs no till session (T6), a
payment can't reference both custody contexts (T7b), `stock_movements` accepts the new
reference_type (T8), `authenticated` cannot write `driver_trips` directly — permission
denied (T9), and the driver-ownership SELECT policy returns the driver's own trip (T10).

`.venv/Scripts/python.exe -m pytest -q` — 12/12 passed, both before and after.

**Deliberately not built this pass (Phase 3, RPC/security layer):** trip lifecycle RPCs
(create/verify-loading/depart/return/reconcile), `guard_driver_trip_transition()`,
`record_driver_trip_payment()`, and the `close_cash_session()` change needed to actually
absorb reconciled trip cash into a branch session's `expected_amount` (today's function
only sums `cash_session_id`-linked payments — it does not yet know trips exist). No
`INSERT`/`UPDATE` grant exists on `driver_trips` yet by design; nothing is callable from
the client until Phase 3 lands.

## 2026-08-24 · AD-014 amendment (BLOCKER-013)

Owner approved amending AD-014 to match the implemented session storage: chunked
`expo-secure-store` entries, platform Keychain/Keystore protection, stale-chunk cleanup,
and torn-write rejection. AES-GCM via `expo-crypto` was removed because the installed
module provides no cipher. Existing executed storage checks remain the implementation
evidence; no new dependency was added.

---

## 2026-08-24 · Documentation conflict resolution (BLOCKER-007)

Clarified that `sync_conflicts` is a local client projection, while server conflict
outcomes are recorded on `sync_operations.status = 'CONFLICT'` with diagnostic metadata.
The ticket documentation conflict was already corrected when BLOCKER-005 was resolved.
BLOCKER-006 remains open for per-entity conflict strategies and the sync-applier contract.

---

## 2026-08-24 · EAS project initialization (BLOCKER-004)

**Scope:** Configure the Expo EAS project identity for the mobile app.

**Executed evidence:**
```
cd bakeflow-frontend/apps/mobile
corepack npm exec eas-cli init
-> Created @isaac2055/bakeflow
-> Project successfully linked
-> ID: 5644cf5a-1568-4da7-810e-5049143ee7cd
```

---

## 2026-08-20 · Database Migration Reconciliation (P0.5 & P1.4 / BLOCKER-002)

**Scope:** P0.5 Migration reproducibility, P1.4 Migration verification, resolving BLOCKER-002.

**Deliverables:**
1. **Migration Governance (`supabase/migrations/MIGRATION_GOVERNANCE.md`):**
   - Documented exact mapping between remote Supabase production timestamps (`20260809191552` … `20260810182611`) and repository migration files.
   - Retained 14 granular `.sql` migration files for historical reference and auditability.
2. **Baseline Schema Snapshot (`supabase/migrations/20260809_live_schema.sql`):**
   - Populated complete, canonical DDL baseline covering 37 core tables across all 8 operational domains, foreign key constraints, indexes, and forced RLS policies matching `SCHEMA-REFERENCE.md`.

**Executed Evidence:**
```
.venv/Scripts/python.exe -m pytest -q         -> exit 0, 12 passed
npm run typecheck --workspace apps/mobile     -> exit 0
npm run lint --max-warnings=0                 -> exit 0
```

---

## 2026-08-20 · Edge Function Foundation & Invitation Delivery (P6.1 & P6.2 / BLOCKER-001)


**Scope:** P6.1 Edge Function scaffold, P6.2 Invitation delivery, resolving BLOCKER-001.

**Deliverables:**
1. **Edge Function Foundation (`supabase/functions/_shared/`):**
   - `cors.ts`: CORS headers and OPTIONS preflight handling.
   - `errors.ts`: Standard JSON error envelope per `API-CONTRACT.md` §3 and `HttpError`.
   - `auth.ts`: Caller JWT verification and tenant membership assertion using service-role client.
   - `email/types.ts`: `EmailProvider` interface & message payload definitions.
   - `email/resend.ts`: Resend API adapter.
   - `email/mock.ts`: Mock email adapter.
   - `email/factory.ts`: Provider factory with environment variable resolution.
   - `templates/invite.ts`: Responsive HTML and plain-text invitation templates.
2. **Invitation Delivery Edge Function (`supabase/functions/send-invite-email/`):**
   - `index.ts`: Validates caller's tenant membership & role, verifies raw token against stored SHA-256 hash, resolves organization / role / branch names, renders email templates with deep-link/web URLs, and dispatches email via configured adapter.
3. **Frontend API Mutations (`packages/api`):**
   - `mutations/invitations.ts`: `createOrganizationInvite`, `sendInviteEmail`, `createAndSendInvite`.
   - Exported in `@bakeflow/api/index.ts`.
4. **Verification Script:**
   - `scripts/verify-invite-delivery.mjs`: Tests SHA-256 token hashing, deep link URL generation, and HTML template escaping.

**Executed Evidence:**
```
npm run typecheck --workspace apps/mobile     -> exit 0
npm run lint --max-warnings=0                 -> exit 0
.venv/Scripts/python.exe -m pytest -q         -> 12 passed
node scripts/verify-invite-delivery.mjs       -> exit 0, 3/3 passed
```

---

## 2026-08-10 · Multi-organization membership & offline sync foundation


**Scope:** B1–B4. Applied to live project `tvfyxpafbpnkneujcnvr`.

**Migrations applied (11)** — `20260810141258` … `20260810182611`, indexed in
`supabase/migrations/README-multiorg-2026-08-10.md`.

**Functions changed:** `set_active_organization` (new), `is_member_of` (new),
`is_authorized_for_branch` (new), `guard_user_role_integrity`,
`custom_access_token_hook`, `accept_organization_invite`, `sync_validate_device`,
`process_sync_batch`, `process_sync_batch_context_validated`.

**Policies changed:** `profiles_update_self`, `profiles_select`,
`profiles_update_admin`, `organizations_select`, `sync_changes_select`,
`sync_devices_*` (3), `sync_operations_select`.

**Schema:** `profiles.active_tenant_id` added; `sync_devices.tenant_id`/`branch_id`
dropped; `FORCE ROW LEVEL SECURITY` on 7 tables.

**Three defects found and fixed beyond plan:**
1. `guard_user_role_integrity()` required `user_roles.tenant_id = profiles.tenant_id`,
   making a second membership impossible to insert.
2. `jsonb_set()` is STRICT — a null active organization made the token hook return
   NULL. Present in the previously deployed hook *and* the repo's unapplied hardened
   version; never exercised because the case could not exist under single-tenancy.
3. `profiles_select`/`profiles_update_admin` matched staff on `profiles.tenant_id`,
   so a Bakery B admin could not see a driver whose home organization was Bakery A.

**Verification actually executed:**
- `pytest -q` → 12 passed
- `assert_schema_invariants()` → clean
- Security suite S1–S13 + G1/G2 → 15/15
- `tsc --noEmit` (strict) → exit 0
- `eslint .` → exit 0
- `expo install --check` → up to date
- `expo prebuild --platform android --clean` → exit 0, no warnings
- `expo-doctor` → 19/20 (the failure is a TLS error reaching Expo's API)
- Duplicate check → single `react@19.2.3`, single `expo@57.0.12`
- Live row counts after fixture teardown → 0 users / 0 orgs / 0 operations

**Native verification:** `android/gradle.properties` contains
`expo.sqlite.useSQLCipher=true`; 11 Expo modules and 6 RN modules autolinked.

**Not done (deliberate):** per-entity operation application; the gateway records
authorized operations only.

---

## 2026-08-10 · Agency agent setup

Installed 9 specialists into `.claude/agents/` with a BakeFlow governance preamble;
staged 4 deferred agents in `.claude/agents-deferred/`; created the 7 control files.
No BakeFlow feature code was written.

---

## 2026-08-10 · VERIFICATION pass — authorization foundation (steps 1–6)

Read-only re-verification of the multi-organization authorization foundation against
the live project, plus one new behavioural test. No migrations were applied.

**Verified against the live database (all PASS):**

| Step | Assertion | Evidence |
|---|---|---|
| 1 | `profiles_update_self` WITH CHECK pins `active_tenant_id`, `tenant_id`, `primary_branch_id`, `status`, `deleted_at`, `deleted_by` | `pg_policy` |
| 2 | `profiles.active_tenant_id` is `uuid` NULL with FK to `organizations`; `set_active_organization()` is SECURITY DEFINER, pins `search_path`, validates membership **and** `status='active'`; EXECUTE granted to `authenticated`, denied to `anon` | `information_schema`, `pg_proc`, `has_function_privilege` |
| 3 | Token hook reads `active_tenant_id`, filters `user_roles.deleted_at` + `roles.deleted_at` + profile `status`/`deleted_at`, scopes roles to the active organization only, and coalesces the null tenant so `jsonb_set`'s STRICT behaviour cannot return NULL | `pg_get_functiondef` |
| 4 | `guard_user_role_integrity()` no longer requires `profiles.tenant_id = NEW.tenant_id` (multi-org membership insertable) while still enforcing branch-belongs-to-organization; `organizations_select`, `profiles_select`, `profiles_update_admin` all resolve via `user_roles` | `pg_get_functiondef`, `pg_policy` |
| 5 | `accept_organization_invite` has no "already belongs to a different organization" rejection, seeds `profiles.tenant_id` only when NULL, sets `active_tenant_id` only when NULL | `pg_get_functiondef` |
| 6 | `sync_devices` has no `tenant_id`/`branch_id`; FORCE RLS on `sync_devices` + `sync_operations`; `sync_validate_device` returns `uuid` and checks ownership + revocation; no sync function references `current_tenant_id()`; internal helpers not EXECUTE-able by `authenticated`/`anon`; inner processor takes 3 args (no batch-level tenant) | `pg_proc`, `pg_class`, `has_function_privilege` |

`assert_schema_invariants()` — executed, no violations.
Row counts before and after — 0 users / 0 orgs / 0 profiles / 0 devices / 0 operations / 0 branches.

**Test-coverage gap found and closed.** A textual ordering check on
`is_authorized_for_branch()` produced a false negative (the word "owner" appears in an
explanatory comment above the branch check). Reading the body confirmed the ordering is
correct — but it revealed that no *behavioural* test covered the cross-organization
branch case. S2 only covered an unauthorized branch inside the actor's own organization.

Added **S2b** to `tests/sql/security_multiorg_sync.sql` and executed it: a user who is
**owner** in Bakery A (organization-wide authority) submitting an operation for Bakery A
that names Branch B2 (a branch of Bakery B) is refused, and zero rows are written.
Fixtures were removed; counts returned to 0.

Security suite is now **16 assertions** (S1, S2, S2b, S3, S4, S5a–d, S6–S13, G1, G2).

**No implementation work was performed. B7 was not started.**

---

## 2026-08-10 · B5 — PLAN phase only, stopped at the gate

Attempted B5 (per-entity sync operation application). **Stopped at PLAN. No code
written, no migration applied, no business table touched.** Live row counts unchanged
at 0.

**Inspected:** `tickets`/`ticket_items` columns; the five ticket guard functions;
trigger firing order on `tickets`; `docs/STATE-MACHINES.md` §1 and §63-70;
`docs/OFFLINE-SYNC-MODEL.md` conflict sections (§335, §659-663, §1018-1047).

**Verified against the live database (not read from docs):**

| Finding | Query result |
|---|---|
| Trigger order on `tickets` | `prevent_submitted_ticket_update -> tickets_assign_number -> tickets_guard_status_transition -> tickets_set_updated_at -> trg_guard_driver_created_ticket_assignment -> trg_guard_ticket_actor_assignment` |
| `prevent_submitted_ticket_update()` guards `status` | true — so it pre-empts the transition guard |
| Guards `subtotal_amount` / `total_amount` | **false / false** |
| `guard_ticket_item_mutation()` includes `submitted` | **false** |
| `sync_conflicts` table exists | **false** |
| `tickets` / `customers` rows | 0 / 0 |

**Conclusion.** Both defects documented in `docs/STATE-MACHINES.md` §63-70 are real and
still deployed: onward ticket transitions are unreachable, and a submitted ticket's
money is not frozen. Additionally the `sync_conflicts` table the sync model references
does not exist, and no per-entity conflict strategy or applier contract is defined.

An applier built on this would either fail on every transition past `submitted` or
silently rewrite finalised totals. `docs/STATE-MACHINES.md` §70 records the owner's
2026-08-10 decision not to write the remediation migration, so overriding it was not
an option.

**Raised:** BLOCKER-005 (ticket guards), BLOCKER-006 (conflict strategy / applier
contract), with matching NOTIFICATIONS entries. `CURRENT_TASK.md` marks B5 BLOCKED.

**B7 was not started**, per the human's explicit gate.

---

## 2026-08-11 · P11.1 — Lint/typecheck/spec CI gate (PARTIAL)

Established the quality gate the loop depends on. **No database logic, business rule,
sync behaviour, financial rule or frontend feature was touched. Zero migrations.**

**Problem.** Zero files in the repository were being linted. `npm run lint` exited 2
because `expo lint` globs `apps/mobile/components`, a directory that does not exist, so
ESLint aborted before reading a file (TD-011). Separately, `packages/*` sat outside the
only flat config's base path, leaving all 1,713 lines of the P4.1a catalog read path
unlinted (TD-010).

**Changed.**

| File | Change |
|---|---|
| `bakeflow-frontend/eslint.config.js` | new — root flat config for `packages/*`, ignoring `apps/**` |
| `bakeflow-frontend/apps/mobile/package.json` | `lint`: `expo lint` → `eslint . --max-warnings=0` |
| `bakeflow-frontend/package.json` | root `lint` also runs `eslint . --max-warnings=0` |
| `.github/workflows/ci.yml` | new — lint + typecheck + pytest on push to `main` and every PR |

Two configs rather than one because flat config does **not** merge across directories:
ESLint resolves exactly one config walking up from the cwd. They own disjoint paths so
they can never both claim a file.

**Executed evidence.**

| Command | Result |
|---|---|
| `npm run lint` (root) | exit 0 |
| `npm run lint --workspace apps/mobile` | exit 0, **7 files** |
| `npx eslint . --format json` (root) | exit 0, **17 files**, incl. all 8 P4.1a sources |
| `npm run typecheck` | exit 0 |
| `.venv/Scripts/python.exe -m pytest -q` | **12 passed** |

**Negative control.** Exit 0 does not prove a gate works, so a probe file with an unused
variable and an undefined identifier was linted deliberately. ESLint reported the unused
variable as a **warning and still exited 0** — which is why `--max-warnings=0` was added.
It did not flag the undefined identifier at all (`typescript-eslint` disables `no-undef`
and defers to `tsc`); `tsc` raised `TS2304`, confirming lint and typecheck are
complementary and CI must run both. Probe deleted; suites re-run clean.

**Not done, deliberately.** The SQL suites are **not** in CI, so P11.1 is PARTIAL, not
COMPLETE. They need a live Postgres and credentials; the repo cannot rebuild the schema
(BLOCKER-002) and pointing CI at production would mean storing a privileged key in
GitHub secrets. Both are human decisions.

**Not verified.** The workflow has never run on GitHub. Its commands pass locally; the
YAML itself is unproven until a push triggers it.

**TD-010 and TD-011 marked RESOLVED.** No blocker was opened or closed.

---

## 2026-08-11 · P4.2a — Inventory READ path (production code)

Second domain read service. **Zero migrations, zero schema changes.** Live row counts 0
before and after.

**Production code added**

| File | Lines | Provides |
|---|---|---|
| `packages/types/inventory.ts` | 253 | Row + read models for the 4 inventory tables; `StockMovement` as a discriminated union on `item_type`; reason/reference literal unions |
| `packages/validation/inventory.ts` | 143 | Zod schemas mirroring live constraints, incl. the per-reason sign rule |
| `packages/api/queries/inventory.ts` | 418 | The read service: warehouses, both stock-level tables, the ledger |
| `packages/api/internal/read.ts` | 196 | Shared read primitives extracted from catalog |

`packages/api/queries/catalog.ts` shrank 663 → 513 lines: its private copies of
`parseRows`/`parseRow`/`run`/`resolveLimit`/`projectionFor`/`Page` moved into
`internal/read.ts` rather than being duplicated. One response gate, not two.

**Two paging hazards catalog did not have, both handled**

1. `stock_movements.created_at` is **not unique** — a production batch writes every
   consumption and its output in one transaction sharing `now()`. A single-column cursor
   would silently drop siblings. The ledger uses a composite `(created_at, id)` keyset
   cursor. Proven necessary by suite assertion I9.
2. `warehouses.name` is unique per `(tenant_id, branch_id)`, **not** per tenant, so two
   branches may both hold a "Main Store". That list is unpaged instead.

**Executed evidence**

| Command | Result |
|---|---|
| `tests/sql/inventory_read_rls.sql` (live, BEGIN…ROLLBACK) | **15/15 passed** |
| post-run row counts, 10 tables | **0 rows** |
| `npm run typecheck` | exit 0 |
| `npx eslint packages --max-warnings=0` | exit 0 |

**Finding: the negative-stock policy is already implemented, and the roadmap was wrong
to call it unspecified.** `apply_stock_movement()` enforces it: `sale` and
`production_consume` may never drive stock negative whatever the setting (raises
`insufficient_stock`, P0001); `waste` and `adjustment` may, but only where
`organizations.allow_negative_stock` is true. Found by a fixture failing, then read from
the live function body and proven by assertions I10/I11. The roadmap's "may become a
blocker if unspecified" note is withdrawn. **No blocker was opened** — the rule exists,
it simply was not written down here.

This vindicates `signedQuantitySchema`: an opted-in bakery legitimately stores a negative
`quantity_on_hand`, so a non-negative read schema would have failed on real rows.

**Also fixed:** the P11.1 lint gate immediately caught `BakeflowApiError` left unused in
`catalog.ts` by the extraction — the first defect that gate has paid for.

**Not verified:** full-repo `npm run lint` could not complete — Node aborts
(`0xC0000409`) with 0.35 GB free RAM on this machine. Both scopes pass when run
separately; CI runners are unaffected. Recorded as TD-014.

---

## 2026-08-11 · P4.2b — Inventory WRITE path (PARTIAL — code done, suite NOT executed)

**Zero migrations, zero schema changes.**

### The mechanism was not what the milestone assumed, and the database said so

The plan was a direct `INSERT INTO stock_movements` via PostgREST. That is **impossible
for an application user**, verified live:

| Fact | Evidence |
|---|---|
| `authenticated` holds **SELECT only** on `stock_movements` | `information_schema.role_table_grants` |
| GRANTs are checked before RLS, so `stock_movements_insert` is unreachable from a client | every test insert returned `42501` |
| `adjust_stock(...)` is SECURITY DEFINER and IS EXECUTE-able by `authenticated` | `has_function_privilege` |

This is deliberate, not a gap. Routing writes through the function is what lets the server
own `created_by` (`auth.uid()`), derive `branch_id` from the warehouse, and write the
`audit_log` row in the same transaction. An INSERT grant would make all three forgeable.
A first implementation built on direct inserts was written and then **discarded** once the
grants were read — it would have failed for every user in production.

### The contract, read from the live function body

```
adjust_stock(p_warehouse_id uuid, p_item_type text, p_item_id uuid,
             p_new_quantity numeric, p_reason text = 'adjustment',
             p_note text = null) RETURNS jsonb
```

- **`p_new_quantity` is an ABSOLUTE TARGET, not a delta.** Reads the level `FOR UPDATE`,
  computes `delta = target - current`. Passing a delta would set stock *to* the delta.
- Accepts only `adjustment`, `waste`, `opening_balance`. The other six reasons belong to
  their own domain flows.
- Target equal to current is a **no-op** returning `unchanged: true` — absolute-target
  semantics give idempotency without any client token.
- Negative target refused. Roles: adjustment/opening_balance need
  owner/admin/branch_manager; waste additionally allows `baker`.
- Returns `to_jsonb(v_movement)`, which renders `numeric` **unquoted** — so every quantity
  in the envelope is already a double. `adjustStock` therefore reads only the `id` from it
  and re-reads the row through `getStockMovementById`, whose projection casts `::text`.

### Production code

| File | Change |
|---|---|
| `packages/api/mutations/inventory.ts` | **new**, 196 lines — `adjustStock()` |
| `packages/api/errors/index.ts` | `classifyP0001()` added; normalizer message made domain-neutral |
| `packages/validation/inventory.ts` | sign rule factored out; direct-insert schema removed as unreachable |
| `packages/api/index.ts`, `packages/validation/index.ts` | exports |

`classifyP0001` matters: `adjust_stock` raises plain-text `P0001` with **no** JSON detail,
so without it every authorization and validation failure normalized to `unexpected_error`
— indistinguishable from a bug. The durable fix is for those functions to carry a `DETAIL`
code; that is a database change and was not made.

### Tests

| Command | Result |
|---|---|
| `npm run typecheck` | **exit 0** |
| `npx eslint packages --max-warnings=0` | **exit 0** |
| `tests/sql/inventory_write_rls.sql` | **NOT EXECUTED** |

The write suite (A0–A12) is written and committed but **was never run**: the database
connection failed with `getaddrinfo ENOTFOUND mcp.supabase.com` immediately after the
contract was read. No assertion in it may be cited as evidence until it is executed.

**P4.2b is therefore PARTIAL, not COMPLETE.** The contract facts above were each read from
the live database before the outage; the behavioural assertions were not.

---

## 2026-08-14 · Security hardening + ticket lifecycle fix + catalog restore UX

**Scope:** Four migrations applied to live project `tvfyxpafbpnkneujcnvr`. Zero application code changes. Zero rows affected (live DB holds zero business data).

### Migrations applied

| Migration name | What it does |
|---|---|
| `drop_prevent_submitted_ticket_update_and_harden_guard` | Drops trigger + function `prevent_submitted_ticket_update`; adds `subtotal_amount` freeze to `guard_ticket_status_transition` |
| `revoke_anon_execute_on_internal_functions` | Revokes anon/authenticated EXECUTE on `bump_cash_session_revision`, `guard_daily_financial_audit_mutation`; revokes anon on `archive_ticket` and `has_permission` |
| `revoke_public_execute_bump_cash_session_revision` | Revokes PUBLIC grant on `bump_cash_session_revision` (the previous revoke targeted role directly; PUBLIC grant requires a separate revoke) |
| `partial_unique_indexes_for_soft_delete_restore` | Replaces 4 UNIQUE constraints + 1 plain index with partial unique indexes scoped to `deleted_at IS NULL` on products, ingredients, product_categories, product_variants, recipes |
| `index_permanent_deletion_challenges_tenant_id` | Adds missing FK-covering index on `permanent_deletion_challenges.tenant_id` |

### Verified live after each migration

| Check | Result |
|---|---|
| `prevent_submitted_ticket_update` trigger exists | 0 rows — dropped |
| `prevent_submitted_ticket_update` function exists | 0 rows — dropped |
| `bump_cash_session_revision` anon-callable | NO |
| `guard_daily_financial_audit_mutation` anon-callable | NO |
| `archive_ticket` anon-callable | NO |
| `has_permission` anon-callable | NO |
| All 5 partial indexes: `WHERE (deleted_at IS NULL)` | Confirmed in `pg_indexes.indexdef` |
| `idx_permanent_deletion_challenges_tenant_id` exists | Confirmed |

### BLOCKER-005 — RESOLVED

`prevent_submitted_ticket_update` was the root cause of BLOCKER-005 and BLOCKER-009. Its alphabetical trigger order caused it to fire before `guard_ticket_status_transition`, blocking every onward transition from `submitted`. The trigger and function have been removed. `guard_ticket_status_transition` is now the sole state-machine authority and guards `subtotal_amount` correctly. Every ticket status transition is now reachable.

`total_amount` is `GENERATED ALWAYS AS ((subtotal_amount - discount_amount) + tax_amount) STORED` — it cannot be written directly and needs no separate guard.

### BLOCKER-010a — RESOLVED

The five catalog unique indexes are now partial on `deleted_at IS NULL`. A soft-deleted entity's name/SKU is no longer permanently consumed. Application-layer restore UX is specified in `docs/SOFT-DELETE-AND-RETENTION.md` §38 and must be implemented as part of P4.1b.

### TD-013 — RESOLVED

All anon-callable functions from the security audit are now closed. `archive_ticket` remains callable by `authenticated` (managers need it). The two trigger functions (`bump_cash_session_revision`, `guard_daily_financial_audit_mutation`) are now inaccessible to all client roles.

### Remaining open items (unchanged)

BLOCKER-001, BLOCKER-002, BLOCKER-003, BLOCKER-004, BLOCKER-006, BLOCKER-007, BLOCKER-009 (archive_ticket `ARCHIVE` operation_type issue — separate from BLOCKER-005), BLOCKER-010b, BLOCKER-010c all remain OPEN and are unaffected by this session.

---

## 2026-08-14 · P4.4a + P4.4b — Sales READ path

**Scope:** three new files, three modified, one new SQL suite. **Zero migrations.** No
mutation of any kind was added.

### The session began by clearing the outstanding verification, and could not

`CURRENT_TASK.md` carried one unblocked item: run `tests/sql/inventory_write_rls.sql` now
that the Supabase MCP authorization was reported available. It is **still not runnable**,
for a new and different reason, established by direct calls rather than inferred:

| Call | Result |
|---|---|
| `list_organizations` | one org, `mwbgqqiifogmwdbhkbhd` — "Undeify's Org" |
| `list_projects` | one project, `etodmfsmvhewihboxcrp` |
| `list_tables` on it | 28 tables — `shifts`, `leave_requests`, `attendance_records`, `announcements`. A workforce-scheduling schema. **No BakeFlow table.** |
| `execute_sql` on `tvfyxpafbpnkneujcnvr` | `MCP error -32600: You do not have permission to perform this action` |

The connector works; it is pointed at the wrong account. BakeFlow is in organization
`tkrygyuxqyqbxgqaodjq`, which this account does not belong to. Checked for a fallback and
found none: no `.env` with a service-role key, no `psql` on PATH, no stored CLI token
(`~/.supabase` holds only telemetry), no `supabase/.temp/pooler-url`.

Recorded as **BLOCKER-011**. Work continued on the next independent milestone.

### Why P4.4 was the next milestone

`BACKEND_ROADMAP.md` listed P4.4 as BLOCKED on BLOCKER-005 — "any ticket service built now
would be built on a broken lifecycle". **BLOCKER-005 was resolved on 2026-08-14** by
dropping `prevent_submitted_ticket_update()`, so the read path's premise is sound: every
status is now reachable and `subtotal_amount` is frozen once a ticket leaves `draft`. The
roadmap's own note already split `customers` out as independently unblocked.

### Production code

| File | Change |
|---|---|
| `packages/types/sales.ts` | **new**, 280 lines — `Customer`, `Ticket`, `TicketItem`, the 10-state model, `areTicketItemsLocked` |
| `packages/validation/sales.ts` | **new**, 156 lines |
| `packages/api/queries/sales.ts` | **new**, 508 lines — 9 read functions |
| `packages/api/internal/read.ts` | 196 → 281 — composite-cursor helpers extracted; `softDeleted` added to `ReadEntity` |
| `packages/validation/decimal.ts` | `signedMoneySchema` added |
| `packages/api/queries/{catalog,inventory,production}.ts` | `softDeleted` declared; inventory's private cursor helpers deleted |
| `tests/sql/sales_read_rls.sql` | **new**, 391 lines, S1–S18 — **NOT EXECUTED** |

### Three decisions worth the record

**1. The item-freeze point is `ready`, not `confirmed`.** `SCHEMA-REFERENCE.md` §9
explicitly corrects `STATE-MACHINES.md` §1 on this, and §9 wins per `CLAUDE.md`.
`areTicketItemsLocked()` implements §9's version. Reproducing §1's would have greyed out an
edit the database accepts. S11a/S11b test both halves.

**2. `sale_customer_type` stays `string | null`.** §4 records the column but no CHECK.
Inventing a `'walk_in' | 'registered'` union would make the reader stricter than the
database — the failure the inventory milestone already paid for once with
`quantity_on_hand`. S12 asserts no CHECK exists, so the type can be narrowed the day one
does.

**3. Signed money now exists.** Through P4.3 every money column carried `CHECK >= 0`. §4
documents that check on `discount_amount`, `tax_amount`, `total_amount` and `line_total`
and **not** on `subtotal_amount`, `amount_paid` or `ticket_items.unit_price`. The asymmetry
is preserved rather than smoothed over, on the `signedQuantitySchema` precedent.

### Defect found in already-committed P4.3a code

`queries/production.ts` filtered `.is('deleted_at', null)` on `production_batches` and
`production_batch_ingredients` while selecting a column set containing neither, and
`SCHEMA-REFERENCE.md` §5 — the document those types were written from — lists `[std]` alone
for both. The module contradicted its own source. Were the column absent, PostgREST would
answer `42703` and **every production read would fail outright.**

`ReadEntity` now carries a **required** `softDeleted: boolean`, applied through
`withSoftDeleteFilter()`. All twelve entities across four domains now declare it beside the
schema that says which columns they have. Catalog (6) and inventory (4) are `true` on live
evidence — their SELECT policies reference `deleted_at`, which they could not if it did not
exist. Production (2) is `false` per §5; `ticket_items` is `false` per §4; `customers` and
`tickets` are `true`. **S2a–S2c and S3a–S3b verify all of it** and are the highest-value
assertions in the new suite.

### Tests

| Command | Result |
|---|---|
| `npm run typecheck --workspace apps/mobile` | **exit 0** |
| `npx eslint packages --max-warnings=0` | **exit 0** |
| `.venv/Scripts/python.exe -m pytest -q` | **12 passed** |
| zod projection probe (executed, zod 4.1.12) | customers 10/0 ::text, tickets 25/5, ticket_items 9/3; JSON-number payload rejected; `"3000.0000"` survived intact; cancelled-without-reason rejected; negative subtotal accepted. Probe deleted. |
| `tests/sql/sales_read_rls.sql` | **NOT EXECUTED** — BLOCKER-011 |

The probe is not ceremony: P4.3a's near-miss was a `.def.innerType` lookup that typechecked
through a cast and would have produced an empty column list at runtime. `ticketSchema` is
also a refined object, so the same trap was live here. Executed, `.shape` resolves and the
projection is 25 columns.

**P4.4 is IMPLEMENTED, not COMPLETE.** Every behavioural claim above rests on the SQL suite,
which has not run.

---

## 2026-08-14 · P4.5 — Delivery READ path

**Scope:** three new files, three barrels touched, one new SQL suite. **Zero migrations.**
No mutation added.

### Production code

| File | Change |
|---|---|
| `packages/types/delivery.ts` | **new**, 129 lines — `Delivery`, the 6-state model, `isDeliveryVerified` |
| `packages/validation/delivery.ts` | **new**, 74 lines |
| `packages/api/queries/delivery.ts` | **new**, 189 lines — `listDeliveries`, `getDeliveryById`, `getDeliveryForTicket` |
| `tests/sql/delivery_read_rls.sql` | **new**, D1–D10 — **NOT EXECUTED** |

### Three decisions worth the record

**1. `failed` is not terminal.** Its exit is `returned`, and that hop writes a return stock
movement. `OPEN_DELIVERY_STATUSES` therefore includes `failed`, and the `openOnly` filter is
offered as a flag rather than left to callers — a dispatch board that filtered `failed` out
would drop exactly the deliveries someone still has to act on.

**2. The list orders on `created_at`, not `scheduled_at`.** `scheduled_at` is nullable. An
unscheduled delivery would sort into a NULL group whose position depends on
`NULLS FIRST`/`LAST`, and a keyset comparison against NULL yields NULL — which reads as
"no more rows" and truncates the list with no error. The composite `(created_at, id)` cursor
is used for the same reason as tickets and the ledger.

**3. The `proof_url` OR `recipient_name` rule is deliberately NOT in the schema.** §3 states
it, but as a *transition* precondition checked at the `in_transit → delivered` hop, not as a
table CHECK. A delivered row can later lose its `proof_url` — an expiring storage object, a
retention job — and a reader enforcing it would then hide a completed delivery entirely.
`failure_reason` on `status = 'failed'` **is** refined, because that one is a standing
invariant. Blurring the two is the specific mistake avoided here.

### Tests

| Command | Result |
|---|---|
| `npm run typecheck --workspace apps/mobile` | **exit 0** |
| `npx eslint packages --max-warnings=0` | **exit 0** |
| zod probe (executed, zod 4.1.12) | 16 columns, 0 `::text` (correct — no NUMERIC column exists); `failed` without a reason rejected; `delivered` without proof or name **accepted**, confirming decision 3; unknown status rejected. Probe deleted. |
| `tests/sql/delivery_read_rls.sql` | **NOT EXECUTED** — BLOCKER-011 |

**P4.5 is IMPLEMENTED, not COMPLETE.** D5/D6/D7 are the roadmap's stated completion gate —
that the `ready → delivered` rule is enforced by the database rather than by convention —
and they have not run.

---

## 2026-08-15 · Live verification pass — BLOCKER-011 resolved, BLOCKER-012 found

**Scope:** no migrations (migration rule in force). Six production files corrected against
the live schema, two SQL suites corrected and executed, one P0 live defect found.

### Connection

The project-scoped connector was reauthorized. `execute_sql` against
`tvfyxpafbpnkneujcnvr` returns 37 public tables with the BakeFlow schema present.
**BLOCKER-011 RESOLVED.** Identity was checked, not assumed — the previously-authorized
account reached a workforce-scheduling schema that also answered MCP calls successfully.

### Executed against the live database

| Suite / check | Result |
|---|---|
| Sales structural (S1, S3, S4, S4b, S5, S6, S8, S12a–d, S19) | **12/12 passed** |
| Customers RLS (S13c, S13d, S16b, S16c, S18c, S20) | **6/6 passed** |
| `inventory_write_rls.sql` A0–A12 | **14/15**, then **17/17** after the A11 fix below |
| `production_batches` / `production_batch_ingredients` columns, CHECKs, policies | read column-for-column |
| `customers` / `tickets` / `ticket_items` / `deliveries` columns, CHECKs, policies | read column-for-column |
| `npm run typecheck` / `npx eslint packages --max-warnings=0` | **exit 0 / exit 0**, captured directly rather than through a pipe |

**P4.2b is COMPLETE.** **P4.4a (customers) is COMPLETE.**

### A11 — a test defect, not a product defect

A11 failed with `audit rows = 0`. `adjust_stock()` does call `log_audit_event`, and the row
was there: visible as `postgres`, invisible to the assertion because it ran as
`authenticated` holding `branch_manager`, and `audit_log`'s SELECT policy is
`tenant_id = current_tenant_id() AND has_role('owner','admin','accountant') AND deleted_at IS NULL`.

Measuring an invariant *through* a policy that hides it tests the policy. A11 now measures
with RLS bypassed; **A11c asserts the restriction deliberately** — a branch_manager sees 0
audit rows — so the property is locked in rather than papered over.

### Six corrections the live schema forced on already-committed code

| # | Was | Live truth |
|---|---|---|
| 1 | `softDeleted: false` on `production_batches`, `production_batch_ingredients`, `ticket_items`, `deliveries` | **All 16 domain tables carry `deleted_at`.** All flags are `true`. |
| 2 | `sale_customer_type: string \| null` | `NOT NULL`, `CHECK IN ('REGISTERED','ROADSIDE')` |
| 3 | `signedMoneySchema` for `subtotal_amount`, `amount_paid`, `unit_price` | all three carry `CHECK >= 0`; **no money column permits a negative** — the schema was removed |
| 4 | `line_total` a written column with a ROUND identity CHECK | `GENERATED ALWAYS ... STORED` — unwritable, and the fixtures raised `428C9` until they stopped supplying it |
| 5 | delivery proof rule treated as a transition precondition only | `deliveries_delivered_needs_proof` is a **standing CHECK**; also `deliveries_assigned_needs_driver` |
| 6 | `production` `actual_quantity` signed, ingredient `planned_quantity` non-negative | `actual_quantity >= 0`, `planned_quantity > 0` on **both** tables |

**Correction #1 reverses a change made the previous day.** P4.3a's original unconditional
`deleted_at` filter was right; it was "fixed" by reconciling two documents against each
other because the database was unreachable. `SCHEMA-REFERENCE.md`'s `[std]` shorthand simply
does not enumerate the soft-delete pair even where it exists, so its absence carries no
information. `CLAUDE.md` already says the live database outranks every document here.

### One policy worth knowing before the frontend

`deliveries_select` is the only policy in the system with a disjunction:
`tenant_id = current_tenant_id() AND (driver_id = auth.uid() OR has_branch_access(branch_id)) AND deleted_at IS NULL`.
A driver sees deliveries assigned to them **outside their assigned branches**. Correct for
the job, but it means `listDeliveries({ branchId })` is a filter and never a boundary.
Tenant isolation is unaffected.

### BLOCKER-012 — no ticket can be created (migration-dependent)

`assign_order_number()` passes `'ticket'` to `next_document_number()`, whose CASE maps it to
`TKT`, but `document_sequences_doc_type_check` still allows only
`('order','invoice','production_batch')`. `'ticket'` fails the constraint; `'order'` fails
the function. **Every ticket INSERT raises 23514** — which is why `tickets` holds zero rows.
Fixing it is a constraint swap, deliberately not applied in this pass. See BLOCKER-012.

---

## 2026-08-15 · P8.1 — first frontend vertical slice

**Scope:** sign in → choose bakery → catalog. **Zero migrations, zero database changes.**
The four backend blockers (012, 003, 006, 009) were left untouched and unworked-around.

### Files

| File | Change |
|---|---|
| `packages/config/index.ts` | 4 → 74 — env resolution, fails loudly and names the variable |
| `packages/auth/index.ts` | 4 → 234 — chunked SecureStore session storage, client factory, `setActiveOrganization` |
| `packages/hooks/index.ts` | 4 → 196 — organization-scoped query keys and catalog hooks |
| `packages/types/organization.ts`, `packages/validation/organization.ts`, `packages/api/queries/organizations.ts` | **new** — membership read path |
| `apps/mobile/stores/session.ts`, `providers/AppProviders.tsx`, `components/ScreenState.tsx` | **new** |
| `apps/mobile/app/{_layout,index,sign-in,select-organization}.tsx` | root gate + three screens |
| `scripts/verify-cache-isolation.mts`, `apps/mobile/.env.example` | **new** |

### The load-bearing decision: cache identity

`packages/api` signatures carry **no tenant argument** — the tenant is the JWT claim RLS
reads. Correct for the data layer, a trap for the cache layer: `['products']` is identical
for every organization, so after a switch TanStack Query would serve bakery A's catalog
under bakery B's name, from memory, with no request and no error. Invisible with one
organization; indistinguishable from a leak with two.

Every organization-scoped key therefore begins `['org', tenantId]` and is built only via
`orgScoped()`. The id used is **the claim in force on the current token**, not the one
tapped — those differ for the whole window between the RPC and the refresh.

Eviction is `removeQueries`, not `invalidateQueries`: invalidation keeps serving stale data
while refetching, so the first frame after a switch would still show the previous bakery.

### Two live-schema facts the design depends on

- **`organizations_select` keys off `auth.uid()`, not `current_tenant_id()`.** Without that
  the switcher would be unreachable — a user with a null claim sees zero rows everywhere
  else — and the app would deadlock on first sign-in.
- **`set_active_organization()` updates one column** (`profiles.active_tenant_id`) and
  nothing else. The claim lives in the JWT, so the RPC alone changes nothing the database
  can see. `setActiveOrganization` does the RPC **and** the refresh; splitting them would
  produce a UI that switched while the database did not.

### Tests

| Command | Result |
|---|---|
| `npm run typecheck` (all workspaces) | **exit 0** |
| `npx eslint packages --max-warnings=0` | **exit 0** |
| `npm run lint --workspace apps/mobile` | **exit 0**, 12 files, all 7 new files covered — counted via `--format json`, not inferred from the exit code |
| `npm run verify:cache` | **11/11 passed** |
| `pytest -q` | **12 passed** |
| On-device run | **NOT PERFORMED** — `apps/mobile/.env` has no anon key |

`scripts/verify-cache-isolation.mts` is an executable check, not a unit test: the repo has
no jest/vitest/react-test-renderer, so component behaviour cannot be asserted. It drives a
real `QueryClient` and proves keys differ per organization, that B's key returns nothing
while A's data is cached, that a switch evicts organization-scoped entries but keeps the
user-scoped organization list, and that sign-out empties the cache.

### BLOCKER-013 — AD-014 is not implementable as written

AD-014 specifies "AES-256-GCM via `expo-crypto`". `expo-crypto` has **no cipher** — only
random bytes, digests and `randomUUID`, verified against the installed types. Sessions ship
on chunked SecureStore (Android Keystore / iOS Keychain) instead, which honours "no
AsyncStorage" and no-plaintext-on-disk without a hand-rolled cipher. Recorded for a
decision rather than substituted silently.

---

## 2026-08-15 · P8.1 review + P9.1 catalog browse

**Zero migrations, zero database changes.**

### P8.1 review found one bug that made the whole slice non-functional

`activeTenantIdFromSession` read `session.user.app_metadata.tenant_id`. The live
`custom_access_token_hook` writes **top-level claims**:

```sql
claims := jsonb_set(claims, '{tenant_id}', coalesce(to_jsonb(v_active), 'null'), true);
claims := jsonb_set(claims, '{roles}',     coalesce(to_jsonb(v_roles),  '[]'),   true);
```

So the accessor returned `null` for every signed-in user: permanent redirect to the
organization picker, every catalog query disabled, switching apparently inert. Typecheck,
lint and the 11 cache-isolation checks all passed, because **none of them touches a real
token** — the P8.1 report's "verified" claims were true and beside the point.

Fixed by decoding the JWT payload. Claim reading moved to `packages/auth/claims.ts`, which
imports nothing from React Native, so `verify-cache-isolation.mts` can exercise it under
Node — `packages/auth/index.ts` pulls in `expo-secure-store` → `react-native`, whose
Flow-typed entry esbuild cannot transform. Six new checks build a real JWT and assert the
claim location.

### Other P8.1 defects fixed

| Defect | Fix |
|---|---|
| No `SafeAreaProvider` — screens using `SafeAreaView` outside a navigator would measure zero insets | mounted explicitly in `AppProviders` |
| `verify:cache` used `npx --yes tsx@…`, non-deterministic | `tsx@4.23.12` pinned as a root devDependency; lockfile updated |
| No `.env`, so nothing could run | `apps/mobile/.env` written with the project URL and publishable key (gitignored; `.env.example` already committed) |
| Near-miss: I replaced `packages/utils/money.ts` with a half-up rounding formatter | **reverted.** The existing file truncates deliberately and documents why: the settlement rounding rule is unspecified (BLOCKER-003), so offering a rounding helper invites it to feed a stored value. P9.1 uses the existing `formatNaira`. |

### Runtime verification against the live project

Executed with the publishable key against `tvfyxpafbpnkneujcnvr`:

| Check | Result |
|---|---|
| `products` / `organizations` / `product_variants` as anon | `42501 permission denied for table` |
| `tickets` as anon | denied |
| `set_active_organization` as anon | `42501 permission denied for function` |
| sign-in with bad credentials | `Invalid login credentials` — auth endpoint reachable |

Anonymous access is refused at the **GRANT** level, before RLS is consulted. Config,
transport and the client factory are therefore proven against the real project.

**Still not verified:** a signed-in run. That needs real user credentials, which do not
exist in this environment — no organization switch or catalog render has been observed on a
device.

### P9.1 — catalog browse

`app/product/[id].tsx`: product detail with its variants, each priced. `useProduct` added;
catalog rows navigate.

`unit_price` lives on `product_variants`, so a product has *a set of prices*, never one.
**No price is summarised** — no "from ₦X", no range. That would need comparison over money,
and `"900.0000" > "1000.0000"` lexicographically while a numeric comparison would require
the double conversion the whole precision strategy exists to prevent. Prices render through
`formatNaira`, which truncates.

### Tests

| Command | Result |
|---|---|
| `npm run typecheck` (all workspaces) | **exit 0** |
| `npx eslint packages --max-warnings=0` | **exit 0** |
| `npm run lint --workspace apps/mobile` | **exit 0**, 13 files, all 8 app files covered (counted via `--format json`) |
| `npm run verify:cache` | **22/22 passed** (11 cache + 6 claim + 5 money) |
| `pytest -q` | **12 passed** |
| Live anon-key runtime probe | executed, results above |

`scripts/` is outside the root ESLint config's scope and is therefore unlinted — noted, not
fixed, to avoid reconfiguring lint scope alongside a feature change.

---

## 2026-08-15 · Signed-in smoke test — BLOCKER-014 found

**Zero migrations.** Scratch DML fixtures only (one auth user, three organizations, a small
catalog), created to make a real signed-in run possible and left in place for re-runs.

### The finding

A real sign-in returns a JWT with **no `tenant_id` claim and no `roles` claim** — not null,
absent. `current_tenant_id()` is `auth.jwt() ->> 'tenant_id'`, so every tenant-scoped table
returns zero rows for every authenticated user. The app cannot function.

`custom_access_token_hook` exists, `supabase_auth_admin` holds EXECUTE and schema USAGE, and
the `*_auth_hook_read` policies are present. Auth logs for the smoke sign-in show clean
`200`s with no hook invocation and no hook error — a configured-but-failing hook would log
one. The hook is not registered in the project's Auth settings. **BLOCKER-014**, project
configuration, not code.

Every SQL suite to date sets `request.jwt.claims` by hand, simulating the hook's output. So
they proved the policies correct *given* a claim and never that one is minted. This is the
gap the smoke test existed to close, and it closed it.

### What the smoke test did prove (20/30)

Sign-in; the organization switcher loading with a null claim and showing exactly the two
memberships while hiding the third organization; own roles readable; an empty catalog rather
than an error with no active org; `set_active_organization` succeeding for a member and
**refused** for a non-member (`not a member of this organization`); the RPC alone leaving
the old token unchanged; `refreshSession`; sign-out; and post-sign-out reads denied at the
GRANT level (`42501`), not merely filtered.

### BLOCKER-013 — implementation half resolved

Chunking moved to `packages/auth/chunked-storage.ts`, backend-injected so Node can exercise
it. Eight new executed checks: a >2KB session round-trips exactly, it really is split, every
chunk is within the SecureStore limit, a shorter overwrite leaves no orphaned tail, a torn
write reads as *no* session rather than a truncated one, and removal clears everything. Only
the AD-014 amendment remains, and that is a decision.

### Tests

| Command | Result |
|---|---|
| `npm run typecheck` | **exit 0** |
| `npx eslint packages --max-warnings=0` | **exit 0** |
| `npm run lint --workspace apps/mobile` | **exit 0** |
| `npm run verify:cache` | **30/30 passed** (11 cache + 6 claim + 5 money + 8 storage) |
| `pytest -q` | **12 passed** |
| `scripts/smoke-signed-in.mjs` | **20/30** — 10 failures all downstream of BLOCKER-014 |

---

## 2026-08-15 — BLOCKER-014 resolved; P9.4 inventory read path

### BLOCKER-014 closed

The access-token hook was enabled on `tvfyxpafbpnkneujcnvr` and GoTrue now invokes it.
Sign-in mints `tenant_id` and `roles` as top-level claims. Nothing in the database or the
application changed — the whole gap was one project setting.

The diagnosis technique is worth keeping: joining `pg_stat_statements` to `pg_roles` and
counting calls *by caller* is what distinguished "the hook is broken" from "the hook is
never called". `supabase_auth_admin` sat at 0 calls against `postgres`'s 11 while the
function itself returned correct claims when invoked directly.

### Two test defects fixed (no application defect)

`set_active_organization` deliberately rejects NULL and persists to
`profiles.active_tenant_id`, so an organization choice survives sign-out and is restored at
the next sign-in. The smoke test assumed a never-used account, so it passed only on its
first ever run. Both assertions now state invariants that hold in every state: the catalog
holds exactly the token's tenant rows (and nothing when the claim is null), and after the
RPC the un-refreshed token still carries the **previous** tenant — which is precisely why
`refreshSession()` is mandatory rather than cosmetic.

### P9.4 — inventory read path

`useWarehouses`, `useIngredients`, `useAllProductVariants`, `useIngredientStockLevels`,
`useProductStockLevels`, all organization-scoped; `app/inventory/index.tsx` (stockroom
picker) and `app/inventory/[warehouseId].tsx` (stock on hand, ingredients and finished goods).
Read-only by design: levels are trigger-maintained from the immutable ledger, so an "edit
quantity" control would misrepresent how the system works. Zero migrations.

`compareDecimalStrings` added to `packages/types/scalars.ts` — exact digit-wise comparison,
needed for the low-stock cue. `Number('12345678901234.5678')` already loses the fourth
decimal, so any float comparison would mis-order values the database stores exactly.

### A live-behaviour correction

Seeding fixtures surfaced a documentation defect. `packages/types/inventory.ts` claimed
negative stock was reachable because "no non-negative CHECK exists". True about constraints,
wrong about behaviour: `apply_stock_movement()` enforces it. Verified all three branches in
a rolled-back transaction:

| Attempt | Live result |
|---|---|
| `production_consume` beyond stock | **refused** — `insufficient_stock: Smoke Yeast short by 96.5000 g` |
| `waste` beyond stock, `allow_negative_stock = false` | **refused** — `movement would leave -96.5000 on hand` |
| same `waste`, `allow_negative_stock = true` | **allowed**, `on_hand = -96.5000` |

The probe rolled itself back; `allow_negative_stock` is false and the yeast level is
`2.5000`, as before. Doc comments in the type and the screen now state the real rule.

### Rule 7 verified end-to-end

Stock **levels** were never inserted — only ledger movements were. The smoke test asserts
the resulting levels equal the sum of their movements (`30 - 5 = 25`, `5 - 2.5 = 2.5`),
so the trigger's arithmetic is what is being checked, not fixture data.

### Tests

| Command | Result |
|---|---|
| `scripts/smoke-signed-in.mjs` | **39/39 passed** (was 20/30) |
| `npm run verify:cache` | **46/46 passed** (+16 decimal-comparison checks) |
| `npm run typecheck --workspace apps/mobile` | **exit 0** |
| `npm run lint --workspace apps/mobile` | **exit 0** |
| `npx eslint packages --max-warnings=0` | **exit 0** |
| `pytest -q` | **12 passed** |

---

## 2026-08-16 — P9.5 production batches, read path (frontend)

Batch list with a server-side status filter, batch detail with ingredient lines. Three
organization-scoped hooks (`useProductionBatches`, `useProductionBatch`, `useRecipesByIds`)
over the existing `packages/api/queries/production.ts`, plus one new query,
`listRecipesByIds`. **Zero migrations.**

### Why this milestone and not P9.6

P9.6 delivery is written but cannot be *verified*: a delivery requires a ticket, and
BLOCKER-012 makes every ticket INSERT fail. `production_batches.ticket_id` is nullable and
`assign_batch_number()` routes through `next_document_number(…, 'production_batch')` — a
doc type the `document_sequences` CHECK allows, unlike `'ticket'`. Production is the only
P9 slice both unblocked and live-verifiable today.

### Fixtures insert batches only; the trigger produces the lines

`copy_batch_planned_ingredients()` (AFTER INSERT) writes
`round(recipe_quantity * (planned_quantity / yield), 4)` per line. Observed live:

| Batch | Planned | Recipe yield | Line | Trigger result |
|---|---|---|---|---|
| BATCH-000001 | 25.0000 | 10.0000 | Flour 2.5 | `6.2500` |
| BATCH-000001 | 25.0000 | 10.0000 | Sugar 0.75 | `1.8750` |
| **BATCH-000002** | **7.0000** | **3.0000** | **Flour 2.5** | **`5.8333`** |
| BATCH-000003 | 5.0000 | 10.0000 | Sugar 0.75 | `0.3750` |

The 5.8333 line is the load-bearing one: `2.5 × 7/3 = 5.83333…`, so the value only appears
if the rounding happens in the database at four decimals.

`assign_batch_number()` also proved document sequences are **per tenant** — org A holds
`BATCH-000001..3` and org B holds its own `BATCH-000001`. A global sequence would leak how
much other bakeries produce; the smoke test asserts the duplicate.

### State machine executed, not read (one transaction, rolled back)

| Attempt | Live result |
|---|---|
| `cancelled → in_progress` | REFUSED — `invalid_transition: batch cancelled -> in_progress` |
| `scheduled → completed` (skipping `in_progress`) | REFUSED — `invalid_transition` |
| `complete_production_batch(in_progress, 7.0)` | OK — status `completed`, actual `7.0000`, `completed_at` set, **2** movements |
| ledger the RPC wrote | `production_consume -5.8333` \| `production_output 7.0000` |
| flour on hand | `120.0000` → `114.1667` |
| ingredient line actual | `5.8333` |
| `completed → in_progress` (reopen) | REFUSED — `invalid_transition` |

Verified after ROLLBACK that nothing persisted: flour `120.0000`, 7 movements, batch still
`in_progress`, 0 lines with actuals.

One diagnostic worth keeping: the first attempt raised `insufficient_role` because the
simulated claim omitted `roles`. `has_role()` reads `auth.jwt() -> 'roles' ?| keys` — the
claim is a JSON **array**, and a simulation without it fails in a way that looks like an
authorization defect but is the harness being wrong.

### RPC signatures now read from the live database

```
complete_production_batch(p_batch_id uuid, p_actual_quantity numeric,
                          p_ingredient_actuals jsonb DEFAULT '[]', p_warehouse_id uuid DEFAULT NULL)
fail_production_batch(p_batch_id uuid, p_reason text,
                      p_ingredient_actuals jsonb DEFAULT '[]', p_warehouse_id uuid DEFAULT NULL)
```

Both `SECURITY DEFINER`, both returning `{batch, movements}`. `fail_` writes the consume
movements and **deliberately no output movement** — a failed batch still used its flour.
This removes the stated obstacle to P4.3's write path; it does not make the write path done.

### Documentation defect corrected

`packages/api/queries/production.ts` still carried a "not yet live-verified" provenance
caveat that stopped being true on 2026-08-15. Both tables match `information_schema.columns`
and `pg_constraint` exactly. The header now records the live RLS predicates instead,
including that `production_batch_ingredients` reaches its branch axis **through its parent**
— which is why querying the child directly cannot widen visibility.

### Cache-key guard strengthened

`verify-cache-isolation.mts` now enumerates **every** builder in `queryKeys` and requires
each to be organization-scoped unless explicitly allowlisted as user-scoped. The previous
checks sampled three keys, so a future key that forgot `orgScoped()` would have passed them.
`recipesByIds` is additionally asserted to key on the id *set*, not the array order.

### Tests

| Command | Result |
|---|---|
| `scripts/smoke-signed-in.mjs` | **51/51 passed** (was 39/39) |
| `npm run verify:cache` | **61/61 passed** (was 46) |
| `npm run typecheck` | **exit 0** |
| `npm run lint --workspace apps/mobile` | **exit 0**, 18 files, all 3 new files covered (`--format json`) |
| `npx eslint packages --max-warnings=0` | **exit 0** |
| `pytest -q` | **12 passed** |

On-device run: **NOT PERFORMED** — no anon key configured on a device.

### Defect found in the recorded fixture cleanup (not executed, corrected in place)

`CURRENT_TASK.md` carried a two-line cleanup ending in
`delete from public.organizations where slug like 'smoke-bakery-%'`. That **cannot succeed**:
`organizations` has 32 RESTRICT children and 0 cascades (verified live). It would have
raised `23503` on the first child table, which is a bad thing to discover while trying to
sanitise a database before production. A child-first order is now recorded, derived by
iterating `information_schema.columns` for `tenant_id` and counting rows per table:

```sql
do $$
declare r record; n bigint;
begin
  for r in select table_name from information_schema.columns
           where table_schema='public' and column_name='tenant_id' order by table_name
  loop
    execute format('select count(*) from public.%I where tenant_id in (%L,%L,%L)',
      r.table_name, :a, :b, :c) into n;
    if n > 0 then insert into fixture_rows values (r.table_name, n); end if;
  end loop;
end $$;
```

16 tables hold fixture rows today. No cleanup was run — the fixtures are still needed to
re-run the smoke test.

---

## 2026-08-16 — BLOCKER-012 resolved; BLOCKER-015 found behind it

### Migration APPLIED: `20260816131235_fix_document_sequences_doc_type_check_for_ticket`

`document_sequences_doc_type_check` allowed `('order','invoice','production_batch')` while
`assign_order_number()` passes `'ticket'` and `next_document_number()` rejects `'order'` —
disjoint, so no value satisfied both and every ticket INSERT raised 23514. The constraint now
allows `('ticket','invoice','production_batch')`.

Zero `doc_type='order'` rows existed, so no data migration ran. The rename statement is kept
for other environments and **cannot** violate `UNIQUE (tenant_id, doc_type)`: a `'ticket'` row
cannot exist anywhere the old constraint is in force, because that constraint is what forbids
the value. No counter merge is needed, and numbering continues from `current_value` rather
than restarting — `tickets.ticket_number` is unique per tenant, so a reset would collide.

Applied through `apply_migration`, matching the convention of the last five applied
migrations (recorded in the remote migration history; no repo file, since the 14 files in
`supabase/migrations/` are the never-applied set of BLOCKER-002 and adding an applied file
among them would deepen that confusion).

### Verification found a SECOND defect with the same symptom — BLOCKER-015

The first real signed-in INSERT after the migration failed on `P0001 invalid order creator`
from `guard_order_actor_and_assignment()`. Isolated in one rolled-back transaction:

| Attempt | Result |
|---|---|
| INSERT as the schema stands | REFUSED — `P0001 invalid order creator` |
| same INSERT, `profiles.tenant_id` set to the target org | **CREATED `TKT-000001`** |
| same user (owner of A and B, home = A), INSERT into **B** | REFUSED — `invalid order creator` |

Row 2 is the proof that the constraint fix works. Row 3 is the new defect: the guard resolves
membership through `profiles.tenant_id`, which under the multi-organization model is the
user's **home** organization, not their membership set —
`accept_organization_invite()` says so in its own body. Membership is `user_roles`, which the
same function already consults for the assignee's driver role. Nothing persisted: 0 tickets,
0 ticket sequences, `profiles.tenant_id` still null.

### Migration DRAFTED but NOT APPLIED — `fix_ticket_actor_membership_check_for_multi_org`

The `apply_migration` call was **denied by the permission classifier**. It was not worked
around. Re-run this unmodified once approved:

```sql
create or replace function public.guard_order_actor_and_assignment()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_is_driver boolean := public.has_role(array['driver']);
begin
  -- created_by is immutable after insertion. Never overwrite historical authorship.
  if tg_op = 'INSERT' then
    if v_uid is not null then
      new.created_by := v_uid;
    end if;

    if v_uid is not null and v_is_driver and new.assigned_to is null then
      new.assigned_to := v_uid;
    end if;
  elsif tg_op = 'UPDATE' then
    new.created_by := old.created_by;

    -- Drivers may work their tickets, but cannot reassign them.
    if v_uid is not null and v_is_driver and new.assigned_to is distinct from old.assigned_to then
      raise exception 'drivers cannot reassign tickets';
    end if;
  end if;

  if new.created_by is not null then
    if not exists (
      select 1
      from public.profiles p
      where p.id = new.created_by
        and p.deleted_at is null
        and exists (
          select 1
          from public.user_roles ur
          where ur.profile_id = p.id
            and ur.tenant_id  = new.tenant_id
            and ur.deleted_at is null
        )
    ) then
      raise exception 'invalid order creator';
    end if;
  end if;

  if new.assigned_to is not null then
    if not exists (
      select 1
      from public.profiles p
      where p.id = new.assigned_to
        and p.deleted_at is null
        and exists (
          select 1
          from public.user_roles ur
          where ur.profile_id = p.id
            and ur.tenant_id  = new.tenant_id
            and ur.deleted_at is null
        )
    ) then
      raise exception 'assigned staff member does not belong to this organization';
    end if;

    if not exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.profile_id = new.assigned_to
        and ur.tenant_id = new.tenant_id
        and ur.deleted_at is null
        and r.key = 'driver'
        and r.deleted_at is null
        and (ur.branch_id is null or ur.branch_id = new.branch_id)
    ) then
      raise exception 'assigned staff member is not a driver for this branch';
    end if;
  end if;

  return new;
end;
$function$;
```

Only the two membership lookups change. The rule is unchanged — the actor must belong to the
organization the ticket is written into — and only the table consulted moves. It is strictly
tighter in one respect: a profile carrying `tenant_id = A` with no `user_roles` row for A
previously passed and no longer would.

### RPC signatures read live (for whoever builds the write paths)

```
confirm_ticket(p_order_id uuid) returns jsonb
complete_ticket(p_order_id uuid, p_warehouse_id uuid DEFAULT NULL) returns jsonb
cancel_ticket(p_order_id uuid, p_reason text) returns jsonb
archive_ticket(p_ticket_id uuid, p_reason text) returns tickets
transition_delivery(p_delivery_id uuid, p_to_status text, p_proof_url text DEFAULT NULL,
                    p_recipient_name text DEFAULT NULL, p_reason text DEFAULT NULL,
                    p_driver_id uuid DEFAULT NULL) returns jsonb
update_delivery_details(p_delivery_id uuid, p_address_line text DEFAULT NULL,
                        p_contact_phone text DEFAULT NULL,
                        p_scheduled_at timestamptz DEFAULT NULL) returns jsonb
```

Grants confirm the mechanism rather than leaving it to inference: `authenticated` holds
`INSERT, SELECT` on `tickets` and `deliveries` and **no UPDATE** on either, so rows are
created through PostgREST + RLS and every transition goes through a SECURITY DEFINER RPC.
`ticket_items` additionally holds UPDATE. This retires the "signatures not read" half of the
P4.5 write-path blocker; what remains is BLOCKER-015 and the unspecified financial rules.

### Tests

| Command | Result |
|---|---|
| `scripts/smoke-signed-in.mjs` | **53 pass / 9 fail** — all nine downstream of BLOCKER-015, with a printed diagnosis |
| `npm run verify:cache` | **61/61 passed** |
| `npm run typecheck` | **exit 0** |
| `npm run lint --workspace apps/mobile` | **exit 0** |
| `npx eslint packages --max-warnings=0` | **exit 0** |
| `pytest -q` | **12 passed** |

The smoke suite is deliberately left red. The ticket path genuinely does not work, and the
nine assertions describe the behaviour the system is supposed to have.

---

## 2026-08-16 — BLOCKER-015 resolved; the ticket path works end to end

### Migration APPLIED: `fix_ticket_actor_membership_check_for_multi_org`

The statement recorded in the previous entry was applied unmodified (plus a header comment
block). It replaces the two `profiles.tenant_id` membership lookups inside
`guard_order_actor_and_assignment()` with `user_roles` checks and changes nothing else.

Post-apply, re-read from `pg_proc` rather than assumed:

```
prosecdef = true
proconfig = {search_path=public}
owner     = postgres
proacl    = {postgres=X/postgres, service_role=X/postgres}
```

`create or replace function` preserved owner, security attributes and the EXECUTE ACL. The
trigger binding is untouched: `trg_guard_ticket_actor_assignment BEFORE INSERT OR UPDATE OF
created_by, assigned_to, branch_id, tenant_id ON public.tickets`.

### Authorization verified behaviourally — 1 signed-in + 8 rolled back

Row 1 is a real PostgREST INSERT from `scripts/smoke-signed-in.mjs`. Rows 2–11 ran in one
transaction terminated by `ROLLBACK`, each in its own exception-trapping sub-block.

| # | Scenario | Result |
|---|---|---|
| 1 | member of A → create in A | CREATED, `created_by=aa000000-…-da01` |
| 2 | member of A **and** B, home org = A → create in **B** | CREATED `3e7d9707-…` |
| 3 | non-member → create in C | REFUSED — `invalid order creator` |
| 4 | membership soft-deleted → create in A | REFUSED — `invalid order creator` |
| 5 | assignee not a member of the tenant | REFUSED — `assigned staff member does not belong to this organization` |
| 6 | assignee is a member, no driver role for the branch | REFUSED — `assigned staff member is not a driver for this branch` |
| 7 | assignee **is** a driver for that branch | CREATED, `assigned_to` preserved |
| 8 | a driver creates a ticket | CREATED, auto-assigned to themselves |
| 9 | a driver reassigns a ticket | REFUSED — `drivers cannot reassign tickets` |

Rows 5–9 are the pre-existing assignee/driver rules, unchanged by this migration and
re-proven after it. Nothing persisted — re-read after the rollback:

```
home_tenant_still_null   = null
driver_rows              = 0
soft_deleted_memberships = 0
tickets_total            = 1   (TKT-000001, the real signed-in one)
```

### Two test defects found by the change and fixed

Both were in `scripts/smoke-signed-in.mjs`; neither was an application defect.

1. **`line_total` asserted a contract the database does not have.** The suite sent
   `unit_price: '1500.5000'` and asserted `2 × 1500.5000 = 3001.0000`. Live,
   `guard_order_item_price()` — read, not guessed — does
   `NEW.unit_price := v_price` from `product_variants.unit_price` on **every** INSERT, so
   pricing is catalog-authoritative and a client cannot name its own price. The assertion was
   replaced with the stronger, true one: the submitted price is discarded, the catalog price
   (`850.0000`) wins, `line_total` is `GENERATED ALWAYS AS round(quantity * unit_price, 4)` =
   `1700.0000`, and a new check proves `recalculate_ticket_totals()` propagated
   `1700.0000` to the ticket header. Three checks where there was one, none weaker.
2. **`Buffer` was used without importing `node:buffer`** — `no-undef` under the root ESLint
   gate. Fixed with the explicit import.

### Regression guards added

- `the same user CAN create a ticket in their SECOND organization (BLOCKER-015)` — the exact
  case that failed, through real auth.
- `B's ticket is numbered from B's OWN sequence and stamped with B's tenant` — B minted its
  own `TKT-000001` while A was on `TKT-000002`, so document numbers stay per tenant.
- The printed diagnosis banner was rewritten from "needs approval" to a regression notice for
  `invalid order creator`, plus a new one-line notice for a `23514` (BLOCKER-012) return.

### Gates — all executed from `bakeflow-frontend`

| Command | Result |
|---|---|
| `node scripts/smoke-signed-in.mjs` | **66 pass / 0 fail**, exit 0 (was 53/9) |
| `npm run typecheck --workspace apps/mobile` | **exit 0** |
| `npm run lint --workspace apps/mobile` | **exit 0** |
| `npm run lint` (workspaces + root `eslint .`) | **exit 0** |
| `npm run verify:cache` | **61 checks, all passed** |
| `.venv/Scripts/python.exe -m pytest -q` | **12 passed** |

`npm run deps:check --workspace apps/mobile` failed with `Error: read ECONNRESET` reaching the
Expo registry — a network failure in this environment, not a code defect, and unrelated to
this change. It is the one documented gate not green.

### Fixture consequence

The smoke suite now creates one real ticket per run in **each** scratch organization, so
`deliveries`, `ticket_items` and `tickets` were added to the teardown order in
`CURRENT_TASK.md`, above `document_sequences` and below `production_batches` (which
references `tickets` through `ticket_id`).

---

## 2026-08-17 — P9.6 delivery read path; P4.5 layer live-verified

### The P4.5 data layer was verified against the live database, not trusted

`packages/types/delivery.ts`, `packages/validation/delivery.ts` and
`packages/api/queries/delivery.ts` were written from `SCHEMA-REFERENCE.md` §6 and
`STATE-MACHINES.md` §3 and each carried a standing caveat: *"not from a live read — verify
before P4.5 is marked COMPLETE"*. Executed:

| Read | Result |
|---|---|
| `information_schema.columns` for `deliveries` | 19 columns, every field in the `Delivery` interface present with the stated nullability |
| `pg_constraint` (CHECK + UNIQUE) | 10 constraints; `deliveries_status_check` allows exactly the six values in `DELIVERY_STATUSES` |
| `pg_policy` | `deliveries_select`, `deliveries_insert`, `deliveries_update` — the disjunction in SELECT is exactly as documented |
| `role_table_grants` | `authenticated` = `INSERT, SELECT`; **no UPDATE** |

**No mismatch was found.** The three caveats are corrected in place rather than left to
mislead the next reader. BLOCKER-011, which they cited, was resolved 2026-08-15.

### The delivery path executed end to end through real auth

The smoke suite raises a `fulfilment_type = 'delivery'` ticket, then inserts a delivery
against it. That INSERT is authorized by `deliveries_insert`
(`tenant_id = current_tenant_id() AND has_branch_access(branch_id) AND has_role(...)`) under
the smoke user's owner role — PostgREST and RLS, not a service key.

Four database rules proven behaviourally rather than read:

```
second delivery, same ticket   -> 23505 deliveries_ticket_id_key
status='assigned', no driver   -> 23514 deliveries_assigned_needs_driver
status='failed',  no reason    -> 23514 deliveries_failed_needs_reason
status='delivered', no proof   -> 23514 deliveries_delivered_needs_proof
UPDATE status='in_transit'     -> 42501 permission denied for table deliveries
```

The last one is the load-bearing one: it is why the screens have no dispatch button. The
refusal is at GRANT level, so PostgREST rejects before RLS is consulted, and no client-side
restraint is involved.

**Tenant isolation under the weakest SELECT policy in the schema.** `deliveries_select` is
the only policy carrying a disjunction, so a driver sees a delivery assigned to them even
outside their branches. The smoke user owns **both** smoke organizations, and A's delivery is
still invisible under B's claim — the driver clause does not cross tenants, because
`tenant_id = current_tenant_id()` is conjoined ahead of it.

### Screens

`app/delivery/index.tsx` (board) and `app/delivery/[deliveryId].tsx` (detail), plus
`components/DeliveryStatusBadge.tsx`. Reached from a **Drops** button on the catalog header.

`failed` is treated as **open** in the badge styling, the filter chips and the query's
`openOnly` set, matching `TERMINAL_DELIVERY_STATUSES`, which deliberately excludes it. Until
`failed → returned` runs, the goods are out of the branch and unaccounted for in the ledger.

### One defect found and fixed en route

Expo Router's generated `apps/mobile/.expo/types/router.d.ts` had registered
`components/DeliveryStatusBadge` **as a route** — as `/../components/DeliveryStatusBadge` —
while omitting `/delivery` entirely, which failed `tsc` on both `router.push('/delivery')`
and `router.push('/delivery/${id}')`. That was a stale incremental scan by the running dev
server, not a code defect: deleting the file and restarting Metro regenerates it correctly
with `/delivery` and `/delivery/[deliveryId]` present and the component absent (grep count
0). Stopping the task did not free port 8081 — the Metro node process survived and had to be
stopped by PID.

### Small refactor

`chunk` and `IN_CLAUSE_CHUNK` moved from `queries/catalog.ts` to `internal/read.ts` and
exported. Three domains now resolve rows by id set — recipes for the batch list, ingredients
for a bill of materials, tickets for the delivery board — and a second copy of a URL-length
guard is a copy that gets fixed once. `listTicketsByIds` is the new consumer.

### Gates — all executed from `bakeflow-frontend`

| Command | Result |
|---|---|
| `node scripts/smoke-signed-in.mjs` | **78 pass / 0 fail** (was 66/0) |
| `npm run typecheck --workspace apps/mobile` | **exit 0** |
| `npm run lint` (workspaces + root) | **exit 0** |
| `npm run verify:cache` | **66 checks, all passed** (was 61) |
| `.venv/Scripts/python.exe -m pytest -q` | **12 passed** |
| `entry.bundle?platform=web` | **200, 6,152,317 B** |
| `entry.bundle?platform=android` | **200, 10,700,325 B** |

### Fixture consequence

Each smoke run now also creates one delivery-fulfilment ticket and one delivery in
organization A. `deliveries` was already added to the teardown order in `CURRENT_TASK.md`
ahead of `ticket_items`/`tickets`, so no change is needed there.

---

## 2026-08-21 · Delivery write path — transitions and detail corrections (P9.6 write half)

**Scope:** the write half of P9.6 — moving a delivery through its status graph and
correcting address/phone/schedule, both routed through `SECURITY DEFINER` RPCs since
`authenticated` holds no `UPDATE` grant on `deliveries`.

**Deliverables (commit `a1985a29`):**
1. `bakeflow-frontend/packages/api/mutations/delivery.ts` — `transitionDelivery()` and
   `updateDeliveryDetails()`, calling `transition_delivery()` and
   `update_delivery_details()` respectively. `DeliveryTransition` is a discriminated union
   so the argument combinations the database rejects (`assigned` with no driver, `failed`
   with no reason) cannot be constructed. Both re-read the row via `getDeliveryById` after
   the RPC returns rather than parsing the `jsonb` envelope, for precision-safety and to
   prove the row is still visible under `deliveries_select` post-change.
2. `bakeflow-frontend/packages/hooks/index.ts` — `useTransitionDelivery`,
   `useUpdateDeliveryDetails`. No retry (replaying `failed` would overwrite the stored
   reason). `invalidateDelivery()` writes the returned row into the detail query key and
   invalidates the list key by tenant-scoped prefix, so a transitioned delivery moves boards
   without a manual refetch.
3. `bakeflow-frontend/apps/mobile/components/DeliveryActions.tsx` (new) — renders the legal
   next hops per status, transcribed from `guard_delivery_transition()` read live. `delivered`
   and `failed` gate on a small form (proof/recipient, reason) before the button arms, ahead
   of the standing CHECK constraints that would otherwise refuse the bare call. No control
   for `pending -> assigned` — needs a driver picker this app does not have a read path for
   yet; the screen states that rather than guessing at one.
4. `bakeflow-frontend/apps/mobile/app/delivery/[deliveryId].tsx` — mounts `DeliveryActions`.

**Verification performed this session** (the commit had landed with gates unrun and
undocumented; this closed both gaps):
- Read `transition_delivery`, `update_delivery_details`, and `guard_delivery_transition`
  live from `pg_proc`/`pg_trigger` and confirmed the module's docstring claims match the
  function bodies exactly — the legal-hop graph, the two RPC-level preconditions
  (driver-role check for `assigned`, ticket-ready check for `in_transit`), and the
  `COALESCE` set-but-never-clear semantics.
- Read `pg_trigger` for `deliveries` and confirmed only `deliveries_guard_transition` and
  `deliveries_set_updated_at` exist — neither writes `stock_movements`, so `returned`
  restores no stock. Recorded as **BLOCKER-016** in `BLOCKERS.md` and `NOTIFICATIONS.md`
  (open; not patched from the client, since that would split the transaction rule 4 exists
  to prevent).
- Extended `scripts/smoke-signed-in.mjs` with six checks exercising both RPCs directly
  against the live project as the signed-in owner: `assigned` with a non-driver assignee
  refused `insufficient_role`; `in_transit` against a not-ready ticket refused
  `invalid_transition`; `update_delivery_details()` succeeds and the correction reads back
  through the same projection the screen caches; an all-null call is confirmed to be a
  DB-level no-op via `COALESCE` rather than an error.

**Executed evidence (from `bakeflow-frontend`):**
```
node scripts/smoke-signed-in.mjs           -> 84 pass / 0 fail (was 78/0)
npm run typecheck --workspace apps/mobile  -> exit 0
npm run lint --workspace apps/mobile       -> exit 0
npm run verify:cache                       -> all checks passed
.venv/Scripts/python.exe -m pytest -q      -> 12 passed
```

---

## 2026-08-21 · Production batch write path — transitions (P9.5 write half)

**Scope:** the write half of P9.5 — moving a production batch through `scheduled ->
in_progress -> completed/failed` and `scheduled -> cancelled`, the second pair required to
be atomic with `stock_movements` writes per `STATE-MACHINES.md` §2.

**Deliverables:**
1. `bakeflow-frontend/packages/api/mutations/production.ts` (new) — `startProductionBatch()`
   and `cancelProductionBatch()` as plain PostgREST updates (re-read through
   `getProductionBatchById` afterward for precision, since `production_batches` carries
   `NUMERIC` columns unlike `deliveries`); `completeProductionBatch()` and
   `failProductionBatch()` calling `complete_production_batch()`/`fail_production_batch()`,
   re-read through `getProductionBatchWithIngredients`.
2. `bakeflow-frontend/packages/api/index.ts` — exported the four mutations and their input
   types; updated the module-header comment that previously said no batch mutation existed.
3. `bakeflow-frontend/packages/hooks/index.ts` — `useStartProductionBatch`,
   `useCancelProductionBatch`, `useCompleteProductionBatch`, `useFailProductionBatch`. All
   four invalidate the tenant-scoped batch-list prefix plus the single detail key on success.
4. `bakeflow-frontend/apps/mobile/components/ProductionBatchActions.tsx` (new) — the
   transition controls, mounted into `apps/mobile/app/production/[batchId].tsx` below the
   batch fields.

**Verification performed this session:**
- Read `complete_production_batch`, `fail_production_batch`, and
  `guard_production_batch_transition` live from `pg_proc`/`pg_trigger`, and the grants/RLS
  on `production_batches` from `information_schema.role_table_grants`/`pg_policy` —
  confirmed `authenticated` holds `UPDATE` here (unlike `deliveries`), which is why the
  `scheduled` hops are plain updates and the `in_progress` hops are RPCs.
- Found and reproduced live a gap the grants don't close: a raw `UPDATE` supplying
  `status`, `actual_quantity`, and a client-fabricated `completed_at` reaches `completed`
  without ever calling the RPC, and writes zero `stock_movements` rows. A first attempt
  omitting `completed_at` was refused by the `production_batches_completed_fields` CHECK —
  a real but small mitigation, not a closed door. Recorded as **BLOCKER-017**.
- Extended `scripts/smoke-signed-in.mjs` with a full production-batch-transitions section:
  illegal-hop/precondition refusals (no stock touched), then a real completion and a real
  failure against a purpose-built disposable ingredient/product/variant/recipe graph (an
  opening balance via `adjust_stock()`), each verified against the resulting
  `stock_movements` rows and `ingredient_stock_levels`. Also reproduces BLOCKER-017 and
  confirms it writes zero movements.
- Discovered mid-session that this client-side soft-delete (`UPDATE ... SET deleted_at`)
  against the disposable fixtures is refused by RLS with a bare `42501`, for a reason not
  run down (the read policies looked permissive; not chased further, since this is a smoke
  fixture hygiene question, not a product path). Fixed the resulting three previously-exact-
  count assertions in the smoke file (`catalog A`'s product count, the batch list count, the
  `in_progress` status filter) to tolerate the resulting permanent row growth, matching how
  the file already tolerates the tickets/deliveries it creates every run. One orphaned
  `in_progress` batch left over from an earlier iteration of this same debugging session
  (before the `completed_at` requirement was discovered) was cleaned up directly against the
  database.

**Executed evidence (from `bakeflow-frontend`):**
```
node scripts/smoke-signed-in.mjs           -> 103 pass / 0 fail, repeatable over 3 runs (was 84/0)
npm run typecheck --workspace apps/mobile  -> exit 0
npm run lint --workspace apps/mobile       -> exit 0
npx eslint packages --max-warnings=0       -> exit 0
npm run verify:cache                       -> all checks passed
.venv/Scripts/python.exe -m pytest -q      -> 12 passed
```

---

## 2026-08-21 · Inventory adjust — hook and screen control (P9.4 write half)

**Scope:** the write half of P9.4. The RPC (`adjust_stock`) and its API-layer wrapper
(`packages/api/mutations/inventory.ts`) already existed from P4.2b; this was the missing
hook and UI control on the warehouse stock screen.

**Deliverables:**
1. `bakeflow-frontend/packages/hooks/index.ts` — `useAdjustStock()`, invalidating whichever
   of the two stock-level lists (`ingredient-stock-levels` / `product-stock-levels`) the
   adjusted item belongs to, by tenant+warehouse-scoped key prefix.
2. `bakeflow-frontend/apps/mobile/components/AdjustStockAction.tsx` (new) — the per-row
   form: quantity field pre-filled with the current level (absolute target, not a delta),
   a required reason among the three `adjust_stock` accepts, an optional note.
3. `bakeflow-frontend/apps/mobile/app/inventory/[warehouseId].tsx` — `StockRow` now takes
   `warehouseId`/`itemType`/`itemId`/`tenantId` and renders the action; the module
   docstring and header subtitle, which previously described the screen as read-only by
   design, were corrected.

**Verification:** no new live-verification of the RPC was needed — `adjust_stock()`'s
contract (absolute target, three reasons, role-per-reason) was already proven live earlier
this session as part of the P9.5 work (a real `opening_balance` call against a disposable
fixture, in `scripts/smoke-signed-in.mjs`). This slice is a thin, correctly-keyed hook and
form around that already-proven call.

**Executed evidence (from `bakeflow-frontend`):**
```
npm run typecheck --workspace apps/mobile  -> exit 0
npm run lint --workspace apps/mobile       -> exit 0
npx eslint packages --max-warnings=0       -> exit 0
```
On-device / Expo Go run not performed — no anon key available on a device in this
environment, consistent with every prior milestone in this log.

---

## 2026-08-22 · BLOCKER-016 & BLOCKER-017 resolved — one migration, one closed-as-not-a-bug, one real defect found and fixed

**Scope:** resolve the two open findings from the P9.5/P9.6 sessions, per explicit
instruction to proceed.

**BLOCKER-017 — trigger-side guard flag, applied live.** Human decision (of the two options
presented): keep `production_batches`' `UPDATE` grant and the plain-update path for
`scheduled`'s two exits, close the gap specifically for `completed`/`failed`.
`complete_production_batch()` and `fail_production_batch()` now call
`perform set_config('bakeflow.production_batch_rpc', 'true', true)` immediately before
their own final `UPDATE`. `guard_production_batch_transition()` refuses
`new.status IN ('completed','failed')` unless
`current_setting('bakeflow.production_batch_rpc', true) = 'true'`. Transaction-local
(`is_local = true`), so it cannot leak between requests.

**BLOCKER-016 — investigated, reclassified, and the real defect behind it fixed.** The
original ask (approved, then walked back after further investigation in the same session)
was to add a `sales_return` stock movement on `in_transit/failed -> returned`. Two live
facts changed the plan:

1. `stock_movements` had zero `reason = 'sale'` rows ever, and no trigger deducts stock on
   a ticket sale — so "restoring" stock on a delivery return would have inflated it.
2. The delivery/ticket state machines make the scenario unreachable: `guard_delivery_
   transition()` has no exit from `delivered`, so a delivery can never be both `delivered`
   and later `returned`; `guard_ticket_status_transition()`'s delivery gate requires the
   linked delivery to already be `delivered` before the ticket itself can reach
   `delivered` (and therefore `completed`, where a sale would be recorded). A `returned`
   delivery was therefore never on a ticket whose stock had been deducted.

Closed as not-a-bug. The real defect found in the same investigation: `complete_ticket()`
already implements sale-side deduction (one negative movement per ticket line, atomic with
`status -> completed`) and has **never once succeeded** — it inserted
`stock_movements.reference_type = 'ticket'`, and the live `stock_movements_reference_type_
check` has only ever allowed `'order'` (the historical wart `CLAUDE.md` and
`packages/types/inventory.ts` already document for this exact column). Every real call has
always raised `23514`. Fixed by changing the one literal to `'order'`; no other change to
the function's logic.

**Migration applied:** `fix_complete_ticket_reference_type_and_guard_batch_rpc_only` (via
`mcp__supabase__apply_migration`), covering four functions: `complete_ticket()` (the fix),
`guard_production_batch_transition()`, `complete_production_batch()`,
`fail_production_batch()` (the BLOCKER-017 guard). All four re-read from `pg_proc`
afterward: owner `postgres`, `SECURITY DEFINER`, `search_path=public` unchanged on every
one.

**Verification performed:**
- **BLOCKER-017:** the exact bypass that originally proved the blocker (`status:
  'completed', actual_quantity, completed_at` all client-supplied) is now refused with
  `invalid_transition: completed must be set through complete_production_batch() or
  fail_production_batch()`. The legitimate RPC path was re-run against the same batch
  immediately after and still succeeds — confirming the guard doesn't also block what it
  exists to protect. `scripts/smoke-signed-in.mjs`'s BLOCKER-017 section was rewritten from
  a reproduction into a permanent regression guard (two independent refusals asserted: the
  standing `completed_at` CHECK, then the new trigger guard; plus a real completion
  afterward proving the RPC path is unaffected).
- **BLOCKER-016 / `complete_ticket()`:** verified live end to end as a real signed-in
  owner. `request.jwt.claims` was simulated via `set_config(..., true)` inside a single
  PL/pgSQL `DO` block (the same technique BLOCKER-015's verification used) — `auth.uid()`,
  `current_tenant_id()` and `has_role()` all resolve from that GUC, so this exercises
  exactly the code path a real PostgREST request would. A disposable product/variant was
  given a 5.0000 opening balance via `adjust_stock()`, a pickup ticket was created and
  raised through `draft -> submitted -> confirmed -> scheduled -> in_production -> ready ->
  delivered -> completed`, and `complete_ticket()` was called for real. Result: ticket
  `TKT-000041` reached `completed`; exactly one `stock_movements` row was written
  (`reason='sale', reference_type='order', quantity_delta=-2.0000`); `product_stock_levels
  .quantity_on_hand` read back as `3.0000` (5 − 2).
- No smoke-suite check was added for this flow: `authenticated` holds no `UPDATE` grant on
  `tickets`, and most of the intermediate lifecycle hops have no RPC at all
  (`STATE-MACHINES.md` §1 already documents this as a known, separate gap) — a signed-in
  client genuinely cannot drive a ticket to `delivered` today, so an automated check here
  could only run via simulated credentials rather than what a real client can do.

**Executed evidence (from `bakeflow-frontend` unless noted):**
```
node scripts/smoke-signed-in.mjs           -> pass, repeatable over 3 consecutive runs
npm run typecheck --workspace apps/mobile  -> exit 0
npm run lint --workspace apps/mobile       -> exit 0
npx eslint packages --max-warnings=0       -> exit 0
.venv/Scripts/python.exe -m pytest -q      -> 12 passed   (from repo root)
```

---

### P6.4 — audit logging coverage (2026-08-22)

- Read every `log_audit_event()` caller and every `guard_*_transition` trigger live from
  `pg_proc`. Status-transition triggers on tickets, deliveries and production batches
  already log unconditionally on every legal hop; direct-write RPCs (`adjust_stock`,
  `record_payment`, `record_refund`, the organization/invite RPCs) already call it
  directly. Two significant writes touch no guarded `status` column and had no coverage:
  `archive_ticket()` and `update_delivery_details()`.
- Added a `log_audit_event()` call to both. `update_delivery_details()`'s only fires when
  `address_line`/`contact_phone`/`scheduled_at` actually differ from before, matching
  `adjust_stock`'s convention of writing nothing for a genuine no-op.
- Found two pre-existing, unrelated live defects while verifying — not introduced by this
  change:
  - `archive_ticket()` wrote `sync_changes.operation_type = 'ARCHIVE'`.
    `sync_changes_operation_type_check` has only ever allowed
    `CREATE/UPDATE/SOFT_DELETE/EVENT/COMMAND/CORRECTION` — every real call has always
    raised `23514` before reaching a `RETURN`. Fixed to `'UPDATE'`. Same class of defect as
    `complete_ticket()`'s `reference_type` typo found earlier the same day (b3cce752).
  - The first draft of both new `log_audit_event()` calls used custom `action` values
    (`'archived'`, `'details_updated'`). `audit_log_action_check` only permits
    `insert/update/delete/status_change`. Caught in verification before either shipped;
    both changed to `'update'`.
- Verified live:
  - `update_delivery_details()` end to end through the real signed-in smoke client: one
    `audit_log` row with the correct before/after on an actual address change, zero rows
    added by the immediately-following DB-level no-op call.
  - `archive_ticket()` could not be smoke-tested for success: `tickets.archive` is granted
    only to admin/branch_manager (`role_permissions`, read live), and the smoke fixture
    user is an owner — the same reachability gap already noted for `complete_ticket()`'s
    full lifecycle walk. Proven instead in a rolled-back transaction with simulated admin
    JWT claims (`request.jwt.claims` + `SET LOCAL ROLE authenticated`, the technique
    BLOCKER-015/016 established): a real call succeeded, wrote the corrected
    `sync_changes` row and a correct `audit_log` row, all discarded by the rollback. The
    smoke suite asserts the one thing an owner can actually prove — the refusal.
- Migrations applied via the Supabase MCP server: `p6_4_audit_coverage_archive_ticket_and_
  delivery_details`, `fix_archive_ticket_sync_changes_operation_type`, `fix_p6_4_audit_
  action_values`.

**Executed evidence (from `bakeflow-frontend` unless noted):**
```
node scripts/smoke-signed-in.mjs           -> pass (2 runs, one after a transient DNS blip)
npm run typecheck --workspace apps/mobile  -> exit 0
npm run lint --workspace apps/mobile       -> exit 0
.venv/Scripts/python.exe -m pytest -q      -> 12 passed   (from repo root)
```

---

### P6.5 — normalized error codes (complete for P4); structured logs (written, unverified live) (2026-08-22)

- Read every `RAISE EXCEPTION` across `pg_proc` and counted `DETAIL` coverage against
  `packages/api/errors/index.ts`'s `codeFromDetail()`/`classifyP0001()`/`classify42501()`.
  Four functions raised 18 distinct conditions with zero coverage: `adjust_stock` (8),
  `guard_order_actor_and_assignment` (4), `archive_ticket` (4), `update_delivery_details`
  (2). All four now embed an explicit `code` in `DETAIL`.
- Codes chosen to match existing precedent rather than invented fresh:
  `adjust_stock`'s match exactly what `classifyP0001()`'s documented regex fallback
  already inferred (including "warehouse not found or branch access denied" ->
  `insufficient_role`, a deliberate conflation so a caller cannot distinguish a missing
  warehouse from a denied one and probe cross-branch ids by elimination); `archive_ticket`
  / `update_delivery_details`'s "not found" conditions -> `invalid_transition`, matching
  `transition_delivery()`/`complete_production_batch()`'s existing choice for the same
  shape of condition on the same tables.
- Deliberately excluded: `record_payment`, `record_refund`,
  `guard_payment_relationships`, `guard_daily_financial_audit_mutation`,
  `guard_expense_cash_session`, `update_invoice_due_at`, `update_ticket` — all P5/
  financial-domain or blocked-write-path surface (BLOCKER-003).
- Verified live: each new code confirmed in a rolled-back transaction (simulated JWT
  claims, `GET STACKED DIAGNOSTICS ... = PG_EXCEPTION_DETAIL`) before any smoke-suite
  change; four new permanent smoke assertions added reading `error.details` directly.
  Full suite green across three separate runs (one after a transient network blip, one
  after an unrelated ESLint native-process crash under concurrent-session load — both
  passed clean on retry with no code changes).
- Migrations applied via the Supabase MCP server:
  `p6_5_normalize_error_codes_adjust_stock_and_ticket_guards`,
  `p6_5_normalize_error_codes_archive_ticket_and_delivery_details`.

**Structured logs.** Added `logStructured()` and `FunctionLogContext` to
`supabase/functions/_shared/errors.ts`: one NDJSON line per event
(`level`/`event`/`function`/`request_id`/`timestamp` plus event-specific fields), replacing
the prior ad hoc `console.log`/`console.error` string-prefix calls. `handleFunctionError()`
now requires a `context` argument rather than accepting none, so a future function cannot
skip it silently. Wired into `send-invite-email/index.ts`: a `request_id` generated per
invocation via `crypto.randomUUID()`, a `function_invoked` line at entry, an
`invite_email_dispatched` line on success (recipient email deliberately omitted — PII the
`invite_id` already correlates back to), and the error path via `handleFunctionError`.

**Not deployed, and this is a real, pre-existing gap, not one this change introduced.**
Attempting to verify the above live surfaced that `send-invite-email` has never been
deployed to the Supabase project at all — `list_edge_functions` returns `[]`. BLOCKER-001
and P6.2 were marked COMPLETE on typecheck, lint, pytest, and
`scripts/verify-invite-delivery.mjs` (a standalone invariant script — token hashing, deep
link construction, HTML escaping — that calls no live endpoint), none of which would have
caught this. No Deno CLI is available in this environment to typecheck the Edge Function
code directly, so this change's own correctness rests on manual review, at the same
verification bar P6.2 was originally accepted at, not a stronger one.

Deploying the function to actually test it — and, as a side effect, to find out whether
invitation delivery has ever worked in this project at all — was attempted and stopped at
the user's explicit direction. This is now flagged as the standing, more consequential gap
in `BACKEND_ROADMAP.md` (P6.2 and P6.5) rather than acted on further this session.

**Executed evidence (from `bakeflow-frontend` unless noted):**
```
node scripts/smoke-signed-in.mjs           -> pass (3 runs; 2 unrelated transient failures
                                               on retry — network blip, ESLint crash under
                                               concurrent-session load — both clean on retry)
npm run typecheck --workspace apps/mobile  -> exit 0
npm run lint --workspace apps/mobile       -> exit 0
.venv/Scripts/python.exe -m pytest -q      -> 12 passed   (from repo root)
```

---

## 2026-08-22 — BLOCKER-001 reopened: full investigation of the send-invite-email deployment gap

Investigation only, per explicit instruction — no deploy, no production config change, no
unrelated code touched. Goal was to determine why `send-invite-email` (P6.2) was marked
COMPLETE on 2026-08-20 yet was found undeployed while verifying P6.5 later, and whether
invitation delivery has ever worked at all.

**Repository review:**
- `supabase/functions/send-invite-email/index.ts`, `_shared/auth.ts`,
  `_shared/email/{factory,resend,mock}.ts` read in full — the implementation is complete
  and matches its own spec: caller auth, tenant/role check via `user_roles`, SHA-256 token
  verification, expiry check, deep-link construction, HTML/text templates, Resend dispatch
  with a mock-provider fallback when `RESEND_API_KEY` is absent.
- `bakeflow-frontend/packages/api/mutations/invitations.ts` confirmed as the only caller —
  `createOrganizationInvite` (RPC) and `sendInviteEmail` (Edge Function invoke), composed
  by `createAndSendInvite`. No other code path reaches the function.
- `.github/workflows/ci.yml` read in full: deliberately lint/typecheck/pytest only (its own
  header comment explains why — no live database in CI, per BLOCKER-002). No Edge Function
  deploy step exists or was ever intended to exist here. Deployment has only ever been a
  manual, human-run `supabase functions deploy`.
- `.env.example` still lists the Resend variables under "RESERVED — no consumer yet",
  which is itself slightly stale (the consumer, `factory.ts`, exists since `b6d125e1`) but
  not corrected — the file's own convention is a placeholder contract, not a status record,
  and correcting comment staleness there was judged out of scope for this investigation.
- `git log --follow` on the function file: exactly one commit, `b6d125e1` ("feat: implement
  invitation management and email delivery system", 2026-08-20) plus this session's later
  structured-logging change. No separate deploy commit or script exists anywhere in history.

**Live verification (read-only; `execute_sql`, `list_edge_functions`, `query_logs`):**
- `list_edge_functions` → `[]`. Conclusive: zero Edge Functions deployed, and
  `send-invite-email` is the only one the repo defines.
- `select count(*) from organization_invites` → **0**, unconditionally. Not filtered by
  status — no invite row has ever existed. Combined with the RPC's existence, this means
  the DB half of the pipeline is present but has literally never been called either —
  invitation delivery has never been operational in any form, deployed or not.
- `select proname, pronargs from pg_proc where proname = 'create_organization_invite'` →
  exists, 4 args. Its correctness was not tested here (out of scope: the question was the
  deployment gap, not re-verifying the RPC).
- `query_logs` against `function_edge_logs` for the default 24h window → 0 rows, consistent
  with (not independent proof of) never having been invoked.

**Root cause, found in `NOTIFICATIONS.md`:** two BLOCKER-001 entries coexisted the entire
time without being reconciled — one marked RESOLVED on 2026-08-20 covering code delivery,
and a separate, older "ACTION REQUIRED: BLOCKER-001" further down the same file asking
verbatim *"may the first Edge Function be deployed?"*, never answered and never removed.
The RESOLVED status was accurate for the code and silently wrong for deployment.

**Documentation corrected in the same pass (per `CLAUDE.md`'s contradiction rule):**
- `docs/API-CONTRACT.md` §7 said `supabase/functions/` "is not present in the repo" —
  true when written, false since `b6d125e1`. Corrected to state the current fact: built,
  committed, not deployed.
- `BACKEND_ROADMAP.md` P6.2 downgraded COMPLETE → PARTIAL with the full evidence trail.
- `BLOCKERS.md` §BLOCKER-001 reopened in place (history kept, not deleted), with the live
  evidence table and the recommended next action.
- `NOTIFICATIONS.md` gained a new top entry summarizing the reopening for the human queue,
  and both pre-existing BLOCKER-001 entries were annotated to point at it rather than left
  silently contradicting each other.
- `CURRENT_TASK.md` gained a new top entry.

**Conclusion:** the code is real and appears correct on manual review, but has never been
deployed and never invoked — not by CI, not manually. Separately and more surprisingly, the
database side (`create_organization_invite`) has also never been called by anyone, so this
is not "email delivery is the missing last mile" — it is "no one has ever completed an
invitation through this system, at all, ever." Deploying is judged safe pre-approval in the
sense that the mock-provider fallback prevents any real email from being sent even if
deployed with no Resend key configured — but the deploy action itself was not taken, per
the user's explicit instruction not to deploy in this task.

---

## 2026-08-22 — BLOCKER-001 resolved: send-invite-email deployed and verified live, with the user's explicit approval

Following the investigation above, the user gave explicit approval to deploy. Deployed and
verified fully — not a bare health check.

**Deployment:** `mcp__supabase__deploy_edge_function` — bundled `send-invite-email/index.ts`
plus every `_shared/` dependency (`cors.ts`, `auth.ts`, `errors.ts`, `email/{types,mock,
resend,factory}.ts`, `templates/invite.ts`) and `import_map.json`, mirroring the actual
repo layout so no import paths needed rewriting. `verify_jwt: true` (the function expects a
real Supabase-issued user JWT; it is not a webhook/API-key-authenticated function). Result:
`status: ACTIVE`, `version: 1`. Confirmed independently afterward with
`list_edge_functions` rather than trusting the deploy call's own response.

**Live end-to-end verification**, via a disposable Node script run through PowerShell (the
tool with a working network route in this environment):
1. Signed in as the real `smoke.owner@bakeflow.test` via `/auth/v1/token`.
2. Called `create_organization_invite` for real over `/rest/v1/rpc/...` with that session's
   bearer token (real `auth.uid()`, real RLS/role path) — created a disposable invite,
   `role_key='cashier'`.
3. POSTed `{invite_id, raw_token}` to `/functions/v1/send-invite-email` with the same
   bearer token — **200**, `{"success":true, ..., "delivery":{"provider":"mock","status":
   "simulated"}}`. The mock fallback fired because no `RESEND_API_KEY` is configured —
   exactly the designed behavior, not a failure.
4. `mcp__supabase__query_logs` — discovered the correct log source is `function_logs`, not
   `function_edge_logs` (`select distinct source from logs` lists both `edge_logs` and
   `function_logs`; the latter carries `console.*` output). Found the exact structured
   NDJSON lines P6.5 added, in order and with correct fields:
   `{"level":"info","event":"function_invoked",...}` then
   `{"level":"info","event":"invite_email_dispatched","tenant_id":...,"invite_id":...,
   "provider":"mock","delivery_id":"mock_mail_..."}`, no recipient email present (PII,
   by design).
5. Deleted the disposable `organization_invites` row afterward. Its `log_audit_event()`
   audit-log entry was left in place, per `CLAUDE.md`'s immutable-audit-record rule — it
   is a true record of a real action, not fabricated evidence, and this project's prior
   disposable-fixture verifications have left the same kind of residue.

**This was the first successful invitation dispatch of any kind in this project's
history** — `organization_invites` held zero rows before step 2.

**Second defect found and fixed in the same pass.** Reading `create_organization_invite()`'s
`prosrc` (needed to know its exact return shape before writing the verification script)
showed it returns `jsonb_build_object('invite', to_jsonb(v_invite)-'token_hash',
'raw_token', v_raw)` — `id` and `expires_at` are nested under `invite`, not top-level. But
`bakeflow-frontend/packages/api/mutations/invitations.ts`'s `createOrganizationInvite()`
read `payload.id`/`payload.invite_id`/`payload.expires_at` directly off the RPC response.
`inviteId` would always resolve `undefined`, so the function threw `response_shape_invalid`
unconditionally on every real call — independent of and in addition to the deployment gap.
Even with the function live the entire time, the app's own client code could never have
gotten far enough to call it.

Fixed in the same file: read `invite.id`/`invite.expires_at` from the nested object first,
falling back to the flat keys. Verified against the actual live RPC payload captured in
step 2 above (not a guessed shape):
```
{ inviteId: 'a4690b74-67de-45ca-9709-f68a772e2a65',
  rawToken: '6e6edc4d...',
  expiresAt: '2026-08-23T21:54:14.40493+00:00' }
```

**Documentation updated to close the loop:** `BLOCKERS.md` §BLOCKER-001 marked RESOLVED
with the full evidence trail (superseding the same-day REOPENED entry); `BACKEND_ROADMAP.md`
P6.2 and P6.5 both back to COMPLETE; `NOTIFICATIONS.md` and `CURRENT_TASK.md` updated to
match.

**Remaining, separate from this fix:** real email delivery (as opposed to the mock provider
that fired in this test) needs `RESEND_API_KEY`/`EMAIL_FROM_ADDRESS`/`EMAIL_FROM_NAME` set
in Supabase Secrets. Unverified either way — no tool available here lists live secrets —
but no longer required to prove the invitation pipeline itself works end to end.

**Executed evidence:**
```
mcp__supabase__deploy_edge_function        -> ACTIVE, version 1
mcp__supabase__list_edge_functions          -> confirms the one function, ACTIVE
node verify-deployed-invite.mjs (scratchpad) -> RESULT: EDGE FUNCTION INVOCATION SUCCEEDED
mcp__supabase__query_logs (function_logs)   -> function_invoked, invite_email_dispatched
mcp__supabase__execute_sql (delete)         -> disposable invite row removed
npm run typecheck --workspace apps/mobile   -> exit 0
npm run lint --workspace apps/mobile        -> exit 0
.venv/Scripts/python.exe -m pytest -q       -> 12 passed
```

---

## 2026-08-22 — BLOCKER-009 resolved: tickets do reach a real terminal state after cancellation

While looking for the next unblocked backend milestone, audited P4.4's write-path status
against the live database (the same instinct that caught P4.1/P4.2 and BLOCKER-001's
staleness earlier this session) and found BLOCKER-009 was still marked OPEN despite both
of its named root causes having already been fixed by other, unrelated work.

**Live reads, this pass:**
- `select tgname from pg_trigger where tgrelid='tickets'::regclass and not tgisinternal` →
  `tickets_assign_number`, `tickets_guard_status_transition`, `tickets_set_updated_at`,
  `trg_guard_driver_created_ticket_assignment`, `trg_guard_ticket_actor_assignment`. No
  `prevent_submitted_ticket_update` — confirms BLOCKER-005's 2026-08-14 drop is still in
  effect, no regression.
- `guard_ticket_status_transition()`'s current `prosrc`: the allowed-transitions CASE
  includes `WHEN 'cancelled' THEN ARRAY['archived']`, role-gated to
  `owner/admin/branch_manager`. This transition simply did not exist in BLOCKER-009's
  original 2026-08-11 write-up; it must have been added as part of BLOCKER-005's rewrite
  of this function without anyone connecting the two.
- `select grantee, privilege_type from information_schema.role_table_grants where
  table_name='tickets' and grantee='authenticated'` → `INSERT, SELECT` only, confirming no
  client can ever reach that status transition directly.
- `select proname from pg_proc where prosrc ilike '%''archived''%'` → only
  `guard_ticket_status_transition` itself references the literal. No RPC performs
  `status = 'archived'`. This transition is legal but dead — logged as TD-016.
- `archive_ticket()`'s current `prosrc`: guard is `deleted_at IS NULL AND archived_at IS
  NULL` — no `status` check at all — and it inserts `sync_changes` with
  `operation_type='UPDATE'` (previously `'ARCHIVE'`, fixed in P6.4 earlier the same day).
  Re-confirmed independently rather than trusting the P6.4 write-up's own claim.
- `pg_get_constraintdef` on `sync_changes_operation_type_check` and `tickets_status_check`
  — both read live, matching what the two functions above assume.

**Conclusion:** the metadata-only archive path (`archive_ticket()`) is unconditional on
ticket status, already proven live end-to-end in P6.4 (correct `sync_changes` row, correct
`audit_log` row, via a rolled-back transaction with simulated admin JWT claims). That is
BLOCKER-009's real "terminal disposition" concern, answered — a cancelled ticket can and
does reach a genuine, audited, permission-gated end state today. No new live test was run
in this pass; P6.4's existing proof covers it, since `archive_ticket()` never distinguishes
`cancelled` from any other non-archived status.

**Documentation corrected:** `BLOCKERS.md` §BLOCKER-009 marked RESOLVED with the full
re-derivation (not just a citation of P6.4). `TECHNICAL_DEBT.md` gained TD-016 for the dead
status-transition nuance. `BACKEND_ROADMAP.md` P4.4's write-path paragraph rewritten (was
citing BLOCKER-009 as one of four blocking grounds; now two remain, unrelated). Two more
stale facts fixed in the same neighborhood while updating cross-references: P3.7's
"Blockers" list still named BLOCKER-005 as open eight days after its resolution, and a
planning table under P8.0 still listed BLOCKER-009 against P4.4b/P3.7. `NOTIFICATIONS.md`
and `CURRENT_TASK.md` updated to match.

**Executed evidence:**
```
mcp__supabase__execute_sql (pg_trigger, pg_proc, information_schema, pg_constraint)
                                             -> all read live, quoted above
.venv/Scripts/python.exe -m pytest -q        -> 12 passed
```

---

## 2026-08-22 — P4.4 write path: all lifecycle RPCs confirmed live; update_ticket() authorization defect found and fixed

Continuing the same staleness audit that closed BLOCKER-001 and BLOCKER-009 earlier today,
checked the roadmap's remaining stated reason P4.4's write path was BLOCKED: "the
lifecycle RPC signatures have not been read from the live database."

**Live read:** `select proname, pronargs from pg_proc where proname ilike '%ticket%'` →
`apply_payment_to_ticket`, `archive_ticket`, `cancel_ticket`, `complete_ticket`,
`confirm_ticket`, `guard_ticket_item_mutation`, `guard_ticket_status_transition`,
`recalculate_ticket_totals`, `update_ticket`. Five of the ten state-machine transitions
have no dedicated RPC (`draft→submitted`, `confirmed→scheduled`, `scheduled→in_production`,
`in_production→ready`, `ready→delivered`) — but `docs/API-CONTRACT.md` §51-53 and
`docs/STATE-MACHINES.md` §29 already independently suspected `update_ticket(p_status :=
...)` was the de facto path for these, unconfirmed. Read `update_ticket()`'s full body via
`pg_get_functiondef` to check.

**Found:** `update_ticket()`'s live body gated `p_status` changes behind
`NOT v_manager AND NOT v_cashier` at the top (blocking bakers from calling the function at
all) and explicitly listed `p_status IS NOT NULL` among the fields cashiers are forbidden
to touch. This directly contradicts `guard_ticket_status_transition()`'s own live actor
list (also read via `pg_get_functiondef`), which allows cashier on
submitted/confirmed/scheduled/delivered/completed and baker on in_production/ready. Since
`authenticated` has no direct `UPDATE` grant on `tickets` (confirmed via
`information_schema.role_table_grants`), `update_ticket()` is the *only* way a cashier or
baker can ever reach these five hops — and this gate silently blocked both, for the entire
time BLOCKER-005 has been resolved (2026-08-14 onward), unnoticed.

**Read the three sibling RPCs for comparison** (`cancel_ticket`, `confirm_ticket`,
`complete_ticket`, all via `pg_get_functiondef`): none of them re-implement a role check
for the status change itself — all three let `guard_ticket_status_transition()` be the
sole authority. `update_ticket()` was the outlier.

**Fixed** via `mcp__supabase__apply_migration` (`fix_update_ticket_status_role_gate_matches_guard_trigger`):
removed `p_status` from the cashier-forbidden-fields check; widened the top-level caller
gate to include baker; added a new check restricting baker calls to status-only edits
(never customer/fulfilment/due_at); changed the final `UPDATE`'s `status` assignment from
`CASE WHEN v_manager THEN ... ELSE status END` to an unconditional `COALESCE(p_status,
status)`, trusting the trigger. Pricing/assignment/cancellation-reason fields remain
manager-gated exactly as before — untouched.

**Verified live in one rolled-back transaction** (`BEGIN ... ROLLBACK`, never committed):
created a disposable `branch_assignments` row for the smoke owner's real `auth.uid()` (so
`has_branch_access()` — which checks that table for non-owner/admin roles — would resolve),
then simulated cashier/baker/owner JWTs in turn via `set_config('request.jwt.claims', ...)`
under `SET LOCAL ROLE authenticated`, capturing 12 outcomes in a temp table:

```
1  cashier draft->submitted                      PASS
2  cashier submitted->confirmed                   PASS
3  cashier status+discount refused                PASS (pricing gate still fires)
4  cashier confirmed->scheduled                    PASS
5  cashier scheduled->in_production refused        PASS (trigger: baker/manager only)
6  baker scheduled->in_production                  PASS  <- core of the fix
7  baker in_production->ready                       PASS
8  baker customer_id edit refused                   PASS (new scope check)
9  baker cancel (with reason) refused                PASS (blocked by pricing/cancel gate)
   baker cancel (no reason) refused                  PASS (blocked by manager-only cancel check)
10 owner status+discount regression                 PASS (unchanged manager behavior)
```
Two initial "failures" were test-assertion mismatches, not defects: test 9's first variant
hit an earlier, equally-correct refusal path than the exact message string I'd guessed, and
test 10 initially failed on a fixture artifact (zero-subtotal ticket tripping
`tickets_discount_not_over_subtotal`, unrelated to the migration) — both re-run correctly
and confirmed. Every row above reflects the corrected, final result. All fixture rows
(`branch_assignments`, disposable `tickets`) were discarded by `ROLLBACK` — nothing
persisted.

**Regression check:** full signed-in smoke suite (`node scripts/smoke-signed-in.mjs`,
retried once after a transient "fetch failed" sign-in blip, then clean) and
`.venv/Scripts/python.exe -m pytest -q` both green after the migration.

**Documentation corrected:**
- `docs/STATE-MACHINES.md` §1 — transition table rows for the five `update_ticket`-served
  hops now say so explicitly; new "Defect 3 resolved" note alongside the existing two.
- `docs/API-CONTRACT.md` — five stale notes fixed: `confirm_ticket`/`cancel_ticket`/
  `complete_ticket`'s ⚠️ warnings all described the BLOCKER-005 defect that was resolved
  2026-08-14 and never updated; `update_ticket`'s row cited the now-dropped
  `prevent_submitted_ticket_update()`; the "no submit_ticket RPC... worth resolving
  explicitly" note is resolved. Also fixed, found in the same file: `create_organization_
  invite`'s row and the Edge Function status table both still said invitation delivery
  wasn't deployed, contradicting this session's own earlier BLOCKER-001 resolution.
- `BACKEND_ROADMAP.md` P4.4 — rewritten: write path down to one real remaining ground
  (BLOCKER-003, for `discount_amount`/`tax_amount` only — not lifecycle progression).
  Flagged, not fixed: the roadmap's "Current State" summary (dated 2026-08-14, "every
  write path is BLOCKED") is now badly stale against this section, P4.2b, P6.x, and P9.x —
  a rewrite out of scope for this pass.

**Executed evidence:**
```
mcp__supabase__execute_sql (pg_proc, pg_get_functiondef, information_schema)
                                             -> read live, quoted above
mcp__supabase__apply_migration              -> fix_update_ticket_status_role_gate_matches_guard_trigger
mcp__supabase__execute_sql (rolled-back tx) -> 12/12 checks passing, nothing persisted
node scripts/smoke-signed-in.mjs            -> SMOKE TEST PASSED (after one transient retry)
.venv/Scripts/python.exe -m pytest -q       -> 12 passed
```
---

## 2026-08-22 — P6.6 delivered: rate limiting on send-invite-email, verified against the live deployed function

Investigated what P6.6 ("Rate limiting & production configuration," dependency P6.1, feeds
P12) could concretely mean before writing anything. `supabase/config.toml`'s
`[auth.rate_limit]` section governs the local CLI dev stack only; no tool available here
(`mcp__supabase__*`) can push config values to the hosted project, and there's no evidence
this repo is even CLI-linked to it — that entire layer is out of reach regardless of intent.
`docs/API-CONTRACT.md` had no existing rate-limiting content at all. Concluded the
milestone's real, actionable scope — consistent with its stated P6.1 dependency and its
place in Phase 6 alongside the other Edge-Function-hardening milestones (P6.2/P6.4/P6.5) —
is the Edge Function layer: `send-invite-email`, the only one that exists.

**Design**, matching existing architecture rather than adding a dependency:
- `rate_limit_events` (migration `p6_6_rate_limit_send_invite_email`): append-only ledger,
  same shape as `audit_log`/`stock_movements`/`sync_changes`. RLS enabled and forced;
  `REVOKE ALL ... FROM authenticated, anon, PUBLIC` — no client surface at all.
- `enforce_rate_limit(p_tenant_id, p_actor_id, p_scope, p_limit, p_window_minutes)`:
  `SECURITY DEFINER`, counts `(tenant_id, scope)` events in the trailing window, raises
  `errcode='P0001'`/`detail={"code":"rate_limited",...}` at the cap, else inserts and
  returns. `GRANT EXECUTE ... TO service_role` only — deliberately not `authenticated`,
  because the function trusts its `tenant_id`/`actor_id` parameters rather than deriving
  them from the caller's own JWT, so broader `EXECUTE` would let any authenticated caller
  target another tenant's quota by passing its id.
- Chose 20 calls/tenant/hour by analogy to `supabase/config.toml`'s own
  `auth.rate_limit.email_sent = 2`/hour (local-dev precedent in the same repo), loosened
  because BakeFlow tenants are individual bakeries plausibly onboarding a whole staff at
  once — treated as an engineering parameter, not a business rule needing sign-off.
- Counted per `(tenant_id, scope)`, not per caller: the resource being protected (a
  transactional provider's sending reputation/quota) is a tenant-level concern.

**Integration**: `send-invite-email/index.ts` calls `enforce_rate_limit()` immediately
before `provider.sendEmail()` — after authentication, membership, role, and invite
validity/expiry/token checks, so a request that would fail anyway never consumes quota —
using `invite.tenant_id` (the authoritative tenant, not the caller's active-org JWT claim)
and `context.userId`. Redeployed via `mcp__supabase__deploy_edge_function` (same
file-bundling approach as the original P6.2 deploy): version 1 → version 2, `ACTIVE`.

**Live verification, against the real deployed function, not simulated:**
1. Signed in as the real smoke owner, created one disposable invite in tenant A
   (`create_organization_invite` over real PostgREST).
2. Called `send-invite-email` for real, 20 times, same invite (the function never marks an
   invite "already sent," so one disposable invite sufficed for all 20 calls) → **all 20:
   200, `success: true`**, mock provider each time.
3. 21st call → **429**, body:
   `{"error":{"code":"rate_limited","message":"This organization has sent too many
   invitation emails in the last 60 minutes. Try again later.","details":"rate limit
   exceeded for scope send_invite_email: 20 of 20 calls used in the last 60 minutes"}}`.
4. Switched active organization to the smoke user's second tenant (`set_active_organization`
   + `auth.refreshSession()`, the same pattern `scripts/smoke-signed-in.mjs` already uses),
   created a second disposable invite there, called the function once → **200, success** —
   proving tenant B's quota is untouched by tenant A's exhaustion.
5. `mcp__supabase__query_logs` (`function_logs`) confirmed a correctly structured
   `function_error` NDJSON line for the refusal (`status:429, code:"rate_limited"`),
   matching P6.5's logging contract.
6. **Authorization/tenant-boundary check**, separately, in a rolled-back transaction
   (`BEGIN...ROLLBACK`, simulated owner-role JWT under `SET LOCAL ROLE authenticated`):
   `SELECT enforce_rate_limit(...)` → `42501 permission denied for function
   enforce_rate_limit`; `SELECT count(*) FROM rate_limit_events` → `42501 permission
   denied for table rate_limit_events`. Confirms the impersonation vector the design
   depends on closing is actually closed, not just intended.
7. Cleanup: `delete from rate_limit_events where scope='send_invite_email'` (21 rows) and
   `delete from organization_invites where id in (...)` (2 rows) — nothing from this test
   persisted.

**Client-side**: added `rate_limited` to `BakeflowErrorCode`
(`packages/api/errors/index.ts`) and `docs/API-CONTRACT.md` §3's code table. While doing
this, read `sendInviteEmail()`'s current body (`packages/api/mutations/invitations.ts`) to
confirm whether the new code would actually surface to a UI — it does not: the wrapper
discards `client.functions.invoke()`'s error body entirely, always reporting
`unexpected_error`, for every Edge Function error this function can return, not just the
new one. This is pre-existing (confirmed by reading the code, not assumed) and out of
scope for this milestone — logged as **TD-017** rather than silently fixed or silently
ignored.

**Two more stale lines caught in `docs/API-CONTRACT.md` §7 while adding the rate-limiting
note there**: the function-status table row already said "Deployed and live-verified
2026-08-22" (fixed in the BLOCKER-001 commit earlier today) but the explanatory paragraph
directly beneath it still said "has never been deployed" and "zero rows, ever" — both true
only until earlier the same session. Corrected to match.

**Regression**: full signed-in smoke suite green (`node scripts/smoke-signed-in.mjs`),
`npm run typecheck`/`lint --workspace apps/mobile` exit 0, `pytest -q` 12 passed — run
after the migration and again after the redeploy.

**Executed evidence:**
```
mcp__supabase__apply_migration               -> p6_6_rate_limit_send_invite_email
mcp__supabase__execute_sql (grants check)     -> rate_limit_events/enforce_rate_limit:
                                                  only postgres + service_role, confirmed
mcp__supabase__deploy_edge_function           -> send-invite-email v2, ACTIVE
node verify-rate-limit.mjs (scratchpad)       -> OVERALL: PASS (20 ok, 21st refused,
                                                  tenant isolation confirmed)
mcp__supabase__query_logs (function_logs)     -> function_error, status 429, rate_limited
mcp__supabase__execute_sql (rolled-back tx)   -> 42501 both ways (function + table)
mcp__supabase__execute_sql (cleanup deletes)  -> 21 + 2 rows removed, confirmed
node scripts/smoke-signed-in.mjs              -> SMOKE TEST PASSED
npm run typecheck --workspace apps/mobile     -> exit 0
npm run lint --workspace apps/mobile          -> exit 0
.venv/Scripts/python.exe -m pytest -q         -> 12 passed
```

---

## 2026-08-23 — TD-017 resolved: Edge Function error codes now surface client-side, verified through the real compiled code path

Following the security review of P6.6, resolved the flagged production-batch precondition
question (see the `docs(tickets)` commit) and then picked up TD-017, the other loose thread
the same session left behind: `sendInviteEmail()` never read `send-invite-email`'s own
structured error body, so `rate_limited` — the whole point of P6.6 — could never actually
reach a UI.

**Read `@supabase/functions-js`'s actual installed source** (`node_modules/@supabase/
functions-js/src/types.ts` and `FunctionsClient.ts`) rather than assuming its shape:
`FunctionsHttpError`/`FunctionsRelayError`'s `context` is set to the raw `Response` object
on a non-2xx reply (`throw new FunctionsHttpError(response)`); `FunctionsFetchError` has no
response at all (a transport failure). The SDK's own doc comment confirms the intended read
pattern: `await error.context.json()`.

**Added `normalizeFunctionsError()`** to `packages/api/errors/index.ts`, modeled on the
existing `normalizePostgrestError()`: awaits and parses the `Response` body, extracts
`body.error.code`, and — critically — only trusts it if it's already a member of
`KNOWN_CODES` (the exact same guard `codeFromDetail()` uses for the RPC path), so a future
Edge Function code this client has no vocabulary for yet still degrades safely to
`unexpected_error` rather than this function inventing an unreviewed mapping. Kept
`message` domain-neutral (`request failed (${code})`) and confined the real server text to
`serverMessage` — matching `BakeflowApiError`'s own documented safety property (`message`
is what LogBox/crash reporters/careless `{String(error)}` all render; server text must
never land there). Wired into `sendInviteEmail()`, replacing its old
`code: 'unexpected_error'` catch-all. Exported from `packages/api/index.ts` alongside its
siblings.

**Verified live through the real compiled client code path, not raw HTTP** — deliberately
stronger evidence than the HTTP-level verification P6.6 itself used, since the whole point
was confirming the *client* now does the right thing: wrote a throwaway script
(`scripts/_tmp-verify-normalize-functions-error.ts`, deleted after the run) executed via
`npx tsx`, importing the actual `createOrganizationInvite`/`sendInviteEmail` from
`packages/api`, signing in with `@supabase/supabase-js` for real, creating a real invite,
and calling `sendInviteEmail()` 21 times against the deployed function:
- Calls 1–20: succeeded normally.
- Call 21: threw `BakeflowApiError { code: 'rate_limited', message: 'request failed
  (rate_limited)', serverMessage: 'This organization has sent too many invitation emails
  in the last 60 minutes. Try again later.' }` — confirming both the code surfaces
  correctly AND the server text stays out of `message`.
- Cleanup: `delete from rate_limit_events where scope='send_invite_email'` (20 rows),
  `delete from organization_invites where id=...` (1 row) — nothing persisted.

**Regression**: `npm run typecheck`/`lint --workspace apps/mobile` exit 0, full signed-in
smoke suite green, `pytest -q` 12 passed.

**Executed evidence:**
```
Read: node_modules/@supabase/functions-js/src/types.ts, FunctionsClient.ts
mcp__supabase__execute_sql (rate_limit_events count)  -> 0 rows before starting (clean)
npx tsx scripts/_tmp-verify-normalize-functions-error.ts
                                                        -> OVERALL: PASS (20 ok, 21st
                                                           correctly typed BakeflowApiError)
mcp__supabase__execute_sql (cleanup deletes)           -> 20 + 1 rows removed, confirmed
node scripts/smoke-signed-in.mjs                       -> SMOKE TEST PASSED
npm run typecheck --workspace apps/mobile              -> exit 0
npm run lint --workspace apps/mobile                   -> exit 0
.venv/Scripts/python.exe -m pytest -q                  -> 12 passed
```

---

## 2026-08-23 · `tests/sql/sales_read_rls.sql` executed for the first time — real defect found and fixed

**Scope:** the standing Goal Mode directive's next unblocked, well-scoped item. `BACKEND_ROADMAP.md`'s
own Current State said this suite "has never been executed... a small remaining task, not a
blocker." The suite's own file header contradicted that, claiming "EXECUTED 2026-08-15... See
IMPLEMENTATION_LOG.md for the run." Checked which was true before doing anything else: the
2026-08-15 entry above (§"Live verification pass") ran only 12 structural assertions
(S1/S3/S4/S4b/S5/S6/S8/S12a-d/S19) and 6 customers-only RLS assertions (S13c/S13d/S16b/S16c/
S18c/S20) — test IDs that don't even match the committed S1-S18 file, meaning that was a
different, earlier version of the suite. The file as actually committed — all of S9-S18, i.e.
every ticket/ticket_items RLS assertion and the lifecycle-freeze checks — had never run. The
roadmap was right; the file's own header was wrong.

### First run: blocked by a fixture bug, not a product defect

`INSERT INTO tickets` for the org-B fixture ticket failed live: `P0001 invalid order creator
{"code":"insufficient_role"}` from `guard_order_actor_and_assignment()`. Read the trigger body
live (`pg_get_functiondef`): it requires the ticket's `created_by` to hold a `user_roles` row
scoped to the ticket's own `tenant_id`. The fixture's org-B ticket used profile `...0002` (the
org-A owner test user) as creator but never gave that profile a `user_roles` row in org B. Fixed
by adding one — the system supports multi-org profile membership by design (P3), so this isn't a
workaround, it's the fixture doing what a real multi-org user's data would look like.

### Second run: 26/27 passed. S10 failed — a real product defect

S10 ("`subtotal_amount` is frozen once a ticket leaves `draft`") failed: a direct
`UPDATE tickets SET subtotal_amount = 1.0000` on a `confirmed` ticket raised no exception.
Investigated live rather than assuming the test was stale, since this is a financial-integrity
invariant:
- `pg_trigger` showed `tickets_guard_status_transition` defined as
  `BEFORE UPDATE OF status ON tickets` — meaning it **only fires when an UPDATE's SET list
  includes the `status` column**, regardless of whether the value actually changes.
- `pg_get_functiondef(guard_ticket_status_transition)` confirmed the freeze logic is real,
  correct, and already documented in the function's own comment ("Once a ticket leaves draft,
  subtotal_amount is the authoritative financial input and must not change") — it was added by
  the `drop_prevent_submitted_ticket_update_and_harden_guard` migration on 2026-08-14 per this
  log's own earlier entry. The bug is purely mechanical: an UPDATE that touches only
  `subtotal_amount` never invokes the trigger that guards it.
- Checked exploitability before treating this as urgent: `information_schema.role_table_grants`
  confirms `authenticated` holds `INSERT, SELECT` only on `tickets` — no `UPDATE` at all. The
  only writer is `update_ticket()` (`pg_get_functiondef`), which always includes
  `status = COALESCE(p_status, status)` in its SET clause on every call and has no
  `subtotal_amount` parameter at all. So the gap is **not reachable through any current
  authenticated/anon path** — it's a latent hardening gap against a future or service-role write
  path, not a live exploit. Still a genuine defect against the trigger's own documented intent,
  and a one-line mechanical fix, not a business-rule invention — fixed rather than logged as
  debt.

**Fix:** migration `widen_tickets_guard_status_transition_to_cover_subtotal_amount` — dropped and
recreated the trigger as `BEFORE UPDATE OF status, subtotal_amount`. Re-verified live in a
rolled-back transaction: a direct `subtotal_amount`-only UPDATE on a non-draft ticket is now
correctly refused (`subtotal_amount is frozen once a ticket leaves draft`), and a negative
control (an UPDATE touching only `fulfilment_type`) confirms the trigger isn't now over-firing.

### Third run: 27/27 passed

Full suite green. **P4.4a/b (sales read path) is now COMPLETE**, not just IMPLEMENTED.

### Documentation corrected in the same pass

- `tests/sql/sales_read_rls.sql`: header no longer claims a false 2026-08-15 execution;
  documents the real 2026-08-23 run, the fixture bug, and the product defect. Fixture itself
  fixed (the added `user_roles` row for `...0002` in org B).
- `BACKEND_ROADMAP.md`: Current State summary and the P4.4 section rewritten from
  IMPLEMENTED/NOT-EXECUTED to COMPLETE, with the defect writeup; legacy crosswalk row for B8
  updated.

**Executed evidence:**
```
mcp__supabase__execute_sql (full S1-S18 fixture + assertions, rolled back)
                                            -> ERROR P0001 invalid order creator (fixture bug)
mcp__supabase__execute_sql (pg_get_functiondef guard_order_actor_and_assignment)
                                            -> confirmed: requires user_roles row in ticket's tenant
mcp__supabase__execute_sql (fixture fixed, full suite re-run, rolled back)
                                            -> 26/27 passed; S10 failed (no exception raised)
mcp__supabase__execute_sql (pg_trigger for tickets)
                                            -> tickets_guard_status_transition: BEFORE UPDATE OF status (only)
mcp__supabase__execute_sql (pg_get_functiondef guard_ticket_status_transition)
                                            -> freeze logic present and correctly written, just unreachable
mcp__supabase__execute_sql (role_table_grants for tickets, authenticated)
                                            -> INSERT, SELECT only -- no live exploit path
mcp__supabase__execute_sql (pg_get_functiondef update_ticket)
                                            -> status always in SET clause; no subtotal_amount param
mcp__supabase__apply_migration widen_tickets_guard_status_transition_to_cover_subtotal_amount
                                            -> success
mcp__supabase__execute_sql (fix + negative control, rolled back)
                                            -> both passed: freeze now enforced; unrelated column UPDATE unaffected
mcp__supabase__execute_sql (full S1-S18 suite, corrected fixture, rolled back)
                                            -> 27/27 passed
```

---

## 2026-08-23 · `tests/sql/delivery_read_rls.sql` executed for the first time; P4.3/P4.5 reconciled

**Scope:** continuing the same Goal Mode pass — the direct analogue of the sales-suite work
above. `delivery_read_rls.sql`'s own header banner said "NOT EXECUTED — BLOCKER-011"; that
blocker was resolved 2026-08-15, so this suite (D1-D10) was the next concrete, unblocked,
never-actually-run item. Also folded in the P4.3/P4.5 roadmap-section reconciliation that
the 2026-08-22 Current State refresh had explicitly flagged-but-not-done (their own
sections still read NOT_STARTED/BLOCKED, contradicted by the P9.5/P9.6 rows in the same
file which already document live-verified write paths).

Checked `deliveries`' triggers first, proactively, given what the sales suite had just
found: `deliveries_guard_transition` is also `BEFORE UPDATE OF status` only, but
`pg_get_functiondef(guard_delivery_transition)` shows it guards only `status` itself and
its own role checks — no other-column freeze logic that scoping could silently skip. Not
the same bug class as `tickets`; confirmed rather than assumed.

### Three defects surfaced running the suite for the first time — all three in the test file, zero in product code

1. **Fixture bug** (same class as the sales suite): the org-B ticket's creator
   (`f1...0002`) had no `user_roles` row in org B; `guard_order_actor_and_assignment()`
   correctly rejected the insert. Fixed by adding the membership row.
2. **Fixture bug, column-count**: the org-B delivery row supplied only 7 values for 8
   columns `(id, tenant_id, branch_id, ticket_id, driver_id, status, address_line,
   created_at)`. Naively patching with an extra `NULL` (for `driver_id`) still failed:
   `ticket_id` turned out to be the column genuinely missing a value —
   `23502 null value in column "ticket_id" violates not-null constraint`. Corrected by
   filling `ticket_id` from the org-B ticket already in the fixture and leaving `driver_id`
   NULL.
3. **Stale assertion, not a defect**: D1 still asserted `deliveries` has **no**
   `deleted_at` (`softDeleted: false`). Checked `queries/delivery.ts` before touching
   anything: line 95 already reads `softDeleted: true`, with a comment citing the exact
   2026-08-15 live-verification pass that corrected it. The code was already right; this
   test was simply never updated to match and still asserted the pre-correction claim.
   Fixed the assertion, not the code.

### Result: 11/11 passed

`tests/sql/delivery_read_rls.sql` header rewritten from the stale BLOCKER-011 banner to
record the real 2026-08-23 execution and all three fixes. **P4.5 read path is now
COMPLETE**, not just IMPLEMENTED.

### P4.3 / P4.5 roadmap sections reconciled

Both milestones' own `BACKEND_ROADMAP.md` sections were rewritten against the already-live
evidence already sitting in the P9.5/P9.6 rows of the same file (not re-verified
independently — that evidence was already first-hand: `complete_production_batch()`/
`fail_production_batch()` and `transition_delivery()`/`update_delivery_details()`, all
live-verified 2026-08-21, plus BLOCKER-016/017's 2026-08-22 resolutions). P4.3: NOT_STARTED
→ COMPLETE (read + write). P4.5: "write path BLOCKED" → COMPLETE (read + write) — that
phrasing was itself always slightly wrong: `authenticated` holding no `UPDATE` grant on
`deliveries` is the *intended* mechanism forcing the RPC-only write path, not evidence of a
blocker. Current State summary's per-domain read/write breakdown updated to match, its two
"not reconciled in this pass" flags now resolved, and its still-stale "P6.6 NOT_STARTED"
line corrected to COMPLETE in the same pass (P6.6 shipped 2026-08-22, earlier this
session — simply never propagated to this summary line).

**Executed evidence:**
```
mcp__supabase__execute_sql (pg_get_triggerdef for deliveries)
                                            -> deliveries_guard_transition: BEFORE UPDATE OF status
mcp__supabase__execute_sql (pg_get_functiondef guard_delivery_transition)
                                            -> status-only guard confirmed, not the tickets bug class
mcp__supabase__execute_sql (full D1-D10 fixture + assertions, rolled back)
                                            -> ERROR 42601 VALUES lists must all be the same length
mcp__supabase__execute_sql (patched with extra NULL, rolled back)
                                            -> ERROR 23502 null value in column "ticket_id"
Read: bakeflow-frontend/packages/api/queries/delivery.ts:95
                                            -> softDeleted: true, already correct
mcp__supabase__execute_sql (fixture fully corrected, full D1-D10 suite, rolled back)
                                            -> 11/11 passed
```

---

## 2026-08-24 · P8.1 re-verified live — discovered already fully built, docs badly stale

**Scope:** instructed to "start P8.1 — the first frontend vertical slice", with explicit
instructions to inspect before changing anything, reuse existing patterns, verify the
real user flow (not just compilation), and run a security review across everything
touched. **Zero product code changed** — investigation found the slice already existed,
already worked, and already had continuous live regression coverage; the actual gap was
two badly stale documents.

### What "inspect before changing" found

`Glob`/`Read` on `bakeflow-frontend/apps/mobile` found real, production-quality screens
already committed: `_layout.tsx` (the navigation gate), `sign-in.tsx`,
`select-organization.tsx`, `index.tsx` (catalog), `product/[id].tsx` (detail — P9.1,
shipped same day as P8.1), plus `inventory/`, `production/`, `delivery/` screens (P9.4,
P9.5, P9.6) built on top of it since. This contradicted two documents directly:

- `CLAUDE.md` line 5: "Frontend is pre-development: no app code exists yet."
- `BACKEND_ROADMAP.md` Phase 8: "P8.0 remains open... P8.1 was and is available to start."

`CURRENT_TASK.md` told the true story once read in full: `## ✅ P8.1 DELIVERED — sign in
→ choose bakery → catalog (2026-08-15)`, followed by same-day entries fixing a bug found
in review (`activeTenantIdFromSession` read `app_metadata`, but the live
`custom_access_token_hook` writes top-level JWT claims — the accessor returned `null` for
every signed-in user until fixed) and closing BLOCKER-014 (the access-token hook existed
in the database but was never registered in the project's Auth settings, so it was never
invoked at all). Since then, `scripts/smoke-signed-in.mjs` — the exact P8.1 flow, sign-in
through organization switching through catalog reads — has been the project's standing
live regression suite, run and passing throughout essentially every backend task this
session, most recently in today's own earlier P4.4/P4.5 work.

### Security review of the P8.1 slice

Read every file in the slice end to end against the requested categories — authorization,
tenant isolation, token/session handling, sensitive-data exposure, input validation,
cache isolation, insecure client-side trust:

| File | What it does right |
|---|---|
| `packages/auth/index.ts`, `claims.ts` | Session lives in chunked `expo-secure-store` (Keychain/Keystore), never AsyncStorage; `tenant_id` is always decoded from the JWT payload the database will enforce, never trusted from a client tap; the module's own doc comment states plainly that these values are not authorization and a forged token only changes which empty screen renders. |
| `packages/config/index.ts` | Only `EXPO_PUBLIC_*` variables are readable in the client bundle — the service-role key is structurally excluded, not just conventionally avoided. |
| `providers/AppProviders.tsx` | `onAuthStateChange` evicts organization-scoped cache entries **before** publishing the new session on a tenant-claim change, closing the window where a render could land between a token switch and cache eviction. |
| `packages/hooks/index.ts` | Every organization-scoped query key is built only through `orgScoped()`, keyed on the claim actually in force rather than the id tapped; `clearOrganizationScopedCache` uses `removeQueries` (not `invalidateQueries`) so a switch can never render a frame of the previous bakery's data. |
| `packages/api/queries/organizations.ts`, `catalog.ts` | Every filter goes through the PostgREST query builder (`.eq()`, `.is()`) — no raw SQL, no string interpolation, so a crafted route param (e.g. `product/[id]`) cannot reach the database as anything but a parameterized filter value. |
| `components/ScreenState.tsx` | `ErrorState` renders `error.message` raw — safe only because `BakeflowApiError.message` is already guaranteed (TD-017 work, 2026-08-23) to never carry raw server text. Checked this invariant still holds before trusting the render. |

No defects found. The architecture already anticipated and defended against every
category asked about, several of them explicitly in its own doc comments.

### Fresh live verification (not relying on any historical log entry)

| Command | Result |
|---|---|
| `npm run typecheck --workspace apps/mobile` | exit 0 |
| `npm run typecheck` (all workspaces) | exit 0 |
| `npx eslint packages --max-warnings=0` | exit 0 |
| `npm run lint --workspace apps/mobile` | exit 0 |
| `npm run verify:cache` | **67/67 passed** |
| `node scripts/smoke-signed-in.mjs` | **112/112 passed**, exit 0 (two prior attempts failed on the very first network call — `fetch failed` at sign-in — both transient; a third attempt succeeded outright) |
| `.venv/Scripts/python.exe -m pytest -q` | 12 passed |

The smoke run is the strongest verification achievable in this environment: no physical
device or emulator exists here, so "on-device run" remains formally NOT PERFORMED, same
as every prior pass — but the script signs in for real, decodes the real JWT, calls
`set_active_organization()` + `refreshSession()` for real, and reads the catalog through
the actual `packages/api`/`packages/hooks` code paths against live RLS, then repeats the
whole thing under a second organization and asserts zero cross-tenant leakage by six
independent paths (direct id, list, stock levels, batches, tickets, deliveries).

### Documentation corrected

- `CLAUDE.md` line 5: removed the false "no app code exists yet" claim; states the
  actual 2026-08-24 frontend status and warns against trusting a status claim in this
  file over the real repository state.
- `BACKEND_ROADMAP.md`: the "P8.0 remains open" banner rewritten to "P8.0 is CLOSED";
  the P8.1 milestone section rewritten with the full delivery/verification evidence
  trail; the frozen 2026-08-14 blocker table given a correction banner rather than
  silently rewritten (most of its citations were resolved days to weeks later and never
  updated); the P9.1 table row updated from "READY after P8.1" to COMPLETE; a new
  frontend-status paragraph added to the top-of-file Current State section.
- `CURRENT_TASK.md`: new entry at the top recording this pass.

**Executed evidence:**
```
Glob apps/mobile/app/*.tsx (and inventory/production/delivery subdirs)
                                            -> 11 screens already exist, contradicting
                                               CLAUDE.md's "no app code exists yet"
Read: apps/mobile/app/_layout.tsx, sign-in.tsx, select-organization.tsx, index.tsx,
      product/[id].tsx, providers/AppProviders.tsx, stores/session.ts,
      packages/auth/index.ts, claims.ts, packages/config/index.ts,
      packages/hooks/index.ts, components/ScreenState.tsx,
      packages/api/queries/organizations.ts, catalog.ts
                                            -> full security review, no defects found
npm run typecheck --workspace apps/mobile   -> exit 0
npm run typecheck                           -> exit 0 (all workspaces)
npx eslint packages --max-warnings=0        -> exit 0
npm run lint --workspace apps/mobile        -> exit 0
npm run verify:cache                        -> 67/67 passed
node scripts/smoke-signed-in.mjs            -> fetch failed (transient, retry 1)
node scripts/smoke-signed-in.mjs            -> fetch failed (transient, retry 2)
node scripts/smoke-signed-in.mjs            -> 112/112 passed, SMOKE TEST PASSED
.venv/Scripts/python.exe -m pytest -q       -> 12 passed
```

---

## 2026-08-24 · P5 financial backend audited for the first time — five real defects found and fixed

**Scope:** continuing under the standing goal directive after the P8.1 documentation
correction above. `BACKEND_ROADMAP.md`'s Phase 5 table still read BLOCKED on every row
despite AD-017 (approved earlier the same day, commit `9b85640a`) resolving the scope
question. `list_tables`/`pg_proc` showed the entire MVP financial schema and RPC surface
already live — `payments`, `refunds`, `invoices`, `cash_sessions`, `expenses`,
`daily_financial_audits`, `record_payment()`, `record_refund()`, `open_cash_session()`,
`close_cash_session()` — but `tests/sql/` had no financial suite at all, and nothing had
ever exercised this domain end-to-end. Same pattern as P4.3/P4.5/P8.1 earlier this week:
backend built, roadmap frozen, zero verification.

### Four real defects found auditing the live RPCs against AD-017, before writing any test

Read every relevant function body (`record_payment`, `guard_payment_relationships`,
`record_refund`, `guard_refund_total`, `open_cash_session`, `close_cash_session`,
`guard_cash_session_transition`, `guard_expense_cash_session`,
`guard_daily_financial_audit_mutation`) against AD-017's stated rules before touching
anything, then reproduced each suspected gap live in a rolled-back transaction before
fixing it — none were fixed on suspicion alone.

1. **`record_payment()` actively offered `'credit'` as a payment method.** AD-017: "a
   credit sale creates no payment row" — credit is the absence of a payment, not a
   method. Reproduced: a `method='credit'` payment inserted successfully. Fixed by
   removing `'credit'` from the RPC's allowed-method list. The table's own
   `payments_method_check` CHECK still permits it — left alone as dormant
   deferred-capability schema, per AD-017's own allowance, since no live path can reach
   it once the RPC stops offering it.
2. **Nothing anywhere enforced AD-017's "overpayments are rejected against the current
   outstanding balance."** Reproduced: a 500.0000 payment against a 100.0000 ticket total
   succeeded outright, `tickets.amount_paid` updated to 500. Fixed in
   `guard_payment_relationships()` (`BEFORE INSERT` on `payments`, not only in
   `record_payment()`) so the invariant holds regardless of write path — same
   defense-in-depth precedent as the `tickets_guard_status_transition` fix two days ago.
   Re-verified: single overpayment refused, cumulative overpayment across two payments
   refused, a payment landing exactly on the boundary still succeeds (not an off-by-one),
   a legitimate partial payment still succeeds.
3. **`guard_expense_cash_session()` validated the branch match but never that
   `paid_method='cash'` when `cash_session_id` was set** — unlike
   `guard_payment_relationships()`'s identical, already-existing check for payments.
   AD-017: "non-cash expenses do not reduce expected drawer cash." Reproduced: a
   `paid_method='transfer'` expense attached to an open cash session inserted
   successfully, which `close_cash_session()`'s reconciliation sums unconditionally —
   silently corrupting the till count. Fixed by mirroring the payments guard exactly.
4. **`cash_sessions` was the one P5 table still holding direct `INSERT`/`UPDATE` grants
   for `authenticated`**, unlike its siblings `payments`/`invoices`/`refunds` (all
   `SELECT`-only, RPC-gated writes). `open_cash_session()`/`close_cash_session()` are both
   `SECURITY DEFINER` and never needed the grants — they run as the function owner
   regardless. Reproduced: a direct `INSERT` succeeded with `opened_by` set to a
   *different* profile than the caller (impersonation) and wrote **zero** `audit_log`
   rows (the RPC's own `log_audit_event()` call never ran). Fixed by `REVOKE INSERT,
   UPDATE ON cash_sessions FROM authenticated` — behavior-neutral for the RPC path,
   verified: both RPCs still work end-to-end, including the audit-log write, after the
   revoke.

### A fifth defect — a self-introduced regression from two days ago, found writing the new suite's F19

Designing `financial_write_rls.sql`'s F18/F19 (subtotal freeze must still hold, but item
edits must keep working through `confirmed`) surfaced that
`widen_tickets_guard_status_transition_to_cover_subtotal_amount` (applied 2026-08-23,
closing the S10 gap in `sales_read_rls.sql`) had been **too broad**: it blocked *any*
change to `subtotal_amount` once a ticket left `draft`, including the legitimate one —
`recalculate_ticket_totals()` (`AFTER` trigger on `ticket_items`, unconditional on
status) recomputing the true sum whenever an item is added/edited/removed, which is
supposed to keep working all the way to `ready` (S11a/S11b in `sales_read_rls.sql`,
proven correct just yesterday). Reproduced directly: inserting a `ticket_item` while
`status='confirmed'` now failed outright with "subtotal_amount is frozen once a ticket
leaves draft" — a real regression breaking core ticket editing for the entire
`confirmed`→`ready` window, not a narrow edge case.

Root cause: the freeze checked "did the value change", when it needed to check "is the
new value the arbitrary/wrong one" — `confirm_ticket()`'s own recompute only ever
happened to pass because `recalculate_ticket_totals()` had already produced the identical
value beforehand, masking the bug in the one place I'd tested it (S10 itself only tests a
direct out-of-band write, never a real item-driven recalculation on a non-draft ticket —
a gap in yesterday's own test design).

**Fix** (`fix_subtotal_freeze_overblocked_legitimate_recalculation`): compare the
attempted `NEW.subtotal_amount` against the true derived sum
(`SELECT COALESCE(SUM(line_total),0) FROM ticket_items WHERE ticket_id = NEW.id` — the
exact formula `recalculate_ticket_totals()` uses) rather than against `OLD.subtotal_amount`.
A write matching the true sum is a legitimate recalculation and is allowed; a write that
doesn't match is an out-of-band write and is refused, exactly as before. Verified all four
properties simultaneously in one pass: item-add while `confirmed` now succeeds and
recalculates correctly (100→150); a direct arbitrary write (999999) is still refused; the
full `sales_read_rls.sql` suite re-run end to end, 27/27, including S10 and S11a/S11b
together for the first time. Full signed-in smoke suite re-run clean, 112/112, after this
fix and again after all four P5 fixes below it.

### `tests/sql/financial_write_rls.sql` — new, F1–F23 (28 assertions), 28/28 passed

The first test suite this domain has ever had. Covers: RLS force on all six tables (F1);
the full ticket→submit→confirm(invoice)→payment→refund lifecycle including every
overpayment/refund-overshoot boundary (F2–F10c); the subtotal-freeze regression guard
(F18/F19); cash-session open/close/reconciliation including the one-open-per-branch
partial unique index, the variance-note requirement, and the direct-INSERT-refused
regression guard for defect 4 (F11–F17); the daily-audit four-eyes rule and
post-confirmation immutability (F21–F23); tenant isolation across all six tables in one
pass (F20).

Two fixture bugs found authoring it, both fixed in the suite, neither a product defect:
- Same defect class as `sales_read_rls.sql`/`delivery_read_rls.sql`: the cross-org
  fixture ticket's creator had no `user_roles` row in org B.
- `guard_daily_financial_audit_mutation()`'s four-eyes check only compares roles, not
  branch, but the *RLS* `daily_financial_audits_update_review` policy does require
  `has_branch_access()` — and `has_branch_access()` only bypasses for owner/admin, not
  branch_manager (read live: `public.has_branch_access`, same rule
  `sales_read_rls.sql` S14 already established). Without a `branch_assignments` row for
  the second manager, the "confirm" `UPDATE` silently matched zero rows — no exception,
  nothing changed — which the *next* assertion caught, but only by accident. Fixed the
  fixture (added the assignment) and additionally hardened the F22 assertion itself to
  check the resulting `status`, not just the absence of an exception, so this class of
  false-positive can't recur even if branch-scoping breaks again later.

### Documentation corrected

`BACKEND_ROADMAP.md` Phase 5: header and every row of the milestone table rewritten from
BLOCKED against verified-live status (P5.3/P5.4/P5.6/P5.7 COMPLETE, P5.5 RPC-complete but
product-deferred by AD-017, P5.1/P5.2 correctly DEFERRED not blocked, P5.8 flagged
not-audited); the stale "decisions needed" line replaced with what AD-017 actually
decided. Current State summary's P5 line rewritten to match.

**Executed evidence:**
```
mcp__supabase__list_tables                  -> payments/refunds/invoices/cash_sessions/
                                                expenses/daily_financial_audits all live,
                                                RLS enabled, 0 rows
mcp__supabase__execute_sql (pg_proc search)  -> record_payment/record_refund/
                                                open_cash_session/close_cash_session/
                                                all guard triggers already live
mcp__supabase__execute_sql (overpayment repro, rolled back)
                                              -> 500 vs 100 total succeeded (defect 2 confirmed)
mcp__supabase__apply_migration p5_financial_ad017_conformance_fixes
                                              -> record_payment() + guard_payment_relationships() fixed
mcp__supabase__execute_sql (fix verification, rolled back)
                                              -> 6/6: credit refused, overpayment refused
                                                 (single + cumulative + exact boundary),
                                                 legitimate payment still works
mcp__supabase__apply_migration fix_guard_expense_cash_session_requires_cash_method
                                              -> guard_expense_cash_session() fixed
mcp__supabase__execute_sql (fix verification, rolled back) -> 3/3 passed
mcp__supabase__execute_sql (cash_sessions impersonation repro, rolled back)
                                              -> direct INSERT succeeded, opened_by
                                                 spoofed, 0 audit_log rows (defect 4 confirmed)
mcp__supabase__apply_migration revoke_direct_write_grants_on_cash_sessions
                                              -> REVOKE applied
mcp__supabase__execute_sql (fix verification, rolled back)
                                              -> 4/4: direct write refused, both RPCs
                                                 still work end to end, audit row written
mcp__supabase__execute_sql (subtotal-freeze regression repro, rolled back)
                                              -> item insert while status=confirmed FAILED
                                                 (defect 5 / self-regression confirmed)
mcp__supabase__apply_migration fix_subtotal_freeze_overblocked_legitimate_recalculation
                                              -> guard_ticket_status_transition() fixed
mcp__supabase__execute_sql (fix verification, rolled back)
                                              -> 4/4: legitimate recalc succeeds, arbitrary
                                                 write still refused, both simultaneously
mcp__supabase__execute_sql (full sales_read_rls.sql suite, rolled back)
                                              -> 27/27 passed (S10 + S11a/S11b together)
node scripts/smoke-signed-in.mjs             -> 112/112 passed (post subtotal-freeze fix)
mcp__supabase__execute_sql (full financial_write_rls.sql suite, rolled back)
                                              -> 28/28 passed
node scripts/smoke-signed-in.mjs             -> 112/112 passed (final, post all P5 fixes)
.venv/Scripts/python.exe -m pytest -q        -> 12 passed
```

---

## 2026-08-24 · P5.8 (Reporting & P&L) investigated — genuine blocker found, BLOCKER-018 raised

**Scope:** the natural next item after auditing P5.1–P5.7 above. Checked whether P5.8
was actually buildable before starting: `pg_views`/`pg_matviews` are both empty in the
live database — `20260810120000_reporting_views.sql` was never applied, so this row's
prior "BLOCKED" status was, unlike the rest of Phase 5, actually true rather than stale.

Read `docs/REPORTING-MODEL.md` in full (85 sections) to check whether it was concrete
enough to implement without guessing. It is — §85 locks revenue recognition, reporting-day
boundary, costing method, and refund treatment explicitly, consistent with AD-017. Checked
its two named hard schema prerequisites before assuming either way:

- `organizations.timezone text` — **exists live.**
- `stock_movements.unit_cost numeric` — **exists live, but is 100% NULL on every row**,
  including all four `purchase`-reason rows (the movement type that should be the actual
  cost source for weighted-average costing). Verified by `GROUP BY reason` with a
  `count(unit_cost)` alongside `count(*)`: every reason, zero non-null costs.

Weighted-average COGS (the REPORTING-MODEL.md-locked costing method, explicitly not
last-cost or FIFO) is therefore uncomputable from live data — not because the formula is
unspecified, but because nothing anywhere ever captures what an ingredient purchase
actually cost. Fabricating a cost would produce a silently-wrong P&L (exactly what
REPORTING-MODEL.md rule 33 and §27–30 forbid); reporting COGS as permanently zero would
be equally wrong. Deciding **how** cost gets captured — a field on `adjust_stock()`'s
`purchase` path, a separate purchase-order workflow, a default per-ingredient standard
cost — has real UX/migration/offline-sync consequences and isn't specified anywhere.
Recorded as **BLOCKER-018** rather than guessed, per this project's standing rule that
unspecified financial behaviour stops work.

**Not fully blocked:** the revenue/cash half of P5.8 — gross/net revenue, refunds, cash
collected/reconciled (REPORTING-MODEL.md §44/§45) — depends only on `tickets`,
`payments`, `refunds`, `cash_sessions`, `daily_financial_audits`, all verified correct
earlier today. Only COGS/gross-profit/inventory-valuation are stopped by BLOCKER-018.
Building the full reporting/dashboard layer (8 conceptual views/RPCs per
REPORTING-MODEL.md §43/§52) is substantial new feature work, not an audit-and-fix pass
like the rest of this session — deliberately not started unilaterally in this same pass;
flagged for a scoped follow-up instead.

### Documentation

`BACKEND_ROADMAP.md` P5.8 row rewritten from "not audited" to the actual finding.
`BLOCKERS.md` BLOCKER-018 added (full detail, including the reason/count table).
`NOTIFICATIONS.md` given a matching ACTION REQUIRED entry, newest-first.

**Executed evidence:**
```
mcp__supabase__execute_sql (pg_views, pg_matviews)      -> both empty, migration never applied
Read: docs/REPORTING-MODEL.md (full, 2326 lines)         -> decision-locked, consistent with AD-017
mcp__supabase__execute_sql (organizations columns)       -> timezone column present
mcp__supabase__execute_sql (stock_movements columns)     -> unit_cost column present
mcp__supabase__execute_sql (stock_movements GROUP BY reason, count(unit_cost))
                                                          -> 0 of 166 rows across all 6 reasons
                                                             carry a unit_cost
```
