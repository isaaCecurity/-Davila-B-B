# REPORTING-MODEL.md

## BakeFlow Reporting, Revenue Recognition, Costing & Dashboard Model

**Status:** Required product/accounting specification before dashboard implementation  
**Scope:** Revenue recognition, reporting-day boundary, costing method, refunds, dashboard metrics, P&L foundations, and reporting views.

---

# 1. Purpose

This document defines the business rules that the BakeFlow reporting layer must follow.

These rules are intentionally separated from UI implementation.

The dashboard must not invent financial semantics.

Every dashboard metric must resolve to an explicit definition that can be reproduced from authoritative database records.

The four currently blocking decisions are:

1. Revenue recognition.
2. Reporting-day boundary.
3. Inventory costing method.
4. Refund treatment.

The most important principle is:

> Operational state, payment state, cash state, and accounting/reporting state are related but are not the same thing.

BakeFlow must not infer accounting meaning from a single `status` column.

---

# 2. Current database reality

The current BakeFlow database already contains the operational entities required to build reporting, including:

```text
organizations
branches
tickets
ticket_items
customers
payments
refunds
cash_sessions
daily_financial_audits
products
product_variants
ingredients
ingredient_stock_levels
product_stock_levels
stock_movements
production_batches
production_batch_ingredients
audit_log
sync_operations
sync_devices
```

The current database also supports offline-created operational records through fields such as:

```text
device_created_at
server_received_at
revision
```

and the synchronization model through:

```text
sync_operations
```

Reporting must therefore be based on the **authoritative server state after synchronization**, while retaining timestamps necessary to understand when an event actually occurred.

---

# 3. Reporting is derived data

Reporting must never become a second source of truth.

The authoritative records remain:

```text
tickets
payments
refunds
cash_sessions
daily_financial_audits
stock_movements
production_batches
```

The reporting layer should derive:

```text
revenue
refunds
net sales
cash collected
outstanding amounts
COGS
gross profit
inventory value
cash variance
```

from those records.

Do not maintain manually editable:

```text
daily_revenue
monthly_profit
branch_profit
```

counters as the primary source of truth.

If materialized reporting tables are introduced later for performance, they must be rebuildable from authoritative data.

---

# 4. Critical distinction: ticket status versus financial status

A ticket's operational status is not sufficient to determine its financial/reporting state.

The system must distinguish at least:

```text
operational ticket state
payment state
refund state
revenue recognition state
cash collection state
```

Example:

```text
Ticket:
delivered

Payment:
paid

Refund:
fully refunded

Revenue:
reversed

Cash:
refunded
```

Therefore a ticket being displayed as `paid` must not cause the dashboard to treat it as currently collected revenue.

---

# 5. Revenue recognition

## 5.1 Decision

BakeFlow should recognize operational sales revenue when the ticket is **confirmed/delivered according to the final ticket lifecycle**, not merely when money is collected.

The preferred accounting/reporting basis is:

```text
Revenue recognition
=
fulfilled/delivered sale
```

rather than:

```text
cash received
```

or:

```text
ticket created
```

or:

```text
payment recorded
```

This prevents deposits/prepayments from being incorrectly treated as earned sales.

---

# 6. Why cash collection must be separate

Consider:

```text
Ticket value: ₦20,000

Day 1:
Customer pays ₦20,000 deposit.

Day 2:
Ticket is delivered.
```

Cash reporting:

```text
Day 1:
₦20,000 collected.
```

Revenue reporting:

```text
Day 2:
₦20,000 recognized revenue.
```

The dashboard must therefore support separate metrics:

```text
Revenue
Cash collected
```

They must never be aliases for one another.

---

# 7. Ticket lifecycle and revenue

The implementation must map the actual ticket lifecycle states to revenue eligibility.

The rule is:

```text
ticket created
    -> no revenue

ticket confirmed/accepted
    -> no revenue unless the business explicitly defines confirmation as fulfillment

ticket delivered/fulfilled
    -> revenue recognized

ticket corrected
    -> original revenue remains historically represented
    -> correction creates adjustment

ticket archived
    -> does NOT automatically reverse revenue

ticket refunded
    -> refund reduces/reverses recognized revenue according to refund amount
```

The exact operational status names in the live database must be used rather than inventing a second ticket-state vocabulary.

