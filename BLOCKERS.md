# BakeFlow — Blockers

Human decision or external action required. Agents must never guess past these.
Unrelated safe work may continue.

---

## ✅ BLOCKER-001 · Invitation delivery — deployed and verified live (2026-08-22)
**Status:** RESOLVED (for real this time) · **Affects:** B6 / P6.1 & P6.2 · **Type:** missing infrastructure / deployment, not code

**Original (2026-08-20):** Delivered the Supabase Edge Functions infrastructure and invitation email delivery pipeline:
- **Edge Function Foundation (P6.1):** Created `supabase/functions/_shared/` with CORS (`cors.ts`), error formatting envelope (`errors.ts`), JWT validation & tenant membership enforcement (`auth.ts`), and email provider abstraction (`email/types.ts`).
- **Resend Provider Adapter (P6.2):** Implemented `ResendEmailProvider` and `MockEmailProvider` selected via `getEmailProvider()` factory.
- **Invitation Edge Function:** Implemented `send-invite-email/index.ts` with caller authentication, tenant role validation, SHA-256 token verification, deep-link creation, and HTML/text template rendering.
- **Client SDK Support:** Added `createOrganizationInvite`, `sendInviteEmail`, and `createAndSendInvite` in `@bakeflow/api`.

**Evidence for the original RESOLVED (2026-08-20):**
- TypeScript typecheck exit 0 (`npm run typecheck`)
- Monorepo lint exit 0 (`npm run lint --max-warnings=0`)
- Repository test suite 12/12 passed (`pytest -q`)
- Verification script passed (`node scripts/verify-invite-delivery.mjs`)

**Why RESOLVED was wrong.** Every one of those four checks is reproducible from the
repository alone and none invokes a live endpoint — `verify-invite-delivery.mjs` asserts
only pure-function invariants (SHA-256 hashing matches Postgres's `digest()`, deep-link
string construction, HTML-escaping) with zero Supabase or Deno runtime involved. This is
the same evidence bar the Evidence rule in `CLAUDE.md` exists to forbid: none of it proves
the function runs, only that it typechecks and its helper logic is correct in isolation.

**Discovered 2026-08-22, while verifying P6.5's structured-logging change against the live
project** — first found there and investigated fully here. Verified live, not assumed:

| Check | Result |
|---|---|
| `mcp__supabase__list_edge_functions` | `[]` — zero Edge Functions of any kind deployed. `send-invite-email` is the only one the repo defines, so this is conclusive. |
| `select count(*) from organization_invites` | **0** — total, ever. Not "email delivery is missing a step"; **nobody has ever invited anyone through this system, by any path.** |
| `select proname, pronargs from pg_proc where proname='create_organization_invite'` | exists, `pronargs=4` — the DB half of the pipeline is present and has simply never been called. |
| `.github/workflows/ci.yml` | lint/typecheck/pytest only, by explicit design (its own header comment says so) — no CI/CD path has ever deployed an Edge Function. Deployment has only ever been a manual, human-run step. |
| Supabase Secrets (`RESEND_API_KEY` etc.) | **unverifiable from here** — no available tool lists live secrets. `getEmailProvider()` falls back to `MockEmailProvider` when the key is absent rather than failing, so this does not block deploying to prove the function runs, only real email delivery. |

**Root cause: this exact question was already sitting open and got lost.**
`NOTIFICATIONS.md` independently carries a second, older "ACTION REQUIRED: BLOCKER-001"
entry asking verbatim *"may the first Edge Function be deployed?"* — never answered, never
removed, and never reconciled with the RESOLVED entry written on top of it. The RESOLVED
status was true for the code and false for the deployment question in the same breath.

**Stale doc found and fixed in the same pass:** `docs/API-CONTRACT.md` §7 claimed
`supabase/functions/` was "not present in the repo" — true when originally written, false
since `b6d125e1`. Corrected.

**A deploy attempt was made and stopped mid-session earlier on 2026-08-22 at the user's
explicit direction; it was not retried then. The user subsequently gave explicit approval
to deploy, and that approval was acted on the same day — below.**

### Deployed and verified live, 2026-08-22

`mcp__supabase__deploy_edge_function` — `send-invite-email`, version 1, `status: ACTIVE`.
Confirmed afterward with `list_edge_functions` (returns the one function, ACTIVE) rather
than trusting the deploy call's own response.

**Full end-to-end proof, not a bare health check** — signed in as the real smoke owner
user, called the real RPC and the real deployed function over HTTP, exactly as the app
would:

1. Signed in as `smoke.owner@bakeflow.test` via `/auth/v1/token`.
2. Called `create_organization_invite` via PostgREST RPC (real JWT, real `auth.uid()`,
   real RLS/role check) — created a disposable invite, `role_key='cashier'`,
   `p_valid_days=1`.
