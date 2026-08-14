# BakeFlow — Current Task

```
TASK: P4.4a + P4.4b — Sales READ path (customers, tickets, ticket_items)
STATUS: IMPLEMENTED (behavioural suite NOT executed — BLOCKER-011)
OWNER: claude
PREREQS: P4.1a (implemented); BLOCKER-005 RESOLVED 2026-08-14
EVIDENCE: npm run typecheck --workspace apps/mobile -> exit 0
          npx eslint packages --max-warnings=0 -> exit 0
          .venv/Scripts/python.exe -m pytest -q -> 12 passed
          zod projection probe (executed, zod 4.1.12) ->
            customers 10 cols / 0 ::text (no NUMERIC column exists)
            tickets 25 cols / 5 ::text
            ticket_items 9 cols / 3 ::text
            JSON-number payload REJECTED; ::text payload accepted, "3000.0000" intact
            cancelled-without-reason REJECTED; negative subtotal ACCEPTED (signed money)
          tests/sql/sales_read_rls.sql (S1-S18) -> NOT EXECUTED
```

**Production code.** `packages/types/sales.ts` (280), `packages/validation/sales.ts` (156),
`packages/api/queries/sales.ts` (508). `packages/api/internal/read.ts` 196 -> 281 as the
composite-cursor helpers moved out of `queries/inventory.ts` (its second consumer) and the
soft-delete predicate became explicit. `packages/validation/decimal.ts` gained
`signedMoneySchema`. **Zero migrations.**

**No ticket mutation was written, deliberately.** Four reasons, none of them "not done
yet": the lifecycle RPC signatures (`confirm_ticket`, `complete_ticket`, `cancel_ticket`,
`archive_ticket`) have not been read from the live database; `draft -> submitted` has no
RPC at all (`API-CONTRACT.md` §2); `discount_amount`/`tax_amount` have no approved rules
(BLOCKER-003); and BLOCKER-009 leaves `cancelled -> archived` unreachable. The
`adjust_stock()` episode is the precedent — a full implementation built on an assumed
contract had to be discarded.

**Defect found and fixed in P4.3a.** `queries/production.ts` filtered
`.is('deleted_at', null)` on both production tables while selecting a column set
containing neither — `SCHEMA-REFERENCE.md` §5 lists `[std]` alone for them, where §4 spells
out `+ deleted_at, deleted_by` for `tickets`. If the column is absent, PostgREST answers
`42703` and **every production read fails**. `ReadEntity` now carries a required
`softDeleted: boolean`, so all twelve entities across four domains state it beside the
schema that says which columns they have. S3a/S3b in the sales suite verify it.

---

## Blocked: all live verification — BLOCKER-011

The Supabase MCP connector is **reachable now** (the old `ENOTFOUND` and 401 are gone) but
is authorized against a **different Supabase account**: one organization, "Undeify's Org",
one project `etodmfsmvhewihboxcrp`, holding a workforce-scheduling schema with no BakeFlow
table in it. Every call against `tvfyxpafbpnkneujcnvr` returns *"You do not have permission
to perform this action"*. No fallback exists — no service-role key, no `psql`, no stored
CLI token, all checked.

Three suites are written, committed and unexecuted: `inventory_write_rls.sql` (P4.2b),
`sales_read_rls.sql` (P4.4), and P4.3's schema verification.

---

## Previous task — P4.2b Inventory WRITE path (PARTIAL)

```
TASK: P4.2b — Inventory WRITE path
STATUS: PARTIAL — production code complete; behavioural suite NOT executed
OWNER: claude
PREREQS: P4.2a (implemented)
EVIDENCE: npm run typecheck -> exit 0
          npx eslint packages --max-warnings=0 -> exit 0
          tests/sql/inventory_write_rls.sql -> NOT EXECUTED (connection lost:
          getaddrinfo ENOTFOUND mcp.supabase.com)
```

**To finish P4.2b:** run `tests/sql/inventory_write_rls.sql` (A0-A12) once the database is
reachable. If it passes, P4.2b becomes COMPLETE; nothing else is outstanding.

**Mechanism correction.** The milestone assumed a direct insert into `stock_movements`.
Verified live, that is impossible for any application user — `authenticated` holds SELECT
only, and GRANTs precede RLS. Writes go through the SECURITY DEFINER `adjust_stock()` RPC,
which takes an **absolute target quantity**, accepts only `adjustment`/`waste`/
`opening_balance`, and owns `created_by`, `branch_id` and the audit entry. A direct-insert
implementation was written and discarded rather than shipped.

