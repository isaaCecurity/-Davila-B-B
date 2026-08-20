# BakeFlow — Blockers

Human decision or external action required. Agents must never guess past these.
Unrelated safe work may continue.

---

## ✅ BLOCKER-001 · Invitation delivery implemented (2026-08-20)
**Status:** RESOLVED · **Affects:** B6 / P6.1 & P6.2 · **Type:** missing infrastructure

Delivered the Supabase Edge Functions infrastructure and invitation email delivery pipeline:
- **Edge Function Foundation (P6.1):** Created `supabase/functions/_shared/` with CORS (`cors.ts`), error formatting envelope (`errors.ts`), JWT validation & tenant membership enforcement (`auth.ts`), and email provider abstraction (`email/types.ts`).
- **Resend Provider Adapter (P6.2):** Implemented `ResendEmailProvider` and `MockEmailProvider` selected via `getEmailProvider()` factory.
- **Invitation Edge Function:** Implemented `send-invite-email/index.ts` with caller authentication, tenant role validation, SHA-256 token verification, deep-link creation, and HTML/text template rendering.
- **Client SDK Support:** Added `createOrganizationInvite`, `sendInviteEmail`, and `createAndSendInvite` in `@bakeflow/api`.

**Evidence:**
- TypeScript typecheck exit 0 (`npm run typecheck`)
- Monorepo lint exit 0 (`npm run lint --max-warnings=0`)
- Repository test suite 12/12 passed (`pytest -q`)
- Verification script passed (`node scripts/verify-invite-delivery.mjs`)


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

## Template

```
## BLOCKER-00N · <one-line title>
**Status:** OPEN | RESOLVED · **Affects:** <tasks> · **Type:** <category>
<what is unknown and why guessing is unsafe>
**Needed:** <the specific decision or action>
```
