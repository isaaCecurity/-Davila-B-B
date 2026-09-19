---
name: rls-policy-check
description: Canonical RLS policy patterns and checklist for BakeFlow tables. Use silently whenever writing or reviewing a CREATE POLICY statement, a new migration that creates a tenant- or branch-owned table, or any change touching row-level security — to apply the correct pattern (A/B/C/D/E) and catch the missing-WITH-CHECK class of bug before it ships.
metadata:
  type: background-knowledge
  argument-hint: (none — invoked automatically by Claude)
user-invocable: false
---

# RLS Policy Check

Background knowledge for writing or reviewing Row-Level Security policies in BakeFlow.
Full canonical reference: `docs/RLS-POLICY-PATTERNS.md` — read it before writing policies
for a table type not covered here, since this skill only summarizes the decision points.

## Step 1 — classify the table before writing anything

| Table shape | Pattern | Example tables |
|---|---|---|
| Tenant-owned, no branch concept | **A** — tenant-scoped | `products`, `ingredients`, `recipes`, `customers` |
| Tenant + branch owned | **B** — branch-scoped (via `has_branch_access(branch_id)`) | `tickets`, `deliveries`, `cash_sessions`, `invoices` |
| Child table with no `branch_id` of its own | **B-child** — scope via `EXISTS` against the parent's `branch_id` | `ticket_items`, `production_batch_ingredients` |
| Immutable ledger — insert-only, never updated or deleted | **D** — append-only | `stock_movements`, `payments`, `audit_log`, `refunds` |
| Row a user owns personally | **E** — self-scoped | `profiles`, `user_roles`, `branch_assignments` |
| Doesn't fit any of the above | **Special case** — see `docs/RLS-POLICY-PATTERNS.md` §8 | `organizations`, `branches`, `roles`, `organization_invites`, `permanent_deletion_challenges`, `document_sequences` |

If the table doesn't obviously map to one of these, stop and check §8 rather than
improvising a policy shape — several tables there (`branches`, `organization_invites`)
look like Pattern A/B at first glance but are deliberately not, to avoid recursion or a
column-level leak.

## Step 2 — the four rules that generate real incidents

1. **Every `UPDATE` policy needs both `USING` and `WITH CHECK`.** `USING` alone lets a
   user update a row they can see and reassign its `tenant_id` to another organization —
   this is the single most common RLS bug in this codebase. `WITH CHECK` must re-verify
   `tenant_id = public.current_tenant_id()` on the *new* row values.
2. **Never use `FOR ALL`.** Write separate `SELECT`/`INSERT`/`UPDATE`/`DELETE` policies.
   Omitting a policy is how a command is forbidden — an append-only table simply has no
   `UPDATE`/`DELETE` policy, it does not need one that denies.
3. **`FORCE ROW LEVEL SECURITY` is required**, not just `ENABLE`, or the table owner
   (frequently the migration role) bypasses the policies entirely.
4. **`tenant_id` is set explicitly on insert by application code**, checked by
   `WITH CHECK`, never defaulted from the JWT. RLS is the enforcement layer; the app is
   the source of truth for the value.

## Step 3 — write the policy using the matching template

Copy the exact template for the table's pattern from `docs/RLS-POLICY-PATTERNS.md`
(§3 Pattern A, §4 Pattern B, §6 Pattern D, §7 Pattern E) rather than writing one from
memory — the helper functions (`public.current_tenant_id()`, `public.has_role()`,
`public.has_branch_access()`, `public.has_permission()`) live in the `public` schema, not
`auth`; a policy that qualifies them as `auth.current_tenant_id()` fails at creation time.

## Step 4 — before calling it done

Every new or changed policy needs the 8-point isolation test from
`docs/RLS-POLICY-PATTERNS.md` §11 run against it, not just a visual read of the SQL. If
you're the one writing the migration, either run that test yourself or hand off to the
`rls-auditor` subagent — a policy that "looks right" and hasn't been tested against a
second tenant is not verified.