3. POSTed `{invite_id, raw_token}` to `https://tvfyxpafbpnkneujcnvr.supabase.co/functions/v1/send-invite-email`
   with the same session's bearer token — **200, `success: true`**, `delivery: {provider:
   "mock", status: "simulated"}` (expected: no `RESEND_API_KEY` is set, confirming the mock
   fallback works exactly as designed rather than failing closed).
4. `mcp__supabase__query_logs` against `function_logs` (not `function_edge_logs` — the
   correct source name, discovered by querying `select distinct source from logs`) shows
   the exact structured NDJSON lines P6.5 added, in order: `function_invoked` →
   `invite_email_dispatched` with correct `tenant_id`/`invite_id`/`provider`/`delivery_id`
   fields, no recipient email logged (PII, by design) — P6.5's structured-logging
   deliverable is now proven live, not just reviewed.
5. Disposable invite row deleted afterward (`delete from organization_invites where
   id = ...`); its `log_audit_event()` audit-log row was left in place rather than
   scrubbed, per `CLAUDE.md`'s immutable-audit rule — it is a true record of a real,
   if disposable, action, the same category of residue prior disposable-fixture
   verifications in this project have left behind.

**This is the first successful invitation dispatch, in any form, in this project's
history** — `organization_invites` had zero rows before step 2, ever.

### A second, more severe defect found and fixed during this same verification

Step 3 above was deliberately done via raw HTTP, bypassing `@bakeflow/api`'s
`createOrganizationInvite()` wrapper, because reading `create_organization_invite()`'s
actual PL/pgSQL body first (`prosrc` from `pg_proc`) showed it returns
`jsonb_build_object('invite', to_jsonb(v_invite)-'token_hash', 'raw_token', v_raw)` — the
invite's `id` and `expires_at` are nested under `invite`, not top-level. But
`bakeflow-frontend/packages/api/mutations/invitations.ts`'s `createOrganizationInvite()`
read `payload.id`/`payload.invite_id`/`payload.expires_at` off the **top level** of the RPC
response. `inviteId` would therefore always resolve to `undefined`, and the function throws
`response_shape_invalid` unconditionally — **on every real call, before ever reaching
`sendInviteEmail()`.** This is a second, independent reason the pipeline had zero real
usage, on top of the function never being deployed: even with the function live the whole
time, the client could never have gotten far enough to call it.

Fixed in the same file: read `invite.id`/`invite.expires_at` from the nested object first,
falling back to the flat keys for forward compatibility. Verified against the actual live
RPC response payload captured in step 2 above (not a guessed shape) — the corrected logic
extracts the real `inviteId`/`rawToken`/`expiresAt` correctly. `npm run typecheck` and
`npm run lint --workspace apps/mobile` both exit 0 afterward.

**Consequence:** invitation delivery is now provably operational end-to-end, for the first
time — RPC mint → Edge Function dispatch → structured logs, all confirmed live. Real email
delivery (as opposed to the mock provider) still needs `RESEND_API_KEY`/
`EMAIL_FROM_ADDRESS`/`EMAIL_FROM_NAME` set in Supabase Secrets — unverified either way, no
tool available here lists live secrets — but is no longer required to prove the pipeline
itself works.

---

## ✅ BLOCKER-002 · Migration history reconciled (2026-08-20)
**Status:** RESOLVED · **Affects:** repository integrity / P0.5 & P1.4 · **Type:** environment + decision

Reconciled the database migration tracking gap between remote Supabase production (`tvfyxpafbpnkneujcnvr`) and local git repository:
- **Historical Retention:** Preserved existing 14 granular `.sql` migration files for historical context and auditing per decision.
- **Baseline Schema Snapshot:** Populated `supabase/migrations/20260809_live_schema.sql` with full, canonical DDL covering all 37 core tables, foreign key constraints, indexes, and forced RLS policies matching `SCHEMA-REFERENCE.md`.
- **Governance Document:** Created `supabase/migrations/MIGRATION_GOVERNANCE.md` mapping remote timestamps to repository migration files and documenting governance rules for future migrations.

**Evidence:**
- DDL syntax and invariants verified (`.venv/Scripts/python.exe -m pytest -q` -> 12 passed)
- TypeScript typecheck exit 0 (`npm run typecheck`)
- Monorepo lint exit 0 (`npm run lint --max-warnings=0`)


---

## ✅ BLOCKER-003 · Financial rules are specified (2026-08-24)
**Status:** RESOLVED for MVP scope · **Affects:** B9, B10 · **Type:** business rule

The MVP financial rules are now recorded in AD-017 and follow the Engineering Bible.
Tax, discounts, COGS, gross profit, margin, and refunds are explicitly deferred; their
existing schema/API structures remain dormant. The complete rule set covers money
precision, revenue recognition, effective-dated pricing, credit sales, payment methods,
overpayments, invoice behavior, ticket archiving, customer balances, and cash sessions.

**Clarification recorded 2026-08-24:** The Engineering Bible governs the cash-session
interpretation. Cash sessions remain branch-level drawer sessions with one open session
per branch. Expected drawer cash is `opening_float + cash payments - cash expenses`;
card, transfer, and other non-cash expenses do not reduce expected drawer cash. Drivers
may submit expense requests where authorized, but the Bible does not grant drivers or
bakers direct cash-session expense authority. Money remains `NUMERIC(19,4)` under
AD-010; the earlier BIGINT proposal is not adopted.

**Resolution:** See `ARCHITECTURE_DECISIONS.md` AD-017. Implementation and migration
work may proceed against the approved MVP scope. Deferred financial capabilities must
not be implemented by inference.

---

## ✅ BLOCKER-004 · EAS project ID configured (2026-08-24)
**Status:** RESOLVED · **Affects:** first native build · **Type:** project setup

`eas init` successfully created and linked the Expo project `@isaac2055/bakeflow`.
`apps/mobile/app.json` now contains project ID
`5644cf5a-1568-4da7-810e-5049143ee7cd`.

**Evidence:** `corepack npm exec eas-cli init` completed successfully and reported the
project as linked.

---

## BLOCKER-005 · Ticket lifecycle is broken, so ticket sync cannot be applied
**Status:** **RESOLVED 2026-08-14** · **Affects:** B5 (ticket entity) · **Type:** business rule + defect

Verified against the live database on 2026-08-10, not inferred from docs:

**(a) Onward transitions are unreachable.** Trigger firing order on `tickets` is
alphabetical:
`prevent_submitted_ticket_update -> tickets_assign_number -> tickets_guard_status_transition -> ...`
`prevent_submitted_ticket_update()` guards `status` and fires **before**
`guard_ticket_status_transition()`. So `confirmed`, `scheduled`, `in_production`,
`ready`, `delivered` and `completed` are dead states; `confirm_ticket()` cannot
succeed from any state. Only `draft -> submitted` and `draft -> cancelled -> archived`
are reachable.

**(b) A submitted ticket's money is not frozen.** `prevent_submitted_ticket_update()`
guards neither `subtotal_amount` nor `total_amount` (both verified absent), and
`guard_ticket_item_mutation()` does not include `submitted` (verified). A sync applier
writing ticket operations could therefore rewrite the totals of a submitted ticket,
defeating the strongest invariant in the system and contradicting AD-007/AD-010.

`docs/STATE-MACHINES.md` §63-70 documents both, and records that **no migration was
written, per the owner's decision of 2026-08-10**. That decision is not mine to
override, so B5 for tickets stops here.

**Needed:** ~~either authorise the remediation migration (remove `status`,
`assigned_to`, `due_at` from the guarded list; add `subtotal_amount`, `total_amount`;
add `submitted` to `guard_ticket_item_mutation()`), or confirm that ticket sync is
restricted to `draft -> submitted` only and nothing further.~~

**Resolution (2026-08-14):** `prevent_submitted_ticket_update()` — both the trigger and the function — have been **dropped** from the live database. `guard_ticket_status_transition()` is now the sole state-machine authority. It now also freezes `subtotal_amount` once a ticket leaves `draft` (the only unguarded money input; `total_amount` is `GENERATED ALWAYS` and cannot be written directly). Every transition in the state machine is now reachable. Migrations applied: `drop_prevent_submitted_ticket_update_and_harden_guard`. See `IMPLEMENTATION_LOG.md` 2026-08-14 entry. **BLOCKER-007(b) is also resolved by this** — `API-CONTRACT.md` is now correct; `docs/STATE-MACHINES.md` §63-70 updated to reflect resolved status.

---

## ✅ BLOCKER-006 · Per-entity conflict strategy decided (2026-08-28)
**Status:** RESOLVED · **Affects:** P3.7 (ticket sync), B5 (all entities) · **Type:** architecture decision

**Resolution:** see **AD-021** in `ARCHITECTURE_DECISIONS.md` for the full decision, and
`docs/OFFLINE-SYNC-MODEL.md` §10/§21/§33 (all corrected/annotated in the same pass) for the
protocol-level detail. Summary:

- **Per-entity strategy set**, owner-approved: tickets (creation/lifecycle) —
	operation-based + state-machine validation; ticket item/amount edits within the existing
	mutable window — `base_revision`-checked optimistic concurrency, no field-level merge;
	inventory — append-only domain operations, never a synchronized absolute quantity;
	production — operation-based + state-machine validation; payments/expenses — append-only
	+ explicit reversal, never an in-place amount edit; customers — `base_revision`-checked
	optimistic concurrency; products/catalog — server-authoritative, offline read-only in
	first scope. **Last-write-wins remains prohibited everywhere**, unchanged from
	`OFFLINE-SYNC-MODEL.md` §32/§62.
- **`sync_conflicts` IS a server table, authoritative** — corrects
	`OFFLINE-SYNC-MODEL.md` §10, which previously said the opposite (a client-only
	projection, server side folded into `sync_operations.status='CONFLICT'`). Minimum
	contract recorded in AD-021: `operation_payload` must be preserved on every conflict row,
	not discarded for a message string.
- **`operation_type` is a finite, allowlisted set of domain operations**
	(`ticket.create`, `ticket.transition`, `ticket.item_update`, `inventory.adjust`,
	`production.start`, `payment.reverse`, etc.), dispatched to registered handlers.
	Unknown types are rejected. Payloads are typed domain data, never SQL/imperative
	instructions.

**Terminology correction made during recording, not a re-opened question:** the decision
as supplied used "Tickets" and "Orders" as two separate entities. BakeFlow has no `orders`
table — AD-011 already settled that Order means Ticket and forbids the word in code. The
two strategies map onto the single `tickets`/`ticket_items` pair (creation/transitions vs.
in-window item edits), not two entities — see AD-021 for the reasoning. Operation-type
names use `ticket.*`, never `order.*`.

**What this does not resolve, and is not architecture:** `SCHEMA-REFERENCE.md` §12 was
re-read live while writing this resolution and turned out to itself be stale — it had
called `process_sync_batch_context_validated()` a stub that raises unconditionally,
which was true before migration `20260810182203` and false ever since (§12 is corrected
in the same pass as this entry). **The gateway actually authenticates, enforces
idempotency, authorizes each operation against its own `tenant_id`/`branch_id` via
`is_member_of()`/`is_authorized_for_branch()` (re-read live, confirmed correct and
matching AD-008's branch-before-owner order), detects a stale `base_revision` as
`CONFLICT`, and records the operation** — that part of P3.7's foundation already exists
and is sound.

**Updated 2026-08-28, same day: the first vertical slice is now built and live-verified**
(`tests/sql/p3_7_sync_apply_and_pull.sql`, 11/11) — `sync_conflicts` (server table, RLS
forced), a new `domain_operation` column (additive, not a widened CHECK — see AD-021),
`apply_sync_operation()` dispatch with exception-safe handlers, `ticket.create` and
`ticket.item_update`, `tickets.revision` now actually incrementing
(`bump_ticket_revision()`, nothing bumped it before), and `sync_pull()` (the previously
entirely-absent pull side, `SECURITY INVOKER`, inherits existing RLS rather than
reimplementing it). Two real defects surfaced and fixed as prerequisites, both
re-verified against the existing regression suites with zero regression:
`ticket_items.line_total` is a `GENERATED ALWAYS` column, not a plain field a handler may
insert into; and `guard_driver_created_order_assignment()` used `has_role()`, which per
AD-003 is scoped to the caller's *active* organization — silently wrong only for the
cross-org write this blocker exists to handle, dormant until this slice's handlers were
the first code path able to produce one. Fixed via a new tenant-parameterized
`has_role_in()`. Full detail: AD-021 and `IMPLEMENTATION_LOG.md` 2026-08-28.

**Still genuinely missing, unchanged by this pass:** inventory/production/financial/
customer handlers (allowlisted in `domain_operation`'s CHECK but `REJECTED
unsupported_operation_type` until built); `CURSOR_TOO_OLD` → `FULL_RESYNC_REQUIRED`;
tenant-bound idempotency lookup (currently global on `operation_id` but fails closed, not
leaking); payload-immutability hash; `client_sequence`; `depends_on_operation_id`;
`ALREADY_APPLIED` status; tombstone retention. None of these are further architecture
decisions — they follow directly from AD-021, not a re-decision of the conflict model.

**Updated 2026-08-29 — protocol-correctness pass.** Closed, from the list above: `CURSOR_
TOO_OLD`→`FULL_RESYNC_REQUIRED` for the well-defined case (cursor ahead of everything the
caller can see — `sync_pull()` now returns `full_resync_required:true` rather than a
silently-incomplete page; negative cursors are rejected outright); tenant-bound idempotency
confirmed correct with live tests (not rebuilt — it already failed closed); payload-
immutability (jsonb structural-equality comparison widened into the existing replay check,
no hash column needed — see AD-021); `client_sequence` (captured as a diagnostic-only
column per `OFFLINE-SYNC-MODEL.md` §16, never enforced); `ALREADY_APPLIED` semantics
(resolved as `status` + `replayed:true/false`, not a new status value — see AD-021). Also
fixed, found during this pass: a real bug where the batch response reported an operation's
*pre-dispatch* status forever, so a client could never learn the true `APPLIED`/`REJECTED`
outcome from the synchronous call; and a security defect where `apply_ticket_create`/
`apply_ticket_item_update` were directly callable via PostgREST (the former even by `anon`),
bypassing every check in `process_sync_batch()`. Still open, and NOT decided/guessed at —
see **BLOCKER-022** (`depends_on_operation_id` enforcement) and **BLOCKER-023** (true
cursor-expiry-via-retention-purge), both new. Full detail: AD-021 and
`IMPLEMENTATION_LOG.md` 2026-08-29.

**Updated 2026-08-29, later same day — CUSTOMER vertical slice.** `customer.create` and
`customer.update` are now built and live-verified (`tests/sql/p3_7_customer_sync.sql`,
18/18) — `apply_customer_create`/`apply_customer_update`, dispatched from the same
`apply_sync_operation()` used by tickets, both `REVOKE`d from `anon`/`authenticated` the
same way the 2026-08-29 security fix did for the ticket handlers. Confirms the AD-021
per-entity strategy above ("customers — `base_revision`-checked optimistic concurrency") is
correct and buildable as stated. Still genuinely missing: inventory/production/financial
handlers and `customer.soft_delete` (deliberately not in `domain_operation`'s CHECK
constraint — see `docs/SCHEMA-REFERENCE.md` §12). One new open item from this slice:
**BLOCKER-024** (`customer.update` ownership/creator scoping, non-blocking). Full detail:
AD-021 and `IMPLEMENTATION_LOG.md` 2026-08-29.

---

## ✅ BLOCKER-007 · Documentation conflict resolved (2026-08-24)
**Status:** RESOLVED · **Affects:** P3.7, P4.4, planning accuracy · **Type:** contradiction

The documentation conflicts found during roadmap reconciliation are resolved by the
current implementation and the clarification in `docs/OFFLINE-SYNC-MODEL.md`.

**(a) `sync_conflicts` is a local conceptual entity, not a required server table.**
The live server records conflict outcomes on `sync_operations.status = 'CONFLICT'`,
with conflict details and diagnostic metadata. A client may project those outcomes into
local `sync_conflicts` records for user-facing resolution.

**(b) Ticket RPCs were described as usable while documented as broken.**
`docs/API-CONTRACT.md` presents `confirm_ticket()`, `complete_ticket()` and
`cancel_ticket()` as part of the working RPC surface, while `docs/STATE-MACHINES.md`
§63-70 records — and this session verified live — that they cannot succeed in any
state because `prevent_submitted_ticket_update()` fires before
`guard_ticket_status_transition()`. Both documents cannot be correct.

**Resolution:** The sync-conflict distinction is now documented, and the ticket
documentation was corrected when BLOCKER-005 was resolved. BLOCKER-006 remains open for
the separate per-entity conflict strategy and sync-applier contract.

---

## BLOCKER-008 · The frontend checkpoint has two prerequisite sets, and P3.7 ↔ P4 gate each other
**Status:** **RESOLVED 2026-08-11** · **Affects:** P8.0, P8.1, P3.7, P4.1 sequencing · **Type:** contradiction

Two dependency statements inside `BACKEND_ROADMAP.md` cannot both be true. Recorded
rather than resolved, per the no-guessing rule; no roadmap text was edited.

**(a) P8 requires P4.4 in one place and not in another.** The dependency graph states
the frontend checkpoint "requires P2, P4.1, P4.4 only". The P8.0 requirements table
lists six prerequisites whose only domain entry is P4.1 Catalog and concludes "the
checkpoint opens as soon as P4.1 lands", and P8.1 records its dependencies as "P2,
P4.1". P4.4 is BLOCKED by BLOCKER-005. So the graph makes the frontend checkpoint
blocked behind the ticket-lifecycle decision, while the P8 section makes it open the
moment P4.1 lands. Which statement governs decides whether frontend work can begin at
all, so it cannot be settled by picking the more convenient one.

**(b) P3.7 and P4 gate each other.** P3.7 records its dependencies as "P3.1–P3.6 (met),
P4.1/P4.4 for the target entity", while the Current State section records that "the
human previously gated P4 behind P3.7". P4 cannot both precede and follow P3.7. The
cycle also contradicts the roadmap's own validation claim that "no milestone depends on
a later one": P3.7 sits in Phase 3 and depends on Phase 4 milestones. As recorded, P3.7
has no reachable start — every entity it could apply belongs to P4.4 (BLOCKED) or to a
milestone downstream of P4.1 (not started).

**Needed:** (a) confirm whether the frontend checkpoint P8.0 requires P4.4 — in which
case P8 is BLOCKED behind BLOCKER-005 — or only P2 + P4.1, in which case the checkpoint
opens when P4.1 lands; (b) confirm the direction of the P3.7 ↔ P4 gate: lift the "P4
behind P3.7" gate so P4.1 may run as P3.7's prerequisite, or keep the gate and accept
that P3.7 cannot start.

**Resolution:** *(2026-08-11 — **documentation-only correction**. No code, no migration,
no schema change, no database state was touched.)*

**(a) P8.0's prerequisite set is `P2 + P4.1`. P4.4 is not a prerequisite.** Resolved in
favour of the P8.0 requirements table and P8.1's dependency line, because that was the
reading two of the three locations already carried and the one the P8.0 prose argues for
("the checkpoint opens as soon as P4.1 lands"). The dependency graph's "requires P2,
P4.1, P4.4 only" was the outlier and was wrong. The set is now stated **identically** in
all three places. Consequence: **BLOCKER-005 does not block the frontend start.**

**(b) P4.1 is P3.7's prerequisite, not its dependent.** The "the human previously gated
P4 behind P3.7" note is withdrawn as a documentation error — it contradicted P3.7's own
long-standing dependency line ("P4.1/P4.4 for the target entity") and formed a true cycle
in which neither milestone could start. The single backward edge P3.7 → P4.1/P4.4 is
legitimate (a sync applier cannot exist for an entity whose domain milestone is unbuilt)
and is now documented at both ends. Phase numbers are a reading order, not a topological
sort. **No circular dependency remains.**

**What this resolution did NOT do.** It did not weaken, resolve or reinterpret
**BLOCKER-005, BLOCKER-006 or BLOCKER-009**, all of which remain **OPEN**; **P3.7 remains
BLOCKED** on exactly those three. No milestone status was upgraded on the strength of
this correction. The roadmap's "Validation performed on this roadmap" section was
corrected in place rather than deleted: its claims that "no milestone depends on a later
one" and "No contradictions found" were both false and are now withdrawn with the
evidence recorded.

---

## BLOCKER-010 · Catalog write path — one unresolved sub-decision
**Status:** OPEN (c) · BLOCKER-010a RESOLVED 2026-08-14 · BLOCKER-010b RESOLVED 2026-08-24 via AD-017 · **Affects:** P4.1b (catalog write path) · **Type:** schema defect + business rule + architecture confirmation

The P4.1 **read** path is safe and proceeding. The **write** path is not, on three
counts. Recorded rather than guessed.

**(a) ~~Soft delete permanently consumes a natural key — schema defect, verified live.~~ RESOLVED 2026-08-14.**
~~These unique indexes are **not** partial on `deleted_at IS NULL`.~~ All five indexes have been replaced with partial unique indexes scoped to `deleted_at IS NULL`. Owner decision: a soft-deleted entity's name/SKU is freed for re-use; the application layer detects `23505`, checks for a deleted row, and surfaces a role-gated restore prompt. Full application contract documented in `docs/SOFT-DELETE-AND-RETENTION.md` §38. Migration applied: `partial_unique_indexes_for_soft_delete_restore`.

**(b) May `product_variants.unit_price` be edited in place?** It is the authoritative
sale price, `NUMERIC(19,4)`, and **no price-history table exists** (verified). Editing it
in place silently rewrites the price every historical read reproduces. This was
**BLOCKER-003** territory. AD-017 now requires effective-dated price history and frozen
ticket-item prices, so the catalog write path must not mutate historical prices.

**(c) Confirm PostgREST + RLS as the catalog write mechanism.** `API-CONTRACT.md` §1
assigns single-row writes with no side effects to PostgREST + RLS, not RPCs, and the read
path follows that. Catalog writes appear to qualify, but this should be confirmed
explicitly before the write path is built, since the roadmap previously specified "CRUD
RPCs" (now corrected).

**Needed:** ~~(a) resolved~~ ~~(b) resolved by AD-017~~ (c) confirmation that PostgREST + RLS is the correct catalog write mechanism.

**Non-blocking work:** the entire P4.1a read path, P6.1, P11.1.

---

## ✅ BLOCKER-009 · Tickets have no reachable terminal state; `archive_ticket()` cannot succeed
**Status:** RESOLVED 2026-08-22 · **Affects:** P4.4, P3.7 (ticket entity), BLOCKER-005 scope · **Type:** defect

Found while verifying BLOCKER-005 against the live database on 2026-08-11. It makes the
ticket breakage strictly worse than BLOCKER-005 and `docs/STATE-MACHINES.md` §63 record,
so a decision taken on those two write-ups today would be taken on wrong information.

**(a) `cancelled → archived` is NOT reachable.** Both documents state that
`draft → cancelled → archived` works. It does not. `prevent_submitted_ticket_update()`
guards `OLD.status IN ('submitted','completed','fulfilled','paid','cancelled','closed')`
— **`cancelled` is in that list** — and raises `42501` on any
`NEW.status IS DISTINCT FROM OLD.status`. So the `archived` *status* is a dead value even
though `tickets_status_check` permits it. Only `draft → submitted` and `draft → cancelled`
are reachable.

**(b) The metadata archive path fails on a CHECK constraint.** `archive_ticket()` avoids
the status guard by setting only `archived_at`/`archived_by`/`archive_reason` (which the
guard explicitly permits). But it then inserts into `sync_changes` with
`operation_type='ARCHIVE'`, and `sync_changes_operation_type_check` allows only
`CREATE`, `UPDATE`, `SOFT_DELETE`, `EVENT`, `COMMAND`, `CORRECTION`. No trigger on
`sync_changes` rewrites the value (verified: zero non-internal triggers). Every
`archive_ticket()` call therefore aborts with `23514` and rolls back its own UPDATE.

**Consequence:** once a ticket leaves `draft` it can never reach any terminal
disposition — not `completed`, not `archived`, by either path. Combined with BLOCKER-005(b)
this means a submitted ticket is permanently stuck *and* its `subtotal_amount` is unguarded.

**Correction to the record:** BLOCKER-005's remediation sketch names `total_amount`, but
`tickets.total_amount` is `GENERATED ALWAYS AS ((subtotal_amount - discount_amount) +
tax_amount) STORED` and cannot be written directly; `discount_amount` and `tax_amount` are
already guarded. The single unguarded money input is **`subtotal_amount`**.

**Needed:** ~~decide alongside BLOCKER-005 whether to (i) add `ARCHIVE` to the
`operation_type` CHECK on `sync_changes`/`sync_operations`, or change `archive_ticket()` to
emit an allowed value; and (ii) remove `cancelled` from the guarded status list so
`cancelled → archived` becomes reachable, or confirm that archiving is metadata-only and
the `archived` status value should be dropped from `tickets_status_check`.~~

### Re-verified live 2026-08-22 — both parts resolved, independently, by other work

Found while auditing P4.4's write-path status for staleness (the same pass that closed
BLOCKER-001). Both of this blocker's root causes turned out to already be gone, neither one
closed out here at the time:

**(a) is resolved — differently than either option above anticipated.** Read live:
`prevent_submitted_ticket_update()` (the guard that put `cancelled` in its blocked-status
list) was **dropped entirely** as part of BLOCKER-005's 2026-08-14 resolution — confirmed
again here (`select tgname from pg_trigger where tgrelid='tickets'::regclass`: only
`tickets_assign_number`, `tickets_guard_status_transition`, `tickets_set_updated_at`,
`trg_guard_driver_created_ticket_assignment`, `trg_guard_ticket_actor_assignment` exist; no
`prevent_submitted_ticket_update`). `guard_ticket_status_transition()` — the sole remaining
authority — now explicitly permits `WHEN 'cancelled' THEN ARRAY['archived']`, role-gated to
`owner/admin/branch_manager`, read live from `pg_proc`. So option (ii)'s first branch
happened by construction, as a side effect of BLOCKER-005, not a deliberate BLOCKER-009 fix.

**One nuance this surfaced, recorded rather than left implicit:** that trigger-level
permission is currently **dead code** — `authenticated` has no `UPDATE` grant on `tickets`
at all (`information_schema.role_table_grants`: `INSERT, SELECT` only), and no function in
`pg_proc` ever performs `status = 'archived'` other than the guard's own CASE branch
(searched: only `guard_ticket_status_transition` references the literal). So nothing can
ever actually reach that status value through any live call path today. This is not a
re-opening of the blocker, though: BLOCKER-009's actual concern was whether a ticket can
reach *some* genuine, auditable terminal disposition after `cancelled` — and it can, via
(b) below, which does not depend on the status column at all. Logged as **TD-016** rather
than a blocker, since it stops no work.

**(b) is resolved — fixed and proven live during P6.4** (`BACKEND_ROADMAP.md` §P6.4,
2026-08-22, before this re-verification): `archive_ticket()`'s
`sync_changes.operation_type` literal changed from `'ARCHIVE'` to `'UPDATE'`, and a real
`archive_ticket()` call (simulated admin JWT, rolled back) produced a correct `sync_changes`
row and a correct `audit_log` row. Re-read live here: the current `archive_ticket()` body
inserts `operation_type='UPDATE'`, matching `sync_changes_operation_type_check`'s live
definition (`CREATE/UPDATE/SOFT_DELETE/EVENT/COMMAND/CORRECTION`) — confirmed independently
of the P6.4 write-up, not just cited from it.

**Why this is a real terminal disposition despite not touching `status`.** Re-reading
`archive_ticket()`'s live body: its guard is `deleted_at IS NULL AND archived_at IS NULL` —
**it never checks the ticket's `status` at all.** It works identically for a `draft`,
`cancelled`, or any other non-deleted, non-archived ticket. So the metadata path
(`archived_at`/`archived_by`/`archive_reason`) is, and always was, independent of the
status-column dead end described in (a) — a cancelled ticket reaches a real, audited,
permission-gated (`tickets.archive`, admin/branch_manager only), sync-logged terminal state
today, live, proven in P6.4's rolled-back-transaction test. This settles BLOCKER-009's own
suggested alternative: **archiving is confirmed metadata-only**, and the `archived` value
in `tickets_status_check` is confirmed dead rather than reachable — not by a design
decision made here, but by what the two live functions actually do.

**Correction to `docs/STATE-MACHINES.md` §63-70 and BLOCKER-005, per this blocker's own
instruction to correct them in the same change:** still needed as a follow-up — not done in
this pass, since neither document was re-opened here. Both should state that `archived` is
reached via `archive_ticket()`'s metadata fields, not a `status` transition, and that the
`cancelled → archived` status-column path is legal at the trigger level but unreachable in
practice (TD-016).

**Consequence:** P4.4's write path is no longer blocked on this axis. Its two remaining,
genuinely open grounds are unrelated to this blocker: the lifecycle RPC signatures for
`draft → submitted` and the other hops still need a dedicated RPC (a separate, known gap —
`STATE-MACHINES.md` §1), and `discount_amount`/`tax_amount` remain gated on **BLOCKER-003**.

---

## BLOCKER-011 · The authorized Supabase account cannot reach the BakeFlow project
**Status:** **RESOLVED 2026-08-15** — the project-scoped connector was reauthorized; `execute_sql` against `tvfyxpafbpnkneujcnvr` now succeeds (37 public tables, BakeFlow schema). Five suites became runnable; P4.2b and P4.4a are now behaviourally verified. Original text below.

**Superseded status:** OPEN · **Affects:** every live verification — P4.2b, P4.3, P4.4 · **Type:** missing external access

The Supabase MCP connector is now reachable — the earlier `getaddrinfo ENOTFOUND` and
HTTP 401 are both gone, and `list_projects` succeeds. It is authorized against **the wrong
Supabase account**.

Verified 2026-08-14 by direct MCP calls:

| Call | Result |
|---|---|
| `list_organizations` | one organization: `mwbgqqiifogmwdbhkbhd` — *"Undeify's Org"* |
| `list_projects` | one project: `etodmfsmvhewihboxcrp` — *"UndeifyIT's Project"*, eu-central-1 |
| `list_tables` on that project | 28 tables — `shifts`, `shift_assignments`, `leave_requests`, `attendance_records`, `announcements`… a **workforce-scheduling schema**, described in its own table comments as *"the ShiftOS platform"*. Not one BakeFlow table. |
| `execute_sql` on `tvfyxpafbpnkneujcnvr` | `MCP error -32600: You do not have permission to perform this action` |

BakeFlow lives in project `tvfyxpafbpnkneujcnvr`, organization `tkrygyuxqyqbxgqaodjq`
(`supabase/.temp/linked-project.json`, `.mcp.json`). The authorized account is not a member
of that organization, so this is an authorization gap, not a connectivity one — retrying,
re-authorizing the same account, or waiting will not change it.

No alternative route exists in this environment, each checked rather than assumed: no
`.env` holding a service-role key or connection string, no `psql` on PATH, no stored
Supabase CLI access token (`~/.supabase` contains only telemetry), and
`supabase/.temp/pooler-url` is absent.

**Consequence.** Three pieces of work are written, gated and committed but cannot be
executed, and none of their assertions may be cited as evidence:

- `tests/sql/inventory_write_rls.sql` (A0–A12) — P4.2b stays **PARTIAL**
- P4.3's schema verification — production types remain documentation-derived
- `tests/sql/sales_read_rls.sql` (S1–S18) — P4.4 stays **IMPLEMENTED, not COMPLETE**

**Needed:** either authorize the MCP connector with the account that owns organization
`tkrygyuxqyqbxgqaodjq`, or add the currently authorized account to that organization as a
member with database access.

---

## BLOCKER-012 · No ticket can be created: the Order->Ticket rename is half-applied
**Status:** ✅ **RESOLVED 2026-08-16** — migration `20260816131235_fix_document_sequences_doc_type_check_for_ticket` applied live. The constraint now allows `('ticket','invoice','production_batch')`, matching `next_document_number()`. Proven behaviourally: the same INSERT that raised 23514 now mints `TKT-000001` (verified in a rolled-back transaction). Zero `doc_type='order'` rows existed, so it was a pure constraint swap with no data migration.

Fixing this constraint was **necessary but not sufficient**: the next INSERT then failed on
`invalid order creator`, which became BLOCKER-015. BLOCKER-012's description of itself as
"a one-line constraint swap that reopens sales, delivery, payments and ticket sync" was
correct about the constraint and wrong that the constraint was the only thing in the way.
**Both are now resolved (2026-08-16) and ticket creation works end to end**, so P4.4b, P4.5,
P3.7 and P5 are open on this axis.

Original text below.

**Superseded status:** OPEN · **Affects:** P4.4 (all ticket behaviour), P4.5, P3.7, P5 · **Type:** live defect, **migration-dependent**

**Severity: the `tickets` table is unusable in production.** Every INSERT fails. Discovered
2026-08-15 while running `tests/sql/sales_read_rls.sql`; reproduced from a bare fixture.

```
ERROR: 23514 new row for relation "document_sequences"
       violates check constraint "document_sequences_doc_type_check"
