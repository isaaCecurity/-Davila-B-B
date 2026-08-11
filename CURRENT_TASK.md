# BakeFlow — Current Task

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

- **(a)** Does soft-delete free a natural key? Five unique indexes are not partial on
  `deleted_at IS NULL`, so a deleted name is consumed permanently. Proven behaviourally
  by suite assertion C9b (`23505` on `products_tenant_name_key`). The fix is a migration
  and needs approval.
- **(b)** May `product_variants.unit_price` be edited in place with no price-history
  table? That is **BLOCKER-003** territory.
- **(c)** Confirm PostgREST + RLS as the write mechanism.

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

A task becomes COMPLETE only with executed-command evidence. Never on assertion.
