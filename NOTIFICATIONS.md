# BakeFlow — Notifications

Human-facing queue. Newest first. An entry here always has a matching `BLOCKERS.md` entry.

---

## NEW: BLOCKER-021 — driver-created roadside tickets have no legal path to completion (2026-08-25)

Building ADR-001 Phase 5's "Sell" step (driver creates a roadside ticket, sells from the
truck), found the live ticket state machine cannot actually complete that sale:
`guard_ticket_status_transition()`'s actor lists never include `driver` at any of the
seven forward hops, and the eight-status chain (`draft → … → completed`) has no shortcut
for stock that's already baked and already loaded — the same eight hops apply to a
made-to-order cake and a truck sale of bread that's already on the vehicle. Two decisions
needed: (1) can a driver advance their own trip-linked ticket unassisted, or must a
manager/cashier confirm every roadside sale live, and (2) should a trip-linked pickup
ticket get a shortened lifecycle. Full detail, evidence and options in **BLOCKER-021**.

**Not blocked:** ticket creation (a driver can `INSERT` a draft `ROADSIDE` ticket + items
today, verified live) and `record_payment()` against an existing trip-linked ticket (its
driver branch is already correctly scoped). Scoped Phase 5 down to ticket creation only
until this is answered — see `IMPLEMENTATION_LOG.md`.

---

## RESOLVED: ADR-001 Phase 2 decisions — BLOCKER-019 and BLOCKER-020 answered (2026-08-24)

Both decided: driver trip cash is custody-distinct from branch till cash, linked only at
reconciliation (**AD-018**); `deliveries` stays the sole authority for physical-delivery
state, trip completion never bypasses it (**AD-019**). BLOCKER-006 (offline conflict
strategy) stays deliberately open and unaddressed — no schema/RPC in Phase 2 may assume a
resolution for it. Phase 2 database design proceeding.

---

## (superseded by the resolution above) ADR-001 approved — three decisions gate Phase 2 (2026-08-24)

`docs/ADR-001-Driver-Workflow-Redesign-MVP.md` is now **Approved**. Domain review (Phase 1)
proceeded immediately — 12 of its 14 open decisions were low-stakes and resolved inline in
the ADR itself (naming, schema-design details, and workflow defaults that are reversible
without a data migration). Three are not, and database design/migration (Phase 2) cannot
start until they're answered:

1. **BLOCKER-019** — does a driver's collected cash settle into the branch's already-open
	 cash session, or does the trip carry its own cash-custody context settled only at
	 reconciliation? Both are legitimate; they have different consequences for AD-017's
	 expected-drawer-cash formula while a driver is out.
2. **BLOCKER-020** — for a trip-linked delivery ticket, does the existing `deliveries`
	 entity (live, P9.6, shipped 2026-08-21) remain the authoritative proof-of-delivery
	 record, or does trip-level sale completion replace that gate? Guessing risks silently
	 breaking a live feature.
3. **BLOCKER-006** (pre-existing, unrelated to this ADR) — no per-entity offline conflict
	 strategy exists yet. ADR-001's Path B (driver creates tickets/customers offline) walks
	 directly into it; it was already blocking P9.3 for the same reason.

Everything else in the ADR — trip entity naming, route-stop/return/reconciliation schema
shape, loading-verification authority, ticket-correction mechanism — is resolved and
unblocked; Phase 1 work can continue on those without further input.

Full detail: `BLOCKERS.md` §BLOCKER-019, §BLOCKER-020.

---

## ACTION REQUIRED: BLOCKER-018 — how should ingredient purchase cost be captured?

Auditing P5 (financial backend) end to end on 2026-08-24, then checking what P5.8
(Reporting & P&L) would need to build on: `docs/REPORTING-MODEL.md` locks
weighted-average costing as the method, and the schema already has the column the
formula needs (`stock_movements.unit_cost`) — but it is **100% null across every row in
the live database**, including on `purchase`-reason movements, the one type that's
supposed to be the actual cost source. Nothing anywhere ever writes it.

