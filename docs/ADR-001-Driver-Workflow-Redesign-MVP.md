# ADR-001 — Driver Workflow Redesign (MVP)

**Status:** Approved 2026-08-24  
**Date:** 2026-08-24  
**Scope:** Driver mobile workflow, route/ticket lifecycle, inventory loading and return, payment/credit recording, reconciliation  
**Related:** `STATE-MACHINES.md`, `EB-013`, `ROLES-AND-PERMISSIONS.md`

**Approval note (2026-08-24):** Approved for implementation. Section 23's open decisions
were triaged on approval: the low-stakes/reversible ones are resolved inline below each
item, so Phase 1 (domain review) can proceed immediately. Three decisions are genuine
financial/architecture calls that implementation cannot proceed past without human input
— they are called out explicitly in §23 and tracked as BLOCKER-019, BLOCKER-020, and the
pre-existing BLOCKER-006. Phase 2 (database design/migration) must not start until those
three are resolved; nothing else in this ADR is gated on them.

---

## 1. Decision Summary

BakeFlow's driver workflow will be redesigned around the real bakery sales operation rather than a courier/delivery model.

The driver is not primarily a delivery courier. During a trip, the driver:

1. Arrives at the bakery.
2. Loads bread/products into the vehicle.
3. Has the loaded quantity verified by a supervisor, manager, or baker.
4. Leaves the bakery with that inventory.
5. Sees the route/tickets assigned to them, if any.
6. Visits customers.
7. Can open an assigned ticket from the route and fulfil that customer request.
8. Can create a new ticket on the road when a customer did not have a pre-created ticket.
9. Can register a new customer when necessary.
10. Selects products and quantities sold.
11. Records the amount actually received from the customer using **cash, transfer, or POS**.
12. The system calculates the outstanding amount automatically as customer credit.
13. Completes the sale and moves to the next customer.
14. Returns to the bakery with any remaining bread/products.
15. Records the inventory returned.
16. The bakery supervisor/manager reconciles the trip against loaded inventory, sold inventory, returned inventory, payments collected, and customer credit.
17. The trip and applicable cash session are closed.

The driver-facing UX must expose this complexity as little as possible. The application should handle accounting, validation, auditability, credit calculation, inventory movements, and synchronization automatically.

---

## 2. Problem

The existing state-machine design models a conventional delivery workflow:

```text
pending → assigned → in_transit → delivered
                                      ├→ failed → returned
                                      └→ returned
```

That model does not accurately represent BakeFlow's driver operation.

The driver may sell directly to customers without a pre-existing ticket. The driver also carries bakery inventory, records sales and payments, accumulates customer credit, and reconciles remaining inventory when returning to the bakery.

The term **delivered** is therefore misleading for the core driver sales workflow.

The existing canonical `STATE-MACHINES.md` should not be modified until this ADR is reviewed and approved.

---

## 3. Product Principles

### 3.1 Driver-first simplicity

The driver's workflow must require minimal mental effort.

The driver should not need to understand internal state-machine terminology such as:

- `acknowledged`
- `reconciled`
- `in_transit`
- `partially_paid`
- inventory movement types
- accounting journal concepts

Those are backend/domain concepts.

The driver should primarily see actions such as:

- **Route**
- **Create Ticket**
- **Complete Sale**
- **Return Stock**
- **Finish Trip**

The system handles the underlying state transitions.

### 3.2 Fast repeat sales

The primary driver action for an unplanned customer sale should be:

```text
Create Ticket
    ↓
Select Customer
    ↓
Select Products + Quantities
    ↓
Record Payment
    ↓
Complete Sale
```

For frequent customers, this should require as few taps as reasonably possible.

### 3.3 No payment gateway

BakeFlow does not process the payment itself.

The driver records what the customer actually paid:

- Cash
- Transfer
- POS

The system does not verify the external payment. It records the driver's declared payment information and preserves it for reconciliation/audit.

### 3.4 Automatic credit calculation

The driver should never manually calculate customer credit.

```text
Credit Created = Total Sale - Total Payment Received
```

