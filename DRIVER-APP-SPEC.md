# Driver — App Flow & Screen Specification

**Status as of 2026-08-31.** Everything under "Live" below was read from the actual code in
`bakeflow-frontend/apps/mobile/app/driver/` and `app/delivery/`, not from a plan. Everything
under "Specified, not built" is transcribed from `docs/ADR-001-Driver-Workflow-Redesign-MVP.md`
and has no screen yet — do not assume it exists because it's documented. Where the docs
disagree with each other, that's called out instead of silently picked (§9).

The Driver role touches **two separate state machines**, not one:

1. **Delivery fulfilment** — a `deliveries` row tied to a ticket with `fulfilment_type =
   'delivery'`. Pre-existing, `STATE-MACHINES.md` §3.
2. **Driver Trip** — the custody/roadside-sale wrapper added by ADR-001, `driver_trips`.
   `STATE-MACHINES.md` §6.

A trip does not replace the delivery gate (AD-019): a trip-linked delivery ticket still
requires its `deliveries` row to reach `delivered` on its own before the ticket can. Treat
these as two things the same person operates, not one merged concept.

---

## 1. Role facts that constrain every screen below

- Rank 11 (lowest), permission grants: `customers.create`, `customers.update`,
  `tickets.correct`, `tickets.create`, `tickets.view` (`docs/ROLES-AND-PERMISSIONS.md` §"Live
  grants by role"). No `tickets.update` — nobody has it; a submitted ticket is immutable by
  design, not by omission.
- Mobile is the driver's **only** real workspace. Web gives "limited or none" (§3 of the same
  doc). Don't design a driver web screen and call it parity.
- `driver_trips` has **no** direct `INSERT`/`UPDATE`/`DELETE` grant for `authenticated` — every
  state change is a `SECURITY DEFINER` RPC. There is no client bypass to guard against because
  there is no direct-write path at all.
- `deliveries` has `INSERT, SELECT` only — no `UPDATE`. Every transition goes through
  `transition_delivery()`. A driver may only transition a delivery where `driver_id =
  auth.uid()`; enforced in the RPC, not just hidden in the UI.
- One active (non-`completed`) trip per driver, enforced by a partial unique index — not
  application logic. A driver cannot start a second trip while one is open, and the UI should
  not pretend otherwise.
- The seven `driver_trips` states (`created → loading → ready_to_depart → in_transit →
  returning → reconciled → completed`) are backend vocabulary. **No driver screen may render
  one of these words.** The only sanctioned translation is `driverTripPhase()` /
  `driverTripPhaseLabel()` in `@bakeflow/types` (`packages/types/driver-trip.ts`), which
  collapses them to: Waiting for loading → Loading → On the road → Returning → Reconciling →
  Trip complete.

---

## 2. Navigation — two specs, not yet reconciled

**`docs/DESIGN-TOKENS.md` §6** (canonical for visual tokens): driver's bottom tabs are
**Today / Deliveries / More** — three of the app's six tabs, role-filtered.

**`docs/ADR-001-Driver-Workflow-Redesign-MVP.md` §14** (approved, driver-workflow-specific):
**Home / Routes / Create Ticket / Tickets / More** — five items, no "Deliveries" tab at all;
delivery-fulfilment work is implied to live inside Routes/Tickets instead.

These do not describe the same tab bar and neither has been amended to match the other. This
is a live contradiction per `CLAUDE.md`'s own rule ("when you hit a spec contradiction, stop
and surface it") — it is flagged here, not resolved, because resolving it is a product call
(does "Deliveries" survive as a driver tab, or does ADR-001's Routes/Tickets split supersede
it?). Raise it before wiring a driver tab bar; the answer changes what "Deliveries" in §4.3–4.4
below means going forward.

**What is actually navigable today**, regardless of tab bar: `/driver/home`, `/driver/sell`,
`/delivery`, `/delivery/[deliveryId]`. No tab-bar component filtering by role has been
confirmed wired for the driver role specifically — the routes exist as screens, reached today
by direct path.

---

## 3. Live screens

### 3.1 Driver Home — `app/driver/home.tsx`

The one screen ADR-001 names first, and the one this app treats as ground truth for "what do I
do right now." Never shows a raw trip status — only the phase label.

**No active trip:**

| Element | Behaviour |
|---|---|
| Vehicle list | One row per warehouse (`useWarehouses`). Tap to select — no multi-select. |
| Empty state | "No vehicle set up" / "Ask a manager to add a warehouse for your vehicle before you can start a trip." — no button, because there is nothing this screen can do about it. |
| **Start trip** (primary) | Disabled until a vehicle is picked. Calls `start_driver_trip()`. Spinner replaces nothing — it sits inline in the button, label stays "Start trip." |

**Active trip, by phase** (one primary control per phase, never more than one at a time):