This isn't something I can safely decide myself: it's a question of **how a bakery owner
records what an ingredient purchase actually cost** — a field added to the existing
`adjust_stock()` purchase path, a separate purchase-order/goods-received workflow, or a
default per-ingredient standard cost purchases can override. Each has different UX,
migration, and offline-sync consequences, and guessing would bake an unreviewed workflow
into the schema.

**Not blocking:** the revenue/cash side of P5.8 (gross/net revenue, refunds, cash
collected/reconciled) needs none of this and could be built independently — only
COGS/gross-profit/inventory-valuation are stopped by it.

Full detail: `BLOCKERS.md` §BLOCKER-018.

---

## RESOLVED: BLOCKER-001 — deployed, invoked, and verified live; a second real bug found and fixed

**Status:** Resolved on 2026-08-22, with your explicit approval to deploy.

Deployed `send-invite-email` (now `ACTIVE`, version 1). Verified with a full real
end-to-end call, not a smoke ping: signed in as the real smoke owner, called
`create_organization_invite` for real over PostgREST, then POSTed the result to the live
Edge Function URL with that session's token — **200, `success: true`**, mock provider
fired (no Resend key set yet), and the structured NDJSON logs added in P6.5 showed up
correctly in `function_logs` (the correct log source — discovered it's `function_logs`,
not `function_edge_logs`). Disposable invite row deleted afterward. **This is the first
successful invitation dispatch in this project's history** — `organization_invites` had
zero rows before this.

**A second, independent bug was found and fixed in the same pass.** While preparing that
test, reading `create_organization_invite()`'s actual body showed it returns
`{invite: {...}, raw_token}` — but the client wrapper
(`packages/api/mutations/invitations.ts`) was reading the invite's `id`/`expires_at` off
the *top level* of that response, which don't exist there. Every real call would have
thrown `response_shape_invalid` before ever reaching the email step — regardless of
whether the function was deployed. Fixed to read the nested `invite.id`/`invite.expires_at`
first; verified against the real captured RPC response, `typecheck`/`lint` both exit 0.

**Still open, separately:** real email delivery (vs. the mock provider) needs
`RESEND_API_KEY`/`EMAIL_FROM_ADDRESS`/`EMAIL_FROM_NAME` in Supabase Secrets — unverified
either way, no tool here lists live secrets — but this is no longer required to prove the
pipeline works, only to make it send real mail.

Full detail: `BLOCKERS.md` §BLOCKER-001.

---

## RESOLVED: BLOCKER-017 — production batch completion/failure now requires the RPC

**Status:** Resolved on 2026-08-22 (decision: trigger-side guard flag, over narrowing the
grant/RLS).

`complete_production_batch()`/`fail_production_batch()` now set a transaction-local flag
immediately before their own final `UPDATE`; `guard_production_batch_transition()` refuses
`status -> completed`/`failed` unless it's present. The raw-update bypass that proved this
blocker is refused live; the legitimate RPC path was re-run immediately after and still
works. `scripts/smoke-signed-in.mjs` carries this as a permanent regression guard.

---

## RESOLVED: BLOCKER-016 — closed as not-a-bug; a real adjacent defect found and fixed

**Status:** Resolved on 2026-08-22.

Investigating the requested fix found that the scenario this blocker described — a
delivery returning stock it once took — **cannot happen under the current design**: a
delivery reaching `returned` was, by construction (walked from the live trigger graphs),
never on a ticket whose stock had actually been deducted, since `delivered` and `returned`
are mutually exclusive delivery outcomes and ticket completion (where a sale would be
recorded) requires having passed through `delivered` first. So there was nothing to
restore, and no restoration mechanism was built.

