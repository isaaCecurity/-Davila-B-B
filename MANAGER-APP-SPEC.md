# Branch Manager — App Flow & Screen Specification

**Status as of 2026-08-31.** Canonical role name is **Branch Manager**
(`docs/ROLES-AND-PERMISSIONS.md` §2). "Manager" alone means this role — there is no separate
standalone Manager role, and any document that implies otherwise is outdated (EB-013 §3,
explicitly superseded). Everything below was checked against the live screens in
`bakeflow-frontend/apps/mobile/app/` and the live permission grants, not against the aspirational
job description alone.

---

## 1. Role facts

- Rank 3. Live permission grants are **identical to Admin's**: `branch.manage`, `branch.view`,
  `customers.create/update/delete`, `financial.audit.confirm/submit`,
  `financial.expense.create/update/delete`, `financial.view`, `pricing.manage`,
  `products.manage`, `records.permanent_delete`, `reports.view`, `staff.manage/staff.view`,
  `tickets.archive`, `tickets.correct`, `tickets.create`, `tickets.view`. The permission layer
  does not distinguish Branch Manager from Admin — `has_branch_access()` is what actually
  scopes a Branch Manager to their own branch; the grant table alone would let either role do
  the same things everywhere they have branch access.
- `docs/ROLES-AND-PERMISSIONS.md` §3: mobile is "Full operational execution for their branch:
  manage tickets, production, inventory, deliveries, cash sessions; manage staff
  operationally." Web adds branch settings/staff configuration, user registration,
  **registering Supervisors and configuring their permissions**, and analytics/reports.
- Branch Manager is the role every production/inventory/delivery RPC role table names first.
  In practice this is the most fully-served role in the live app today, and also the role
  most exposed to the gaps in §3 below, because ADR-001 names Branch Manager (alongside
  Owner/Admin/Supervisor) as the one who verifies driver-trip loading and reconciles trips —
  neither of which has a screen yet.

---

## 2. Live screens — full write access

Unlike Cashier or Supervisor, a Branch Manager's role is actually named in the "Who" column
for nearly every write path that exists in the mobile app today. This section lists what that
means concretely, screen by screen.

### 2.1 Inventory — `app/inventory/index.tsx` / `[warehouseId].tsx`

Full access to **Adjust** on every stock row (`AdjustStockAction`). All three reasons —
**Correction**, **Waste**, **Opening balance** — are available; `adjust_stock()` grants
`adjustment`/`opening_balance` to `owner`/`admin`/`branch_manager` and additionally allows
`baker` for `waste` alone. The field is a target quantity, not a delta — pre-filled with the
current value so editing it reads as "correct this number," matching what the RPC actually
does.

### 2.2 Production — `app/production/index.tsx` / `[batchId].tsx`

Every hop in `STATE-MACHINES.md` §2 names `owner, admin, branch_manager, baker`. From
`ProductionBatchActions`:

| From | Buttons | Needs |
|---|---|---|
| `scheduled` | **Start batch** (primary), **Cancel** (secondary) | — |
| `in_progress` | **Mark completed** (primary), **Mark failed** (secondary) | completed → whole-batch actual quantity; failed → non-blank reason |

`completed`/`failed`/`cancelled` show a "Finished" card and no buttons — all three are
terminal. Note what this screen does **not** collect: per-ingredient actuals or waste. Every
ingredient line defaults to its planned quantity on completion (waste 0) or to "fully used"
on failure (waste = actual). Correcting one ingredient's real usage needs a line-item form
that doesn't exist yet.

### 2.3 Deliveries — `app/delivery/index.tsx` / `[deliveryId].tsx`

Branch Manager is named for every hop in `STATE-MACHINES.md` §3 except the driver-only
requirement that `driver_id = auth.uid()` on the delivery's own row (which doesn't apply to a
manager acting as manager):

