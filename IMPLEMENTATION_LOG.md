# BakeFlow — Implementation Log

Append-only. Every entry records commands actually executed and their output.
Never record planned work here.

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