---

# 8. Revenue recognition timestamp

Revenue must use the timestamp corresponding to the fulfillment/delivery event.

It must not use:

```text
created_at
payment.created_at
server_received_at
```

unless that timestamp is actually the authoritative fulfillment timestamp.

For offline operations:

```text
device-created ticket
      |
      v
offline delivery/submission event
      |
      v
sync to server
```

the reporting system must preserve the actual business-event timestamp separately from the synchronization timestamp.

`server_received_at` answers:

```text
When did the server receive it?
```

It does not necessarily answer:

```text
When did the sale occur?
```

---

# 9. Reporting timestamp hierarchy

Every reportable event should conceptually have:

```text
business_event_at
server_received_at
created_at
```

Where available.

Reporting uses:

```text
business_event_at
```

not synchronization time.

Synchronization timestamps are primarily operational/audit metadata.

---

# 10. Offline reporting rule

Offline capability must not create duplicate revenue.

Example:

```text
Driver sells ticket offline.
Ticket is timestamped locally.
Ticket syncs later.
```

Revenue should be attributed to the business event date according to the configured reporting-day boundary.

It should not suddenly become revenue for the day the device reconnects.

This is essential to BakeFlow's offline-first architecture.

---

# 11. Reporting day boundary

## 11.1 Decision

The reporting day is based on the **organization's local calendar day in its configured timezone**.

It is not defined by a cash-session window.

Example:

```text
Organization timezone:
Africa/Lagos

Reporting day:
2026-08-10 00:00:00
through
2026-08-10 23:59:59.999...
```

Cash sessions remain a separate financial control structure.

---

# 12. Why cash sessions are not the reporting-day boundary

A cash session can:
- open late
- close late
- remain open across midnight
- be corrected
- be reopened according to controlled business rules

If the entire reporting system used cash-session windows, sales reporting would become dependent on operational cash-handling behavior.

That would make:

```text
revenue
```

change merely because a cashier forgot to close a session.

Instead:

```text
calendar-day reporting
```

provides stable reporting periods.

Cash-session reports can still provide:

```text
cash-session totals
```

and reconciliation against the daily report.

---

# 13. Organization timezone

Every organization must have a configured timezone.

Do not rely on:
- device timezone
- browser timezone
- server timezone

for accounting/reporting boundaries.

The organization's configured timezone is authoritative.

The mobile device may be wrong, traveling, or configured differently.

---

# 14. Branch timezone

Unless the product later explicitly supports branches in different timezones within one organization, the organization timezone should be the default reporting timezone.

If multi-timezone branches become a requirement later, the model must explicitly introduce branch timezone semantics rather than silently changing the current rule.

---

# 15. Day-boundary conversion

All report queries should follow:

```text
organization local date
        |
        v
organization timezone
        |
        v
UTC timestamp range
        |
        v
database query
```

Do not compare raw UTC dates to the reporting date.

---

# 16. Inclusive/exclusive ranges

Use half-open intervals:

```text
[start_of_day, start_of_next_day)
```

Example:

```sql
event_at >= start_of_day
AND event_at < start_of_next_day
```

Do not use:

```text
23:59:59.999999
```

as a manually calculated boundary.

---

# 17. Reporting periods

The reporting layer should support:

```text
day
week
month
custom date range
```

All periods derive from the organization's timezone.

Do not create separate financial logic for every period.

The month report should aggregate the same daily-level facts.

---

# 18. Primary dashboard metrics

The dashboard should distinguish:

### Gross recognized revenue

Total recognized sale value before refunds/adjustments.

### Refunds

Total refund amount applicable to recognized sales.

### Net revenue

```text
gross recognized revenue
-
recognized refunds
+
/-
approved reporting adjustments
```

### Cash collected

Actual customer payments received.

### Outstanding receivables

Amounts earned/owed but not yet collected, where the business model supports credit sales.

### COGS

Cost assigned to recognized sales.

### Gross profit

```text
net revenue - COGS
```

### Gross margin

```text
gross profit / net revenue
```

with zero/null handling when net revenue is zero.

---

# 19. Refund treatment

## 19.1 Current problem

The current database can represent a fully refunded ticket while the ticket/payment state may still read:

```text
paid
```