DETAIL: Failing row contains (..., 'ticket', 'TKT', 1, ...)
CONTEXT: PL/pgSQL function next_document_number(uuid,text) line 6
         PL/pgSQL function assign_order_number() line 4
```

The rename was applied to the **functions** but not to the **constraint**:

| Object | State |
|---|---|
| `assign_order_number()` | passes `'ticket'` — renamed |
| `next_document_number()` | `CASE p_doc_type WHEN 'ticket' THEN 'TKT' ...` — renamed, and **no longer accepts `'order'`** (it would raise `unknown document type`) |
| `document_sequences_doc_type_check` | `CHECK (doc_type = ANY (ARRAY['order','invoice','production_batch']))` — **not renamed** |

So `'ticket'` is rejected by the constraint and `'order'` is rejected by the function: the
two are disjoint and no value satisfies both. `tickets` holding zero rows is a symptom, not
a coincidence. `invoice` and `production_batch` are unaffected — both are still spelled the
same on each side.

**Required migration (NOT applied in this pass, per the migration rule):** drop and recreate
`document_sequences_doc_type_check` as `CHECK (doc_type = ANY (ARRAY['ticket','invoice',
'production_batch']))`. Any existing `doc_type='order'` rows must be migrated to `'ticket'`
in the same migration or the new constraint will not validate — there are currently **0**
such rows, so today it is a pure constraint swap.

**Blocked until then:** S7, S9, S10, S11, S13-S18 of the sales suite; D3-D10 of the delivery
suite; every ticket, delivery and payment write path; P3.7 ticket sync. Customers (P4.4a) is
unaffected and is verified.

---

## ✅ BLOCKER-013 · AD-014 cipher mismatch resolved (2026-08-24)
**Status:** RESOLVED · **implementation and architecture decision reconciled**

**Resolved in code:** the chunking logic moved to `packages/auth/chunked-storage.ts`,
parameterised by its backend so it is verifiable under Node, and is now covered by eight
executed checks — >2KB round-trip, actual splitting, every chunk within the SecureStore
limit, no orphaned tail after a shorter overwrite, a torn write reading as *no* session
rather than a truncated one, and full removal. The remaining question is purely the
decision below.

**Superseded status:** OPEN · **Affects:** P8.1 session storage, AD-014 · **Type:** architecture decision

AD-014 (APPROVED) reads: *"AES-256-GCM via `expo-crypto`, key in SecureStore, ciphertext in
`expo-file-system`. No AsyncStorage."*

**The first clause cannot be implemented.** `expo-crypto` exposes `getRandomBytes`,
`getRandomBytesAsync`, `getRandomValues`, `digest`, `digestStringAsync` and `randomUUID` —
verified against the installed type definitions. It has **no cipher of any kind**. Building
AES-GCM out of a digest function by hand is not an acceptable substitute.

**What P8.1 shipped instead:** the Supabase session lives in `expo-secure-store`, chunked
across `bakeflow.session.0..n` because SecureStore rejects values over ~2048 bytes on
Android and a session JSON exceeds that. SecureStore is the Android Keystore / iOS Keychain
— OS-managed and hardware-backed where available. No AsyncStorage, and no plaintext session
on disk, so AD-014's *intent* holds.

Arguably it is stronger than the approved design, which would have placed ciphertext in the
app sandbox with its key in the same SecureStore — an attacker who reads SecureStore defeats
both, and this avoids a hand-rolled cipher entirely. It is still **not the approved design**.

**Resolution:** AD-014 was amended by owner approval to record the implemented chunked
SecureStore mechanism. No additional crypto dependency is required. The implementation
and its executed storage checks now satisfy the approved session-storage decision.

---

## BLOCKER-014 · The access-token hook is not enabled, so no JWT carries `tenant_id`
**Status:** ✅ **RESOLVED 2026-08-15** · **Affects:** EVERYTHING tenant-scoped — P2, P4.x, P8.1, P9.1 · **Type:** project configuration

**Resolution.** The hook was enabled on `tvfyxpafbpnkneujcnvr` and GoTrue now invokes it. A
real sign-in mints `tenant_id` and `roles` as top-level claims, and the signed-in smoke test
passes **30/30** — twice, from both a virgin account and a re-run. The tenant model is live:
RLS now returns exactly the active organization's rows, and switching organizations changes
what the database returns. Nothing in the database or the application had to change; the
whole gap was the one project setting.

The history below is kept because it records *how* the diagnosis was made — `pg_stat_statements`
joined to `pg_roles` is the technique that distinguishes "hook broken" from "hook never
called", and it will be the fastest route if this ever regresses.

---


**Severity: the multi-tenant model is inert in production.** Discovered 2026-08-15 by the
first signed-in smoke test against the live project.

A real sign-in returns a JWT with **no `tenant_id` claim and no `roles` claim at all** —
`undefined`, not `null`. Every RLS policy in the schema compares against
`current_tenant_id()`, which is `auth.jwt() ->> 'tenant_id'`. With no claim, **every
tenant-scoped table returns zero rows for every authenticated user, forever.**

The database side is fully prepared, so this is a single missing setting rather than
missing work:

| Check | Result |
|---|---|
| `public.custom_access_token_hook(jsonb)` exists | yes |
| `supabase_auth_admin` has EXECUTE on it | **true** |
| `supabase_auth_admin` has USAGE on `public` | **true** |
| `profiles` / `roles` / `user_roles` carry `*_auth_hook_read` policies for `supabase_auth_admin` | yes |
| auth logs for the smoke sign-in | clean `200`s, **no hook invocation and no hook error** |

A hook that were configured but failing would log an invocation error; there is none. The
hook is simply not registered in the project's Auth configuration.

**Why no test caught this.** Every SQL suite sets the claim by hand —
`set_config('request.jwt.claims', json_build_object('tenant_id', …))` — which *simulates
what the hook would have produced*. So the suites proved the policies are correct **given**
a claim, and nothing ever proved a claim is minted. The gap was structural, not an
oversight in any one suite.

**Needed:** enable the hook in the Supabase dashboard —
Authentication → Hooks → *Customize Access Token (JWT) Claims* → select
`public.custom_access_token_hook`. It is a project setting, not SQL, and is not reachable
through the MCP tools available here.

**Re-checked 2026-08-15 after the hook was reported enabled — still not invoked.** Decisive
evidence, from `pg_stat_statements` joined to `pg_roles`:

| Caller | Calls to `custom_access_token_hook` |
|---|---|
| `postgres` (migrations + direct probes) | 11 |
| **`supabase_auth_admin`** | **0** |

Zero, across at least nine sign-ins and refreshes. The function itself is provably correct —
calling it directly with a GoTrue-shaped event returns
`{"tenant_id":"ab00…da02","roles":["owner"]}` — and its metadata matches the documented
requirements exactly: `public.custom_access_token_hook(event jsonb)`, owner `postgres`,
`SECURITY DEFINER`, EXECUTE granted to `supabase_auth_admin`, schema USAGE granted. Auth
logs show clean `200`s with no hook invocation and no hook error.

Note the shape of the failure: the JWT has **no `tenant_id` key at all**. The hook sets that
key unconditionally — to `null` when there is no active organization — so an *absent* key
proves the hook never ran, as distinct from a user having no organization.

**Most likely cause, given this project's history:** the hook was enabled on the wrong
Supabase project. This session began with the connector authorized against a different
account entirely (`etodmfsmvhewihboxcrp`, "UndeifyIT's Project"). The setting must be on
**`tvfyxpafbpnkneujcnvr`** ("Bakeflow", organization `tkrygyuxqyqbxgqaodjq`). Other
candidates: the wrong hook slot (it must be *Customize Access Token (JWT) Claims*, not Send
SMS/Email), or the toggle enabled but not saved.

**Third re-verification, 2026-08-15 18:52Z — reclassified as EXTERNAL.** Every remaining
question about the database side has now been answered directly, so the investigation is
closed on this side:

| Question | Answer |
|---|---|
| Is the connector on the right project? | yes — `get_project_url` = `https://tvfyxpafbpnkneujcnvr.supabase.co`, and the scratch user `smoke.owner@bakeflow.test` is present in *this* database |
| Are the call counters stale or reset? | no — `pg_stat_statements_info.stats_reset` = 2026-08-04, so the window covers every sign-in ever made |
| Has `supabase_auth_admin` called the hook, ever? | **no — every row matching `custom_access_token_hook` is owned by `postgres`; not one by `supabase_auth_admin`** |
| Did the most recent sign-ins reach this project? | yes — auth logs show the 18:37Z password grant, two refreshes and the logout, all `200`/`204`, no hook invocation, no hook error |

