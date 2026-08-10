# BakeFlow — Current Task

**Active task:** B5 — Per-entity sync operation application
**Status:** BLOCKED at the PLAN gate (no code written)
**Owner:** orchestrator
**Prereqs:** B4 COMPLETE (verified 2026-08-10)

---

## Why it is blocked

B5 stopped at PLAN, before implementation, on two verified findings:

- **BLOCKER-005** — the ticket lifecycle cannot be driven past `submitted`
  (`prevent_submitted_ticket_update` fires before `guard_ticket_status_transition`),
  and a submitted ticket's money is not frozen. Remediation was explicitly deferred by
  the owner on 2026-08-10.
- **BLOCKER-006** — no per-entity conflict strategy exists, `sync_conflicts` does not
  exist in the database, and the operation-type/payload contract is undefined.

Building an applier without these means inventing a conflict strategy and a lifecycle
contract. That is the guessing the directive forbids.

---

## What was done

PLAN only. Live-schema inspection of `tickets`/`ticket_items`, the five ticket guard
functions, trigger firing order, and `docs/OFFLINE-SYNC-MODEL.md` conflict sections.
No migration applied. No business table touched. Database still holds 0 rows.

---

## Unblocking B5 needs, in order

1. A decision on BLOCKER-005 (ticket guards).
2. A decision on BLOCKER-006 (conflict strategy, `sync_conflicts`, applier contract).
3. Then: pick the first entity, define its contract, implement, test, review.

## Dependency-safe work available now

**B7 — Core domain services** is unblocked (its only prerequisite, B3, is verified
complete). It was explicitly gated behind B5 by the human, so it needs a go-ahead.
