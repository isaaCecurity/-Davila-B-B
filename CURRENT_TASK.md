# BakeFlow — Current Task

**Active task:** none. Awaiting human selection from `BACKEND_ROADMAP.md`.

**Last completed:** B4 — Sync gateway (record & authorize).
Evidence: 11 migrations applied; 15/15 security assertions; `assert_schema_invariants()`
clean; `pytest` 12/12.

---

## Next candidates (prerequisites already met)

| Task | Status | Why it is ready |
|---|---|---|
| B5 Per-entity operation application | READY | B4 complete |
| B7 Core domain services | READY | B3 complete |

Do not start B8/B9/B10 — prerequisites incomplete.
Do not start B6 — see BLOCKER-001.

---

## Task record format

```
TASK: B7 — Core domain services
STATUS: IN PROGRESS | BLOCKED | IN REVIEW | COMPLETE
OWNER: <agent>
PREREQS: B3 (COMPLETE)
QUALITY GATE: plan -> implement -> test -> security review -> code review
              -> fix -> retest -> document
EVIDENCE: <commands actually run and their output>
```

A task becomes COMPLETE only with executed-command evidence. Never on assertion.