Those four together exclude every DB-side explanation. A hook that were registered and
*failing* would return `500` on `/token` and log an invocation error; a hook that were
registered and *succeeding* would appear in `pg_stat_statements` under `supabase_auth_admin`.
Neither is present, which leaves only one possibility: **GoTrue for this project has no
access-token hook registered** — the setting was applied elsewhere, to a different slot, or
did not persist/propagate.

**This is now an external Supabase configuration issue and work stops here.** It cannot be
resolved from SQL, from the repository, or through the MCP tools available (which expose no
Auth-config endpoint). It needs either a dashboard confirmation on
`tvfyxpafbpnkneujcnvr` → Authentication → Hooks → *Customize Access Token (JWT) Claims*, or —
if the dashboard already shows it enabled there — a Supabase support ticket, since the
database side is provably correct.

**Verify with:** `node bakeflow-frontend/scripts/smoke-signed-in.mjs`, which now prints a
one-paragraph diagnosis when the claim is absent rather than ten downstream failures. It fails 10 of 30
checks today; all ten are downstream of the missing claim and should pass once the hook is
on. The scratch fixtures it needs already exist (see the smoke-test note in
`CURRENT_TASK.md`).

---

## BLOCKER-015 · The ticket actor guard predates multi-organization membership
**Status:** ✅ **RESOLVED 2026-08-16** — migration `fix_ticket_actor_membership_check_for_multi_org` applied live · **Affects:** P4.4b, P4.5, P9.2, P9.3, P9.6, P3.7, P5 · **Type:** live defect, migration-dependent

**Ticket creation now works end to end.** The signed-in smoke suite runs 66/66, including a
real PostgREST INSERT that mints `TKT-000001` in organization A with `created_by` stamped
from the JWT, and a second one in organization **B** — the case that was impossible before.
Verification detail is in *Resolution* at the end of this entry.

Found 2026-08-16 while verifying the BLOCKER-012 fix with a **real signed-in INSERT**. The
constraint swap removed the 23514, and the very next INSERT failed:

```
P0001  invalid order creator
CONTEXT: PL/pgSQL function guard_order_actor_and_assignment()
```

`guard_order_actor_and_assignment()` resolves membership as

```sql
select * from public.profiles
 where id = new.created_by and tenant_id = new.tenant_id and deleted_at is null
```

