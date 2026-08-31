# Supervisor — App Flow & Screen Specification

**Status as of 2026-08-31.** Supervisor is the one canonical role that is **optional and
configurable** (`docs/ROLES-AND-PERMISSIONS.md` §2, rank 4) — not every bakery has one, and
there is no single fixed Supervisor permission set. This file describes the **live default**
grant and what it actually authorizes in the current app, distinct from the **product-level
intent** the docs describe — the two disagree in ways worth being precise about (§1–§2).

---

## 1. Role facts

- Rank 4. A Branch Manager enables the Supervisor function, registers Supervisors, and — in
  principle — assigns each one a permission set from the function catalog. **The per-
  Supervisor override mechanism does not exist yet.** `role_permissions` is role-level only
  (`docs/ROLES-AND-PERMISSIONS.md` §4: "today every Supervisor in every bakery has the same
  set"). Any doc or screen that implies a Branch Manager can currently customize one
  Supervisor's access differently from another's is describing intent, not a built
  capability.
- **Live default grant:** `branch.view`, `customers.create/update`, `financial.audit.submit`,
  `financial.expense.create/update` (no `delete`), `financial.view`, `reports.view`,
  `staff.view` (not `staff.manage`), `tickets.correct/create/view`. No `records.
  permanent_delete`, no `tickets.archive`, no `products.manage`, no `pricing.manage`.
- **The product-level intent table** (`docs/ROLES-AND-PERMISSIONS.md` §4) separately
  describes defaults for functions with no permission key behind them yet: "Tickets —
  monitor/manage," "Production — coordinate," "Inventory — monitor," "Deliveries —
  coordinate" are all listed "On" by default, and "Cash — view only (not open/close)" is
  listed on for viewing, off for custody. **The permission catalog has no keys for
  production, inventory, or deliveries at all** — the doc itself calls this "outstanding
  work." Practically: nothing in the live grant list authorizes any production, inventory, or
  delivery action, regardless of what the intent table says a Supervisor should be able to
  coordinate.
- One place Supervisor genuinely does get a real, specific write role, found directly in
  `STATE-MACHINES.md` §6, not in the permission catalog: `verify_trip_loading()`
  (`created → loading → ready_to_depart`) names `owner, admin, branch_manager, supervisor,
  baker`, and `reconcile_driver_trip()` (`returning → reconciled`) names `owner, admin,
  branch_manager, supervisor`. Both are driver-trip RPCs, gated independently of the
  `permissions` table. Neither has a mobile screen yet (§4) — so this is a real authority with
  no way to exercise it today.

---

## 2. What the live grant actually authorizes, screen by screen

Because production/inventory/delivery have no permission keys, and because the generic RPC
role checks for those domains name specific roles rather than a permission key (§3 of
`MANAGER-APP-SPEC.md`), a Supervisor is excluded from essentially every write action on those
three screens — not by a Supervisor-specific rule, but because `owner, admin, branch_manager
(, baker or the assigned driver where relevant)` simply doesn't include `supervisor` anywhere
in `STATE-MACHINES.md` §2 or §3's "Who" columns.

| Screen | Read | Write |
|---|---|---|
| Inventory (`app/inventory/`) | Yes — `branch.view` covers seeing warehouses; stock levels are visible to anyone with branch access. | **No.** `adjust_stock()` accepts `owner/admin/branch_manager` for `adjustment`/`opening_balance`, plus `baker` for `waste`. Supervisor is in none of these. The **Adjust** button renders anyway (§6) and will be refused. |
| Production (`app/production/`) | Yes. | **No.** Every hop in §2's table is `owner, admin, branch_manager, baker`. |
| Deliveries (`app/delivery/`) | Yes. | **No.** Every hop names `owner, admin, branch_manager`, plus the assigned driver where applicable. |
| Finance (`app/finance/`) | Yes (`financial.view`). | **Partial.** `financial.expense.create`/`update` are granted — a Supervisor can record a **non-cash** expense (cash-method expenses need an open till, and Supervisor cannot open one — see next row). No `financial.expense.delete`. Payment-recording and till-opening role requirements aren't documented in the RPC-level tables read for this file; treat both as unconfirmed rather than assumed (§8). |
| Cash session open/close | — | **No.** `STATE-MACHINES.md` §4's opening "Who" is `cashier, branch_manager, owner, admin` — Supervisor is absent. A Supervisor cannot open a till, and therefore cannot record a cash-method expense either, matching the intent table's own "Cash — view only" line. |
| Reports (`app/reports/`) | Yes — `reports.view` + `financial.view` both granted. | N/A, read-only screen for everyone. |
| Catalog (`app/index.tsx`, `product/[id].tsx`) | Yes, same as every role. | N/A. |

**Net effect:** a Supervisor's live mobile app is, in practice, almost entirely read-only —
Inventory, Production, and Deliveries render exactly as they do for a Cashier (see
`CASHIER-APP-SPEC.md` §3.2–3.5), despite the product-level intent describing this role as
coordinating all three. The one real write lever (non-cash expense recording) is narrow and
easy to miss next to how much of the rest of the UI looks actionable but isn't.

---

## 3. The general ticket gap applies here too

Same as every other role: `tickets.create`/`tickets.correct`/`tickets.view` are granted, but
no screen in the mobile app creates, confirms, schedules, or otherwise advances a general
ticket — only the driver's roadside shortcut exists, and it's gated to the `driver` role
specifically. See `CASHIER-APP-SPEC.md` §2 for the full detail; it applies to Supervisor
without modification.

---

## 4. Driver-trip authority with no screen behind it

`verify_trip_loading()` and `reconcile_driver_trip()` both name `supervisor` (§1) — a real,
specific grant, not shared with Cashier or Baker. But as documented in `driver/home.tsx`'s own
header and `MANAGER-APP-SPEC.md` §3, **no screen calls either RPC yet**. The driver's Home
screen shows passive "Waiting for loading" / "Waiting for reconciliation" cards while these
are pending, with nothing on any other role's side to act on them. A Supervisor holding this
authority today has no way to exercise it from either app surface.

---

## 5. End-to-end walkthrough (today's real capability)

1. Open app → Catalog, Inventory, Production, or Deliveries to look something up — all
   read-only for this role.
2. Finance → **Record expense**, non-cash method only (no open till available to this role).
3. Reports → check the day's revenue/collected figures.

That's the complete list of things a Supervisor can actually accomplish in the live mobile
app today, beyond browsing. Everything else visible on screen (Adjust, batch actions,
delivery transitions, till open/close, cash-method expense) will render normally and then be
refused by the server.

---

## 6. A standing fact this role runs into more than any other

Every write-capable screen in this app shows its action buttons to any signed-in user and
lets the RPC's `insufficient_role` response be the actual gate — nothing hides a control a
caller's role/permission set already rules out. Of every role this file set covers, Supervisor
is the one for whom this matters most: the intent table (§1) describes a "coordinate
production/inventory/deliveries" job, the screens make coordinating look possible, and the
grant behind them says otherwise for all three. Whether the frontend should start hiding
actions a role cannot perform is a live open question across every role file
(`CASHIER-APP-SPEC.md` §8, `MANAGER-APP-SPEC.md` §8, `OWNER-APP-SPEC.md` §8) — it would matter
more here than anywhere else, since right now a Supervisor's screen and a Branch Manager's
screen are visually identical while their actual capability is not.

---

## 7. Specified, not built

| Item | Source | Status |
|---|---|---|
| Production/inventory/delivery permission keys | `docs/ROLES-AND-PERMISSIONS.md` §4 | Catalog has none yet — the doc calls this outstanding work. Until they exist, "Supervisor coordinates production" has nothing to bind to even in principle. |
| Per-Supervisor permission override (vs. role-level) | `docs/ROLES-AND-PERMISSIONS.md` §4 | Not built — `role_permissions` is role-level only. |
| Driver-trip loading-verification screen | `STATE-MACHINES.md` §6, `driver/home.tsx` header | Not built (shared gap with Owner/Admin/Branch Manager/Baker). |
| Driver-trip reconciliation screen | `STATE-MACHINES.md` §6, `driver/home.tsx` header | Not built (shared gap with Owner/Admin/Branch Manager). |
| General ticket management | `STATE-MACHINES.md` §1 | Not built for any role except the driver's roadside shortcut (§3). |

---

## 8. Anti-slop standards

Same discipline as the other three role files:

1. Don't caption a button with what it obviously does.
2. Don't pad an empty state with reassurance — name the gap, give the actionable next step.
3. Reserve confirmation dialogs for destructive actions only.
4. Never show raw server/database error text — route through a fixed `code → copy` map.
5. Say "not built" plainly, and say "not granted" plainly when the gap is a permission
   decision rather than a missing screen — §2's table depends on keeping those two causes
   distinct, since for this role they overlap almost everywhere.
6. Cite the file, RPC, or doc section behind a claim — this file in particular leans on
   negative claims ("Supervisor is in none of these lists"), which are exactly the kind of
   thing that needs a source, not an inference.
7. No filler adjectives — "robust," "seamless," "powerful" describe nothing checkable.

---

## 9. Open questions

1. **Payment-recording and till-opening role requirements** aren't pinned down anywhere this
   file could verify beyond the cash-session table itself (which excludes Supervisor from
   opening). Whether `record_payment()` has its own separate role gate that includes or
   excludes Supervisor is unconfirmed — don't assume either way without checking the live RPC.
2. When (if ever) will production/inventory/delivery permission keys be added to the catalog,
   so the "coordinate" defaults in `docs/ROLES-AND-PERMISSIONS.md` §4 have something to bind
   to? Until then, treat that table's "On" defaults as intent, not behavior.
3. Same open question as every other role file: should this app hide actions a role cannot
   perform instead of showing them and relying on the RPC to refuse? Answering it would
   change this file's §2 table from "renders but fails" to "doesn't render at all" for most
   rows.