This is a reporting defect if the dashboard interprets `paid` as:

```text
customer currently owes nothing
```

or:

```text
BakeFlow still holds the money
```

---

# 20. Correct refund model

Do not rewrite historical payment records merely to make the UI say something different.

The system should derive financial state from:

```text
original payment(s)
+
refund(s)
```

A fully refunded ticket can therefore have:

```text
payment status:
paid

refund status:
fully_refunded

net collected:
₦0
```

This preserves payment history while correctly representing the current financial position.

---

# 21. Payment status versus refund status

The system should conceptually support independent states:

```text
payment_status
refund_status
```

Example combinations:

```text
unpaid + none
partially_paid + none
paid + none
paid + partially_refunded
paid + fully_refunded
```

Do not overload one status column to represent both payment and refund state.

---

# 22. Refund calculation

For a ticket:

```text
gross payments
=
sum(successful payments)
```

```text
refunds
=
sum(successful refunds)
```

```text
net collected
=
gross payments - refunds
```

Clamp/report invalid negative values through constraints and validation rather than silently hiding them.

---

# 23. Full refund example

Ticket:

```text
Gross sale = ₦10,000
Payment = ₦10,000
Refund = ₦10,000
```

Reporting:

```text
Gross revenue = ₦10,000
Refunds = ₦10,000
Net revenue = ₦0
Cash collected = ₦0
```

The historical payment remains visible.

The dashboard must not show:

```text
Revenue = ₦10,000
Collected = ₦10,000
```

after the full refund.

---

# 24. Partial refund example

Ticket:

```text
Gross sale = ₦10,000
Payment = ₦10,000
Refund = ₦2,500
```

Reporting:

```text
Gross revenue = ₦10,000
Refunds = ₦2,500
Net revenue = ₦7,500
Cash collected = ₦7,500
```

The ticket remains financially non-zero.

---

# 25. Refund recognition date

Refunds should be reported on the date the refund is actually processed/recognized.

Example:

```text
Sale:
August 8

Refund:
August 10
```

August 8:

```text
gross revenue +₦10,000
```

August 10:

```text
refund -₦10,000
net revenue impact -₦10,000
```

Do not silently rewrite August 8's historical report unless a formal restatement mechanism is introduced.

This gives the dashboard an auditable financial timeline.

---

# 26. Refund after period close

If a refund occurs after a daily financial audit has been confirmed, it should appear in the later reporting period.

It must not mutate the historical audit result.

The audit records what was known/closed for that day.

The refund becomes a later financial event.

---

# 27. Costing method

## 27.1 Decision

For BakeFlow's initial implementation, use **weighted-average costing** for inventory valuation and COGS.

This is preferable to FIFO for the MVP because it provides:
- simpler implementation
- simpler offline synchronization
- simpler reporting
- stable cost calculation
- easier branch-level inventory reconciliation

Do not implement FIFO merely because it is theoretically more detailed.

The product's initial target is small bakeries, where operational simplicity has higher value.

---

# 28. Why not last-cost

Last-cost is too unstable for financial reporting.

If ingredient prices change:

```text
Old cost:
₦1,000

New purchase:
₦1,400
```

Using only the last purchase price can make historical sales suddenly appear more/less profitable based on current purchasing activity.

That is unacceptable for reliable P&L reporting.

---

# 29. Why not FIFO for MVP

FIFO requires maintaining inventory layers:

```text
purchase layer 1
purchase layer 2
purchase layer 3
...
```

and consuming them correctly across:
- branches
- offline operations
- stock adjustments
- production
- transfers
- corrections

That increases complexity and synchronization risk.

FIFO can be introduced later if the product needs formal inventory-layer accounting.

---

# 30. Weighted-average formula

For a stock pool:

```text
weighted average cost
=
total inventory cost
/
total inventory quantity
```

Example:

```text
100 kg @ ₦1,000/kg
50 kg @ ₦1,400/kg
```

Total cost:

```text
₦100,000 + ₦70,000
=
₦170,000
```

Quantity:

```text
150 kg
```

Weighted average:

```text
₦170,000 / 150
=
₦1,133.33/kg
```

---

# 31. Costing event model

Every inventory-changing event must be represented through stock movements.

Conceptually:

```text
purchase
production consumption
production output
sale consumption
adjustment
waste
transfer
return
```