| From | Buttons | Notes |
|---|---|---|
| `pending` | Driver picker → **Assign a driver** | `pending → assigned` names `owner, admin, branch_manager` — Branch Manager can assign here even though a Cashier or Supervisor created the pending row. |
| `assigned` | **Start delivery** | Also usable by the assigned driver. |
| `in_transit` | **Mark delivered** (needs recipient name), **Could not deliver** (needs reason), **Return to bakery** | |
| `failed` | **Return to bakery** | |

This is the one write surface where Branch Manager's authority is explicitly **concurrent**
with the driver's, not exclusive to management — both can drive the same delivery forward.

### 2.4 Finance — `app/finance/index.tsx`

Full use of all three panels: **Open** a till for the branch, **Record payment** against any
eligible ticket, **Record expense** in any category/method (`financial.expense.create` is
granted). Branch Manager may also **close** any session at their branch, not only ones they
personally opened (`STATE-MACHINES.md` §4 — the closing "Who" list is "the opening cashier,
branch_manager, owner, admin").

### 2.5 Reports — `app/reports/index.tsx`

Fully usable, same as every role holding `reports.view` + `financial.view`. Branch selector
appears when more than one branch is visible to this account; for a Branch Manager scoped to
one branch, that's usually a non-issue.

### 2.6 Catalog — `app/index.tsx` / `product/[id].tsx`

Read/browse only — there's no product-editing screen in mobile despite `products.manage` and
`pricing.manage` being granted. That's consistent with the workspace split
(`docs/ROLES-AND-PERMISSIONS.md` §1): catalog/pricing configuration is Web's job, not
mobile's, and no mobile screen claims otherwise.

---

## 3. What this role is specified to do and cannot, today

These are real gaps against `docs/ROLES-AND-PERMISSIONS.md` §3's own description of the
Branch Manager's mobile job — not omissions this file is inventing:

| Named responsibility | Screen/RPC status |
|---|---|
| "Manage tickets" | **No screen.** `packages/api/mutations/sales.ts` only exports `createRoadsideTicket()`/`completeDriverFieldSale()`, both driver-gated. `confirm_ticket()`, `update_ticket()`, `cancel_ticket()`, `archive_ticket()` all name `branch_manager` in `STATE-MACHINES.md` §1's "Who" column and have zero client callers. A Branch Manager cannot create, confirm, schedule, cancel, or archive a ticket from the app today. |
| "Manage staff operationally" | **No screen.** `packages/api/mutations/invitations.ts` has `createOrganizationInvite()`/`sendInviteEmail()`, unused by any screen in `apps/mobile`. `staff.manage` is granted with nothing built against it. |
| Driver-trip loading verification (`verify_trip_loading()` — `owner, admin, branch_manager, supervisor, baker`) | **No screen.** `driver/home.tsx`'s own header names this explicitly as not-yet-built management-side work; the driver's screen just shows a passive "Waiting for loading" card while it's absent. |
| Driver-trip reconciliation and completion (`reconcile_driver_trip()`, `complete_driver_trip()` — both name `branch_manager`) | **No screen.** Same gap; the driver's Home screen shows "Reconciled — a manager still needs to close this trip out" with nothing on the manager side to act on it. |

A Branch Manager today is, functionally, the role with the widest write access to the screens
that exist (§2) and the role most blocked by the screens that don't (this table). Both facts
matter for the same reason: this app's inventory/production/delivery/cash slices are more
complete than its ticket and staff/driver-trip-oversight slices.

---

## 4. End-to-end walkthrough (today's real capability)

1. **Morning** — Finance: **Open** a till for the branch if none is open yet.
2. **Stock arrives** — Inventory: pick the stockroom, **Adjust** an ingredient's quantity with
   reason **Opening balance** or **Correction**.
3. **A batch is due** — Production: open a `scheduled` batch, **Start batch**.
4. **Batch finishes** — **Mark completed** with the actual yield, or **Mark failed** with a
   reason if it didn't work out. Either way, ingredient consumption is recorded atomically by
   the RPC, not assembled from separate calls.
5. **A delivery needs a driver** — Deliveries board → open a `pending` row → **Assign a
   driver**. Later, if the assigned driver hasn't started it, the manager can also tap
   **Start delivery**, **Mark delivered**, **Could not deliver**, or **Return to bakery**
   directly.
6. **A customer pays** — Finance: **Record payment** against their ticket (assuming the
   ticket exists via some path outside this app — §3).
7. **End of day** — Finance: **Close session** on the branch's till (any till at the branch,
   not just self-opened ones), entering counted amount and a variance note if it doesn't
   balance. Reports: check the day's net revenue/collected.

