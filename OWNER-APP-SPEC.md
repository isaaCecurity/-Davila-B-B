# Owner — App Flow & Screen Specification

**Status as of 2026-08-31.** Owner is the highest-rank canonical role
(`docs/ROLES-AND-PERMISSIONS.md` §2, rank 1). Everything below was checked against the live
screens in `bakeflow-frontend/apps/mobile/app/` and the live permission grants — not against
the aspirational "highest organizational authority" framing alone, which does not fully hold
at the permission-grant level (§1).

---

## 1. Role facts — including the counterintuitive one

- Rank 1 (highest). Live permission grants: `branch.manage`, `branch.view`,
  `customers.create/update/delete`, `financial.audit.confirm/submit`,
  `financial.expense.create/update/delete`, `financial.view`, `pricing.manage`,
  `products.manage`, `reports.view`, `staff.manage/staff.view`, `tickets.correct`,
  `tickets.create`, `tickets.view`.
- **Owner does not hold `records.permanent_delete` or `tickets.archive` — Admin and Branch
  Manager do.** `docs/ROLES-AND-PERMISSIONS.md` §4 flags this explicitly as surprising enough
  to call out and leaves it unconfirmed whether it's deliberate segregation of duties or an
  oversight. Don't assume Owner can do everything a lower rank can; rank and permission
  breadth are not the same axis in this schema, and this is the clearest example of it.
- `docs/ROLES-AND-PERMISSIONS.md` §3: mobile is framed as **monitoring** — "Monitor
  dashboards, tickets, production, inventory, deliveries, cash; receive alerts; high-level
  oversight across branches." Web is where the actual management authority lives: org/branch
  management, Branch Manager management, business-wide settings, user/access management,
  dashboards/analytics/reports, and monitoring "all operational domains."
- In practice, the live mobile app does not implement a monitoring-vs-executing distinction
  for Owner — the same write-capable screens Branch Manager uses (§2 of
  `MANAGER-APP-SPEC.md`) are equally reachable and equally functional for Owner, because nothing
  in the frontend narrows a screen's controls by role (§6). The "monitor, don't execute" framing
  in the docs is a product intent for mobile's UI to eventually express, not a restriction the
  current build enforces.
- What genuinely does set Owner apart today: **branch scope, by explicit design, not
  incidentally.** `docs/RLS-POLICY-PATTERNS.md` §"Branch access": "Owners and admins bypass
  branch scoping by design; every other role sees only assigned branches." `has_branch_access()`
  is `SECURITY DEFINER` specifically so this bypass can happen without recursing through
  `branch_assignments`. So an Owner's reach isn't "usually most branches" — it is, by
  construction, every branch in the tenant, unconditionally (identical to Admin — see
  `ADMIN-APP-SPEC.md` §1). This is what makes the Reports screen's branch switcher (§2.3) the
  one screen that visibly serves this role differently from a single-branch role.

---

## 2. Live screens

### 2.1 Cross-branch reach on every operational screen

Inventory (`app/inventory/index.tsx`), Production (`app/production/index.tsx`), and
Deliveries (`app/delivery/index.tsx`) all list rows filtered by `has_branch_access()`, not by
a hardcoded "my branch." Because that function bypasses scoping entirely for Owner (§1), every
branch's stockrooms, batches, and deliveries show up in the same flat list rather than one
branch's — not most of them, all of them. None of these screens
groups or labels rows by branch beyond what's already in the data (a warehouse's own name, a
delivery's address) — there's no branch-selector UI on any of them except Reports (§2.3).
Practically: an Owner scanning the Inventory or Production list today sees a merged view
across the whole org with no visual separation by branch.

### 2.2 Write access — identical mechanics to Branch Manager, same caveats