but under the multi-organization model **`profiles.tenant_id` is the user's HOME
organization, not their membership set**. `accept_organization_invite()` states this in its
own body: *"Membership in another organization is expected and must not block acceptance.
Seed the home organization only on the very first acceptance."* Membership lives in
`user_roles (tenant_id, profile_id)` — which is what `has_role()` and every RLS policy read,
and which the **same function** already consults three lines below for the assignee's driver
role. The correct check sits next to the incorrect one.

### Two failure modes, proven live (rolled back, nothing persisted)

| Attempt | Result |
|---|---|
| INSERT as the schema stands | REFUSED — `P0001 invalid order creator` |
| same INSERT, with `profiles.tenant_id` set to the target org | **CREATED `TKT-000001`** |
| same user (owner of A **and** B, home = A), INSERT into **B** | REFUSED — `invalid order creator` |

So: a user who joined organization A first can create tickets in A and **never** in B; and a
user whose `profiles.tenant_id` is null — any provisioning path that does not run through
invite acceptance — can create tickets in **no** organization at all. The second row is what
proves BLOCKER-012's constraint fix works; the third is the multi-tenant failure mode.

### The fix, and why it is a defect fix rather than a policy change

Replace the two `profiles.tenant_id` lookups with a `user_roles` membership check, leaving
every other clause byte-identical (created_by immutability, the driver rules, and the
assignee's driver-for-this-branch requirement). The rule is unchanged — *the actor must
belong to the organization the ticket is written into* — and only the table consulted moves,
from the one recording where a user **started** to the one recording where a user is a
**member**. It is strictly tighter in one respect: a profile carrying `tenant_id = A` with no
`user_roles` row for A previously passed and would no longer. The guard stays defence in
depth behind the `tickets_insert` RLS policy, which already requires
`tenant_id = current_tenant_id()`, `has_branch_access(branch_id)` and an authorized role.

### Resolution — applied and verified 2026-08-16

Migration `fix_ticket_actor_membership_check_for_multi_org` replaced only the two
`profiles.tenant_id` lookups with `user_roles` membership checks. `create or replace function`
preserved the owner (`postgres`), `SECURITY DEFINER`, `search_path=public`, and the EXECUTE
ACL (`postgres`, `service_role`) unchanged — re-read from `pg_proc` after applying.

Every authorization scenario was executed against the live database. The first row is a real
signed-in PostgREST INSERT from the smoke suite; the rest ran in **one transaction that was
rolled back**, confirmed afterwards by re-reading the database (`profiles.tenant_id` still
null, 0 driver `user_roles` rows, 0 soft-deleted memberships, no probe tickets).

| Scenario | Result |
|---|---|
| member of A → create in A | **CREATED**, `created_by` = the JWT subject |
| member of A **and** B, home org = A → create in **B** | **CREATED** |
| non-member → create in C | REFUSED — `invalid order creator` |
| membership soft-deleted → create in A | REFUSED — `invalid order creator` |
| assignee is not a member of the tenant | REFUSED — `assigned staff member does not belong to this organization` |
| assignee is a member but holds no driver role for the branch | REFUSED — `assigned staff member is not a driver for this branch` |
| assignee **is** a driver for that branch | **CREATED**, `assigned_to` preserved |
| a driver creates a ticket | **CREATED**, auto-assigned to themselves |
| a driver reassigns a ticket | REFUSED — `drivers cannot reassign tickets` |

Rows 5–9 are the pre-existing assignee/driver rules, unchanged by this migration and
re-proven after it. Row 2 is the defect this blocker names.

The smoke suite carries a permanent regression guard: **"the same user CAN create a ticket in
their SECOND organization (BLOCKER-015)"**, plus a printed diagnosis banner if the
`invalid order creator` symptom ever returns.

---

## BLOCKER-016 · `returned` deliveries do not restore stock
**Status:** ✅ **RESOLVED 2026-08-22 — closed as not-a-bug; a real, adjacent live defect found and fixed instead** · **Affects:** B4 (inventory), B5 (delivery) · **Type:** live defect (reclassified)

`STATE-MACHINES.md` §3 and this repository's own earlier comments in
`packages/api/queries/delivery.ts` stated that `in_transit -> returned` and
`failed -> returned` each write a return `stock_movements` row, under universal rule 4.
**The live database does not do this**, confirmed 2026-08-21 by reading `pg_trigger` for
`deliveries`: only `deliveries_guard_transition` and `deliveries_set_updated_at` exist,
neither touching `stock_movements`.

**Investigating the fix surfaced two facts that together close this differently than
planned.** First, `stock_movements` had **zero `reason = 'sale'` rows, ever**, and no
trigger on `tickets`/`ticket_items` writes one — selling something through a ticket did not
deplete inventory at all, so "restoring" stock on a delivery return would have inflated it
rather than corrected it. Second, walking the state machines shows the scenario BLOCKER-016
describes **cannot occur under the current design**: a delivery only reaches `returned` via
`in_transit -> returned` or `failed -> returned`; `guard_delivery_transition()` makes
`delivered` terminal, so a delivery can never be both `delivered` and later `returned`. A
ticket only reaches `completed` (where a sale would be recorded) after passing through
`delivered`, which for `fulfilment_type = 'delivery'` tickets requires the linked delivery's
own status to already be `delivered` (`guard_ticket_status_transition()`'s delivery gate).
So a delivery that ends up `returned` was, by construction, never on a ticket whose stock
had been deducted. There is nothing to restore, and the original "not a bug" behaviour was
correct.

**The real defect, found in the same investigation: `complete_ticket()` already implements
exactly the sale-side deduction this blocker assumed was missing, and has never once worked.**
Read live: it inserts `stock_movements` with `reference_type = 'ticket'`, but
`stock_movements_reference_type_check` only allows `'order'` — the same historical wart
`CLAUDE.md` and `packages/types/inventory.ts` already document for this column. Every real
call has therefore always raised `23514`, which is the actual reason zero `'sale'` rows
existed. Fixed by migration `fix_complete_ticket_reference_type_and_guard_batch_rpc_only`
(2026-08-22): the literal changed from `'ticket'` to `'order'`, with no other change to the
function's logic (owner, `SECURITY DEFINER`, `search_path` all re-read from `pg_proc`
unchanged afterward).

**Verified live end to end**, not assumed — a real signed-in owner call (JWT claims
simulated via `request.jwt.claims`, the same technique BLOCKER-015's verification used),
against a disposable product/variant given a 5.0000 opening balance:
`draft -> submitted -> confirmed -> scheduled -> in_production -> ready -> delivered`
(plain updates; no dedicated RPC exists for most of these hops, a separate known gap — see
`STATE-MACHINES.md` §1), then `complete_ticket()`. Result: ticket `TKT-000041` reached
`completed`; exactly one `stock_movements` row was written —
`reason='sale', reference_type='order', quantity_delta=-2.0000`; the variant's
`product_stock_levels.quantity_on_hand` read back as `3.0000` (5 − 2), confirming the
trigger-maintained level tracks the new movement correctly.

**Not added:** a smoke-suite regression check for this exact flow. `authenticated` holds
`INSERT, SELECT` only on `tickets` (no `UPDATE`), and there is no RPC for `draft ->
submitted` or most of the hops after it (`STATE-MACHINES.md` §1 already documents this gap
independently) — so the signed-in smoke client genuinely cannot drive a ticket to
`delivered` today, and a check that could only ever run via simulated JWT claims would not
be testing what a real client can do. This is the same reachability gap noted in
`NOTIFICATIONS.md`'s prior entry for this blocker, now understood precisely rather than
assumed.

---

## BLOCKER-017 · A raw UPDATE reaches `production_batches.completed` without the RPC, silently skipping stock movements
**Status:** ✅ **RESOLVED 2026-08-22** — migration `fix_complete_ticket_reference_type_and_guard_batch_rpc_only` applied live · **Affects:** B4 (inventory), B7/P9.5 (production) · **Type:** live defect, grant-layer

Unlike `deliveries` (no `UPDATE` grant on `authenticated` at all, which is what forces every
delivery transition through an RPC), `production_batches` grants `authenticated` a blanket
`UPDATE`, and `production_batches_update`'s RLS is a plain tenant/branch/role check with no
awareness of *which* columns are changing. `guard_production_batch_transition()` only
validates the legal-hop graph and the actor's role — it has no way to know whether a write
originated from `complete_production_batch()` or from a client's own PostgREST call, so it
cannot distinguish "legitimate completion" from "a client that skipped the RPC."

**Reproduced live while building P9.5** (2026-08-21), not inferred: a batch was raised
in_progress, then updated directly via `supabase-js` — `status: 'completed',
actual_quantity: '1.0000'` — and refused with `production_batches_completed_fields`
(42514), since that CHECK also requires `completed_at IS NOT NULL` and only the RPCs stamp
it. Supplying `completed_at` from the client as well made the same raw UPDATE **succeed**.
`stock_movements` was then queried for that batch's `reference_id`: **zero rows**. The
ingredient's `ingredient_stock_levels.quantity_on_hand` was confirmed unchanged. So the
`completed_at` CHECK is a real but small speed bump — one extra column to fabricate — not a
closed door. This is now a **permanent regression check in `scripts/smoke-signed-in.mjs`**
("BLOCKER-017 reproduced…" / "…confirmed…"), so a future migration that closes this can flip
those two checks' expectations rather than deleting them.

**Consequence:** any caller with a valid session and an authorized role — this app's own
future code with a bug, a differently-careful second client, or someone constructing
PostgREST calls by hand — can move a batch to `completed` or `failed` while silently
skipping the ingredient consumption and product output the RPC pair exists to guarantee.
The batch row looks correctly finished; the inventory ledger simply never heard about it.

**Resolution — trigger-side guard flag, applied live 2026-08-22.** Decision made: keep the
`UPDATE` grant and the plain-update path for `scheduled`'s two exits (no client changes
needed there), and close the gap specifically for `completed`/`failed`. Mechanism:
`complete_production_batch()` and `fail_production_batch()` each call
`perform set_config('bakeflow.production_batch_rpc', 'true', true)` immediately before
their own final `UPDATE` — `true` (is_local) makes it transaction-scoped, so it cannot leak
between requests (PostgREST gives each RPC call its own transaction). `guard_production_
batch_transition()` now refuses `new.status IN ('completed', 'failed')` unless
`current_setting('bakeflow.production_batch_rpc', true) = 'true'`. Migration
`fix_complete_ticket_reference_type_and_guard_batch_rpc_only`; owner (`postgres`),
`SECURITY DEFINER` and `search_path` re-read from `pg_proc` unchanged on all three
functions afterward.

**Verified live**, not assumed correct from the diff:
- The exact bypass that proved this blocker (`status: 'completed', actual_quantity:
  '1.0000', completed_at: <client-supplied>`) is now refused with `invalid_transition:
  completed must be set through complete_production_batch() or fail_production_batch()`.
- The legitimate RPC path was re-run against the same batch immediately after and
  **succeeds** — confirming the guard does not also block the mechanism it exists to
  protect, which would have been a worse regression than the one being fixed.
- `scripts/smoke-signed-in.mjs`'s BLOCKER-017 section (previously a reproduction) is now a
  **permanent regression guard**: it asserts the bypass is refused, that zero stock
  movements exist for the refused attempt, and that the real RPC still works afterward.
  103+ smoke checks pass, confirmed repeatable across 3 consecutive runs.

---

## BLOCKER-018 · No mechanism captures ingredient/purchase cost, so weighted-average COGS cannot be computed
**Status:** OPEN · **Affects:** P5.8 (Reporting & P&L) · **Type:** business rule + missing workflow

`docs/REPORTING-MODEL.md` §85 locks weighted-average costing as the MVP method and §27–30
explains why (last-cost and FIFO are both rejected). The schema already has the column
the formula needs — `stock_movements.unit_cost NUMERIC` — but it is **100% NULL across
every row in the live database**, verified 2026-08-24:

| `reason` | rows | rows with `unit_cost` set |
|---|---|---|
| `opening_balance` | 31 | 0 |
| `production_consume` | 79 | 0 |
| `production_output` | 50 | 0 |
| `purchase` | 4 | 0 |
| `sale` | 1 | 0 |
| `waste` | 1 | 0 |

Nothing in `adjust_stock()` or anywhere else ever writes `unit_cost` — including on the
four `purchase`-reason rows, which is precisely the movement type weighted-average
costing needs a real cost basis from. Computing COGS today would mean either fabricating
a cost (silently wrong P&L, exactly what §27–30 and rule 33 forbid) or reporting it as
permanently zero/null (a P&L that structurally cannot show gross profit, which
`docs/REPORTING-MODEL.md` §85 does not intend either).

This is not a guessable detail: it requires deciding **how a bakery owner records what an
ingredient purchase actually cost** — a field on `adjust_stock()`'s `purchase` reason? A
separate purchase-order/goods-received flow? A default per-ingredient standard cost that
purchases can override? Each has different UX, migration, and offline-sync implications,
and none is specified anywhere in the repo.

**Not blocking:** the revenue- and cash-side reporting metrics `REPORTING-MODEL.md`
describes (§44/§45 — gross/net revenue, refunds, cash collected/reconciled) need only
`tickets`, `payments`, `refunds`, `cash_sessions`, `daily_financial_audits` — all verified
live and correct as of the P5 audit this same day (`tests/sql/financial_write_rls.sql`)
— and could be built without waiting on this decision. Only COGS/gross-profit/
inventory-valuation (the other half of P5.8) are stopped by it.

**Needed:** a product decision on the ingredient-cost-capture workflow, then the schema
change (if any) and RPC work follow directly from `docs/REPORTING-MODEL.md`'s already
decision-locked formulas.

---

## ✅ BLOCKER-019 · ADR-001 driver trips — relationship to cash sessions — RESOLVED 2026-08-24
**Status:** RESOLVED · **Affects:** ADR-001 Phase 2/3 (driver trip schema + RPCs), P9.7 · **Type:** financial architecture decision

**Resolution:** driver trip cash custody is modeled as distinct from branch till custody,
linked but not merged — see **AD-018** in `ARCHITECTURE_DECISIONS.md` for the full decision.
Driver cash contributes to the trip's own expected-cash figure, never the branch drawer's,
until accepted at reconciliation. Schema/RPC work should follow the existing cash-session
architecture's shape (recorded movements + expected-vs-actual + explicit variance) rather
than a new accounting design. Phase 2 database design may proceed on this axis.

**Original (OPEN, 2026-08-24):**

ADR-001 (Driver Workflow Redesign, approved 2026-08-24) §13 explicitly defers this: "The
exact relationship between `driver_trip` and `cash_session` must be finalized during
schema implementation." §23 item 11 lists it as an open decision. It cannot be resolved by
inference from existing precedent, because both plausible answers are legitimate and have
different accounting consequences:

- **Driver cash settles into the branch's open cash session.** Matches AD-017's existing
	one-open-session-per-branch model with zero new session machinery, but means a driver's
	cash isn't distinguishable from till cash in `expected_cash` until the driver physically
	returns and someone records it — the branch session's expected drawer cash would be wrong
	for the entire time the driver is out with collected cash the till never received.
- **The driver trip has/creates its own cash-session-like context**, settled into the
	branch session only at trip reconciliation. Correctly represents custody but means a new
	session concept, and AD-017's "one open session per branch" invariant needs an explicit
	statement of how a driver-context session interacts with it (is it a sub-session? A
	separate `cash_sessions` row scoped to the driver rather than the branch? `cash_sessions`
	today has no driver/trip scoping column at all).

Guessing here means either building AD-017's expected-drawer-cash formula on top of a
model that's wrong the moment a driver leaves the building, or inventing new cash-session
semantics that were never approved. This is exactly the kind of unspecified financial
behaviour CLAUDE.md's Blocker rule requires escalating, not guessing.

**Needed:** a decision on which of the two models above (or a third) governs driver cash
custody, made before any `driver_trips` migration that touches money is written.

---

## ✅ BLOCKER-020 · ADR-001 driver trips — relationship to `deliveries` — RESOLVED 2026-08-24
**Status:** RESOLVED · **Affects:** ADR-001 Phase 1/2 (domain review, driver trip schema), P9.6 · **Type:** architecture decision

**Resolution:** `deliveries` remains the sole authority for physical-delivery state —
see **AD-019** in `ARCHITECTURE_DECISIONS.md`. A trip-linked delivery ticket still gates
`ready → delivered` on a verified `deliveries` row exactly as today; trip-level sale
completion must not silently transition it. Any new RPC touching a trip-linked ticket's
delivery status must call the existing delivery-transition path. Phase 2 database design
may proceed on this axis, preserving the current `deliveries` schema and triggers as-is.

**Original (OPEN, 2026-08-24):**

ADR-001 §6 Path A (manager/supervisor creates a ticket, driver fulfils it) never states
whether a trip-linked, delivery-fulfilment ticket still creates and transitions a
`deliveries` row through the existing, live-verified P9.6 workflow
(`transition_delivery()`/`update_delivery_details()`, board + detail screens shipped and
smoke-tested 2026-08-21), or whether the driver-trip context replaces that gate for
driver-fulfilled tickets.

This matters because `STATE-MACHINES.md` §60 hard-requires a verified `deliveries` row
before a `fulfilment_type = 'delivery'` ticket can reach `ready → delivered` — that guard
is live in `guard_ticket_status_transition()` today. Two ways this could go, both real
architecture choices:

- **`deliveries` stays authoritative**, and a driver trip is purely an operational
	wrapper (inventory custody + route grouping) around tickets that still go through the
	existing delivery-proof gate unchanged. Lowest risk to the live P9.6 path, but leaves
	two separate "did the driver actually hand this over" records (trip-level sale
	completion and the `deliveries` row) that could disagree.
- **The driver-trip context absorbs delivery proof** (e.g., completing a sale within an
	`in_transit` trip satisfies the gate directly, and `deliveries` becomes vestigial for
	driver-fulfilled tickets, though still used for non-driver couriered deliveries if any).
	Cleaner single source of truth, but means changing a gate that a live, tested feature
	currently depends on, and needs its own migration/rollout plan.

Guessing wrong either duplicates a gate that already works correctly, or silently breaks
the `ready → delivered` transition for every trip-linked ticket the moment `driver_trips`
schema work starts touching ticket status.

**Needed:** a decision on whether `deliveries` remains the authoritative proof-of-delivery
record for trip-fulfilled tickets, or is superseded by trip-level sale completion for
that ticket population — before Phase 2 schema design touches the ticket-status gate.

---

## ✅ BLOCKER-021 · Driver-created roadside tickets have no legal path to a completed sale — RESOLVED 2026-08-25
**Status:** RESOLVED · **Affects:** P9.3 (Ticket creation — driver), ADR-001 Phase 5 (driver UI, "Sell" step) · **Type:** authorization gap + business rule (ticket lifecycle for already-loaded stock)

**Resolution:** a driver-created, trip-linked roadside ticket takes a shortened `draft →
completed` lifecycle instead — see **AD-020** in `ARCHITECTURE_DECISIONS.md` for the full
decision and `STATE-MACHINES.md` §6 "Driver field-sale shortcut" for the mechanism.
Explicitly **not** done: `driver` was not added to any of the seven existing forward-hop
actor lists, and `draft → completed` is not universally legal for any ticket — the hop is
reachable only through the new `complete_driver_field_sale()` RPC, gated by trip
`in_transit` status, driver/manager identity, `fulfilment_type = 'pickup'` (so AD-019's
`deliveries` gate is never bypassed), and a transaction-local flag mirroring
`guard_production_batch_transition()`'s existing `bakeflow.production_batch_rpc`
technique (BLOCKER-017). Verified live: `tests/sql/driver_field_sale_rls.sql` 8/8
(authorized completion, unrecognized-identity refusal, trip-not-in_transit refusal,
unauthorized-role refusal, delivery-fulfilment refusal, raw-UPDATE-without-the-flag
refusal, non-trip-linked refusal, normal lifecycle unaffected), plus regression:
`driver_trips_rls.sql` 20/20, `financial_write_rls.sql` 28/28, `pytest` 12/12 — none
touched by this change, confirmed clean before marking resolved. `docs/API-CONTRACT.md`
§2 gained the new RPC's row.

**Original (OPEN, 2026-08-25):**

Investigating what Phase 5's "Sell" screen (ADR-001's `Load → Go → Sell → Record Payment →
Repeat → Return → Reconcile`) would need to call, found two compounding problems in the
live `tickets` state machine that make an unassisted driver roadside sale unreachable —
neither was touched by ADR-001 Phases 2/3, and neither is guessable:

**1. `guard_ticket_status_transition()`'s actor lists never include `driver`, at any hop.**
Verified live via `pg_get_functiondef`:

```
submitted/confirmed/scheduled/delivered/completed → owner, admin, branch_manager, cashier
in_production/ready                                → owner, admin, branch_manager, baker
cancelled/archived                                  → owner, admin, branch_manager
```

`tickets_insert` RLS *does* let a driver create their own ticket (`created_by = auth.uid()`,
confirmed live), and `confirm_ticket()`/`update_ticket()` carry no independent role gate of
their own — both defer entirely to this trigger (the same deferral pattern the 2026-08-23
`update_ticket()` fix established). So a driver can INSERT a draft ticket + items, but
`update_ticket(p_status='submitted')` — the only path off `draft` — raises
`insufficient_role` for a driver caller, full stop. A driver-created ticket cannot advance
one single hop without a cashier/branch_manager/owner/admin doing it for them.

**2. Even with a role, the lifecycle is eight linear hops with no skip.** The `allowed`
transition map only permits exactly one forward hop per `UPDATE` (`draft→submitted→
confirmed→scheduled→in_production→ready→delivered→completed`), regardless of
`fulfilment_type`. A driver's roadside sale is goods **already baked and already loaded**
(verified via `verify_trip_loading()`) — `scheduled`/`in_production`/`ready` describe a
baking pipeline that has already happened before the trip departed. Nothing in the schema
lets an already-fulfilled sale skip those three states; today's only path is to walk a
truck sale through the same eight-status machine as a made-to-order cake.

Both are real product/architecture decisions, not implementation gaps:

- **Should a driver be able to advance their own trip-linked ticket unassisted** (add
  `driver` to the relevant actor arrays, scoped to `driver_trip_id IS NOT NULL` and the
  trip belonging to them — mirroring how `record_payment()`'s own driver branch is scoped),
  or is a manager/cashier required to confirm every roadside sale live (operationally
  odd for a driver alone on a route, but may be the intended financial control)?
- **Should a trip-linked pickup ticket have a shorter path** (e.g. `confirmed →
  completed` directly once `driver_trip_id` is set, on the theory the goods are already
  produced), or must it walk the full eight-status chain regardless?

Guessing either one means either patching a security-relevant role gate with no
authorization to do so, or inventing a new ticket-lifecycle shortcut that
`docs/STATE-MACHINES.md` §1 does not describe and no one has approved.

**Not blocking:** `record_payment()` itself already has a correctly-scoped driver branch
(role gate includes `driver`; the `p_driver_trip_id IS NOT NULL` branch requires
`v_trip.driver_id = auth.uid()` or a manager) — so *recording a payment* against an
existing trip-linked ticket is not blocked by this. What's blocked is getting that ticket
to a real, completed sale in the first place. Ticket **creation** (`INSERT` into `tickets`/
`ticket_items`, roadside/`ROADSIDE`/`customer_id = NULL`) is also not blocked — verified
live, RLS permits it today.

**Needed:** a decision on (1) whether drivers advance their own trip-linked tickets
unassisted and (2) whether a trip-linked pickup ticket gets a shortened lifecycle — then
the trigger/actor-array change (if any) follows directly. Until decided, ADR-001 Phase 5's
"Sell" step is scoped down to ticket **creation only** (a `draft` ticket the driver hands
off) rather than a complete, unassisted sale — see `IMPLEMENTATION_LOG.md`.

---

## BLOCKER-022 · `depends_on_operation_id` has no defined server-side enforcement semantics
**Status:** OPEN · **Affects:** P3.7 (any future entity whose offline creation legitimately depends on another not-yet-confirmed offline operation, e.g. a customer created just before a ticket that references it) · **Type:** architecture decision (offline sync protocol)

**What was discovered:** `OFFLINE-SYNC-MODEL.md` §49 names `depends_on_operation_id` as
"possible dependency metadata" and says only that "the sync engine must respect dependency
ordering" and a failed prerequisite "may also need to be rejected or placed into a
dependency-failed state" — no concrete status value, no concrete queuing/holding mechanism,
no concrete client contract for discovering when to retry. This is exactly the class of gap
the P3.7 protocol-correctness pass's own instruction flagged in advance: "if the current
architecture does not provide enough information to safely define \[this], STOP and document
the blocker rather than inventing semantics." Inventing behavior here — e.g., holding a
dependent operation `PENDING` until its prerequisite resolves, within `process_sync_batch()`'s
single-transaction-per-batch model — would mean guessing at retry/timeout/expiry semantics
none of the existing docs specify, and could silently strand a client's queued operation.

**Why it isn't guessable from the live schema:** no `depends_on_operation_id` column exists
on `sync_operations` at all (checked live, `information_schema.columns`). There is no
precedent elsewhere in this schema for "hold this row until another row reaches a certain
status" — every other guard in this codebase (state-machine transitions, revision checks,
handler existence checks) evaluates synchronously against already-committed state, never
against a *pending* sibling operation in the same or a future batch.