Each movement must have enough information to reconstruct inventory value.

---

# 32. Stock movement requirements

A stock movement used for reporting should contain or derive:

```text
tenant_id
branch_id
item_id
movement_type
quantity
unit_cost
total_cost
event_at
created_at
reference_type
reference_id
```

The exact existing schema must be inspected before adding duplicate fields.

Do not create a second parallel stock ledger if `stock_movements` already provides the authoritative ledger.

---

# 33. Cost at sale time

COGS must be determined when inventory is consumed by the recognized sale/production event.

Do not calculate historical COGS using today's inventory cost.

Otherwise past P&L values would change whenever new stock is purchased.

---

# 34. Production costing

For bakery production:

```text
ingredient consumption
        |
        v
production batch cost
        |
        v
finished product inventory cost
```

The production batch must capture the cost of ingredients consumed using the configured weighted-average method.

This allows finished goods to carry a defensible cost basis.

---

# 35. Recipe costing

Recipe/variant costing should be calculated from:

```text
recipe quantity
x
ingredient weighted-average unit cost
```

plus any explicitly supported additional production costs.

Do not use retail selling price as production cost.

---

# 36. COGS recognition

When a recognized sale consumes inventory:

```text
COGS
=
quantity sold
x
applicable weighted-average cost
```

The exact unit-cost source must be the inventory state applicable at the business event.

---

# 37. Refund and COGS treatment

A refund may require inventory treatment depending on whether goods are returned to usable inventory.

Do not automatically reverse COGS solely because money was refunded.

Possible cases:

### Customer refunded, product not returned

```text
revenue reversed
COGS remains
```

### Customer refunded, usable product returned

```text
revenue reversed
COGS may be reversed/recovered through inventory return
```

### Returned product is waste/unusable

```text
revenue reversed
original COGS remains
waste movement recorded
```

The operational refund workflow must capture whether inventory was returned.

Do not guess from the refund amount.

---

# 38. Corrections

Because submitted tickets are immutable:

```text
original ticket
    +
correction ticket
```

must drive reporting adjustments.

Do not update historical ticket amounts to "fix" reports.

The reporting layer should understand correction relationships.

---

# 39. Correction reporting

If a correction changes:

```text
quantity
price
discount
customer
payment
```

the reporting impact must be represented as a controlled adjustment.

The original event remains auditable.

The corrected financial result must be reproducible.

---

# 40. Archived tickets

Archiving is not the same as financial deletion.

An archived ticket may remain part of historical reporting unless the business rules explicitly identify the archive as a financial void/reversal.

Therefore:

```text
archived_at
```

must not automatically mean:

```text
exclude from revenue
```

---

# 41. Permanent deletion

Permanent deletion is exceptional.

If a ticket is permanently deleted through the protected destructive workflow, reporting must not silently become irreconcilable.

Before allowing permanent deletion of a financially relevant record, the system must ensure:
- required audit trail exists
- financial impact is handled
- references are preserved or safely represented
- reporting cannot silently fabricate totals

Financial records should generally be retained.

---

# 42. Dashboard architecture

The dashboard should consume reporting views/RPCs rather than duplicating complex calculations in React Native.

Recommended:

```text
database reporting views
+
secure RPC functions
+
typed API wrappers
```

The frontend should request:

```text
dashboard summary
revenue trend
payment collection
refund summary
COGS
gross profit
cash variance
```

rather than fetching thousands of raw rows and calculating accounting totals on-device.

---

# 43. Reporting views

Recommended logical views:

```text
reporting_ticket_revenue
reporting_payments
reporting_refunds
reporting_cogs
reporting_daily_summary
reporting_cash_reconciliation
reporting_inventory_valuation
reporting_gross_profit
```

These names are conceptual.

Before implementation, inspect existing views and avoid duplicate structures.

---

# 44. Daily revenue view

The daily revenue view should expose at least:

```text
tenant_id
branch_id
reporting_date
gross_revenue
refunds
net_revenue
```

Optional:

```text
discounts
corrections
tax
```

only if those concepts are actually supported by the current product.

Do not invent tax accounting unless tax requirements are explicitly defined.

---

# 45. Daily cash view

Cash reporting should expose:

```text
tenant_id
branch_id
reporting_date
cash_collected
cash_refunded
net_cash
cash_session_total
audit_counted_cash
variance
```

The exact relationship between payment methods and cash must be preserved.

Card/bank/transfer payments must not be treated as physical cash.

---

# 46. Payment method reporting

Payments should be grouped by method where supported:

```text
cash
card
bank_transfer
other
```

The live database's actual enum/value set must be treated as authoritative.

Do not silently introduce unsupported methods.

---

# 47. P&L model

Initial P&L:

```text
Net Revenue
-
COGS
=
Gross Profit
```

Operating expenses should only be included if BakeFlow has an authoritative expense model.

Do not calculate:

```text
Net Profit
```

from revenue and COGS alone and label it true net profit.

If expenses are not yet modeled, the dashboard should call it:

```text
Gross Profit
```

not:

```text
Net Profit
```

---

# 48. Gross margin

Formula:

```text
gross_margin =
gross_profit / net_revenue
```

If:

```text
net_revenue = 0
```

return:

```text
NULL
```

rather than:

```text
Infinity
```

or:

```text
0
```

without explanation.

---

# 49. Branch reporting

Every branch-level report must be tenant-scoped.

A Branch Manager should only see authorized branches.

Owner/Admin scope may span multiple branches depending on permissions.

Supervisor must not automatically receive organization-wide reporting.

Driver reporting should remain limited to operational information necessary for the role.

---

# 50. Multi-organization reporting

A user may belong to multiple organizations.

The reporting API must never assume:

```text
user -> one organization
```

Every report request must explicitly resolve the authorized organization context.

The server must validate:

```text
auth.uid()
+
tenant membership
+
branch scope
```

The client-selected organization is not an authorization mechanism.

---

# 51. Reporting RLS

Reporting views exposed through the API must not accidentally bypass tenant/branch RLS.

Supabase documentation warns that views can behave differently depending on ownership/security-invoker configuration; reporting views must therefore be deliberately secured rather than assuming underlying table RLS automatically solves the problem.

Preferred design:

```text
security-invoker views
```

where appropriate, plus explicit authorization in reporting RPCs.

Never expose a privileged reporting view that allows one tenant to query another tenant's financial data.

---

# 52. Reporting RPCs

Potential API functions:

```text
get_dashboard_summary()
get_daily_revenue()
get_revenue_trend()
get_payment_summary()
get_refund_summary()
get_gross_profit()
get_cash_reconciliation()
get_inventory_valuation()
```

Every function must validate:
- authenticated user
- tenant membership
- branch scope
- requested date range

Do not accept an arbitrary `tenant_id` and trust it.

---

# 53. Date range limits

Reporting endpoints should enforce reasonable date ranges.

Examples:

```text
dashboard:
31 days

trend:
12 months

custom report:
bounded maximum
```

Large exports should use dedicated asynchronous/reporting workflows rather than allowing expensive arbitrary queries from mobile clients.

---

# 54. Indexing

Reporting will create heavy date-range queries.

Important indexes should be verified on authoritative event tables, especially:

```text
tickets
payments
refunds
stock_movements
cash_sessions
daily_financial_audits
```

Typical access patterns include:

```text
tenant_id
branch_id
event_at
```

and:

```text
tenant_id
branch_id
created_at
```

Do not blindly create indexes; verify actual query plans after implementation.

---

# 55. Materialized reporting

If the dataset becomes large, materialized views or pre-aggregated daily facts may be introduced.

However:

```text
materialized report
```

must remain rebuildable from authoritative records.

Do not make an unrecoverable reporting cache the source of truth.

---

# 56. Dashboard performance

The mobile dashboard should not load:
- every ticket
- every payment
- every stock movement

and calculate totals in JavaScript.

Instead:

```text
small reporting query
-> small response
-> mobile rendering
```

This improves:
- performance
- battery usage
- offline cache behavior
- consistency
- security
- scalability

---

# 57. Offline dashboard behavior

The offline-first architecture also applies to reporting.

When offline:

```text
last known reporting snapshot
```

may be displayed.

It must be clearly timestamped:

```text
Last synchronized:
10 Aug 2026 18:42
```

Do not present stale financial numbers as live.

---

# 58. Offline financial audit versus reporting dashboard

The daily financial audit is an operational control.

