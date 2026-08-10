# BakeFlow — Backend Roadmap

A **dependency graph**, not a checklist. A task may not start until its prerequisites
are `COMPLETE`. Independent tasks may run concurrently — but correctness beats
concurrency; do not parallelise for speed.

Status: `COMPLETE` (evidence recorded) · `READY` (prereqs met) · `BLOCKED` ·
`NOT STARTED` · `DEFERRED`.

```
B1 Database foundation ────────── COMPLETE
        │
B2 Authentication / JWT claims ── COMPLETE
        │
B3 Authorization & RLS ────────── COMPLETE
        │
        ├── B4 Sync gateway (record) ─ COMPLETE
        │        │
        │        └── B5 Per-entity apply ── READY
        │
        ├── B6 Invitation delivery ─── BLOCKED (no Edge Functions)
        │
        └── B7 Core domain services ── READY
                 │
                 └── B8 Tickets / sales ── NOT STARTED
                          │
                          └── B9 Payments & cash ── NOT STARTED
                                   │
                                   └── B10 Financial reporting ── NOT STARTED
```

---

## B1 · Database foundation — COMPLETE
Tenancy, money/quantity types, soft delete, schema invariants.
**Evidence:** `assert_schema_invariants()` returns clean; `pytest` 12/12.

## B2 · Authentication & JWT claims — COMPLETE
Hardened access-token hook; active-organization resolution; suspended/soft-deleted
profiles and revoked roles mint nothing.
**Evidence:** migrations `20260810141339`, `20260810182611`; tests S5c/S5c2/S5d.
**Prereq:** B1.

## B3 · Authorization & RLS — COMPLETE
Multi-organization membership; membership-validated organization switching; staff
visibility via `user_roles`; RLS forced on every RLS-enabled table.
**Evidence:** migrations `20260810141258`…`20260810141719`, `20260810182301`;
tests S1, S2, S5a/b, S7, S8, G1, G2.
**Prereq:** B2.

## B4 · Sync gateway — record & authorize — COMPLETE
Device authentication, per-operation authorization, immutable context, idempotency,
stale-revision conflict recording.
**Evidence:** migrations `20260810182112`, `20260810182203`, `20260810182219`;
tests S3, S4, S6, S9, S10a/b, S11a/b, S12.
**Prereq:** B3.

## B5 · Per-entity operation application — READY
Apply recorded operations to business tables, per entity type, with explicit conflict
semantics. **No generic writer. No last-write-wins.** Each entity needs its own
transition rules from `docs/STATE-MACHINES.md`.
**Prereq:** B4. **Owner:** backend-architect + database-optimizer, reviewed by
appsec-engineer.

## B6 · Invitation delivery — BLOCKED
`create_organization_invite()` mints tokens; nothing delivers them. `supabase/functions/`
contains only `import_map.json` — zero deployed functions. See BLOCKER-001.
**Prereq:** B3 (met). Blocked on infrastructure, not code.

## B7 · Core domain services — READY
Products, variants, recipes, ingredients, warehouses. Read `docs/SCHEMA-REFERENCE.md`
and inspect the live schema before adding tables.
**Prereq:** B3.

## B8 · Tickets & sales — NOT STARTED
Ticket lifecycle per `docs/STATE-MACHINES.md`. Tickets are immutable once submitted;
corrections use the correction mechanism. **Prereq:** B7.

## B9 · Payments & cash sessions — NOT STARTED
**Financial rules are not specified.** Tax, pricing, discounts, rounding, refunds and
invoice finalisation must each become a blocker rather than an assumption.
**Prereq:** B8.

## B10 · Financial reporting — NOT STARTED
**Prereq:** B9. See `docs/REPORTING-MODEL.md`.

---

## Deferred (not on the critical path)
- **Notifications** — no tables, no push-token storage, no `pg_cron`/`pg_net`. Two
  overlapping specs with no precedence rule. See `docs/PROJECT-OVERVIEW.md` §146.
- **Permission enforcement** — `has_permission()` gates zero policies (AD-016).
- **Frontend feature work** — backend first, per `docs/MASTER_PROMPT.md`.
- **`apps/web`** — AD-015.