Examples:

```text
Sale: ₦10,000
Paid: ₦10,000
Credit: ₦0
```

```text
Sale: ₦10,000
Paid: ₦4,000
Credit: ₦6,000
```

```text
Sale: ₦10,000
Paid: ₦0
Credit: ₦10,000
```

The resulting outstanding amount belongs to the customer's ledger.

### 3.5 Offline-first operation

The driver may operate in areas with unreliable connectivity.

Creating tickets, recording sales, recording payments, and recording trip activity should therefore work locally and synchronize when connectivity returns.

The UI should communicate synchronization status without making the driver manage synchronization manually.

### 3.6 Security without friction

Security controls belong primarily in the backend.

The driver UI should not become a collection of confirmation dialogs.

The database/API must enforce:

- authorization
- tenant/branch isolation
- valid state transitions
- immutable financial history where required
- audit logging
- inventory integrity
- payment integrity
- ownership of driver actions

The client should mirror legal actions for usability, but it must never be the final authority.

---

# 4. Driver Trip Lifecycle

A new **Driver Trip** (or equivalent domain entity) should become the parent context for the driver's daily field operation.

The exact database/table name is still a product/implementation decision.

## Proposed lifecycle

```text
created
   ↓
loading
   ↓
ready_to_depart
   ↓
in_transit
   ↓
returning
   ↓
reconciled
   ↓
completed
```

### `created`

The trip exists for the driver.

For the MVP, this may be created automatically based on the driver's working day/first trip rather than requiring the driver to press a "Start Trip" button.

### `loading`

The driver is at the bakery and inventory is being loaded.

The loaded quantities are recorded and verified by an authorized bakery staff member.

### `ready_to_depart`

Loading has been completed and verified.

The driver can leave with the assigned inventory.

### `in_transit`

This means the driver has left the bakery with bakery inventory in the vehicle.

**Important:** `in_transit` is a **trip-level state**, not the state of every individual customer ticket.

While the trip is `in_transit`:

- assigned route tickets remain available;
- the driver can open and fulfil assigned tickets;
- the driver can create new tickets;
- the driver can create/register a customer when necessary;
- sales and payments are recorded against the trip.

### `returning`

The driver has returned to the bakery and is completing the physical inventory return.

### `reconciled`

The driver and authorized bakery staff have reconciled the trip.

Reconciliation should compare, at minimum:

```text
Loaded inventory
        ↓
minus sold inventory
        ↓
equals expected remaining inventory
        ↓
compare with physically returned inventory
```

It should also reconcile:

```text
Payments recorded
Customer credit created
Cash collected
Transfer/POS declarations
```

### `completed`

The trip is closed.

No normal operational activity should be added to a completed trip.

---

# 5. Route Workflow

A route is a driver's set of planned customer stops/tickets.

A route can exist before a driver is assigned.

For a bakery with only one driver, tickets/routes can effectively be automatically associated with that driver.

For multiple drivers, explicit assignment becomes relevant.

## Driver-facing route behavior

The driver should not need to think about assignment states.

The route screen should simply show:

```text
Today's Route

Customer A     ₦10,000
Customer B     ₦6,500
Customer C     ₦12,000
...
```

The driver opens a customer/ticket and acts on it.

### Assignment provenance

The backend should still distinguish:

```text
manager/supervisor-created ticket
```

from:

```text
driver-created ticket
```

This distinction is important for operational reporting and accountability.

A manager-created ticket should retain its original creator and assigned driver.

A driver-created ticket should retain the driver as the creator.

Do not solve this by creating unnecessary driver-facing states.

---

# 6. Ticket Workflow in the Driver Context

The existing Ticket state machine contains:

```text
draft
  ↓
submitted
  ↓
confirmed
  ↓
scheduled
  ↓
in_production
  ↓
ready
  ↓
delivered
  ↓
completed
```

This ADR does **not** authorize replacing that lifecycle yet.

Instead, the driver workflow should be mapped onto the existing Ticket domain carefully.

## Two ticket entry paths

### Path A — Manager/Supervisor creates ticket