---

## Previous task — P4.2a Inventory READ path (implemented, 15/15 executed)

```
TASK: P4.2a — Inventory domain, READ PATH
STATUS: IMPLEMENTED (tests executed; awaiting independent review)
OWNER: claude
PREREQS: P1, P2 (COMPLETE), P4.1a (implemented)
QUALITY GATE: plan -> implement -> test -> security review -> code review
              -> fix -> retest -> document
EVIDENCE: tests/sql/inventory_read_rls.sql -> 15/15 passed (live, BEGIN...ROLLBACK)
          post-run row counts across 10 tables -> 0
          npm run typecheck -> exit 0
          npx eslint packages --max-warnings=0 -> exit 0
```

**Production code:** `packages/types/inventory.ts` (253), `packages/validation/inventory.ts`
(143), `packages/api/queries/inventory.ts` (418), `packages/api/internal/read.ts` (196).
`packages/api/queries/catalog.ts` 663 -> 513 as its private read primitives moved into the
shared module. **Zero migrations.**

**Security proven, not asserted:** organization isolation (I1), **branch isolation** via
`has_branch_access` (I2, with I2b/I3 preventing a vacuous pass), owner authority not
crossing organizations (I3b), soft-delete invisibility (I4), FORCE RLS (I5), money/quantity
scale surviving only under `::text` (I6a/b/c), null-tenant denial (I7).

**Finding, no blocker opened:** the negative-stock policy is **already implemented** in
`apply_stock_movement()` — `sale`/`production_consume` may never go negative;
`waste`/`adjustment` only where `organizations.allow_negative_stock` is true (I10, I11).
The roadmap's "may become a blocker if unspecified" note is withdrawn.

**P4.2b write path:** not started. A write is an insert into `stock_movements`, never an
update to a level (`CLAUDE.md` rule 7). No decision is outstanding for it.

---

## Previous task — P11.1 lint/CI gate (PARTIAL, accepted)

```
TASK: P11.1 — Lint/typecheck/spec CI quality gate
STATUS: PARTIAL — lint/typecheck/pytest delivered; SQL suites deferred (BLOCKER-002)
OWNER: claude
PREREQS: none
QUALITY GATE: plan -> implement -> test -> code review -> fix -> retest -> document
EVIDENCE: npm run lint -> exit 0, 24 files linted (7 app + 17 root, counted via
          --format json, not inferred from exit code)
          npm run typecheck -> exit 0
          .venv/Scripts/python.exe -m pytest -q -> 12 passed
          negative control: probe file with an unused var + undefined identifier ->
          ESLint warned (exit 0, which is why --max-warnings=0 was added);
          tsc raised TS2304. Probe deleted.
```

**Scope held.** No database logic, business rule, sync behaviour, financial rule or
frontend feature was touched. The only non-config edit was deleting the probe I created.

---

## P11.1 — what changed

| File | Change |
|---|---|
| `bakeflow-frontend/eslint.config.js` | **new** — root flat config covering `packages/*` |
| `bakeflow-frontend/apps/mobile/package.json` | `lint`: `expo lint` → `eslint . --max-warnings=0` |
| `bakeflow-frontend/package.json` | `lint` also runs `eslint . --max-warnings=0` at root |
| `.github/workflows/ci.yml` | **new** — lint + typecheck + pytest on push/PR |

**Two findings worth keeping.** ESLint alone would not have caught an undefined
identifier (`typescript-eslint` disables `no-undef` and defers to `tsc`), so lint and
typecheck are complementary gates and CI must run both — dropping either leaves a real
class of error unchecked. And an exit code is not evidence of coverage: `expo lint`
returned a *failure* while linting nothing, and the first fix returned *success* while
warning. Both were caught only by counting files and by the negative-control probe.

**Not verified:** the workflow has never run on GitHub. Its commands pass locally; the
YAML is unproven until a push triggers it.

---

## Previous task — P4.1a Catalog READ PATH (unchanged, still IN REVIEW)

```
TASK: P4.1a — Catalog domain, READ PATH
STATUS: IN REVIEW  (implementation + tests done; security/code review returned)
OWNER: agents-orchestrator
PREREQS: P1 (COMPLETE), P2 (COMPLETE) — NOT P3.7 (see BLOCKER-008 resolution)
QUALITY GATE: plan -> implement -> test -> security review -> code review
              -> fix -> retest -> document
```