**What already provides real safety for the realistic case, so this is lower urgency than
it might sound:** within one batch, `process_sync_batch_context_validated()` processes
operations sequentially in array order inside a single transaction, so operation 2 already
sees operation 1's committed row if the client orders its own batch correctly — no explicit
dependency field is needed for that case. Across batches (client goes offline again before
its dependency's operation is acknowledged), every existing handler already does an
existence check against the referenced entity (e.g. `apply_ticket_item_update`'s
`product_variants` lookup, `RAISE EXCEPTION ... 'product variant not found'`) — a dependent
operation submitted before its prerequisite is confirmed fails cleanly with a retryable
error today, and a well-behaved offline client's own outbox is expected to retry a failed
operation later, which is standard offline-queue behavior, not a gap.

**What remains blocked:** any entity or workflow where the "retry later, cheaply" pattern
above is not good enough — e.g., where re-attempting a whole batch on any single dependency
failure is too expensive, or where the client needs an explicit signal *which* prerequisite
it's waiting on rather than a generic not-found error.

**Needed:** a decision on whether `depends_on_operation_id` enforcement is required at all
before further entities are built (inventory/production/financial/customer are not yet
scheduled to need it — none of AD-021's per-entity strategies currently describe a
cross-operation dependency), and if so, the concrete semantics: what status a dependent
operation gets while waiting, how long it waits, how the client learns to retry, and whether
this lives inside `process_sync_batch()`'s existing single-call-per-batch model or requires a
new mechanism.

**Updated 2026-08-29 — this blocker's own motivating example was built and tested.** The
CUSTOMER slice (`customer.create`/`customer.update`) confirms the analysis above rather than
changing it: `customer.create` does not accept a client-supplied id (matches
`apply_ticket_create`'s own precedent — the real id is server-generated and returned in the
result), so a client cannot construct a single offline batch containing both
`customer.create` and a `ticket.create` that references the new customer — it must wait for
the first call's real `customer_id` before constructing the second. `tests/sql/
p3_7_customer_sync.sql` T1 tests and confirms the working two-sequential-calls path (create,
then a separate `process_sync_batch()` call with the returned id); it deliberately does NOT
attempt the single-batch case, since that's exactly what remains blocked here. Still open,
still not guessed at.

---

## BLOCKER-023 · No retention/purge policy exists for `sync_changes`, so true cursor-expiry cannot be implemented
**Status:** OPEN · **Affects:** P3.7 `sync_pull()`, P10.7 (sync client), any future storage-cost/retention decision for the sync ledger · **Type:** architecture decision (data retention)

**What was discovered:** `sync_pull()`'s cursor model (`sequence_id` on `sync_changes`) was
hardened in the 2026-08-29 protocol-correctness pass to detect a cursor value that is
structurally invalid today — negative, or ahead of everything the caller can see (returns
`full_resync_required:true` rather than a silently-incomplete page). The classic
"cursor-too-old" case this was meant to also cover — a client's cursor points into history
that has since been purged for retention/storage reasons — is **not** implemented, because
no such purge mechanism exists to trigger it.

**Evidence from the live database:** `sync_changes` has no `deleted_at`, no TTL/expiry
column, and no archival flag of any kind (checked live via `information_schema.columns`). A
repo-wide grep of `supabase/migrations` for `purge|retention|archive|tombstone|delete from
sync_changes|TTL` (case-insensitive) returns zero hits. `sync_changes_pkey` is a plain
`bigint` sequence with no partitioning or row-expiry mechanism. `sync_changes` is, as
designed (`OFFLINE-SYNC-MODEL.md` §11: "Do not delete failed operations silently. Retain
enough metadata to diagnose why synchronization failed"), a true append-only ledger — every
row ever written is still there. Implementing "cursor points at purged history" detection
would require first inventing a retention policy that does not currently exist anywhere in
this codebase, which is exactly the "guessing" this pass's own instruction said to avoid.

**What remains blocked:** nothing operationally yet — with unlimited retention, no client
cursor can currently go stale via purge, so no user-facing gap exists today. This blocker
exists so that if/when `sync_changes` growth becomes a real storage-cost concern and someone
proposes a retention window or archival job, that proposal is designed *with* the
`full_resync_required` response contract already established by this pass (reuse it, don't
invent a second cursor-invalidity signal), rather than being designed blind.

**Needed:** no immediate action. When retention/archival for `sync_changes` is proposed,
that proposal should explicitly define: the retention window, how a client's cursor is
checked against the retained floor (not just the ceiling this pass implemented), and
confirm it reuses `sync_pull()`'s existing `full_resync_required:true` response shape rather
than adding a new one.

---

## ✅ BLOCKER-024 · `customer.update` role scope — decided by the product owner (2026-08-29)
**Status:** RESOLVED · **Affects:** P3.7 CUSTOMER slice (`apply_customer_update`) · **Type:** business rule (authorization)

**What was discovered, 2026-08-29, while implementing `customer.create`/`customer.update`:**
live `role_permissions` grants `customers.update` to owner, admin, branch_manager,
supervisor, cashier, and driver — unscoped, with no row-level qualifier anywhere in the
schema. `docs/ROLES-AND-PERMISSIONS.md`'s "Live grants by role" table confirms the same six
roles. `ADR-001` (Approved 2026-08-24) explicitly describes driver **creation** of a
customer as a required flow (§7, and point 9 of its driver-trip walkthrough) but never once
mentions a driver **editing** an existing customer record. Ticket has a real precedent for
this exact question — `apply_ticket_item_update` restricts the driver role to
`created_by = actor OR assigned_to = actor` — but nothing in the schema, ADR-001, or
`docs/ROLES-AND-PERMISSIONS.md` extends that same ownership carve-out to customers, and
`customers` has no `assigned_to`-equivalent column to even express it against.

**What was implemented instead of guessing:** `apply_customer_update` enforces exactly the
literal, unscoped role grant above (any of the six roles may update any customer in their
authorized tenant/branch context) — it does not add a creator-only or assignee-only
restriction, because doing so would be inventing a business rule with no source. This
matches this pass's own no-guessing instruction: implement what's established, flag what
isn't, rather than picking a plausible-sounding default.

**What remains open:** whether product actually wants unrestricted driver editing of any
customer record (e.g. a driver correcting a rival driver's typo in a shared customer's
phone number), or whether it should be scoped to "customers the driver created" the way
ticket items are scoped to "tickets the driver created or is assigned to." Data-safety
impact is low — `customer.update` cannot touch `tenant_id`, `branch_id` (customers has none),
credit/balance (customers has no such column; credit is derived elsewhere), or any audit
field — the exposure is limited to name/phone/email/address/notes/is_walk_in on someone
else's customer record within the same tenant.

**Decision, given directly by the product owner (2026-08-29):** rather than the
ticket-style ownership-scoping this blocker asked about, `customer.update` is restricted by
role, more narrowly than `customer.create`: **owner, admin, and branch_manager may always
edit an existing customer; supervisor may edit only while holding the supervisor role in
that tenant; driver and cashier may not edit an existing customer at all** (they retain
`customer.create`, unaffected). This is a genuine change from the initial unscoped
implementation, not an elaboration of it — driver and cashier were previously permitted and
are now explicitly excluded.

The decision also asked for a **per-supervisor, manager-configurable toggle** ("the manager
has a settings [control] to edit what the supervisor has access to do") beyond the
coarse role-presence check above. That finer mechanism does not exist anywhere in this
codebase yet — confirmed live and independently by `docs/ROLES-AND-PERMISSIONS.md` itself:
*"The per-Supervisor override mechanism itself — a `user_permissions` table or equivalent —
is not built; `role_permissions` is role-level only, so today every Supervisor in every
bakery has the same set."* Building it would mean designing new schema beyond a single
handler's authorization array. Per explicit direction, the coarse (role-presence) version
was implemented now; the finer per-supervisor toggle is tracked separately — see
**BLOCKER-025** — rather than being invented inline.

**Implemented and live-verified 2026-08-29:** `apply_customer_update`'s role check is now
`ARRAY['owner','admin','branch_manager','supervisor']` (previously included `cashier`,
`driver`). `tests/sql/p3_7_customer_sync.sql` re-tests this explicitly: U1/U2 prove
driver-only and cashier-only are now rejected (`42501`); U3/U4 prove branch_manager-only and
supervisor-only are accepted; U5 (accountant, unaffected, still rejected) is unchanged.
21/21 passed. `customer.create`'s role set is unchanged
(`owner/admin/branch_manager/supervisor/cashier/driver`) — this decision applies to
`customer.update` only, confirmed explicitly with the product owner before implementing.

---

## BLOCKER-025 · Per-supervisor, manager-configurable permission overrides — no schema exists
**Status:** OPEN · **Affects:** `customer.update` (the specific trigger for this blocker), and potentially any future permission the product wants configurable per-Supervisor rather than per-role · **Type:** architecture decision (new capability, not yet designed)

**What was requested, 2026-08-29:** resolving BLOCKER-024, the product owner asked for a
Branch Manager to be able to grant or revoke customer-edit access for an **individual**
supervisor via a settings control — not an all-or-nothing toggle for the Supervisor role
across the whole bakery.

**Why this isn't buildable today:** `role_permissions` (the live permission-grant table) is
role-level only — every profile holding the `supervisor` role in a tenant gets an identical
permission set; there is no row linking one specific supervisor profile to a
narrower-or-wider grant. `docs/ROLES-AND-PERMISSIONS.md` independently documents this exact
gap in its own words, describing per-Supervisor overrides as intended-but-**"not built."**
No `user_permissions` table, no override table of any kind, and no UI/settings surface for
a Branch Manager to manage this exists anywhere in the schema, the frontend, or the docs.

**What was implemented in the meantime (BLOCKER-024):** the coarse, already-available
mechanism — `customer.update` checks only whether the actor holds the `supervisor` role at
all in that tenant, which today is itself an all-or-nothing toggle already available to
Branch Managers only in the sense that they assign/remove the `supervisor` role from a
profile via `user_roles` (existing, general-purpose role management — not a new mechanism,
and not scoped to this one permission).

**Needed:** a real architecture decision, not an inline guess, covering at minimum: the
schema shape for a per-profile permission override (a new table keyed on
`(tenant_id, profile_id, permission_key)` is the obvious candidate, but not decided here);
whether overrides are additive-only, subtractive-only, or both; whether this generalizes
beyond `customers.update` to other permissions Branch Managers might want to toggle
per-supervisor; and the settings UI a Branch Manager would use (out of scope for backend
work alone). Until this is designed, `customer.update`'s supervisor gate remains the coarse,
role-level check described in BLOCKER-024's resolution.

---

## ✅ BLOCKER-026 · `inventory.receive` / `.consume` / `.transfer` sync handlers — RESOLVED 2026-08-31 (out of MVP scope)
**Status:** RESOLVED · **Affects:** P3.7 (remaining inventory domain_operation coverage) · **Type:** business rule / architecture decision

**Resolution (2026-08-31, product decision, no guessing):** all three are out of MVP scope
entirely — no stock purchasing/receiving workflow, no generic non-trip warehouse-to-warehouse
transfer, and no standalone consume beyond what the already-built `inventory.adjust`/`.waste`
cover. Rather than leave them "allowlisted for later", all three were **removed from the
`domain_operation` CHECK constraint** on `sync_operations`/`sync_changes` (migration
`p3_7_allowlist_tighten_receive_transfer_consume_complete`), having first verified live that
zero existing rows used any of the three values. A client submitting one of these three now
gets a hard `23514 check_violation` on the whole `process_sync_batch()` call (not a graceful
per-operation `REJECTED`/`unsupported_operation_type`, since the CHECK fires before the
dispatcher's own exception-isolated handler execution ever runs) — see
`tests/sql/p3_7_production_output_waste_sync.sql` tests D2–D4, and the note in
`IMPLEMENTATION_LOG.md` 2026-08-31 about why that's an accepted, deliberate consequence of
"out of scope" rather than "not yet built". If any of the three is ever wanted post-MVP, it
needs a fresh product decision and must be re-added to the CHECK constraint from scratch — see
the original context below for what was investigated and ruled out.

**Original context (kept for history):**

**Context:** 2026-08-30, building the P3.7 INVENTORY vertical slice, `inventory.adjust` and
`inventory.waste` were built (mirroring the live `adjust_stock()` RPC's own reason/role gates
exactly — see `tests/sql/p3_7_inventory_sync.sql` and `IMPLEMENTATION_LOG.md` 2026-08-30). The
other three inventory operations AD-021 already allowlisted (`inventory.receive`, `.consume`,
`.transfer`) were investigated live and deliberately NOT built this pass, each for a distinct
reason with no existing precedent to mirror:

- **`inventory.receive`** would write `reason='purchase'`. No RPC anywhere in the live schema
  writes this reason — it exists only on legacy/seed rows, all with `unit_cost` NULL. This is
  the same gap **BLOCKER-018** already names (weighted-average COGS blocked because nothing
  captures a purchase-cost event). Building a sync handler here would either have to guess a
  cost-capture rule BLOCKER-018 hasn't resolved, or ship a "receive" that still can't feed
  COGS — deferred to whatever resolves BLOCKER-018, not decided in isolation.
- **`inventory.transfer`** would write `reason='transfer_in'/'transfer_out'`. The only live
  writers of this reason pair are the driver-trip lifecycle RPCs (`verify_trip_loading`,
  `return_driver_trip`), always linked to a specific trip (`reference_type='driver_trip'`).
  There is no generic warehouse-to-warehouse manual transfer RPC to mirror, and who may move
  stock between two warehouses with no trip involved is a real, undecided authorization
  question — not implementation detail.
- **`inventory.consume`** would write `reason='production_consume'`, but the only live writers
  (`complete_production_batch`, `fail_production_batch`) always tie it to a real production
  batch. A standalone "consume" operation with no batch link has no defined meaning and would
  overlap unclearly with the already-built `inventory.adjust`/`inventory.waste`.

All three remain allowlisted in `domain_operation`'s CHECK (added earlier, per AD-021) but
unhandled — `apply_sync_operation()`'s dispatcher fallback correctly `REJECTED
unsupported_operation_type`s them today (verified live, test I10), never silently leaves them
PENDING.

**Needed:** for `.receive`, resolution of BLOCKER-018 first (or an explicit decision that
receiving can be recorded without a cost, decoupling the two). For `.transfer`, a product
decision on whether/how a non-trip manual warehouse-to-warehouse transfer should exist and who
may perform it. For `.consume`, a product decision on whether a standalone consume operation is
needed at all, or whether `inventory.adjust`/`.waste` already cover every case a bakery actually
needs offline.

---

## ✅ BLOCKER-027 · `production.complete` / `.record_output` / `.record_waste` sync handlers — RESOLVED 2026-08-31
**Status:** RESOLVED · **Affects:** P3.7 (remaining production domain_operation coverage) · **Type:** business rule / architecture decision

**Resolution (2026-08-31, confirmed live before deciding):** `complete_production_batch()`/
`fail_production_batch()` already take per-ingredient `actual_quantity`/`waste_quantity` in
ONE call each, and `production_batches` has only a single `actual_quantity`/`completed_at`
column — no schema support anywhere for multiple partial output/waste events per batch. This
confirms `.record_output`/`.record_waste` are the sync-facing names for those two existing
RPCs, not new finer-grained events. Built `apply_production_record_output()`/
`apply_production_record_waste()` as thin wrappers that validate the payload, check the same
`has_role_in(actor, tenant, ['owner','admin','branch_manager','baker'])` gate
`guard_production_batch_transition()`'s trigger already enforces for 'completed'/'failed', and
delegate entirely to `complete_production_batch()`/`fail_production_batch()` rather than
duplicating their ingredient-consume/output-movement logic (migration
`p3_7_production_record_output_waste_handlers`). `production.complete` was redundant with
`.record_output` and removed from the `domain_operation` CHECK allowlist in the companion
migration (zero existing rows used it, verified live first) — same "out of scope, not
dispatcher-rejected" treatment as BLOCKER-026.

As a prerequisite, added an additive `p_tenant_id uuid DEFAULT NULL` parameter to both RPCs
(AD-006 fix): they previously resolved their own tenant via `current_tenant_id()` (the
session's *active* org), which for a genuinely cross-org sync operation doesn't cause a
false-accept (the trigger's own role check and the batch lookup are both still tenant-correct)
but does cause a false NEGATIVE — the lookup silently uses the wrong org and returns "batch not
found" for a legitimately authorized actor. The default preserves existing non-sync callers
unaffected. Full detail, live-verified test suite (16 assertions, all pass), and zero-regression
confirmation against the existing `production.start`/`.cancel` suite: see
`tests/sql/p3_7_production_output_waste_sync.sql` and `IMPLEMENTATION_LOG.md` 2026-08-31.

**Original context (kept for history):**

**Context:** 2026-08-30, building the P3.7 PRODUCTION vertical slice, `production.start` and
`production.cancel` were built as plain guard-validated status transitions (`scheduled` →
`in_progress`/`cancelled`), mirroring `guard_production_batch_transition()`'s own role lists
verbatim — see `tests/sql/p3_7_production_sync.sql` and `IMPLEMENTATION_LOG.md` 2026-08-30. The
other three production operations AD-021 already allowlisted (`production.complete`,
`.record_output`, `.record_waste`) were investigated live and deliberately NOT built this pass:

- AD-021's own text names all five production operations in a single line ("production.start,
  .complete, .cancel, .record_output, .record_waste") but never specifies `.record_output`'s or
  `.record_waste`'s payload, or how either relates to the two existing RPCs
  `complete_production_batch()`/`fail_production_batch()` — which already combine a status flip
  (`in_progress`→`completed`/`failed`) with ingredient-consume and product-output stock
  movements in ONE call. It is not decided anywhere whether `.record_output`/`.record_waste` are
  meant to be synonyms for `.complete`/a "fail" op that doesn't exist in the allowlist,
  finer-grained events decomposing that one call into separate steps, or something else. No EB
  chapter or `docs/*.md` file mentions either name. Building either would mean guessing this
  relationship, not reading it from a decision.
- **A related defect, found live while investigating:** both `complete_production_batch()` and
  `fail_production_batch()` derive their own tenant via `public.current_tenant_id()` — the
  calling session's *active* organization — not an explicit parameter. Calling either from a
  sync handler for a genuinely cross-org operation (actor's session active in a different org
  than the operation's own `tenant_id`, AD-006's exact scenario) would silently use the wrong
  tenant to look up the batch. This is the same active-org-assumption bug class just found and
  fixed in `guard_production_batch_transition()`'s own role check (see AD-021 postscript,
  2026-08-30) — but fixing it in these two RPCs is a bigger, currently-untested surface
  (ingredient consume movements, the output movement, the "insufficient_stock rolls back the
  whole completion" behavior) than the trigger's single role check, and wasn't undertaken
  speculatively without first knowing what `.record_output`/`.record_waste` are actually meant
  to do.

All three remain allowlisted in `domain_operation`'s CHECK (unchanged since AD-021) but
unhandled — `apply_sync_operation()`'s dispatcher fallback correctly `REJECTED
unsupported_operation_type`s them today (verified live, test P11), never silently leaves them
PENDING.

**Needed:** a product/architecture decision on what `.record_output`/`.record_waste` actually
represent relative to `complete_production_batch()`/`fail_production_batch()` — new finer-
grained events, or the sync-facing names for calling those two RPCs (in which case `.complete`
becomes redundant with `.record_output` and one of the two allowlisted values is likely a
naming mistake worth correcting rather than both being built). Whichever direction is chosen,
`complete_production_batch()`/`fail_production_batch()` (or their sync-facing replacements)
need an explicit-tenant parameter before they can be safely called from the sync gateway for a
genuinely cross-org operation.

---

## BLOCKER-028 · `expense.reverse` sync handler — no live reversal mechanism exists for expenses, not built
**Status:** OPEN (reconsidered and explicitly re-deferred 2026-08-31 — not forgotten; see below) · **Affects:** P3.7 (remaining financial domain_operation coverage) · **Type:** business rule, not yet specified

**2026-08-31 checkpoint:** revisited alongside BLOCKER-026/027 (both resolved that day — see
above). Presented with the same two concrete design options this blocker already named — a new
`expense_corrections`/`expense_reversals` table mirroring `refunds`, or a sync wrapper around a
constrained direct edit — the product decision was to **defer entirely**, same as today: leave
`expense.reverse` unbuilt, allowlisted-but-dispatcher-rejected (`unsupported_operation_type`),
no allowlist change. Unlike BLOCKER-026/027, this one was NOT removed from the
`domain_operation` CHECK, since "not yet decided" rather than "out of scope" is the actual
status here.

**Context:** 2026-08-30, building the P3.7 FINANCIAL vertical slice, `payment.create`,
`payment.reverse`, and `expense.create` were built — see `tests/sql/p3_7_financial_sync.sql` and
`IMPLEMENTATION_LOG.md` 2026-08-30. `expense.reverse`, the fourth financial `domain_operation`
AD-021 already allowlists, was investigated live and deliberately NOT built:

- AD-021 calls for "append-only + explicit reversal" as the conflict strategy for both payments
  and expenses. For payments, this maps cleanly onto the live schema: `payments` carries a
  `prevent_financial_mutation()` trigger making it genuinely immutable, and `refunds` (with its
  own `guard_refund_total()` trigger and `record_refund()` RPC precedent) is the explicit
  reversal mechanism — `payment.reverse` mirrors that precedent directly.
- **Expenses have no equivalent.** There is no `refund`-shaped table for expenses, no RPC that
  inserts a correcting/reversing entry, and no trigger enforcing append-only-ness — `expenses`
  carries no `prevent_financial_mutation()`-style trigger at all. Worse, the live
  `expenses_update` RLS policy (`owner/admin/branch_manager/accountant`) actively permits direct
  in-place edits to an existing expense row, which is the opposite of the append-only-plus-
  reversal model AD-021 asks for at the sync layer. There is no existing artifact to mirror, and
  the live schema's own direct-edit path contradicts the assumption a sync `expense.reverse`
  handler would need to make.
- Building `expense.reverse` today would mean inventing one of at least two incompatible
  designs — (a) a new `expense_corrections`/`expense_reversals` table plus trigger, matching the
  refunds shape, or (b) treating `expense.reverse` as a sync-facing wrapper around a direct
  UPDATE (contradicting append-only) — without a decision on which the product actually wants,
  or whether the existing direct-edit RLS path should be retired in favor of one of them.

`expense.reverse` remains allowlisted in `domain_operation`'s CHECK (unchanged since AD-021) but
unhandled — `apply_sync_operation()`'s dispatcher fallback correctly `REJECTED
unsupported_operation_type`s it today (verified live, test E6), never silently leaves it
PENDING.

**Needed:** a product/architecture decision on what "reversing an expense" means for this
platform — a new correction/reversal table and trigger (mirroring `payments`/`refunds`), or a
sync-facing name for a constrained direct edit — and, if the former, whether the live
`expenses_update` RLS policy's direct-edit path should be narrowed or retired once a reversal
mechanism exists, so the two paths don't contradict each other.

---

## Template

```
## BLOCKER-00N · <one-line title>
**Status:** OPEN | RESOLVED · **Affects:** <tasks> · **Type:** <category>
<what is unknown and why guessing is unsafe>
**Needed:** <the specific decision or action>
```