```text
Manager/Supervisor
       ↓
Ticket created
       ↓
Assigned to driver / appears in driver's route
       ↓
Driver opens ticket
       ↓
Driver fulfils customer request
       ↓
Payment recorded
       ↓
Sale completed
```

### Path B — Driver creates ticket

```text
Driver
  ↓
Create Ticket
  ↓
Select existing customer
       OR
Create new customer
  ↓
Select product(s)
  ↓
Enter quantities
  ↓
System calculates sale total
  ↓
Record payment
  ↓
System calculates credit
  ↓
Complete sale
```

The second path is essential. A driver must not require a manager to create a ticket before a legitimate roadside/customer sale can be recorded.

---

# 7. Customer Creation

When creating a ticket, the driver first searches for the customer.

```text
Select Customer
       ↓
Customer exists?
   ↙           ↘
 YES           NO
  ↓             ↓
Continue      Create Customer
                ↓
             Continue Sale
```

The customer creation form should be intentionally small.

Only collect information necessary for:

- identifying the customer;
- contacting them when appropriate;
- maintaining their ledger;
- associating future sales with the same customer.

Avoid forcing the driver to enter unnecessary profile information during a sale.

---

# 8. Sale Completion

The driver's sale screen should follow a simple sequence.

```text
Customer
   ↓
Products
   ↓
Quantities
   ↓
Total
   ↓
Payment
   ↓
Complete Sale
```

Payment methods:

```text
Cash
Transfer
POS
```

The system should calculate:

```text
amount_due = total_amount
amount_paid = sum(recorded payments)
credit = max(total_amount - amount_paid, 0)
```

The driver should see the resulting amount clearly before completing the sale.