| Phase | What's shown | Button |
|---|---|---|
| Waiting for loading | Passive card: "A supervisor, manager, or baker needs to verify what's going in the vehicle before you can go." | none |
| Loading | Passive card: "Verification is in progress." | none |
| Loading *(verified, `ready_to_depart`)* | "Loaded and verified" / "You're clear to leave the bakery." | **Go** (primary) → `depart_driver_trip()` |
| On the road | "Sell from the truck and record what customers hand over." | **Sell** (primary) → navigates to `/driver/sell` |
| On the road (same screen, second card) | "If you sold everything, return the trip with nothing left over. Returning specific items isn't built yet — ask a manager if you're bringing stock back." | **Return trip (nothing left)** (secondary) → `return_driver_trip({ items: [] })` |
| Returning | Passive: "A manager will check your returned cash and stock against what you took out." | none |
| Reconciling | Passive: "Reconciled — a manager still needs to close this trip out and settle your cash into the till." | none |

Every mutation on this screen uses one fixed error-code map (`describeError`), never the raw
server string. Unmapped codes fall back to "That did not work. Nothing has been changed." —
never a stack trace, never the Postgres message.

### 3.2 Sell — `app/driver/sell.tsx`

Reachable only when the current trip's status is exactly `in_transit`; anything else shows "No
trip on the road / You can only sell while a trip is in transit," no button.

Flow, in order — matches ADR-001 §8 with one deliberate gap (no customer step, see below):

1. **Browse** — product list → tap a product → its variants. Back control is `← Product name`,
   not a generic "Back."
2. **Add to cart** — per variant: quantity input (decimal pad, `\d{1,14}(\.\d{1,4})?` shape,
   `0` rejected) + **Add to cart** / **Update in cart** (label changes if already in cart; same
   button, no separate "edit" control).
3. **Cart bar** (only rendered once non-empty) — one row per line: name, qty × unit price,
   **Remove**. Footer: **Sell** (primary). No running total is computed or shown — money is an
   exact decimal string and summing it needs a decimal library this package doesn't carry;
   the driver, holding physical cash, is the one who adds it up, same as at any till without a
   calculator.
4. **Sell** creates a `draft` roadside ticket, then immediately completes it straight to
   `completed` via `complete_driver_field_sale()` (AD-020 — skips the seven-hop production
   lifecycle because this stock is already loaded and already sold). Two server calls,
   sequenced, both must succeed before advancing.
5. **Record payment** — amount (decimal input) + method chips (**Cash / Transfer / POS /
   Card** — flat row, no dropdown). **Save payment** disabled until amount is a valid non-zero
   number.
6. **Sale complete** — "The ticket, stock, and payment are all recorded." + **Sell again**
   (resets to step 1, cart cleared).

**No customer selection anywhere in this flow.** Every ticket created here is
`sale_customer_type: 'ROADSIDE'`, `customer_id: null`. ADR-001 §7 specifies a customer
search/create step ahead of product selection; it is not built because the customer
create/select frontend (P9.2) itself isn't started yet, per `BACKEND_ROADMAP.md`. Don't add a
customer step to this screen in isolation — it depends on P9.2 landing first.

### 3.3 Deliveries board — `app/delivery/index.tsx`

Read-only. There is no assign/dispatch/mark-delivered control on this screen, and this is not
an oversight — the write grant doesn't exist for it (§1), so a mutation here would be refused
by PostgREST before it even reached application logic.

