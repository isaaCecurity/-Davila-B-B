# BakeFlow — Current Task

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
