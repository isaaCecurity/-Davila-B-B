# BakeFlow — Blockers

Human decision or external action required. Agents must never guess past these.
Unrelated safe work may continue.

---

## BLOCKER-001 · Invitation delivery has no transport
**Status:** OPEN · **Affects:** B6 · **Type:** missing infrastructure

`create_organization_invite()` mints tokens correctly, but `supabase/functions/`
contains only `import_map.json` and zero functions are deployed. Minting a token is
not delivering an invitation, so inviting a user cannot be completed end-to-end.
Also absent: `pg_cron`, `pg_net`, any notification tables.

**Needed:** approval of an email provider and deployment of the first Edge Function.

---

## BLOCKER-002 · Migration files are not reproducible from the repository
**Status:** OPEN · **Affects:** repository integrity · **Type:** environment + decision

`supabase db pull` fails with `LegacyDbPullMigrationConflictError`: 14 local `.sql`
files were never applied, and the remote holds migrations the repo lacks.
`supabase db dump` requires Docker, which is not installed.

The CLI suggests `migration repair --status applied` on the 14 stale files. **Do not
run it** — that records never-executed migrations as applied, so `db reset` would
build a different schema than production.

**Needed:** a decision on the 14 stale files, then either install Docker and dump a
baseline, or delete the stale files and re-run `db pull`.

---

## BLOCKER-003 · Financial rules are unspecified
**Status:** OPEN · **Affects:** B9, B10 · **Type:** business rule

No approved rules exist for tax, pricing, discounts, rounding, refunds, invoice
finalisation, or financial reporting. Agents must not invent any of them.

**Needed:** written rules before B9 begins.

---

## BLOCKER-004 · EAS project ID is a placeholder
**Status:** OPEN · **Affects:** first native build · **Type:** project setup

`apps/mobile/app.json` carries `extra.eas.projectId: "REPLACE_WITH_EAS_PROJECT_ID"`.
No real ID exists anywhere in the repository. It must not be invented.

**Needed:** the EAS project ID, or `eas init`.

---

## BLOCKER-005 · Ticket lifecycle is broken, so ticket sync cannot be applied
**Status:** OPEN · **Affects:** B5 (ticket entity) · **Type:** business rule + defect

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

**Needed:** either authorise the remediation migration (remove `status`,
`assigned_to`, `due_at` from the guarded list; add `subtotal_amount`, `total_amount`;
add `submitted` to `guard_ticket_item_mutation()`), or confirm that ticket sync is
restricted to `draft -> submitted` only and nothing further.

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

## Template

```
## BLOCKER-00N · <one-line title>
**Status:** OPEN | RESOLVED · **Affects:** <tasks> · **Type:** <category>
<what is unknown and why guessing is unsafe>
**Needed:** <the specific decision or action>
```