**Not COMPLETE.** Marking it complete requires the P8.1 slice to consume it on a real
device, and requires lint coverage to exist at all (TD-010/TD-011).

---

## What P4.1a delivered

Typed, validated, tenant-isolated **read** access to the six catalog tables, built to
`API-CONTRACT.md` §1's rule that reads go through **PostgREST + RLS, not RPCs**.

| Layer | Files |
|---|---|
| Types | `packages/types/scalars.ts`, `packages/types/catalog.ts` |
| Validation | `packages/validation/decimal.ts`, `packages/validation/catalog.ts` |
| Data access | `packages/api/client/index.ts`, `packages/api/errors/index.ts`, `packages/api/queries/catalog.ts` |
| Tests | `tests/sql/catalog_read_rls.sql` |

**Zero migrations. Zero schema changes. Database still holds 0 rows** (verified after the
suite rolled back).

### Evidence actually executed

| Command | Result |
|---|---|
| `tests/sql/catalog_read_rls.sql` (live, BEGIN…ROLLBACK) | **22/22 assertions passed** |
| post-run row-count verification | **0 rows** in all 7 touched tables |
| `.venv/Scripts/python.exe -m pytest -q` | **12 passed** |
| `npm run typecheck --workspace apps/mobile` | **exit 0**; `--listFilesOnly` confirms all new package files are in the program |
| zod-4 API runtime check (21 assertions) | **21/21 passed** |
| `npm run lint --workspace apps/mobile` | **FAILS — pre-existing**, see TD-011 |

---

## Findings recorded, not silently absorbed

1. **`API-CONTRACT.md` §4 is wrong about money transport** (TD-012). Postgres renders
   `numeric` unquoted in JSON, so `JSON.parse` destroys the scale. Every numeric column is
   therefore selected with a `::text` cast, and Zod rejects a JSON number in those
   positions so a dropped cast fails loudly instead of corrupting money.
2. **Catalog has no `branch_id`** — tenant-scoped only. "Branch isolation where
   applicable" does not apply here, and no branch filter was invented.
3. **No `catalog.*` permission keys exist.** The live keys are `products.manage` and
   `pricing.manage`; per AD-016 they enforce nothing. Authorization is role-based RLS.
4. **Lint cannot see `packages/*` at all** (TD-010).

---

## BLOCKED: P4.1b — catalog write path

Not started, deliberately. **BLOCKER-010**, three sub-decisions:

- **(a)** ~~Does soft-delete free a natural key?~~ **RESOLVED 2026-08-14.** All five unique indexes are now partial on `deleted_at IS NULL`. A deleted entity's name/SKU is freed for re-use. The application layer must detect `23505`, query for a soft-deleted row with the same key, and surface a role-gated restore prompt. Full contract in `docs/SOFT-DELETE-AND-RETENTION.md` §38.
- **(b)** May `product_variants.unit_price` be edited in place with no price-history table? That is **BLOCKER-003** territory — still OPEN.
- **(c)** Confirm PostgREST + RLS as the write mechanism — still OPEN.

**P4.1b unblocks when (b) and (c) are resolved.** (a) is done.

---

## Standing blocked task (unchanged)

**P3.7 — Per-entity sync operation application** · **BLOCKED at PLAN** on BLOCKER-005,
BLOCKER-006 and BLOCKER-009. The BLOCKER-008 resolution did **not** touch these: it only
established that **P4.1 is P3.7's prerequisite**, not its dependent.

---

## Next dependency-safe task

**P8.1 — first frontend vertical slice** ("sign in → pick organization → see catalog").
Its prerequisite set is now unambiguously **P2 + P4.1**, and the catalog read path is the
"at least one readable domain" the P8.0 checkpoint was waiting on.

Also safe in parallel: **P11.1** CI pipeline (which would close TD-010/TD-011), **P6.1**
Edge Function scaffold.

**Also required during P4.1b:** implement `restore_catalog_entity` RPC (specified in
`docs/SOFT-DELETE-AND-RETENTION.md` §38) and the `CatalogEntityDeletedError` /
`DuplicateNameError` types in `packages/api/errors/index.ts`. The 23505 catch-and-check
pattern must be in place before catalog writes go live.

A task becomes COMPLETE only with executed-command evidence. Never on assertion.