| Element | Behaviour |
|---|---|
| Filter chips | **Open** (default, includes `failed` — a failed delivery still owes a `returned` hop, so hiding it would hide exactly the row someone has to chase), **All**, then one chip per status. Selecting an explicit status overrides Open/All rather than intersecting with it. |
| Row | Address line (leads — this is read while deciding where a van goes next, not while looking up an order), status badge, ticket number (or "Ticket unavailable" if the linked ticket isn't visible to this caller — a real state, not a loading glitch), "No driver yet" marker when unassigned. |
| Tap a row | → `/delivery/[deliveryId]` |
| Header button | **Catalog** — back to the product catalog, not delivery-specific. |

Because `deliveries` follows the standard branch-access RLS pattern (`docs/RLS-POLICY-
PATTERNS.md` §"Branch access"), this board is **branch-wide**, not filtered to the signed-in
driver's own deliveries — a driver sees every delivery their branch access covers, matching
DESIGN-TOKENS' "Deliveries" tab framing of it as a shared board.

### 3.4 Delivery detail — `app/delivery/[deliveryId].tsx`

Header: address, status badge, ticket number. Below it, `DeliveryActions` renders exactly the
hops legal from the current status — transcribed straight from `guard_delivery_transition()`,
re-verified by the trigger on every tap regardless of what the screen offered:

| From | Buttons offered | Needs before enabled |
|---|---|---|
| `pending` | Driver picker (assign) | a driver selected |
| `assigned` | **Start delivery** (primary) | — |
| `in_transit` | **Mark delivered** (primary), **Could not deliver** (secondary), **Return to bakery** (secondary) | delivered → recipient name non-blank; could-not-deliver → reason non-blank |
| `failed` | **Return to bakery** (primary) | — |
| `delivered` / `returned` | none — "Finished" card | — |

Tapping a button that needs a field opens that field inline (never a modal) and the button
label gains a trailing "…" until the field is filled; **Cancel** appears only while a form is
open. Below the actions: a fixed key/value panel (Contact, Driver, Scheduled, Dispatched,
Delivered — nulls render as `—`, never a sentence), and a Proof of Delivery panel that shows
whichever of recipient name / proof photo was actually recorded — the standing `CHECK`
requires at least one, not both, so the screen never implies both were captured.

A `failed` delivery gets one extra amber panel showing the failure reason plus "A failed
delivery is not finished. The goods are still out until it is returned." — text, not a status
word, because `failed` looks terminal and isn't.

---

## 4. Specified, not built

Everything here is real product intent from ADR-001, with no screen behind it yet. Do not
build against these as if they exist; do not skip them silently either — they're load-bearing
for the full driver story the user asked about.

| Item | Source | Why it isn't built |
|---|---|---|
| **Today's Route** list — flat "Customer — ₦amount" rows, tap to open a ticket, no assignment-state UI | ADR-001 §5 | No route/ticket-list screen exists in `app/driver/` yet. |
| **Create Ticket** as its own nav entry with Customer → Products → Payment sequence | ADR-001 §14 | Sell (§3.2) covers products/payment; the customer step is blocked on P9.2. |
| **Tickets** tab — search/view tickets created by or assigned to the driver | ADR-001 §14 | Not started. |
| **Partial return** — returning specific unsold items, not "everything" | ADR-001 §11, §15 rule "not yet built" note in `driver/home.tsx` | Return entity/table intentionally left open at approval time ("the exact return entity/table can be decided during implementation"); `driver/home.tsx` only covers the all-sold case. |
| **Offline queueing** for ticket/customer/payment/trip-event writes | ADR-001 §16 | Not implemented. Every driver mutation today requires a live connection; treat "works offline" as false until this lands. |
| Loading-verification screen (supervisor/manager/baker side) and reconcile/complete screen (manager side) | ADR-001, `IMPLEMENTATION_LOG.md` 2026-08-25 | Not driver-facing, but the driver is blocked behind both — Home just shows a passive card while they're missing. |

---

## 5. End-to-end walkthrough

A driver's day, both paths, in the order a driver actually experiences them:

1. **Open app → Driver Home.** No active trip → pick a vehicle (warehouse) → **Start trip**
   (`created`).
2. **Wait.** A supervisor/manager/baker calls `verify_trip_loading()` off-screen for this
   driver — one atomic call that both records what was loaded and verifies it
   (`loading → ready_to_depart` happens inside that single RPC, never as two driver-visible
   steps). Home shows "Waiting for loading," no button.
3. **Go.** Home now shows "Loaded and verified" → driver taps **Go** →
   `depart_driver_trip()` → `in_transit`.
4. **Sell, repeatedly.** From Home, **Sell** → cart → **Sell** (creates + completes the
   roadside ticket) → **Save payment**. Repeats per customer stop. In parallel, if the driver
   also holds an **assigned delivery** (a separate `deliveries` row from a manager-created
   ticket), they work it from the Deliveries board (§3.3–3.4): **Start delivery** →
   **Mark delivered** (with recipient name or photo) or **Could not deliver** (with reason) →
   if failed, **Return to bakery** later. These two flows run independently and use different
   screens; a driver may be mid-trip and mid-delivery at the same time.
5. **Return to bakery.** Once selling is done, Home's second card: **Return trip (nothing
   left)** → `return_driver_trip()` → `returning`. (Partial returns aren't built — §4.)
6. **Reconciliation — not driver-facing.** A manager/supervisor calls `reconcile_driver_trip()`
   (expected cash computed from the trip's own payments, compared against what the driver
   physically hands back; a `variance_note` is required if they don't match) then
   `complete_driver_trip()` to settle that cash into an open branch till session. Home shows
   "Waiting for reconciliation," then "Reconciled," with no driver action either time.
7. **Done.** Trip is `completed` — terminal, never reopened, never deletable
   (`prevent_driver_trip_delete()` raises unconditionally).

Cash the driver is holding during step 4–5 is **never** counted in the branch till's expected
cash — it only enters the till at step 6, through the branch session's own ordinary cash-in
mechanism (AD-018). Don't build any driver screen that implies otherwise (e.g. a running "till
total" that includes trip cash before reconciliation).

---

## 6. Interaction rules already in force

From `docs/ADR-001-Driver-Workflow-Redesign-MVP.md` §15 and `docs/DESIGN-TOKENS.md` §5–7 —
apply these to anything new on a driver screen, don't re-derive them per screen:

- One obvious primary action per screen. If two feel primary, one of them is secondary and
  should look it (border, not fill).
- Verb-first button labels, 1–3 words: "Go," "Sell," "Mark delivered." Never "Submit," "OK,"
  or "Click here."
- Minimize typing; remember frequent selections where the data supports it (e.g. the last-used
  payment method — not currently implemented, would be a legitimate addition).
- 48pt minimum touch target on every interactive element, including icon-only ones — this app
  is used with floury hands.
- Never require the driver to compute credit, totals, or variance by hand from raw numbers the
  system already has (cart subtotal is the one deliberate exception, and only because of the
  decimal-precision constraint in §3.2 — not a UX default to reuse elsewhere).
- Never surface a raw backend status word. Only `driverTripPhaseLabel()` / the fixed
  `DeliveryStatus` labels reach the screen.
- Skip confirmation dialogs for routine, reversible steps (Go, Sell, Save payment). Reserve a
  confirmation step for destructive actions only (per DESIGN-TOKENS §5, destructive buttons are
  "always behind a confirmation") — these are not the same rule and don't trade off against
  each other; "avoid unnecessary confirmations" and "destructive needs one" both hold at once.
- Every error is rendered through a fixed `code → copy` map (`describeError` /
  `describeSaleError` / `describe`). The server's own message text is never shown. An unmapped
  code gets neutral fallback copy, not a raw string.
- Every empty state names the actual space and gives a verb-first way out ("No vehicle set
  up" + explanation, not "Nothing here yet").

---

## 7. Anti-slop standards

These are the rules that keep both the UI copy and any documentation about it from turning
into padded, AI-generated-sounding filler. They're not new — they're the pattern already
followed in every screen and doc read while writing this file — made explicit so nobody has to
reverse-engineer it from example next time.

**In the app:**

1. Don't explain what a button obviously does. "Sell" needs no caption underneath it; a
   caption is a symptom of a label that isn't doing its job.
2. Don't add a subtitle to a control whose label is already unambiguous. The payment-method
   chips (Cash / Transfer / POS / Card) get no description line each — the word is the whole
   spec.
3. Don't pad an empty state with reassurance. "Nothing here yet 🎉" is banned by
   DESIGN-TOKENS §7 rule 8 for a reason: it says nothing the driver can act on. Name the gap,
   give the one thing that fixes it, stop.
4. Don't invent a confirmation step, a tooltip, or a help sheet for something the interaction
   itself already makes clear (§6, "avoid unnecessary confirmation dialogs"). If a reviewer
   would ask "why does this need explaining," it doesn't need adding.
5. Don't show server/database text to the driver, ever — not as a "detail" link, not in small
   gray print. It's either mapped to one of the fixed phrases or it's the generic fallback.
   There is no third option.
6. Don't decorate a status with an icon or color alone. Pair it with the word (§6). This is a
   correctness rule dressed as a style rule — color blindness and daylight glare both defeat
   color-only signaling in a truck cab.

**In documentation about the app (including this file):**

1. State the current fact, then — only if it isn't obvious — the one-line reason. Don't
   narrate the reasoning process that arrived at the fact.
2. Don't restate what code already makes self-evident. A table row that says "Mark delivered —
   marks the delivery as delivered" is noise; say what it requires and what changes instead.
3. Cite the file, function, or doc section a claim rests on. An unsourced claim about what a
   screen does is exactly the kind of thing that goes stale silently.
4. Say "not built" plainly when something is only specified. Don't blur planned and shipped
   behind soft language like "supports" or "enables" — either the screen exists or it doesn't.
5. Flag a contradiction (§2) instead of quietly picking a side. Silently resolving a genuine
   product disagreement in a spec document is how the disagreement disappears without ever
   being decided.
6. No filler adjectives — "robust," "seamless," "powerful," "intuitive" describe nothing
   checkable. If a sentence still means the same thing with the adjective removed, remove it.

---

## 8. Open questions

Do not guess at these; they're product/architecture calls, not implementation details.

1. **Nav conflict (§2)** — does "Deliveries" survive as a driver tab, or does ADR-001's
   Routes/Tickets split replace it?
2. **Partial-return manifest** — table/entity shape was deliberately left open at ADR-001
   approval. Needs a decision before "Return trip (nothing left)" can grow a "return some of
   this" sibling.
3. **Should the Deliveries board scope to the signed-in driver's own rows** instead of the
   whole branch? Current behaviour (branch-wide, §3.3) falls out of the generic branch-access
   RLS pattern by default, not from an explicit product decision either way.