The same investigation found the real, previously-undiscovered defect:
**`complete_ticket()` already implements sale-side stock deduction and has never once
worked** — it wrote `stock_movements.reference_type = 'ticket'`, which the live CHECK
constraint has never allowed (only `'order'`, the historical wart `CLAUDE.md` already
documents elsewhere). Every real call has always failed `23514`. Fixed by changing the one
literal; verified live end to end via a real signed-in owner completing a real ticket
(disposable fixtures, JWT claims simulated the same way BLOCKER-015's verification worked)
— one `sale` movement written, the resulting stock level correct.

**No smoke-suite automation added for this flow**: `authenticated` has no `UPDATE` grant on
`tickets` and most of the intermediate lifecycle hops have no RPC at all
(`STATE-MACHINES.md` §1 already documents this as a known, separate gap), so a signed-in
client cannot currently drive a ticket to `delivered` on its own. Not something this
resolution should paper over with a check that can only run via simulated credentials.

---

## RESOLVED: BLOCKER-002 — Database migration history reconciled

**Status:** Resolved on 2026-08-20.

Reconciled the database migration tracking gap between remote Supabase production and the local repository. The 14 local migration files are preserved for historical context, `supabase/migrations/MIGRATION_GOVERNANCE.md` documents the tracking inventory, and `supabase/migrations/20260809_live_schema.sql` holds the canonical baseline DDL snapshot.

---


## RESOLVED: BLOCKER-001 — Invitation delivery pipeline implemented — **superseded, see reopened entry at top**

**Status:** Resolved on 2026-08-20. **This was premature — reopened 2026-08-22, see the
entry at the top of this file.** Everything below was true of the code; the deployment
question was, in fact, never answered — see the stale duplicate entry further down that
this RESOLVED status should have been reconciled against and wasn't.

Implemented the Edge Functions scaffold (P6.1), the Resend email provider adapter with mock fallback, the `send-invite-email` function (P6.2), and client SDK mutation methods in `@bakeflow/api`.

**Action needed for production deployment:**
- Set `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, and `EMAIL_FROM_NAME` in Supabase Secrets (`supabase secrets set`) when deploying Edge Functions to live Supabase project.

---


## RESOLVED: BLOCKER-015 — ticket creation works end to end

Migration `fix_ticket_actor_membership_check_for_multi_org` was **approved and applied live
on 2026-08-16**. It replaced the two membership lookups inside
`guard_order_actor_and_assignment()` that read `profiles.tenant_id` with `user_roles` checks;
every other clause is byte-identical, and the function's owner, `SECURITY DEFINER`,
`search_path` and EXECUTE ACL were re-read from `pg_proc` afterwards and are unchanged.

**FYI, no action needed** — recorded here because the previous entry asked for a decision.

**Verified, not assumed.** The signed-in smoke suite is **66 pass / 0 fail**, up from 53/9,
and now mints a real `TKT-000001` through PostgREST in organization A *and* another in
organization B — the multi-organization case that was impossible before. Nine authorization
scenarios (non-member, deleted membership, home-org mismatch, and the five assignee/driver
rules) were executed in one rolled-back transaction and all behaved correctly; the database
was re-read afterwards to confirm nothing persisted. Full table in `BLOCKERS.md` §015.

**Unblocked by this:** P4.4b, P4.5, P9.6, and the ticket half of P9.3. P9.2, P3.7 and P5
remain blocked on their own separate blockers (006, 003, 009), not on ticket creation.

**One caveat for whoever cleans up:** the smoke suite now creates a real ticket per run in
each of the two scratch organizations. `tickets`, `ticket_items` and the `document_sequences`
rows must be included in the fixture teardown — the order is in `CURRENT_TASK.md`.

---

## RESOLVED: BLOCKER-012 — tickets can be numbered again

Migration `20260816131235_fix_document_sequences_doc_type_check_for_ticket` is applied live.
`document_sequences_doc_type_check` now allows `('ticket','invoice','production_batch')`,
matching `next_document_number()`. No data migration was needed — zero `doc_type='order'`
rows existed. **This alone does not restore ticket creation** — see BLOCKER-015.

---

## ACTION REQUIRED: BLOCKER-011

**Question:** Can the Supabase MCP connector be authorized with the account that owns
organization `tkrygyuxqyqbxgqaodjq` (project `tvfyxpafbpnkneujcnvr`) — or the currently
authorized account added to that organization?

**Affected:** every live verification. P4.2b stays PARTIAL, P4.3 and P4.4 stay
IMPLEMENTED-not-COMPLETE. Implementation itself is **not** blocked and is continuing.

**Status:** BLOCKED — needs a Supabase account/permission action, not a code change

**Why it matters:** the connector now works, which makes this easy to misread as fixed.
It is authorized against a **different Supabase account** — one organization,
*"Undeify's Org"*, one project, `etodmfsmvhewihboxcrp`, holding a workforce-scheduling
schema (`shifts`, `leave_requests`, `attendance_records`) with no BakeFlow table in it.
Any call against `tvfyxpafbpnkneujcnvr` returns *"You do not have permission to perform
this action"*. No fallback route exists here: no service-role key, no `psql`, no stored
CLI token.

Three suites are written and committed but unexecuted — `inventory_write_rls.sql`,
`sales_read_rls.sql`, and P4.3's schema verification. Under the Evidence rule none of
their assertions counts until they run. The sales suite's S2/S3 in particular decide
whether five `softDeleted` flags in the query layer are right; if they are wrong, the
affected reads fail outright with `42703`.

---

## RESOLVED: BLOCKER-009 — tickets do reach a real terminal state, no decision needed

**Status:** Resolved on 2026-08-22. Superseded — see `BLOCKERS.md` §BLOCKER-009 for full
detail. This entry's original question (below) turned out not to need a decision: both
things it worried about had already been fixed as side effects of other work, just never
verified or closed out.

`prevent_submitted_ticket_update()` — the trigger that put `cancelled` on a guarded list —
was dropped entirely back on 2026-08-14 (BLOCKER-005), and the CHECK-constraint bug in
`archive_ticket()` was fixed during P6.4 (2026-08-22, earlier the same day this was
closed). The real, working way a cancelled ticket reaches an audited terminal state is
`archive_ticket()`'s metadata fields (`archived_at`/`archived_by`/`archive_reason`), which
never touch `status` at all and were proven live in P6.4. One harmless nuance logged as
TD-016, not a blocker: the trigger *does* now permit a `cancelled → archived` status
transition, but nothing ever calls it — dead code, not a functional gap.

**Original question (answered above, no longer needs a decision):** Should `ARCHIVE` be
added to the `operation_type` CHECK (or `archive_ticket()` changed to emit an allowed
value), and should `cancelled` be removed from the guarded status list so `cancelled →
archived` becomes reachable?

**Was affecting:** P4.4 tickets, P3.7 ticket entity, and the accuracy of BLOCKER-005

**Status:** ~~BLOCKED — decide together with BLOCKER-005~~ RESOLVED, no decision needed

**Why it matters:** verified live 2026-08-11, tickets have **no reachable terminal state
at all**. `cancelled → archived` is blocked because `cancelled` sits in the guarded status
list, and `archive_ticket()` — the metadata path that legitimately bypasses that guard —
aborts with `23514` because it writes `operation_type='ARCHIVE'`, which the
`sync_changes` CHECK does not permit. BLOCKER-005 and `docs/STATE-MACHINES.md` §63 both
state that `draft → cancelled → archived` works; it does not. They also name
`total_amount` as needing a guard, but it is a generated column — the unguarded money
input is `subtotal_amount`. Deciding BLOCKER-005 from the current write-ups would fix the
wrong columns.

---

## ACTION REQUIRED: BLOCKER-010

**Question:** (a) May a migration make the five catalog unique indexes partial on
`deleted_at IS NULL`? (b) May `product_variants.unit_price` be edited in place with no
price-history table? (c) Is PostgREST + RLS confirmed as the catalog write mechanism?

**Affected:** P4.1b catalog write path only. **P4.1a read path is unaffected and
proceeding.**

**Status:** BLOCKED — write path only; the read path, P6.1 and P11.1 all continue

**Why it matters:** verified live, none of `products_tenant_name_key`,
`ingredients_tenant_name_key`, `product_categories_tenant_name_key`,
`product_variants_tenant_sku_key` or `recipes_one_active_per_variant` is partial on
`deleted_at IS NULL`. Under AD-012 soft delete, a deleted product name is consumed
permanently — re-creating it fails with `23505` forever. Fixing that is a migration on
live constraints and needs approval, so it was recorded, not done. Separately,
`unit_price` is the authoritative sale price with no price history, which puts any
in-place edit inside BLOCKER-003.

---

## RESOLVED: BLOCKER-008 — *(2026-08-11, no action required)*

**Was:** Does the frontend checkpoint P8.0 require P4.4, or only P2 + P4.1 — and which
way does the P3.7 ↔ P4 gate point?

**Resolution:** documentation-only correction to `BACKEND_ROADMAP.md`. (a) **P8.0
requires P2 + P4.1 only**; P4.4 is not a prerequisite, so **BLOCKER-005 does not block
the frontend start**. (b) **P4.1 is P3.7's prerequisite**, not its dependent; the "P4
gated behind P3.7" note is withdrawn and no circular dependency remains.

**Status:** RESOLVED — no code, migration, schema or database change was made, and **no
milestone status was upgraded**. BLOCKER-005, BLOCKER-006 and BLOCKER-009 are untouched
and still OPEN; **P3.7 remains BLOCKED** on those three.

---

## ACTION REQUIRED: BLOCKER-007

**Question:** Should `sync_conflicts` be created (or the sync spec corrected), and
which ticket document is wrong — `API-CONTRACT.md` or `STATE-MACHINES.md`?

**Affected:** P3.7 per-entity sync, P4.4 tickets, documentation accuracy

**Status:** BLOCKED — planning only; no implementation depends on it today

**Why it matters:** the sync model names a conflict table that does not exist, and the
API contract advertises ticket RPCs that provably cannot succeed. Both would mislead
the next implementer.

---

## ACTION REQUIRED: BLOCKER-005

**Question:** May the ticket-guard remediation migration be written, or is ticket sync
restricted to `draft -> submitted` only?

**Affected:** B5 — per-entity sync application for tickets

**Status:** BLOCKED — B5 cannot apply ticket operations

**Why it stops work:** verified live, `confirmed`/`scheduled`/`in_production`/`ready`/
`delivered`/`completed` are unreachable, and a submitted ticket's `subtotal_amount`
and `total_amount` are not frozen. An applier built on this would either fail on every
onward transition or silently rewrite finalised money. `docs/STATE-MACHINES.md` §70
records that you decided on 2026-08-10 not to write this migration.

---

## ACTION REQUIRED: BLOCKER-006

**Question:** What is the per-entity conflict strategy, should `sync_conflicts` exist,
and what is the operation-type/payload contract per entity?

**Affected:** B5 — all entities

**Status:** BLOCKED — no entity can be applied safely

**Why it stops work:** the sync model forbids generic last-write-wins but defines no
replacement, and the `sync_conflicts` table it references does not exist. Choosing a
strategy myself would bake it into every entity by default.

---
## ACTION REQUIRED: BLOCKER-002

**Question:** How should the repository be made able to rebuild the live schema?

**Affected:** repository integrity, CI, any future `supabase db reset`

**Status:** BLOCKED — unrelated work may continue

**Options:** (a) install Docker and dump a baseline snapshot; (b) delete the 14 stale
unapplied migration files and re-run `supabase db pull`. Do **not** run the CLI's
suggested `migration repair --status applied`.

---

## ACTION REQUIRED: BLOCKER-004

**Question:** What is the EAS project ID for BakeFlow?

**Affected:** first native build, push notification tokens

**Status:** BLOCKED — all other mobile work may continue

---

## ACTION REQUIRED: BLOCKER-001 *(original entry — this question was never actually answered; see the reopened entry at the top of this file, 2026-08-22)*

**Question:** Which transactional email provider should deliver invitations, and may
the first Edge Function be deployed?

**Affected:** B6 invitation delivery

**Status:** BLOCKED — unrelated work may continue. **This is the root cause of the 2026-08-22
reopening: this entry sat unanswered while a separate RESOLVED entry above claimed the
blocker closed.**

---

## ACTION REQUIRED: BLOCKER-003

**Question:** What are the approved rules for tax, pricing, discounts, rounding,
refunds and invoice finalisation?

**Affected:** B9 payments, B10 financial reporting

**Status:** BLOCKED — B5/B7 may continue