The reporting dashboard is an analytical view.

They are related but not interchangeable.

Example:

```text
Daily audit:
cash counted at close

Dashboard:
cash collected according to payment records
```

Differences between them can be surfaced as:

```text
cash variance
```

but one must not overwrite the other.

---

# 59. Reconciliation model

The system should support reconciliation:

```text
recorded payments
        |
        v
cash-session totals
        |
        v
daily audit
        |
        v
variance
```

A variance is a financial exception.

It should not be silently adjusted by changing payment records.

Corrections require controlled financial adjustment records.

---

# 60. Reporting correction strategy

Never fix reports by:

```text
UPDATE ticket SET amount = ...
```

after submission.

Instead:

```text
original immutable record
+
correction/amendment record
+
reporting adjustment
```

This preserves:
- auditability
- offline synchronization
- historical reconstruction
- fraud resistance

---

# 61. Reporting status vocabulary

The reporting layer should use stable concepts:

```text
recognized
refunded
collected
outstanding
costed
```

These are reporting concepts.

Do not expose internal implementation statuses as if they were accounting definitions.

---

# 62. Metric contract

Every dashboard metric must document:

```text
Metric name
Definition
Source tables
Timestamp used
Timezone
Filters
Formula
Refund treatment
Correction treatment
Archive treatment
Offline treatment
Permission scope
```

Example:

### Net Revenue

```text
Definition:
Recognized fulfilled sales minus recognized refunds.

Source:
tickets + refunds + correction relationships.

Timestamp:
business fulfillment timestamp for revenue;
refund recognition timestamp for refunds.

Timezone:
organization timezone.

Archive:
archived tickets remain unless explicitly financially reversed.

Offline:
use business-event timestamp, not sync receipt timestamp.
```

---

# 63. Dashboard metric examples

## Today Revenue

```text
sum recognized revenue
for organization-local current reporting day
minus recognized refunds for that reporting day
```

## Today Collected

```text
sum successful payments
minus successful refunds
for the reporting day
```

## Today Gross Profit

```text
today net revenue
-
today COGS
```

## Outstanding

```text
recognized revenue
-
net collected
```

only where credit/receivable semantics are supported.

---

# 64. Revenue versus collection example

```text
Day 1:
₦50,000 deposit received.

Day 2:
Ticket delivered.

Day 3:
₦20,000 additional payment received.
```

Reporting:

```text
Day 1:
Revenue: ₦0
Collected: ₦50,000

Day 2:
Revenue: ₦70,000
Collected: ₦0

Day 3:
Revenue: ₦0
Collected: ₦20,000
```

This demonstrates why the two metrics must remain separate.

---

# 65. Fully refunded example

```text
Sale:
₦70,000

Payment:
₦70,000

Refund:
₦70,000
```

Final financial position:

```text
Gross revenue: ₦70,000
Refunds: ₦70,000
Net revenue: ₦0
Gross collected: ₦70,000
Net collected: ₦0
```

The original payment remains part of history.

The ticket can retain its original `paid` state while its derived refund state becomes:

```text
fully_refunded
```

The UI must not treat `paid` as the complete financial state.

---

# 66. Partial refund example

```text
Sale:
₦70,000

Payment:
₦70,000

Refund:
₦20,000
```

Final:

```text
Gross revenue: ₦70,000
Refunds: ₦20,000
Net revenue: ₦50,000
Net collected: ₦50,000
```

---

# 67. Costing example

Suppose ingredient inventory is:

```text
100 kg @ ₦1,000
50 kg @ ₦1,400
```

Weighted average:

```text
₦1,133.33/kg
```

If a recipe consumes:

```text
10 kg
```

ingredient COGS:

```text
₦11,333.30
```

The exact currency rounding rules must be defined centrally.

---

# 68. Currency and precision

Money must use the database's existing monetary representation consistently.

Do not use floating-point arithmetic for financial totals.

Prefer:
- integer minor units, or
- PostgreSQL `numeric`

depending on the already-deployed schema.

The reporting implementation must inspect the live columns before introducing a second monetary representation.

---

# 69. Rounding

Rounding must occur at defined boundaries.

Do not round every intermediate calculation unnecessarily.

For weighted-average costing:

```text
store sufficient precision
calculate
round final displayed/accounting amount
```

