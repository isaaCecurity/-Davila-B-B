# Admin — App Flow & Screen Specification

**Status as of 2026-08-31.** Admin sits at the organization level alongside Owner, not inside
a Branch (`docs/ROLES-AND-PERMISSIONS.md` §2's tree). Rank 2 — one below Owner, yet holding a
**broader** permission grant than Owner in two specific places (§1). Everything below was
checked against the live screens in `bakeflow-frontend/apps/mobile/app/`, the live permission
grants, and the RLS branch-access pattern — not against "assists Owner" alone, which
undersells how much this role's grant set actually authorizes.

---

## 1. Role facts

- Rank 2. Live permission grants: **everything Owner has, plus `records.permanent_delete` and
  `tickets.archive`** (`docs/ROLES-AND-PERMISSIONS.md` §4: "admin — everything owner has,
  plus records.permanent_delete and tickets.archive"). In full: `branch.manage`,
  `branch.view`, `customers.create/update/delete`, `financial.audit.confirm/submit`,
  `financial.expense.create/update/delete`, `financial.view`, `pricing.manage`,
  `products.manage`, `records.permanent_delete`, `reports.view`, `staff.manage/staff.view`,
  `tickets.archive`, `tickets.correct`, `tickets.create`, `tickets.view`.
- **This is the single broadest permission grant of any role in the system** — wider than
  Owner's own (see `OWNER-APP-SPEC.md` §1). Rank alone would suggest Admin is subordinate to
  Owner; the permission table doesn't bear that out. Don't infer capability from rank in this
  schema.
- **`branch_manager`'s live grant is identical to Admin's**, permission-for-permission
  (`docs/ROLES-AND-PERMISSIONS.md` §4). What actually distinguishes Admin from a Branch
  Manager is not the permission table but branch reach (next point) and org-tree position —
  Admin exists once per organization, not once per branch.
- **Admin bypasses branch scoping entirely, by explicit design, identical to Owner.**
  `docs/RLS-POLICY-PATTERNS.md` §"Branch access": "Owners and admins bypass branch scoping by
  design; every other role sees only assigned branches." This is implemented in
  `has_branch_access()` itself (`SECURITY DEFINER`, specifically so the bypass doesn't recurse
  through `branch_assignments`) — it is not an emergent property of Admin usually being
  assigned to every branch. An Admin sees every branch in the tenant unconditionally, on every
  screen that filters by branch access.
- `docs/ROLES-AND-PERMISSIONS.md` §3 frames the mobile job narrowly and conditionally:
  "Monitor dashboards/tickets/production/inventory/deliveries/cash **per assigned
  permissions**; perform authorized operational actions." Web adds user management,
  authorized branch/system settings, operational configuration, and dashboards/analytics/
  reports — "all permission-gated, never assumed to equal Owner." That final clause matters:
  the docs are explicit that Admin's authority is bounded by what's actually granted, not by
  an assumption that Admin ≈ Owner. In this codebase, what's actually granted (§1's first
  bullet) is in fact *wider* than Owner's on two permissions — the caution is correct in
  spirit even though the live data runs the other direction from what "assists Owner" implies.

---

## 2. Live screens

### 2.1 Full write access, same mechanics as Branch Manager

Because Admin's grant set is identical to Branch Manager's, and because every RPC role table
read for this file (`STATE-MACHINES.md` §1–§4, §6) names `admin` everywhere it names
`branch_manager`, every write path documented in `MANAGER-APP-SPEC.md` §2 applies to Admin
without modification:

- **Inventory** (`app/inventory/`) — full **Adjust** access, all three reasons (Correction,
  Waste, Opening balance).
- **Production** (`app/production/`) — full batch lifecycle: **Start batch**, **Cancel**,
  **Mark completed**, **Mark failed**.
- **Deliveries** (`app/delivery/`) — assign a driver, **Start delivery**, **Mark delivered**,
  **Could not deliver**, **Return to bakery**.
- **Finance** (`app/finance/`) — **Open** a till, **Record payment**, **Record expense**
  (any category/method), **Close session** on any session at any branch, not only
  self-opened ones (`STATE-MACHINES.md` §4's closing "Who" list includes `admin`
  unconditionally, same as Branch Manager and Owner).
- **Driver-trip loading verification and reconciliation** — `verify_trip_loading()` and
  `reconcile_driver_trip()`/`complete_driver_trip()` all name `admin` (`STATE-MACHINES.md`
  §6). No screen calls any of them yet (§4) — same gap as every other role that holds this
  authority.

This file doesn't re-derive the field requirements and button labels for each of these —
they're identical to `MANAGER-APP-SPEC.md` §2.1–2.4. The difference is scope, covered next.

### 2.2 Reach — every branch, unconditionally

Same as Owner (`OWNER-APP-SPEC.md` §2.1): Inventory, Production, and Deliveries all list rows
filtered by `has_branch_access()`, which bypasses scoping entirely for Admin (§1). There is no
branch grouping or label on any of these three screens beyond what's already in the row data,
so an Admin opening Inventory or Production sees every branch's rows merged into one flat
list, with no way to filter back down to one branch except Reports' branch switcher (§2.3).

### 2.3 Reports — `app/reports/index.tsx`

Fully usable, with the branch-chip switcher active (more than one branch will normally be
visible to this role). Same content as every other role's Reports screen: gross/net revenue,
gross/net collected, per branch, one at a time — no combined organization total exists on this
screen for anyone, Admin included.

### 2.4 Catalog — `app/index.tsx` / `product/[id].tsx`

Read/browse only. `products.manage`/`pricing.manage` are granted but unimplemented on mobile —
correctly so, per the workspace split (`docs/ROLES-AND-PERMISSIONS.md` §1): catalog and
pricing configuration belongs to Web.

---

## 3. The two permissions Admin holds that nobody else does

`records.permanent_delete` and `tickets.archive` are granted to Admin and Branch Manager only
— **not** Owner (`docs/ROLES-AND-PERMISSIONS.md` §4 flags this as surprising and leaves it
unconfirmed whether it's deliberate segregation of duties or an oversight; see
`OWNER-APP-SPEC.md` §1 for the same fact from the other side).

**Neither has a screen.** The permanent-delete flow is specified in `CLAUDE.md` rule 8 as "a
two-step hash-confirmed permanent-delete flow via `permanent_deletion_challenges`" — no such
UI exists anywhere in `apps/mobile`. Ticket archiving (`archive_ticket()`,
`STATE-MACHINES.md` §1: `cancelled → archived`, "Who: owner, admin, branch_manager" — note
Owner is actually listed as able to call this RPC despite lacking the permission grant table
entry, which is its own inconsistency worth flagging rather than resolving here) has no
caller in `packages/api` either. So today, holding these two permissions confers no actual
capability difference from Owner in practice — the gap is theoretical until either screen is
built.

---

## 4. What this role is specified to do and cannot, today

Identical gaps to `MANAGER-APP-SPEC.md` §3 and `OWNER-APP-SPEC.md` §3, since they trace to the
same missing screens rather than to anything role-specific:

| Named responsibility | Status |
|---|---|
| "Manage users" (Web) | No screen anywhere uses `packages/api/mutations/invitations.ts` (`createOrganizationInvite`/`sendInviteEmail`). |
| Ticket monitoring/management (Mobile) | No general ticket screen exists for any role — only the driver's roadside shortcut. See `CASHIER-APP-SPEC.md` §2 for full detail. |
| Driver-trip loading verification | No screen (§2.1). |
| Driver-trip reconciliation/completion | No screen (§2.1). |
| Permanent deletion, ticket archiving | Permission granted; no UI or client caller exists (§3). |
| "Authorized branch/system settings," "configure operational settings" (Web) | Out of mobile's scope by design (workspace split) — not tracked here as a mobile gap. |

---

## 5. End-to-end walkthrough (today's real capability)

Mechanically identical to `MANAGER-APP-SPEC.md` §4 — open a till, adjust stock, run a
production batch through to completion or failure, assign and progress a delivery, record a
payment, close a till, check Reports — with the same two differences Owner has:

1. **Reach.** Inventory/Production/Deliveries lists are organization-wide, not branch-scoped,
   by design (§2.2) — identical to Owner, not merely similar.
2. **Reporting.** Reports is per-branch, one tap at a time; no organization rollup exists.

Everything involving tickets, staff, permanent deletion, ticket archiving, or driver-trip
loading/reconciliation is unreachable from either app surface today (§4).

---

## 6. Specified, not built

Same list as `MANAGER-APP-SPEC.md` §5 and `OWNER-APP-SPEC.md` §5 (ticket management, staff
invite screen, driver-trip loading-verification and reconcile/complete screens,
per-Supervisor permission configuration, organization-wide dashboard/alerting), plus the two
items unique to this role:

| Item | Source | Status |
|---|---|---|
| Permanent-delete flow (`permanent_deletion_challenges`) | `CLAUDE.md` rule 8 | Not built on mobile or, as far as this pass found, anywhere in the frontend. |
| Ticket archiving | `STATE-MACHINES.md` §1 | `archive_ticket()` exists server-side; no client caller. |

---

## 7. A standing fact worth carrying into any new screen

Every write-capable screen in this app shows its action buttons to any signed-in user and
relies on the RPC's `insufficient_role` response as the actual gate — nothing in the frontend
hides an action a caller's role/permission set already rules out. This affects Admin least of
any role, since Admin's grant set is the widest in the system (§1) — but the Reports screen
remains the one place branch scoping is genuinely visible in the UI rather than only enforced
server-side.

---

## 8. Anti-slop standards

Same discipline as every other role file (`DRIVER-APP-SPEC.md` §7, `CASHIER-APP-SPEC.md` §7,
`MANAGER-APP-SPEC.md` §7, `OWNER-APP-SPEC.md` §7):

1. Don't caption a button with what it obviously does.
2. Don't pad an empty state with reassurance — name the gap, give the actionable next step.
3. Reserve confirmation dialogs for destructive actions only.
4. Never show raw server/database error text — route through a fixed `code → copy` map.
5. Say "not built" plainly rather than implying a feature exists because a permission key or
   RPC does — and say "not granted" plainly when the gap is a permission decision rather than
   a missing screen. For this role, keep a third category distinct too: "granted, but the
   grant confers nothing yet because no screen exists" (§3) is not the same claim as either of
   the other two.
6. Cite the file, RPC, or doc section behind a claim — this file leans on a specific RLS-layer
   citation (`docs/RLS-POLICY-PATTERNS.md`'s branch-access bypass) rather than inferring reach
   from rank, and that distinction is the point.
7. No filler adjectives — "robust," "seamless," "powerful" describe nothing checkable.

---

## 9. Open questions

1. **Is Admin's wider grant than Owner's (`records.permanent_delete`, `tickets.archive`)
   deliberate segregation of duties, or an oversight?** `docs/ROLES-AND-PERMISSIONS.md` §4
   raises this and leaves it open; this file inherits the same uncertainty rather than
   resolving it.
2. `STATE-MACHINES.md` §1 lists Owner in `archive_ticket()`'s "Who" column despite Owner not
   holding the `tickets.archive` permission grant per §4's own table. Is the state-machine
   table stale, or does `archive_ticket()` check something other than the `tickets.archive`
   permission key (e.g., a role check instead of a permission check)? Worth verifying against
   the live RPC body rather than assuming either document is the error.
3. Same open question as every other role file: should this app hide actions a role cannot
   perform instead of showing them and relying on the RPC to refuse?
