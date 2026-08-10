# BakeFlow — Notifications

Human-facing queue. Newest first. An entry here always has a matching `BLOCKERS.md` entry.

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