Because the permission grant sets overlap almost entirely (§1), everything documented in
`MANAGER-APP-SPEC.md` §2.1–2.4 (Inventory's **Adjust**, Production's **Start batch** /
**Mark completed** / **Mark failed** / **Cancel**, Deliveries' assign/transition buttons,
Finance's open/record payment/record expense/close-any-session) is equally available to
Owner. This file doesn't re-derive that content — the mechanics, field requirements, and
button labels are identical; the only difference is which branches' rows an Owner sees.

### 2.3 Reports — `app/reports/index.tsx`

The one screen that actually surfaces cross-branch oversight as a UI concept: a row of branch
chips appears whenever more than one branch is visible, and switching branches re-queries
`get_daily_revenue_summary()` for that branch alone — there is no combined, all-branches
total anywhere on this screen. An Owner checking "how did we do today" has to tap through
branches one at a time. Gross/net revenue and gross/net collected are shown;
COGS/gross-profit/margin are explicitly withheld (`BLOCKER-018`) and the screen says why
rather than omitting silently.

### 2.4 Catalog — `app/index.tsx` / `product/[id].tsx`

Read/browse only, same as every role. `products.manage` and `pricing.manage` are granted but
have no mobile screen — catalog and pricing configuration is Web's job per the workspace
split (`docs/ROLES-AND-PERMISSIONS.md` §1), and mobile correctly doesn't attempt it.

---

## 3. What Owner is specified to do on mobile and cannot, today

| Named responsibility | Status |
|---|---|
| "Receive alerts" | No alerting/notification mechanism exists in any mobile screen read for this pass. |
| High-level cross-branch dashboard (a single view of the whole organization "today") | Doesn't exist. Reports (§2.3) is per-branch, one at a time — there is no organization-rollup screen. |
| Ticket oversight ("monitor... tickets") | No ticket screen at all exists for any role except the driver's roadside shortcut — see `CASHIER-APP-SPEC.md` §2 and `MANAGER-APP-SPEC.md` §3 for the full detail; it applies identically to Owner. |
| Staff oversight ("manage staff") | `staff.manage` is granted; no screen uses it. Same gap as Branch Manager (`MANAGER-APP-SPEC.md` §3). |
| Permanently deleting a record, or archiving a ticket | **Not a build gap — a genuine permission gap.** Owner holds neither `records.permanent_delete` nor `tickets.archive` (§1). Even once the relevant screens exist, Owner specifically would not be able to use those two actions unless the grant changes. |

---

## 4. End-to-end walkthrough (today's real capability)

Mechanically identical to `MANAGER-APP-SPEC.md` §4 (open till → adjust stock → start/complete
a batch → assign/transition a delivery → record a payment → close a till), with two
differences worth naming:

1. **Reach.** Every list an Owner opens (Inventory, Production, Deliveries) is likely to span
   every branch in the org, not one — there's no branch filter to narrow it back down on any
   of those three screens.
2. **Reporting.** Reviewing "how the business did today" means visiting Reports and tapping
   through each branch chip in turn (§2.3) — there's no single number for the whole
   organization.

Everything involving tickets, staff, or driver-trip loading/reconciliation is unreachable for
the same reason it is for every other role — see `MANAGER-APP-SPEC.md` §3, which applies here
without change.

---

## 5. Specified, not built

Identical list to `MANAGER-APP-SPEC.md` §5 (ticket management, staff invite screen,
driver-trip loading-verification and reconcile/complete screens, per-Supervisor permission
configuration), plus:

| Item | Source | Status |
|---|---|---|
| Organization-wide ("all branches at once") dashboard or alerting | `docs/ROLES-AND-PERMISSIONS.md` §3 ("high-level oversight across branches," "receive alerts") | Not built. Reports is per-branch only (§2.3). |
| Branch/org management screens (create a branch, configure business-wide settings) | `docs/ROLES-AND-PERMISSIONS.md` §1 | Deliberately Web's job, not mobile's — not a gap, a workspace-split decision. |

---

## 6. A standing fact worth carrying into any new screen

Every write-capable screen in this app shows its action buttons to any signed-in user and
relies on the RPC's `insufficient_role` response as the actual gate. This affects Owner less
than most roles, since Owner's permission set is broad — but it's worth naming precisely
because it's easy to mistake "I can press this button" for "this is the role's intended
scope." The Reports screen (§2.3) is the one place role-appropriate scoping (branch access)
is genuinely enforced through what the screen shows, not just what the server allows.

---

## 7. Anti-slop standards

Same discipline as the other three role files (`DRIVER-APP-SPEC.md` §7,
`CASHIER-APP-SPEC.md` §7, `MANAGER-APP-SPEC.md` §7):

1. Don't caption a button with what it obviously does.
2. Don't pad an empty state with reassurance — name the gap, give the actionable next step.
3. Reserve confirmation dialogs for destructive actions only.
4. Never show raw server/database error text — route through a fixed `code → copy` map.
5. Say "not built" plainly rather than implying a feature exists because a permission key or
   RPC does — and say "not granted" plainly when the gap is a permission decision, not a
   missing screen (§1, §3's last row).
6. Cite the file, RPC, or doc section behind a claim.
7. No filler adjectives — "robust," "seamless," "powerful" describe nothing checkable.

---

## 8. Open questions

1. Is Owner's exclusion from `records.permanent_delete` and `tickets.archive` deliberate
   segregation of duties, or an oversight? `docs/ROLES-AND-PERMISSIONS.md` §4 leaves this
   explicitly unconfirmed — it isn't this file's place to guess either way.
2. Should mobile eventually distinguish Owner's "monitor" framing from Branch Manager's
   "execute" framing at the UI level (e.g., read-only variants of the write screens for
   Owner), or is identical mobile access across both roles the intended long-term state and
   the docs' wording just aspirational? Worth a product decision rather than inferring one
   into this screen or that.
3. Same open question as every other role file: should this app hide actions a role cannot
   perform instead of showing them and relying on the RPC to refuse?