**Clarification added on approval:** `amount_paid > total_amount` is not floored to
`credit = 0` in practice — `guard_payment_relationships()` rejects any payment that would
exceed the outstanding balance at the database level (AD-017: "Overpayments are rejected
against the current outstanding balance"). The driver sale screen must handle a
payment-rejected response (e.g. "amount exceeds balance due"), not assume the max-clamp
above is what happens silently at the boundary.

---

# 9. Customer Ledger

Each customer has an independent ledger.

A completed credit sale creates an outstanding customer balance.

Example:

```text
Customer: Example Bakery Shop

Sale                         ₦10,000
Payment — Cash                ₦4,000
-----------------------------------
Outstanding Credit            ₦6,000
```

The ledger must preserve transaction history rather than simply overwriting a balance.

The current outstanding balance should be derived from the underlying financial transactions.

---

# 10. Inventory Model

The driver's trip must establish custody of the inventory.

At loading:

```text
Bakery Stock
     ↓
Driver Trip Stock
```

During sales:

```text
Driver Trip Stock
     ↓
Customer Sale
```

At return:

```text
Driver Trip Stock
     ↓
Bakery Stock
```

The system should be able to calculate:

```text
Expected Return
=
Loaded Quantity
-
Sold Quantity
-
Other Valid Stock Movements
```

The physical return recorded by the driver should then be reconciled against the expected return.

A discrepancy must remain visible for investigation.

Do not silently "correct" inventory to make the numbers balance.

---

# 11. Returns

A product return from the driver's vehicle to the bakery is **not a customer sales ticket**.

It should be represented as an inventory return associated with the driver trip.

Proposed flow:

```text
Driver returns to bakery
        ↓
Record physical remaining stock
        ↓
Supervisor/manager verifies
        ↓
Inventory return posted
        ↓
Trip reconciliation
```

The exact return entity/table can be decided during implementation.

The important architectural rule is:

> A bakery inventory return must not be modelled as a customer order/ticket.

---

# 12. Reconciliation

At the end of the trip, the supervisor/manager and driver reconcile the operation.

The reconciliation should cover:

### Inventory

```text
Loaded
- Sold
- Other valid movements
= Expected Return

Expected Return
vs
Actual Return
```

### Money

```text
Cash recorded
Transfer recorded
POS recorded
```

### Customer credit

```text
Total sales
- Payments received
= Credit created
```

### Exceptions

Any discrepancy should be visible rather than silently corrected.

The supervisor/manager should have the appropriate authority to investigate and resolve discrepancies.

Driver-facing reconciliation should remain simple.

---

# 13. Cash Session Relationship

The existing Cash Session state machine remains:

```text
open → closed
```

The driver trip should provide the operational context for driver sales and collections.

Do not make payment a Ticket state.

Payment status remains a financial concern independent of the operational ticket lifecycle.

At reconciliation/close, the system should provide the supervisor/manager with the totals necessary to reconcile the driver's activity with the applicable cash session.

The exact relationship between `driver_trip` and `cash_session` must be finalized during schema implementation.

---

# 14. Driver Mobile Navigation

The driver's primary navigation should remain intentionally small:

```text
Home
Routes
Create Ticket
Tickets
More
```

## Home

Purpose:

- current trip status;
- quick operational summary;
- synchronization status;
- important exceptions;
- primary action.

Avoid turning Home into an accounting dashboard.

## Routes

Shows:

- today's route;
- manager-created/assigned tickets;
- customer names;
- relevant quantities;
- completion status.

## Create Ticket

This is the fastest path for an unplanned customer sale.

Target flow:

```text
Create Ticket
    ↓
Customer
    ↓
Products
    ↓
Payment
    ↓
Complete
```

## Tickets

Search and view tickets created by or associated with the driver.

## More

Settings and secondary functionality.

---

# 15. Driver UX Rules

The driver UI should follow these rules:

1. Prefer one obvious primary action per screen.
2. Minimize typing.
3. Remember frequently used customers.
4. Make repeat sales fast.
5. Use large touch targets.
6. Keep critical information visible.
7. Avoid unnecessary confirmation dialogs.
8. Never require the driver to manually calculate credit.
9. Never require the driver to understand backend state names.
10. Make offline operation normal rather than exceptional.
11. Show sync status subtly.
12. Preserve an audit trail without adding driver friction.

---

# 16. Offline and Sync Requirements

Driver operations must be safely recordable while offline.

Locally queued operations should include the required identifiers and timestamps so they can synchronize later.

The sync system must handle:

- ticket creation;
- customer creation;
- ticket items;
- payment records;
- trip events;
- inventory movements;
- return records.

Operations must be idempotent.

A driver pressing an action twice because of poor connectivity must not create duplicate financial transactions.

Server-side authorization and state validation remain authoritative after synchronization.

---

# 17. Security Requirements

The simplified UX does not mean simplified security.

The backend must enforce:

- tenant isolation;
- branch isolation;
- driver authorization;
- ownership of driver-created records;
- valid state transitions;
- immutable financial history;
- atomic inventory movements;
- atomic payment application;
- audit logs;
- protection against duplicate operations;
- server-side validation of all financial totals.

The mobile client may hide invalid actions, but the database/API must reject invalid operations.

---

# 18. PCI Considerations

BakeFlow records payment method and payment amount. It does not process card payments itself.

The driver should not enter or store:

- card numbers;
- CVV;
- PIN;
- bank credentials;
- OTPs;
- other payment authentication secrets.

For POS transactions, record only the business information required by BakeFlow, such as:

```text
payment_method = POS
amount = ₦X
```

The actual card transaction remains between the customer and the external payment/POS provider.

PCI scope should be minimized by ensuring BakeFlow never becomes a repository for cardholder data.

---

# 19. Auditability

The system should retain:

- who loaded inventory;
- what was loaded;
- when loading was verified;
- who created each ticket;
- who completed each sale;
- what products were sold;
- what payment was recorded;
- what customer credit was created;
- what inventory was returned;
- who verified/reconciled the return;
- reconciliation discrepancies;
- trip start/end timestamps;
- synchronization metadata where relevant.

This allows management to answer:

> What did the driver take out, what did the driver sell, what money did the driver record, what credit was created, and what came back?

---

# 20. Proposed Architecture

Conceptually:

```text
                    DRIVER TRIP
                         │
        ┌────────────────┼────────────────┐
        │                │                │
     Inventory        Route Stops      Sales
        │                │                │
     Loaded           Assigned        Tickets
        │                │                │
     Returned         Customer         Payments
        │              Visits             │
        │                │              Credit
        └────────────────┼────────────────┘
                         │
                    Reconciliation
                         │
                    Trip Completed
```

The Driver Trip is the operational context.

Tickets remain customer sales/business documents.

Payments remain financial records.

Customer credit remains ledger/accounting data.

Inventory movements remain inventory records.

Reconciliation ties the operational facts together.

---

# 21. What We Should NOT Do

Do not:

- turn payment into Ticket states;
- use `delivered` as the primary driver-sales concept;
- model inventory return as a customer ticket;
- require a manager to pre-create every driver sale;
- require drivers to manually calculate credit;
- trust the mobile client to enforce financial rules;
- silently adjust inventory discrepancies;
- introduce unnecessary driver-facing states;
- redesign the entire existing Ticket state machine without tracing its current dependencies.

---

# 22. Migration Strategy

This ADR should be approved before modifying `STATE-MACHINES.md`.

After approval:

### Phase 1 — Domain review

- Confirm the Driver Trip entity and lifecycle.
- Confirm route/stop semantics.
- Confirm how manager-created tickets are associated with trips.
- Confirm how driver-created tickets are associated with trips.
- Confirm inventory loading/return representation.
- Confirm reconciliation ownership.

### Phase 2 — Database design

Define:

- `driver_trips`;
- trip inventory movements/associations;
- route stop representation;
- trip-ticket relationship;
- trip reconciliation record;
- required indexes and constraints.

Avoid creating redundant tables where existing entities already provide the correct source of truth.

### Phase 3 — RPC/security layer

Create or revise server-side operations for:

- creating/starting a trip;
- verifying loaded inventory;
- starting/closing a trip;
- creating driver sales;
- recording payments;
- posting inventory returns;
- reconciling a trip.

Each operation must be atomic where it changes money or stock.

### Phase 4 — State machine update

Only after the above decisions are confirmed should the canonical state-machine document and database transition guards be updated.

### Phase 5 — Driver UI

Implement the simple workflow:

```text
Home
  ↓
Routes / Create Ticket
  ↓
Customer
  ↓
Products
  ↓
Payment
  ↓
Complete Sale
  ↓
Next Customer
  ↓
Return
  ↓
Reconciliation
```

The UI should hide domain complexity rather than exposing every backend state.

---

# 23. Open Decisions Before Implementation

Triaged on approval (2026-08-24). Items resolved here are low-stakes and reversible —
implementation may proceed on them. Items marked **BLOCKED** are financial or
architecture decisions this ADR cannot settle by inference from existing precedent;
Phase 2 (database design/migration) must not start until they are resolved.

1. **Resolved.** Trip entity is `driver_trips` — plain, matches CLAUDE.md rule 10
	 (lowercase plural snake_case).
2. **Resolved.** A driver may have multiple trips per day, each independently
	 reconciled. Restricting to one trip/day is a stricter constraint that can be added
	 later without a data migration; allowing multiple now avoids modelling a false
	 assumption about depot re-load patterns.
3. **Resolved.** A trip is created on the driver's first loading-related action of the
	 day, not by a manual "Start Trip" button, matching §4's own stated MVP preference.
4. **Resolved.** Already answered by this ADR's own §1 step 3: supervisor, manager, or
	 baker may verify loaded quantity. No new role decision needed.
5. **Resolved.** One-party confirmation (the verifying staff member's role-gated RPC
	 call), matching the existing precedent for `adjust_stock()` and production-batch
	 completion — neither requires a second confirming party. Two-party confirmation can
	 be added later if reconciliation experience shows it's needed; it is not a
	 financial-integrity requirement today.
6. **Resolved.** Route-stop representation is a Phase 2 schema-design detail, not a
	 product decision — no human input needed before designing it.
7. **Resolved.** A manager-created ticket appears in the driver's route as soon as it is
	 assigned (per §5's "Assignment provenance"); it becomes formally trip-linked
	 (`tickets.driver_trip_id` set) once the driver's trip reaches `in_transit`.
8. **Resolved.** A driver-created ticket is attached at creation time to whichever trip
	 is currently `in_transit` for that driver (`tickets.driver_trip_id` set directly by
	 the creating RPC).
9. **Resolved.** Inventory return schema is a Phase 2 schema-design detail.
10. **Resolved.** Reconciliation schema is a Phase 2 detail. Approval authority mirrors
	 the existing `daily_financial_audits` four-eyes pattern (submitter ≠ confirmer,
	 confirmer is branch_manager/owner/admin) rather than inventing a new authorization
	 model.
11. **BLOCKED — see BLOCKER-020.** Relationship between `driver_trip` and `cash_session`.
	 This determines whether driver cash collections settle into the branch's currently
	 open cash session or require a session of their own, which is a real accounting
	 model choice, not an implementation detail — AD-017's expected-drawer-cash formula
	 is defined per branch session and this ADR does not say which session a driver's
	 cash lands in.
12. **Resolved.** A failed/no-sale visit is a lightweight visit-outcome record linked to
	 the trip and route stop — no ticket, no money, no inventory movement. Pure
	 reporting data; no product decision needed.
13. **Resolved.** Corrections after sale completion reuse the existing `tickets.correct`
	 permission (already granted to `driver` per `ROLES-AND-PERMISSIONS.md:123`) rather
	 than a new mechanism — consistent with CLAUDE.md rule 8's append-only correction
	 model for business-critical records.
14. **BLOCKED — pre-existing BLOCKER-006.** Offline conflict rules for driver-created
	 customers and tickets. This ADR doesn't introduce a new open question here so much
	 as walk directly into an already-open one: `BLOCKERS.md` BLOCKER-006 (no per-entity
	 conflict strategy, no `sync_conflicts` table) already blocks P9.3 (driver ticket
	 creation) for exactly this reason. This ADR's Path B makes BLOCKER-006 load-bearing
	 for driver trips too, not just plain ticket sync — it doesn't change what's needed
	 to resolve it.

**Additional blocker surfaced during review, not originally in this list:**

15. **BLOCKED — see BLOCKER-020.** Relationship between `driver_trip`/Path A and the
	 existing, live-verified `deliveries` entity (P9.6). `STATE-MACHINES.md` hard-requires
	 a verified `deliveries` row before a delivery-fulfilment ticket can reach
	 `ready → delivered`. §6 Path A never states whether a trip-linked delivery ticket
	 still creates/transitions a `deliveries` row, or whether the trip context replaces
	 that gate for driver-fulfilled tickets. Guessing here risks either duplicating a
	 gate that already works or silently breaking the live P9.6 write path.

---

# 24. Acceptance Criteria

The redesign is ready for implementation when:

- A single-driver bakery can operate without unnecessary assignment actions.
- A driver can leave the bakery with verified inventory.
- Assigned tickets appear in the driver's route.
- A driver can create an unplanned customer ticket without manager intervention.
- A driver can create a customer when the customer is not registered.
- A driver can record product quantities quickly.
- A driver can record cash, transfer, or POS payments.
- Credit is calculated automatically.
- Customer ledger history is preserved.
- Driver inventory is traceable from loading through sale and return.
- Returns are represented as inventory movements, not sales tickets.
- Manager/supervisor reconciliation can identify discrepancies.
- Offline operations do not create duplicate sales or payments.
- Backend authorization remains authoritative.
- The driver UI does not expose unnecessary internal state-machine complexity.

---

## 25. Final Principle

The driver should experience BakeFlow as a simple sales tool:

```text
Take stock → Go out → Sell → Record payment → Repeat → Return stock → Reconcile
```

The backend should experience the same operation as a controlled, auditable transaction system:

```text
Trip
  + Inventory custody
  + Route activity
  + Tickets
  + Payments
  + Customer ledger
  + Inventory returns
  + Reconciliation
  = Auditable driver operation
```

The architecture should absorb the complexity so the driver does not have to.
