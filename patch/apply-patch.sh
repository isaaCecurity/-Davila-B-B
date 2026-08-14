#!/bin/bash
# Run this from the root of your -Davila-B-B repo
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp "$SCRIPT_DIR/docs/STATE-MACHINES.md" docs/
cp "$SCRIPT_DIR/docs/SOFT-DELETE-AND-RETENTION.md" docs/
cp "$SCRIPT_DIR/BLOCKERS.md" .
cp "$SCRIPT_DIR/CURRENT_TASK.md" .
cp "$SCRIPT_DIR/IMPLEMENTATION_LOG.md" .
cp "$SCRIPT_DIR/TECHNICAL_DEBT.md" .
git add docs/STATE-MACHINES.md docs/SOFT-DELETE-AND-RETENTION.md BLOCKERS.md CURRENT_TASK.md IMPLEMENTATION_LOG.md TECHNICAL_DEBT.md
git commit -m "docs: resolve BLOCKER-005, BLOCKER-010a, TD-013 — 2026-08-14 security & lifecycle session

- Drop prevent_submitted_ticket_update (trigger + function): BLOCKER-005 resolved
- guard_ticket_status_transition now freezes subtotal_amount past draft
- Revoke anon/PUBLIC EXECUTE on 4 internal functions: TD-013 resolved
- 5 catalog unique indexes made partial on deleted_at IS NULL: BLOCKER-010a resolved
- Add restore UX contract to SOFT-DELETE-AND-RETENTION.md §38
- Add FK index on permanent_deletion_challenges.tenant_id
- Update STATE-MACHINES, BLOCKERS, CURRENT_TASK, IMPLEMENTATION_LOG, TECHNICAL_DEBT"
git push
echo "Done."
