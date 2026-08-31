# Cashier ("Sales Person") — App Flow & Screen Specification

**Status as of 2026-08-31.** "Sales person" is not a role name in this codebase — the
canonical role is **Cashier** (`docs/ROLES-AND-PERMISSIONS.md` §2: "operational,
sales/cash-facing," rank 10). This file uses Cashier throughout; treat the two as the same
person.

Every claim below was checked against the actual screens in `bakeflow-frontend/apps/mobile/
app/` and the live permission grants in `docs/ROLES-AND-PERMISSIONS.md`, not against what the
role is supposed to do eventually. The gap between those two is the single most important
thing in this file — see §2.

---

## 1. Role facts

- Rank 10. Live permission grants: `customers.create`, `customers.update`,
  `financial.audit.submit`, `financial.view`, `reports.view`, `tickets.create`,
  `tickets.view`.
- `docs/ROLES-AND-PERMISSIONS.md` §3 describes the mobile job as "Create/manage tickets,
  process payments, open/close cash sessions, record transactions." Web is explicitly
  secondary: "Limited: view relevant tickets, sales info, cash sessions, reports. No Branch
  Manager configuration authority."
- Cash session role table (`STATE-MACHINES.md` §4): a cashier may **open** a session for
  their branch, and may **close** a session **they personally opened** (branch_manager,
  owner, admin may close any). A cashier cannot close a colleague's till.
- Cashier holds **no** `financial.expense.*` permission at all. Recording an expense is not
  part of this role today, regardless of what the Finance screen's UI shows (§3.1).

---

## 2. The gap that defines this role's current app experience

**`tickets.create` is granted. No screen in the mobile app creates a ticket for a
Cashier.** `packages/api/mutations/sales.ts` exports exactly two functions:
`createRoadsideTicket()` and `completeDriverFieldSale()` — both gated to the `driver` role
(`/driver/sell.tsx` refuses anyone whose session roles don't include `driver`, and the
catalog screen only shows the entry point, "My Trip," when `isDriver` is true). There is no
`createTicket()`, no ticket list, no ticket detail screen, and no wrapper anywhere in the
frontend for `confirm_ticket()`, `update_ticket()`, `cancel_ticket()`, or `archive_ticket()` —
all five exist as RPCs (`STATE-MACHINES.md` §1) and all five name `cashier` in their "Who"
column for at least one hop, but none has a client caller.

Per `BACKEND_ROADMAP.md`, this is accurately tracked, not silently missing: **P9.3** ("Ticket
creation") is scoped to the driver only and is complete for that scope; **P9.2** ("Customer
create/select") — the screen a general ticket-creation flow would need first — hasn't been
started. There is no "P9.3-general" row queued yet.

**What this means in practice:** a Cashier cannot originate a sale from the mobile app today.
The only mobile action against a ticket is recording a payment on one that already exists
(§3.1) — which itself presupposes the ticket was created some other way (a different client,
a migration/seed, or a future screen). Do not read the sections below as "the Cashier's
ticket workflow" — there isn't one yet. Read them as "everything a Cashier can actually press
today."

---

## 3. Live screens

### 3.1 Finance — `app/finance/index.tsx`

The one screen built around this role's actual job. Three independent panels, always
visible together (not steps in a sequence):

**Record payment**

| Element | Behaviour |
|---|---|
| Ticket picker | Up to 8 rows from `usePaymentTickets()`, pre-filtered to exclude `draft` and `cancelled`. Tap to select. |
| Amount field | Decimal input, no client-side max — "The server rejects payments above the outstanding balance" is stated directly in the panel's own copy rather than validated locally. |
| Method chips | `cash` / `card` / `transfer` / `pos`, flat row. |
| Reference field | Only rendered when method ≠ `cash`. |
| Cash warning | "Open a till before recording cash" appears, and **Record payment** disables, if the method is `cash` and no session is open. |
| **Record payment** button | Disabled while pending, while amount is empty, or while cash-without-a-till applies. |

**Open a till**

| Element | Behaviour |
|---|---|
| Opening float field | Decimal, defaults to `"0"`. |
| **Open** button | Calls `openCashSession()` against the first branch in `branchOptions`. Disabled with no branch available. |

Per `STATE-MACHINES.md` §4, a Cashier can do this — but only once per branch: the database
enforces one open session per branch via a partial unique index, not this screen.

**Record expense**

| Element | Behaviour |
|---|---|
| Category chips | One per `EXPENSE_CATEGORIES` value. |
| Amount field | Decimal input. |
| Paid-method chips | "unspecified" plus one per `EXPENSE_PAID_METHODS` value. |
| Cash warning | Same pattern as payment: a cash-method expense needs an open till; other methods do not. |
| **Record expense** button | Disabled while pending, amount empty, no branch available, or cash-without-a-till. |

**This panel is shown to every user who reaches `/finance`, Cashier included — but a Cashier
holds no `financial.expense.*` permission.** The screen does not hide it; tapping submit will
return `insufficient_role` from the server (or an equivalent rejection), same pattern as
`AdjustStockAction` and `ProductionBatchActions` on screens this role also can't fully use
(§3.2–3.4). This is not a bug specific to Cashier — it's a standing property of this codebase
(§6) — but it means a Cashier will see a working-looking form for an action they cannot
complete, with no indication in advance that it will fail.

**Open sessions list** — below the three panels: one card per session (`CashSessionCard`).
An **open** card shows a counted-amount field, an optional variance note, and **Close
session** (enabled once counted amount is filled). A **closed** card shows Expected /
Counted / Variance instead, read-only. Per §4, a Cashier's **Close session** only actually
succeeds on a session they themselves opened — the card doesn't say whose session it is
before the tap, so a Cashier can attempt to close a colleague's session and will be refused.

Money and quantity fields on this screen use raw `.message` from the thrown error
(`recordPayment.error.message`, `openSession.error.message`, etc.) rather than a fixed
`code → copy` map. This is a real inconsistency against the pattern every other write screen
in this app uses (`DeliveryActions`, `ProductionBatchActions`, `AdjustStockAction`, the driver
screens) — see §7 item 5. Don't extend this screen's current error handling; fix it toward
the established pattern instead.

### 3.2 Catalog — `app/index.tsx` / `app/product/[id].tsx`

Read-only for this role: browse products, open one to see its variants and prices. There is
no "add to sale" control anywhere in the catalog — that action doesn't exist for anyone but
the driver (§2). A Cashier uses this screen purely to look something up.

### 3.3 Inventory — `app/inventory/index.tsx` / `[warehouseId].tsx`

Read access: pick a stockroom, see quantities per ingredient/finished-good, with a Low/
Negative marker where applicable. The **Adjust** control on every row is visible regardless
of role, but `adjust_stock()` requires `owner`/`admin`/`branch_manager` for `adjustment` and
`opening_balance`, and additionally allows `baker` for `waste` — Cashier is in none of those
lists. Treat this as read-only for a Cashier; the button exists but will not work.

### 3.4 Production — `app/production/index.tsx` / `[batchId].tsx`

Read access: batch list with status filter, detail view with ingredient lines. Every hop in
`STATE-MACHINES.md` §2's "Who" column is `owner, admin, branch_manager, baker` — Cashier is
excluded from all of it. Same as inventory: the action buttons render, none of them will
succeed.

### 3.5 Deliveries — `app/delivery/index.tsx` / `[deliveryId].tsx`

Read access to the branch-wide board and detail view. One partial exception:
`STATE-MACHINES.md` §3 lists `cashier` in the "Who" column for the very first hop (— →
`pending`, i.e. a delivery coming into existence off a `fulfilment_type = 'delivery'`
ticket) — but that hop isn't a button anywhere; it's implied to happen as a side effect of a
ticket reaching that state, and no ticket-creation screen exists (§2) for a Cashier to trigger
it from. Every other hop (`pending → assigned`, `assigned → in_transit`, and the `in_transit`
exits) excludes Cashier entirely. So in practice, this screen is read-only for a Cashier too.

### 3.6 Reports — `app/reports/index.tsx`

Fully usable: `reports.view` and `financial.view` are both granted. Shows today's gross/net
revenue and gross/net collected, per branch, with a branch switcher when more than one
branch is visible. COGS/gross-profit/margin are explicitly not shown (`BLOCKER-018` — no
ingredient cost is captured anywhere yet) and the screen says so rather than omitting
silently.

---

## 4. End-to-end walkthrough (today's real capability)

1. Open app → Catalog. Browse products/prices if needed — no action taken here.
2. Finance → **Open** a till for the branch, opening float entered.
3. Some other path (not this app, today) puts a non-`draft`, non-`cancelled` ticket in front
   of the Cashier.
4. Finance → select that ticket → enter amount → pick method → **Record payment**. Repeat per
   ticket through the day.
5. End of shift: Finance → find the till session opened in step 2 → enter counted amount →
   **Close session**. If it doesn't balance, a variance note is required before closing —
   the variance is recorded, never corrected to force a match (`STATE-MACHINES.md` §4).
6. Reports → check the day's net revenue/collected figures if wanted.

Steps 1, 3 (the actual sale), 6, and the read-only visits to Inventory/Production/Deliveries
are the full extent of this role's live app today. Step 3 is the load-bearing gap (§2).

---

## 5. Specified, not built

| Item | Source | Why it isn't built |
|---|---|---|
| General ticket creation (Customer → Products → Quantities → Total) | `docs/ROLES-AND-PERMISSIONS.md` §3, `ADR-001` §8 (written for the driver but the same shape applies) | No screen, no mutation hook outside the driver's roadside path (§2). |
| Ticket list / search, and advancing an existing ticket through `confirmed → scheduled → in_production → ready → delivered → completed` | `STATE-MACHINES.md` §1 | RPCs exist server-side; nothing in `packages/api` calls them. |
| Customer search/create during a sale | `ADR-001` §7 (driver-specific, but Cashier holds the identical `customers.create`/`customers.update` grants) | Blocked on P9.2, not started for any role. |
| Daily financial audit submission (`financial.audit.submit`, granted) | Permission catalog | No screen references an audit RPC anywhere in `apps/mobile`. |

---

## 6. A standing fact this role runs into constantly

**Every write-capable screen in this app renders its buttons the same way for every signed-in
user, and lets the server's `insufficient_role` response be the actual gate.** Inventory's
Adjust button, Production's Start/Complete/Fail/Cancel buttons, and Delivery's transition
buttons all appear on a Cashier's screen exactly as they would on a Branch Manager's. None of
them checks the caller's role before rendering. This is consistent behavior across the whole
app, not a Cashier-specific bug — but it lands hardest on this role, since so much of what a
Cashier can see is, in practice, everything they cannot do. Whether the frontend should start
hiding actions a role's permission set already rules out is an open product/design question,
not something to fix unilaterally in one screen (§8).

---

## 7. Anti-slop standards

Same discipline as the driver spec (`DRIVER-APP-SPEC.md` §7) — restated here because this
file stands alone:

1. Don't caption a button with what it obviously does. "Open" on the till panel needs no
   subtitle explaining it opens a till.
2. Don't pad an empty state with reassurance ("No invoiced tickets are available" is correct;
   "Nothing here yet! 🎉" would not be).
3. Don't add a confirmation step to a routine, reversible action. Reserve confirmation for
   destructive ones.
4. Don't show raw server/database error text. This is the one place in the live app that
   currently violates its own rule (§3.1) — `error.message` is rendered directly on Finance's
   three forms. Flag it as a defect against the established pattern rather than copying it
   into new work.
5. Say "not built" plainly (§5) rather than implying a feature exists because its permission
   key does.
6. Cite the file, RPC, or doc section behind a claim. An unsourced claim about what a Cashier
   can do is exactly the kind of thing that silently goes stale.
7. No filler adjectives in copy or docs — "seamless," "powerful," "intuitive" describe
   nothing checkable.

---

## 8. Open questions

1. **Should write-only-for-other-roles buttons (Adjust, batch actions, delivery transitions)
   be hidden from a Cashier's view**, rather than shown and left to fail at the RPC? This
   affects every role's screens, not just this one, and is worth deciding once, not per
   screen.
2. **How does a ticket reach a Cashier for payment** if nothing currently creates one outside
   the driver's roadside path? Until §2's gap is closed, this role's core job is only
   reachable by a side channel this file cannot describe, because none is documented as live.
3. **Finance's error handling** (`error.message`) should probably be brought in line with the
   `code → copy` map every other write screen already uses — worth confirming as a real fix
   rather than assuming it's deliberate.
