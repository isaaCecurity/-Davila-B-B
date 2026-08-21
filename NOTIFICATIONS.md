# BakeFlow — Notifications

Human-facing queue. Newest first. An entry here always has a matching `BLOCKERS.md` entry.

---

## ACTION REQUIRED: BLOCKER-017

**Question:** How should the completion/failure gap be closed — narrow
`production_batches`' grant/RLS the way `deliveries` already is (small RPCs for the two
plain-update hops too), or a trigger-side guard that refuses `status -> completed`/`failed`
unless it detects the write came from the RPC?

**Affected:** inventory accuracy for every production batch. Reproduced live: a raw
PostgREST `UPDATE` (status + actual_quantity + completed_at) reaches `completed` without
ever calling `complete_production_batch()`, and writes zero `stock_movements` rows — the
batch looks finished but the ingredient consumption and product output it should have
recorded never happened. `packages/api/mutations/production.ts` never takes this path, so
nothing shipped in P9.5 is affected, but the gap is open to any other caller.

**Status:** BLOCKED — the P9.5 production-batch write path (start, cancel, complete, fail)
shipped and is fully working; this is a backend hardening gap adjacent to it, found live
while building it on 2026-08-21, not a defect in what shipped. A permanent regression check
now lives in `scripts/smoke-signed-in.mjs` proving the gap and will need its expectations
flipped once this is closed. Unrelated work may continue.

---

## ACTION REQUIRED: BLOCKER-016

**Question:** What should the return `stock_movements` write look like for a delivery that
reaches `returned` — which warehouse, by variant or by the ticket's original lines, and are
partial returns in scope for MVP 1?

**Affected:** inventory accuracy for every delivery that fails or is returned; the goods are
physically back at the branch but no ledger row says so, and `quantity_on_hand` stays as
depleted as while the delivery was still out.

**Status:** BLOCKED — the P9.6 delivery write path (transitions, address/phone corrections)
shipped and is fully working; this is the one gap in it, discovered live while building that
path on 2026-08-21, not a defect in what shipped. Unrelated work may continue.

---

## RESOLVED: BLOCKER-002 — Database migration history reconciled

**Status:** Resolved on 2026-08-20.

Reconciled the database migration tracking gap between remote Supabase production and the local repository. The 14 local migration files are preserved for historical context, `supabase/migrations/MIGRATION_GOVERNANCE.md` documents the tracking inventory, and `supabase/migrations/20260809_live_schema.sql` holds the canonical baseline DDL snapshot.

---


## RESOLVED: BLOCKER-001 — Invitation delivery pipeline implemented

**Status:** Resolved on 2026-08-20.

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

## ACTION REQUIRED: BLOCKER-009

**Question:** Should `ARCHIVE` be added to the `operation_type` CHECK (or
`archive_ticket()` changed to emit an allowed value), and should `cancelled` be removed
from the guarded status list so `cancelled → archived` becomes reachable?

**Affected:** P4.4 tickets, P3.7 ticket entity, and the accuracy of BLOCKER-005

**Status:** BLOCKED — decide together with BLOCKER-005

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

## ACTION REQUIRED: BLOCKER-001

**Question:** Which transactional email provider should deliver invitations, and may
the first Edge Function be deployed?

**Affected:** B6 invitation delivery

**Status:** BLOCKED — unrelated work may continue

---

## ACTION REQUIRED: BLOCKER-003

**Question:** What are the approved rules for tax, pricing, discounts, rounding,
refunds and invoice finalisation?

**Affected:** B9 payments, B10 financial reporting

**Status:** BLOCKED — B5/B7 may continue
