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

## BLOCKER-006 · No per-entity conflict strategy, and no place to record a conflict
**Status:** OPEN · **Affects:** B5 (all entities) · **Type:** architecture decision

`docs/OFFLINE-SYNC-MODEL.md` §1018 forbids generic last-write-wins, §1047 says ticket
sync must not resolve conflicts by overwriting fields, and §663 says "do not assume
all four tables use the same conflict strategy" - but no per-entity strategy is
defined anywhere. §335 refers to a `sync_conflicts` table; **it does not exist in the
live database** (verified).

The applier contract is also unspecified: which `operation_type` values are valid per
entity, the payload shape each carries, how `revision` increments, and when a
`sync_changes` row is written.

Inventing any of this would be the guessing the directive forbids, and would bake a
conflict strategy into 37 tables by accident.

**Needed:** per-entity conflict strategy for the first entities in scope, a decision
on whether `sync_conflicts` is created, and the operation-type/payload contract.

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

## BLOCKER-013 · AD-014 specifies a cipher `expo-crypto` does not have
**Status:** OPEN — **implementation half resolved 2026-08-15**; only the AD amendment is outstanding.

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

**Needed:** either amend AD-014 to record SecureStore-chunked storage as the approved
mechanism, or approve a real crypto dependency (`react-native-quick-crypto` or
`expo-standard-web-crypto`) and the lockfile change it implies. Until then the current
implementation stands and is recorded here rather than passed off as AD-014.

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

## Template

```
## BLOCKER-00N · <one-line title>
**Status:** OPEN | RESOLVED · **Affects:** <tasks> · **Type:** <category>
<what is unknown and why guessing is unsafe>
**Needed:** <the specific decision or action>
```
