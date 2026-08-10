# BakeFlow — Notifications

Human-facing queue. Newest first. An entry here always has a matching `BLOCKERS.md` entry.

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
