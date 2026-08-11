# BakeFlow — Current Task

**Active task:** none. Roadmap planning completed 2026-08-10.
**Last action:** `BACKEND_ROADMAP.md` expanded into the master implementation roadmap
(P0–P12). Planning only — no code, migration or database change.

---

## Standing blocked task

**P3.7 — Per-entity sync operation application** *(formerly B5)* · **BLOCKED at PLAN**

Stopped before implementation on two verified findings:
- **BLOCKER-005** — ticket lifecycle unreachable past `submitted`; submitted-ticket
  money not frozen. Remediation deferred by owner decision 2026-08-10.
- **BLOCKER-006** — no per-entity conflict strategy; `sync_conflicts` absent; applier
  contract undefined.

No code was written. Database still holds 0 rows.

---

## Recommended next task

**P4.1 — Catalog domain** (`product_categories`, `products`, `product_variants`,
`ingredients`, `recipes`, `recipe_ingredients`)

| Why it is the right next move | |
|---|---|
| Prerequisites | P1, P2 — both verified COMPLETE |
| Financial exposure | none — touches no unspecified financial rule |
| Unblocks | most of Phase 4, and the frontend checkpoint P8.0 |
| Blocked by | nothing |

**It needs an explicit go-ahead**: P4 was previously gated behind P3.7 by the human,
and P3.7 is blocked on decisions rather than on work.

### Also available in parallel
- **P6.1** Edge Function scaffold (unblocks P6.2 once a provider is approved)
- **P11.1** CI pipeline — the test suites exist but nothing runs them automatically
- **P0.5** migration reproducibility (needs a BLOCKER-002 decision first)

---

## Task record format

```
TASK: P4.1 — Catalog domain
STATUS: IN PROGRESS | BLOCKED | IN REVIEW | COMPLETE
OWNER: <agent>
PREREQS: P1 (COMPLETE), P2 (COMPLETE)
QUALITY GATE: plan -> implement -> test -> security review -> code review
              -> fix -> retest -> document
EVIDENCE: <commands actually run and their output>
```

A task becomes COMPLETE only with executed-command evidence. Never on assertion.