The exact decimal scale should be consistent across finance and reporting.

---

# 70. Report reproducibility

A report generated for:

```text
Organization A
Branch B
2026-08-10
```

should be reproducible from the same authoritative records.

If data changes later because a legitimate refund occurs:

```text
historical report
```

may change in accordance with the documented event-date rules.

But it must never change because:
- the app was opened later
- sync happened later
- current inventory price changed
- a user changed their device timezone

---

# 71. Auditability

Every material reporting number should be explainable.

A user should eventually be able to drill:

```text
Gross Revenue
    |
    +-- Ticket T-1001
    +-- Ticket T-1002
    +-- Ticket T-1003
```

and:

```text
COGS
    |
    +-- Product A
    |     +-- Ingredient X
    |     +-- Ingredient Y
    |
    +-- Product B
```

This is essential for a finance product.

---

# 72. Security

Reporting is highly sensitive.

Do not expose:
- another organization's totals
- another branch's private financial data
- customer information beyond permission scope
- internal cost information to Drivers
- COGS/margin data to roles that should not see it

The reporting API must enforce authorization server-side.

---

# 73. Driver reporting

Drivers should generally see operational totals necessary for their work, such as:

```text
their tickets
their collections where applicable
their sync state
```

They should not automatically see:

```text
organization gross profit
branch COGS
organization P&L
other drivers' financial performance
```

unless permissions explicitly allow it.

---

# 74. Supervisor reporting

Supervisor access should be narrower than Branch Manager.

A Supervisor may see:

```text
branch operational summaries
authorized cash/audit information
ticket performance
exceptions
```

but must not automatically receive full organization-level analytics.

---

# 75. Branch Manager reporting

Branch Manager can see branch-level:

```text
revenue
collections
refunds
COGS
gross profit
cash reconciliation
inventory
production
```

subject to final permissions.

---

# 76. Owner/Admin reporting

Owner and Admin are distinct.

Owner may have business-wide organization analytics.

Admin may have broader technical/administrative visibility but should not automatically receive every business-financial privilege unless the permission model grants it.

Do not equate:

```text
Admin = Owner
```

for reporting.

---

# 77. Required implementation decisions

Before dashboard coding is considered complete, the following must be locked:

```text
1. Revenue recognition:
   fulfilled/delivered event.

2. Reporting day:
   organization local calendar day.

3. Costing:
   weighted-average.

4. Refunds:
   separate refund state;
   refunds reduce net revenue and net collected;
   original payment history remains immutable.
```

These decisions remove the current dashboard blockers.

---

# 78. Database implications

The existing database should be reviewed for these specific gaps before reporting implementation:

### Ticket fulfillment timestamp

There must be an authoritative timestamp for the event that makes a ticket revenue-eligible.

### Refund state

The system needs a reliable way to derive:

```text
none
partial
full
```

refund state from refund records.

### Payment aggregation

Successful payments must be distinguishable from failed/voided payments.

### Stock costing

Stock movements must retain enough quantity/cost information to calculate weighted-average valuation.

### Organization timezone

The organization must have a canonical timezone.

### Correction relationships

Correction tickets must be included in reporting calculations.

---

# 79. Do not prematurely redesign the schema

The reporting layer should first inspect the current live schema.

Only add columns/tables when a required business fact cannot currently be represented.

Do not create:

```text
revenue_total
daily_profit
today_collected
```

columns on tickets or branches simply to make the dashboard easier.

Prefer derived views/RPCs.

---

# 80. Recommended reporting implementation order

### Phase 1

Lock metric definitions.

### Phase 2

Verify current schema supports each definition.

### Phase 3

Add only missing authoritative fields/constraints.

### Phase 4

Create reporting views/RPCs.

### Phase 5

Add indexes based on query plans.

### Phase 6

Implement dashboard API wrappers.

### Phase 7

Implement mobile dashboard.

### Phase 8

Add offline reporting snapshots.

### Phase 9

Test reconciliation and historical reproducibility.

---

# 81. Required tests

## Revenue recognition

```text
created ticket
=> no revenue

delivered ticket
=> revenue

payment before delivery
=> collection only

delivery after payment
=> revenue on delivery date
```

## Refund