Steps 6's precondition and anything involving tickets, staff, or driver-trip
loading/reconciliation (§3) are not reachable from this app yet.

---

## 5. Specified, not built

| Item | Source | Status |
|---|---|---|
| Ticket management (create/confirm/schedule/cancel/archive) | `docs/ROLES-AND-PERMISSIONS.md` §3, `STATE-MACHINES.md` §1 | No screen, no mutation hooks (§3). |
| Staff invite/management screen | `docs/ROLES-AND-PERMISSIONS.md` §3, `packages/api/mutations/invitations.ts` | Backend function exists; unused by any screen. |
| Driver-trip loading-verification screen | ADR-001, `driver/home.tsx` header comment | Not built. |
| Driver-trip reconcile/complete screen | ADR-001, `driver/home.tsx` header comment | Not built. |
| Per-Supervisor permission configuration ("register Supervisors and configure their permissions") | `docs/ROLES-AND-PERMISSIONS.md` §3, §4 | Not buildable yet even on Web — `role_permissions` is role-level only; there is no per-user override table. See `SUPERVISOR-APP-SPEC.md` §1. |

---

## 6. A standing fact worth carrying into any new screen

Every write-capable screen in this app shows its action buttons to any signed-in user and
lets the RPC's `insufficient_role` response be the actual gate — nothing in the frontend
hides an action a caller's role/permission set already rules out. For a Branch Manager this
rarely bites (§2's coverage is wide), but it's the same mechanism a Cashier or Supervisor runs
into constantly (see `CASHIER-APP-SPEC.md` §6, `SUPERVISOR-APP-SPEC.md` §6). Worth knowing
before assuming a button's mere presence means the current user can use it.

---

## 7. Anti-slop standards

Same discipline as `DRIVER-APP-SPEC.md` §7 and `CASHIER-APP-SPEC.md` §7:

1. Don't caption a button with what it obviously does.
2. Don't pad an empty state with reassurance — name the gap, give the one actionable next
   step.
3. Reserve confirmation dialogs for destructive actions only; don't add one to a routine step.
4. Never show raw server/database error text — route every error through a fixed
   `code → copy` map, as `DeliveryActions`/`ProductionBatchActions`/`AdjustStockAction` all do
   (Finance's screen currently doesn't — see `CASHIER-APP-SPEC.md` §3.1, item 4 there).
5. Say "not built" plainly rather than implying a feature exists because its permission key or
   RPC does.
6. Cite the file, RPC, or doc section behind a claim.
7. No filler adjectives — "robust," "seamless," "powerful" describe nothing checkable.

---

## 8. Open questions

1. Who actually verifies driver-trip loading and reconciles trips today, given that
   `verify_trip_loading()`/`reconcile_driver_trip()`/`complete_driver_trip()` all name
   Branch Manager but no screen calls any of them? Until a screen exists, a Branch Manager
   cannot fulfil this named responsibility from either app surface.
2. Should ticket management land on mobile (matching "mobile is the operational workspace")
   or is a ticket-management screen intentionally deferred behind P9.2 (customer create/
   select)? `BACKEND_ROADMAP.md` doesn't currently have a general (non-driver) ticket-creation
   row queued — worth confirming that's deliberate sequencing and not a dropped item.
3. Same open question as the Cashier and Supervisor files: should this app start hiding
   actions a role cannot perform, rather than showing them and relying on the RPC to refuse?
