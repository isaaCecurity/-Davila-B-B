# BakeFlow — Notifications

Human-facing queue. Newest first. An entry here always has a matching `BLOCKERS.md` entry.

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