```text
full refund
=> net revenue zero

partial refund
=> net revenue reduced

refund after reporting day
=> later-period refund impact
```

## Offline

```text
offline delivery
=> business-event date used

late sync
=> no duplicate revenue
```

## Timezone

```text
23:30 local
=> current reporting day

00:30 local
=> next reporting day
```

## Costing

```text
two inventory purchases at different costs
=> weighted-average cost

new purchase
=> historical COGS does not retroactively change
```

## Tenant isolation

```text
Org A report
cannot expose Org B data.
```

## Branch isolation

```text
Supervisor Branch A
cannot query Branch B reporting data.
```

## Refund/payment state

```text
paid + full refund
=> paid history + fully_refunded financial state
```

---

# 82. Final architecture

```text
                 AUTHORITATIVE DATA
                        |
        +---------------+----------------+
        |               |                |
      Tickets        Payments         Refunds
        |               |                |
        +---------------+----------------+
                        |
                  REPORTING FACTS
                        |
        +---------------+----------------+
        |               |                |
      Revenue        Collection         Refunds
        |               |                |
        +---------------+----------------+
                        |
                 INVENTORY / COGS
                        |
                        v
                  DAILY FACTS
                        |
                        v
                 REPORTING VIEWS
                        |
                        v
                    RPC/API
                        |
                        v
                    DASHBOARD
```

---

# 83. Non-negotiable rules

Claude Code MUST:

1. Use `tickets`, never reintroduce `orders`.
2. Treat submitted tickets as immutable.
3. Use correction tickets for amendments.
4. Treat archive as different from financial reversal.
5. Separate revenue from cash collection.
6. Recognize revenue on the configured fulfillment/delivery event.
7. Use organization timezone for reporting days.
8. Never use device timezone for accounting boundaries.
9. Never use sync receipt time as the business-event time.
10. Use weighted-average costing for MVP inventory valuation.
11. Never use last-cost as the authoritative COGS method.
12. Do not implement FIFO unless the product specification changes.
13. Treat refunds as separate financial events.
14. Do not rewrite historical payment records to represent refunds.
15. Derive net collected from payments minus refunds.
16. Ensure fully refunded tickets cannot appear as currently collected revenue.
17. Keep historical payment records intact.
18. Recognize refunds on the refund event date.
19. Do not automatically reverse COGS on refund unless inventory actually returns to usable stock.
20. Keep financial reporting server-side.
21. Do not calculate authoritative P&L in React Native.
22. Enforce tenant and branch authorization in reporting APIs.
23. Respect multi-organization users.
24. Do not trust client-provided tenant IDs.
25. Keep offline reporting explicitly marked as potentially stale.
26. Preserve enough data to reproduce reports.
27. Test reporting across timezone boundaries.
28. Test late offline synchronization.
29. Test full and partial refunds.
30. Test correction tickets.
31. Test weighted-average costing.
32. Test cross-organization data isolation.
33. Do not label gross profit as net profit unless operating expenses are actually modeled.
34. Do not add redundant denormalized financial counters without a measured performance requirement.
35. Make every dashboard metric have an explicit documented definition.

---

# 84. Final metric contract

The initial BakeFlow dashboard should therefore treat these as distinct first-class metrics:

```text
Gross Recognized Revenue
Recognized Refunds
Net Revenue

Gross Payments Collected
Refunds Paid
Net Cash Collected

COGS
Gross Profit
Gross Margin

Cash Session Total
Audited Cash
Cash Variance

Outstanding Amount
```

Not every role needs access to every metric.

The reporting engine should calculate the metrics once, enforce authorization once, and expose appropriately scoped results to each client.

---

# 85. Decision lock

For the current BakeFlow product scope:

```text
REVENUE
=
recognized when the sale is fulfilled/delivered.

REPORTING DAY
=
organization-local calendar day.

COSTING
=
weighted-average.

REFUNDS
=
separate financial events that reduce net revenue
and net collected amounts without rewriting
historical payment records.

OFFLINE
=
business-event timestamp determines reporting date;
sync time does not.

TICKETS
=
immutable after submission;
corrections are separate records.

ARCHIVE
=
not automatic financial reversal.

REPORTING
=
derived from authoritative domain records;
never manually maintained as the source of truth.
```

These rules are the foundation on which the dashboard should be implemented.
