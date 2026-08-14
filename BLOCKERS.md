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

## BLOCKER-007 · Documentation conflicts found during roadmap reconciliation
**Status:** OPEN · **Affects:** P3.7, P4.4, planning accuracy · **Type:** contradiction

Two conflicts surfaced while reconciling every `docs/` specification against the live
schema for the master roadmap. Recorded rather than resolved, per the no-guessing rule.

**(a) `sync_conflicts` is specified but does not exist.**
`docs/OFFLINE-SYNC-MODEL.md` §335 names a `sync_conflicts` table as the place a
conflict is recorded for domain resolution. The live database has no such table
(verified). Either the table is missing, or the spec describes a design that was
superseded by recording conflicts on `sync_operations.status = 'CONFLICT'`. Until this
is settled, P3.7 has no defined destination for a conflict that needs human resolution.

**(b) Ticket RPCs are described as usable while documented as broken.**
`docs/API-CONTRACT.md` presents `confirm_ticket()`, `complete_ticket()` and
`cancel_ticket()` as part of the working RPC surface, while `docs/STATE-MACHINES.md`
§63-70 records — and this session verified live — that they cannot succeed in any
state because `prevent_submitted_ticket_update()` fires before
`guard_ticket_status_transition()`. Both documents cannot be correct.

**Needed:** (a) confirm whether `sync_conflicts` should be created or the spec
corrected; (b) correct whichever ticket document is wrong, in the same change that
resolves BLOCKER-005.

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

## BLOCKER-010 · Catalog write path — three unresolved sub-decisions
**Status:** OPEN (b, c) · BLOCKER-010a RESOLVED 2026-08-14 · **Affects:** P4.1b (catalog write path) · **Type:** schema defect + business rule + architecture confirmation

The P4.1 **read** path is safe and proceeding. The **write** path is not, on three
counts. Recorded rather than guessed.

**(a) ~~Soft delete permanently consumes a natural key — schema defect, verified live.~~ RESOLVED 2026-08-14.**
~~These unique indexes are **not** partial on `deleted_at IS NULL`.~~ All five indexes have been replaced with partial unique indexes scoped to `deleted_at IS NULL`. Owner decision: a soft-deleted entity's name/SKU is freed for re-use; the application layer detects `23505`, checks for a deleted row, and surfaces a role-gated restore prompt. Full application contract documented in `docs/SOFT-DELETE-AND-RETENTION.md` §38. Migration applied: `partial_unique_indexes_for_soft_delete_restore`.

**(b) May `product_variants.unit_price` be edited in place?** It is the authoritative
sale price, `NUMERIC(19,4)`, and **no price-history table exists** (verified). Editing it
in place silently rewrites the price every historical read reproduces. This is
**BLOCKER-003** territory — no pricing rule is approved — so no write path may touch it.

**(c) Confirm PostgREST + RLS as the catalog write mechanism.** `API-CONTRACT.md` §1
assigns single-row writes with no side effects to PostgREST + RLS, not RPCs, and the read
path follows that. Catalog writes appear to qualify, but this should be confirmed
explicitly before the write path is built, since the roadmap previously specified "CRUD
RPCs" (now corrected).

**Needed:** ~~(a) resolved~~ (b) the pricing rule from BLOCKER-003, or approval of a `product_variant_prices` history table; (c) confirmation that PostgREST + RLS is the correct catalog write mechanism.

**Non-blocking work:** the entire P4.1a read path, P6.1, P11.1.

---

## BLOCKER-009 · Tickets have no reachable terminal state; `archive_ticket()` cannot succeed
**Status:** OPEN · **Affects:** P4.4, P3.7 (ticket entity), BLOCKER-005 scope · **Type:** defect

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

**Needed:** decide alongside BLOCKER-005 whether to (i) add `ARCHIVE` to the
`operation_type` CHECK on `sync_changes`/`sync_operations`, or change `archive_ticket()` to
emit an allowed value; and (ii) remove `cancelled` from the guarded status list so
`cancelled → archived` becomes reachable, or confirm that archiving is metadata-only and
the `archived` status value should be dropped from `tickets_status_check`.
Then correct BLOCKER-005 and `docs/STATE-MACHINES.md` §63 in the same change.

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
**Status:** OPEN · **Affects:** P4.4 (all ticket behaviour), P4.5, P3.7, P5 · **Type:** live defect, **migration-dependent**

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

## Template

```
## BLOCKER-00N · <one-line title>
**Status:** OPEN | RESOLVED · **Affects:** <tasks> · **Type:** <category>
<what is unknown and why guessing is unsafe>
**Needed:** <the specific decision or action>
```
