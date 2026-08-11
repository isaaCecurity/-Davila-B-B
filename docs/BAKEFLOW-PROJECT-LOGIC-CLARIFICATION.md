# BAKEFLOW-PROJECT-LOGIC-CLARIFICATION.md

## Purpose

This document is a cross-cutting implementation authority for Claude Code.

BakeFlow has multiple feature specifications and database documents. This document exists to prevent a feature from being implemented correctly in isolation while violating an established business rule elsewhere.

Treat the rules below as **business invariants**, not suggestions.

If an existing document, migration, database function, API contract, or UI implementation appears to conflict with these rules:

1. Do not silently choose one interpretation.
2. Identify the conflict.
3. Preserve the business invariant stated here unless the product owner explicitly changes it.
4. Prefer the smallest implementation change that satisfies the invariant.
5. Do not redesign unrelated architecture merely because a different design looks cleaner.

---

# 1. Product identity

BakeFlow is a bakery operations and finance platform for organizations/bakeries with multiple branches and staff.

The core operational model is:

```text
Organization
    |
    +-- Branch
          |
          +-- Staff
          +-- Customers
          +-- Tickets
          +-- Production
          +-- Inventory
          +-- Finance
          +-- Reporting
```

BakeFlow is intentionally different from ordinary cloud-only business software because **offline operation is a first-class product capability**.

The system must continue to support critical operational workflows when connectivity is unavailable and reconcile them safely when connectivity returns.

---

# 2. Terminology is important

## 2.1 Tickets, not orders

The operational transaction is called a **ticket**.

Do not introduce or reintroduce `orders` as the business concept.

If legacy code/database objects use `orders`, determine whether they are legacy artifacts that should be migrated/renamed rather than creating a second parallel concept.

The product vocabulary should consistently use:

```text
ticket
ticket item
ticket correction/amendment
ticket archive
```

---

# 3. Submitted tickets are immutable

This is one of the strongest business rules in the system.

Once a ticket is submitted:

```text
IT CANNOT BE UPDATED.
IT CANNOT BE CANCELLED.
IT CANNOT BE EDITED.
```

This applies regardless of:

- driver
- supervisor
- branch manager
- admin
- owner

Authority does not create an exception.

Do not implement:

```text
UPDATE ticket SET ...
```

as the normal correction mechanism.

---

# 4. Corrections/amendments are new records

If a submitted ticket is wrong:

```text
original ticket
      |
      v
correction/amendment ticket/event
```

The correction must reference the original.

The original remains historically intact.

This preserves:

- auditability
- financial traceability
- offline reconciliation
- historical reporting
- accountability

Do not mutate the original ticket to make the database "look correct."

The UI may present the corrected business result, but the underlying historical record must remain immutable.

---

# 5. Cancellation versus archive

A submitted ticket is not cancelled through a mutation.

If the business needs to remove it from normal operational views, the system uses **archive/soft-delete semantics**.

Normal application users do not hard-delete records.

The general rule is:

```text
nothing is hard deleted through ordinary CRUD
```

Where appropriate, records use fields such as:

```text
deleted_at
deleted_by
```

or the project's established equivalent.

Archiving does not rewrite historical facts.

An archived ticket must remain auditable.

---

# 6. Permanent deletion is exceptional

There is a deliberate distinction between:

```text
archive / soft delete
```

and:

```text
permanent deletion
```

Permanent deletion is an exceptional destructive workflow, not an ordinary button.

The product direction is similar to a protected destructive action such as deleting a GitHub repository/organization.

Therefore:

- require explicit confirmation
- require appropriate authority
- use a deliberate challenge/confirmation flow
- record who initiated it
- record when it occurred
- record what was affected
- enforce server-side authorization
- never expose a generic unrestricted `DELETE` path to normal clients

The exact permanent-deletion retention/legal rules must follow the project's retention specification.

---

# 7. Driver is the primary ticket creator

The normal field workflow is driver-led.

The driver creates/submits tickets during operations.

The Branch Manager may also create an assigned/pre-arranged ticket when a customer calls in advance, but this is not the primary driver workflow.

Do not redesign the workflow so that managers must create all tickets.

---

# 8. Driver timestamp

The driver does **not** choose the ticket submission time.

The application/server records the appropriate timestamp automatically when the ticket is submitted/accepted into the operational workflow.

A user-entered arbitrary submission timestamp must not be used to manipulate reporting.

Offline records still need an authoritative business event time and must retain enough metadata to distinguish:

```text
when the business event occurred
```

from:

```text
when the device synchronized it
```

Sync time must never replace the business event time for reporting.

---

# 9. Offline ticket creation

Offline operation is a core feature, not an error state.

If the driver creates a ticket while offline:

```text
driver submits ticket
       |
       v
ticket is persisted locally
       |
       v
encrypted local storage
       |
       v
sync queue
       |
       v
automatic synchronization when connectivity returns
```

The driver must not need manager approval to synchronize.

---

# 10. Manager cannot control synchronization

Synchronization is a platform capability.

The Branch Manager does not have an authority switch that can:

```text
allow sync
disable sync
approve sync
reject normal sync
```

The system synchronizes automatically according to its sync protocol.

Managers can review sync exceptions/conflicts where the product exposes those workflows, but they do not control whether normal synchronization occurs.

---

# 11. Offline data must be encrypted

Data stored locally on the device before synchronization must be encrypted.

This includes sensitive operational data stored in:

- offline database
- local queue
- persisted application state
- local cached records

Do not treat AsyncStorage/plaintext JSON files as sufficient secure storage for sensitive offline records.

The local persistence design must provide encryption appropriate to the platform.

Encryption keys must not be stored as ordinary application data alongside the encrypted database.

---

# 12. Offline operations

The offline design must support the operational workflows explicitly approved for offline use.

At minimum, consider:

### Driver

- create ticket
- select existing customer
- create a new registered customer when the customer does not exist
- record roadside customer transaction without creating a registered customer
- create correction/amendment according to the offline correction rules
- queue operational events for automatic synchronization

### Manager/Supervisor

Offline access must also support the operational/financial audit workflows required for closing the day's balance.

This is important:

> Offline is not a driver-only feature.

Managers and supervisors must be able to continue the relevant financial audit/close-of-day workflow offline, with secure local data and later synchronization.

Do not implement offline infrastructure solely inside the driver feature.

---

# 13. Offline sync principles

Every sync operation must be designed for:

- idempotency
- retries
- duplicate delivery
- network interruption
- partial synchronization
- ordering
- conflict detection
- authorization
- organization isolation

A request may be sent more than once.

The server must not create two business transactions because a client retried the same operation.

---

# 14. Idempotency

Offline clients must have stable identifiers for locally-created operations.

Conceptually:

```text
client_operation_id
device_id
organization_id
branch_id
event_type
```

The server should be able to recognize:

```text
same operation received again
```

and return the existing result rather than creating a duplicate.

This applies to more than tickets.

It must be considered for:

- tickets
- corrections
- payments
- refunds
- audit actions
- inventory operations
- other offline mutations

---

# 15. Sync ordering

Do not assume network arrival order equals business-event order.

A device may reconnect and submit:

```text
event A
event B
event C
```

in a different transport order.

Where business ordering matters, use explicit event/revision/sequence information.

The system must distinguish:

```text
event occurred at
```

from:

```text
event synchronized at
```

and:

```text
request received at
```

---

# 16. Conflict handling

Do not silently overwrite server data when a conflict occurs.

For immutable tickets, the preferred strategy is generally:

```text
accept immutable original event
+
create explicit correction/conflict record when necessary
```

rather than:

```text
last write wins
```

Do not implement generic last-write-wins for financial/operational facts.

If a sync conflict cannot be resolved automatically, preserve both the original information and the conflict metadata and expose an authorized resolution workflow.

---

# 17. Driver/customer relationship

Drivers do not enter an arbitrary recipient name for normal registered-customer tickets.

There is an existing customer list.

The driver:

```text
selects existing customer
```

or, if the customer does not exist:

```text
creates the customer
```

then uses that customer.

This is different from a roadside customer.

---

# 18. Roadside customers

A roadside customer may simply buy something from the driver without needing registration.

A roadside transaction does not require creating a persistent registered customer profile.

Therefore the application must support:

```text
registered customer
```

and:

```text
roadside/non-registered customer
```

as different workflows.

Do not force every transaction to create a customer record.

Do not create fake customer accounts such as:

```text
Walk-in Customer #123
```

for driver roadside sales unless the product specification explicitly requires it.

---

# 19. Multi-organization users

A driver/user may belong to multiple organizations/bakeries.

This is a major security boundary.

Example:

```text
Driver X
   |
   +-- Organization A
   +-- Organization B
```

The application must never assume:

```text
one user = one organization
```

---

# 20. Organization context must be explicit

Operational mutations must be tied to the active:

```text
organization
branch
```

context.

Before submitting a ticket, payment, correction, etc., the system must ensure that the selected organization/branch is:

- valid
- active
- accessible to the user
- appropriate for the user's role
- appropriate for the current device/session context

Do not rely only on a client-side selected organization ID.

The backend/database must enforce authorization.

---

# 21. Prevent cross-organization mistakes

The primary failure we must prevent is:

```text
Driver intends to create ticket for Bakery A
but accidentally submits it into Bakery B
```

The architecture should reduce this risk at multiple levels.

### Client

Clearly display the active organization/branch in operational screens.

Do not make organization switching invisible.

### Application state

Maintain explicit organization/branch context.

### Backend

Validate organization membership and branch authorization on every mutation.

### Database

Use RLS/server-side constraints/functions to prevent cross-organization writes.

### Offline queue

Every queued operation must retain organization/branch context.

Do not execute an offline queue operation against "whatever organization is currently selected."

The queued operation belongs to the organization under which it was created.

---

# 22. Cross-organization data leakage

A user belonging to multiple organizations must never receive:

- tickets
- customers
- financial records
- reports
- notifications
- inventory
- production data

from Organization A while operating in Organization B unless the user explicitly switches context and is authorized there.

This applies especially to push notifications because one physical device may receive notifications for multiple organizations.

Push payloads are not authorization.

The app must re-check authorization when opening a resource.

---

# 23. Roles and hierarchy

The hierarchy is:

```text
Owner
   |
   +-- Admin
   |
   +-- Branch Manager
          |
          +-- Supervisor
                 |
                 +-- Driver
```

This is conceptual hierarchy; actual permissions are explicit rather than automatically inherited merely because someone is higher in the hierarchy.

---

# 24. Branch Manager

`branch_manager` is the manager role.

Do not create a separate generic `manager` role unless the database/product contract explicitly requires it.

The Branch Manager manages the branch and has broader operational authority than a Supervisor.

---

# 25. Supervisor

Supervisor is a distinct role.

A Supervisor is:

```text
under the Branch Manager
```

and has fewer privileges.

Do not treat:

```text
supervisor = branch_manager
```

and do not grant manager permissions to supervisors by default.

The permission system should make the differences explicit.

---

# 26. Owner and Admin

The Admin should have the relevant administrative capabilities established by the product rules.

Do not assume:

```text
owner = admin
```

or:

```text
admin = branch manager
```

They are separate roles with separate authority.

Where the product explicitly says Admin shares a capability with Owner, implement that capability for both rather than using Owner-only checks.

---

# 27. Financial audit

Financial audit is not merely a reporting screen.

It is an operational close-of-day workflow.

Managers and supervisors may need to perform relevant audit work even when offline.

The system must therefore distinguish:

```text
business transaction
```

from:

```text
audit/close action
```

and preserve audit history.

Do not make a financial close simply a boolean such as:

```text
is_closed = true
```

without retaining the underlying audit evidence required by the product.

---

# 28. Reporting day

The reporting day follows the organization's local calendar day unless the reporting specification explicitly defines another boundary.

Do not use synchronization time as the reporting date.

Do not use device-local timezone blindly.

Use the organization's configured timezone.

---

# 29. Revenue recognition

The reporting model established for BakeFlow distinguishes operational events from payment state.

Revenue recognition should follow the approved reporting specification rather than simply:

```text
payment_status = paid
```

A ticket being paid does not automatically mean every reporting metric should treat it as recognized revenue.

Do not infer accounting semantics from UI labels.

---

# 30. Refunds

A ticket may historically have a payment state of `paid` while a subsequent refund has occurred.

Do not rewrite history to pretend the payment never existed.

Refunds should be represented as financial events that affect derived reporting.

A fully refunded ticket should therefore be distinguishable from:

```text
never paid
```

and:

```text
paid and not refunded
```

The reporting layer should derive the appropriate net financial result.

---

# 31. Costing

The MVP reporting direction uses weighted-average costing unless the reporting specification is explicitly changed.

Do not silently switch to:

- FIFO
- last-cost
- arbitrary current purchase price

because it is easier to implement.

---

# 32. Dashboard architecture

Dashboard figures should be derived from authoritative records/views/functions.

Do not create duplicated counters everywhere such as:

```text
organization.total_revenue
branch.total_sales
user.total_tickets
```

unless there is an explicit performance reason and a reliable consistency mechanism.

Avoid denormalized financial truth.

---

# 33. Notifications

Notifications are asynchronous side effects.

This rule is critical:

> A notification failure must never cause the underlying business operation to fail.

Example:

```text
ticket submitted
+
push provider unavailable
=
ticket still submitted
```

Likewise:

```text
invitation created
+
email provider unavailable
=
invitation still exists and can be retried
```

---

# 34. Invitation delivery

Creating an invitation token is not the same as delivering an invitation.

The complete flow is:

```text
invitation created
        |
        v
secure token/credential
        |
        v
notification job
        |
        v
transactional email provider
        |
        v
delivery result
        |
        v
recipient opens invitation
        |
        v
account authentication/creation
        |
        v
token validation
        |
        v
membership activation
```

Do not mark an invitation as successfully delivered merely because a token was minted.

---

# 35. Notification providers

For MVP:

```text
Email
=
transactional email provider

Mobile push
=
Expo Push

Android/iOS transport
=
Expo abstraction over platform push infrastructure

SMS
=
separate transactional provider

WhatsApp
=
separate approved business messaging channel
```

Do not hard-code provider APIs throughout the application.

Use provider adapters.

---

# 36. Push notification security

Never put sensitive data directly into push payloads.

Prefer:

```text
event_type
organization_id
resource_id
short display text
```

then let the authenticated application fetch authorized details.

Never treat a push payload as authorization.

---

# 37. Notification recipient authorization

A notification recipient must be authorized for the resource.

Do not do:

```text
all users in branch
```

without checking whether each user should receive that event.

For multi-organization users, verify organization and branch context.

---

# 38. Notification idempotency

A sync retry must not generate duplicate notifications.

Example:

```text
offline ticket
    |
    +-- sync attempt 1
    +-- sync attempt 2
    +-- sync attempt 3
```

must still produce one logical:

```text
ticket.created
```

event and one intended notification per recipient/channel.

---

# 39. Local notification versus server notification

Do not confuse:

```text
local device UI notification
```

with:

```text
server-side business notification
```

Offline UX can tell the driver:

```text
Ticket saved offline
Waiting for synchronization
```

without creating an organizational notification event.

Normal offline status is not a business notification.

---

# 40. Storage and files

Storage objects must follow the project's storage specification.

Do not expose permanent public URLs for sensitive organizational files.

Where sensitive files are involved, use controlled access and signed URLs according to the storage policy.

Deleting/archiving a database record must not automatically leave unmanaged sensitive files indefinitely.

Storage cleanup behavior must be explicit.

---

# 41. RLS is not optional

Every API-exposed public table must have appropriate RLS.

RLS must enforce organization/branch/user boundaries server-side.

Client-side checks are UX safeguards, not security.

Do not bypass RLS merely because a query is inconvenient.

Service-role/server-side operations must still perform explicit authorization in application logic where the service role bypasses RLS.

---

# 42. SECURITY DEFINER functions

If a database function uses `SECURITY DEFINER`:

- use a safe `search_path`
- qualify objects where appropriate
- validate the caller
- validate organization membership
- validate role/permission
- avoid trusting user-supplied organization IDs
- avoid privilege escalation through arbitrary function parameters

A SECURITY DEFINER function is a privileged boundary.

---

# 43. Database versus backend responsibilities

Use the database for:

- relational integrity
- foreign keys
- uniqueness
- check constraints
- RLS
- atomic transactions
- authoritative state transitions where appropriate
- audit records
- idempotency guarantees
- secure RPCs

Use backend/server functions for:

- provider API calls
- notification delivery
- external services
- orchestration
- secrets
- asynchronous jobs
- complex integration logic

Use the client for:

- UX
- local encrypted persistence
- offline queue
- optimistic UI where safe
- connectivity state
- presenting authorized data

Do not put security-critical authorization exclusively in the client.

---

# 44. Offline queue ownership

An offline mutation belongs to the organization/branch in which it was created.

Do not allow:

```text
current active organization
```

to determine the organization of an already queued mutation.

The queue record itself must contain the necessary context.

---

# 45. Device identity

A physical device can be used by a user who belongs to multiple organizations.

Device registration must therefore not be treated as proof of organization membership.

A device can hold data for multiple organizations only if the application has an explicit, secure reason to do so.

Local cached data must be partitioned by organization context.

---

# 46. Local cache isolation

Do not use one unscoped cache key such as:

```text
tickets
```

for all organizations.

Use organization/branch-aware keys conceptually such as:

```text
organization:{orgId}:branch:{branchId}:tickets
```

and ensure authorization before displaying data.

The exact implementation can vary, but the isolation principle cannot.

---

# 47. Do not assume online-only architecture

Never implement a feature with:

```text
network required
```

without checking whether the feature is one of the approved offline workflows.

At the same time, do not blindly make every feature offline-capable.

Offline support should be deliberate because it increases complexity around:

- conflicts
- encryption
- storage
- synchronization
- authorization
- reporting
- auditability

---

# 48. Do not make everything mutable for convenience

Avoid shortcuts such as:

```text
UPDATE ticket
UPDATE payment history
UPDATE audit record
UPDATE historical transaction
```

when the business model requires immutable history.

If the business meaning changes, create a new event/record representing the change.

---

# 49. Do not use hard delete as cleanup

Avoid:

```text
DELETE FROM tickets
```

for ordinary application cleanup.

Use the established archive/retention mechanism.

Hard deletion must only occur through the protected permanent-deletion process where explicitly permitted.

---

# 50. Do not solve business problems with UI restrictions

A button being hidden does not mean an action is secure.

For example:

```text
Hide "delete" button from Driver
```

is not enough.

The backend/database must reject the unauthorized action.

This applies to:

- ticket modification
- ticket archive
- organization access
- branch access
- financial operations
- role changes
- permanent deletion
- notification access

---

# 51. Do not infer permissions from UI routes

A route such as:

```text
/manager/tickets
```

does not establish manager authorization.

Authorization must be derived from the authenticated identity and backend permission model.

---

# 52. Do not create parallel concepts

Avoid introducing duplicate concepts such as:

```text
orders + tickets
manager + branch_manager
walk-in customer + roadside customer
delete + archive
sync approval + synchronization
```

unless the product specification explicitly distinguishes them.

If two concepts mean the same thing, use the established BakeFlow terminology.

---

# 53. Required implementation behavior when requirements are ambiguous

When Claude Code encounters ambiguity:

### Do

- inspect the live database
- inspect existing migrations
- inspect relevant specification documents
- inspect API contracts
- identify the invariant involved
- explain the ambiguity
- propose the smallest safe resolution

### Do not

- invent a new role
- invent a new status
- add a mutable shortcut
- weaken RLS
- bypass the offline protocol
- assume one organization per user
- silently rename core business concepts
- silently introduce hard deletion
- silently change financial definitions

---

# 54. Cross-cutting invariants

The following should be treated as automated test cases.

## Ticket invariants

```text
Submitted ticket cannot be updated.
Submitted ticket cannot be cancelled.
Correction creates a separate record/event.
Original ticket remains auditable.
```

## Deletion invariants

```text
Normal application flow cannot hard-delete.
Archive preserves history.
Permanent deletion is protected and auditable.
```

## Offline invariants

```text
Offline ticket can be created.
Local sensitive data is encrypted.
Sync is automatic.
Manager cannot disable normal sync.
Retries are idempotent.
Sync time does not replace business-event time.
```

## Organization invariants

```text
User may belong to multiple organizations.
Every operational mutation has explicit organization context.
Every mutation is authorization-checked server-side.
Organization A data cannot leak into Organization B.
Queued operations retain their original organization.
```

## Role invariants

```text
Supervisor is distinct from Branch Manager.
Supervisor has fewer privileges.
Owner/Admin are not automatically interchangeable.
Driver does not receive manager privileges.
```

## Customer invariants

```text
Driver selects existing customer when available.
Driver can create a registered customer when absent.
Roadside customer does not require registration.
Driver does not require recipient-name entry.
```

## Financial invariants

```text
Historical transactions are not rewritten.
Refunds are separate financial effects.
Reporting uses organization timezone.
Sync time is not the business reporting date.
Costing follows the approved costing method.
```

## Notification invariants

```text
Notification failure does not roll back business operations.
Duplicate sync does not create duplicate notifications.
Provider secrets stay server-side.
Push payloads do not contain unnecessary sensitive data.
Notification recipient must be authorized.
```

## Security invariants

```text
RLS protects exposed organizational data.
Client-side authorization is never the only security control.
SECURITY DEFINER functions validate callers and context.
Multi-organization access is enforced server-side.
```

---

# 55. Architecture principle: preserve history, derive state

BakeFlow should generally preserve the sequence of business events and derive current state from authoritative records.

Prefer:

```text
immutable event/history
        |
        v
derived current state
        |
        v
reporting/dashboard
```

over:

```text
mutable row
        |
        v
overwrite history
        |
        v
guess what happened
```

This is especially important for:

- tickets
- corrections
- payments
- refunds
- inventory movements
- financial audit
- synchronization
- security events

---

# 56. Architecture principle: server is authoritative

The client can operate offline, but offline does not mean the client becomes the permanent authority.

The client creates signed/identified operations that are later accepted/rejected/reconciled by the server.

The server/database remains authoritative for:

- permissions
- organization membership
- financial truth
- accepted business records
- final reporting
- cross-organization isolation

---

# 57. Architecture principle: offline-first, not offline-only

The intended model is:

```text
ONLINE
client -> server -> database

OFFLINE
client -> encrypted local store -> sync queue

RECONNECT
encrypted local queue -> idempotent sync -> server/database
```

The UI should remain useful offline.

The architecture should not duplicate the entire backend in the client.

---

# 58. Architecture principle: asynchronous side effects

Business operations and side effects should be separated.

Example:

```text
Ticket submitted
       |
       +--> persist ticket
       |
       +--> audit event
       |
       +--> notification job
       |
       +--> reporting derivation
```

Failure of:

```text
notification
analytics
push delivery
email delivery
```

must not invalidate the ticket itself.

---

# 59. Final instruction to Claude Code

Before implementing any new feature, answer internally:

1. Is this a new business concept or an existing one?
2. Does this affect immutable history?
3. Does this work offline?
4. Can the user belong to multiple organizations?
5. What organization/branch does the operation belong to?
6. What role is allowed to perform it?
7. Can this action mutate historical data?
8. Should this be an event/correction instead?
9. Does it create a notification?
10. Could retries duplicate the operation?
11. Does RLS enforce the boundary?
12. Does the operation expose sensitive data locally?
13. Does reporting depend on this event?
14. Does the operation need an audit trail?
15. Does the database or backend need to enforce something the client currently enforces only visually?

If any answer is unclear, inspect the relevant specification and live schema before coding.

---

# 60. Non-negotiable summary

The most important rules to keep in working memory are:

```text
TICKETS, NOT ORDERS.

SUBMITTED TICKETS ARE IMMUTABLE.

NO USER CAN EDIT OR CANCEL A SUBMITTED TICKET.

CORRECTIONS ARE NEW RECORDS/EVENTS REFERENCING THE ORIGINAL.

NORMAL APPLICATION FLOWS NEVER HARD-DELETE.

ARCHIVE IS NOT THE SAME AS PERMANENT DELETION.

PERMANENT DELETION IS AN EXCEPTIONAL, PROTECTED, AUDITED ACTION.

OFFLINE IS A FIRST-CLASS PRODUCT CAPABILITY.

OFFLINE DATA IS ENCRYPTED.

DRIVER SUBMISSION TIME IS AUTOMATIC; USER DOES NOT CHOOSE IT.

OFFLINE SYNC IS AUTOMATIC AND IS NOT MANAGER-CONTROLLED.

SYNC MUST BE IDEMPOTENT, ORDER-AWARE, AND CONFLICT-SAFE.

A DRIVER CAN BELONG TO MULTIPLE ORGANIZATIONS.

EVERY OFFLINE MUTATION RETAINS ITS ORIGINAL ORGANIZATION/BRANCH CONTEXT.

NEVER TRUST THE CURRENT ACTIVE ORGANIZATION FOR AN ALREADY-QUEUED OPERATION.

BRANCH MANAGER AND SUPERVISOR ARE DISTINCT ROLES.

SUPERVISOR HAS FEWER PRIVILEGES THAN BRANCH MANAGER.

REGISTERED CUSTOMERS AND ROADSIDE CUSTOMERS ARE DIFFERENT WORKFLOWS.

DRIVERS DO NOT ENTER RECIPIENT NAMES FOR NORMAL CUSTOMER TICKETS.

MANAGER/SUPERVISOR FINANCIAL AUDIT MUST SUPPORT THE APPROVED OFFLINE WORKFLOW.

REPORTING USES THE ORGANIZATION'S BUSINESS TIME/REPORTING RULES, NOT SYNC TIME.

REFUNDS ARE FINANCIAL EVENTS, NOT HISTORY REWRITES.

NOTIFICATION DELIVERY IS ASYNCHRONOUS AND NEVER DETERMINES BUSINESS TRANSACTION SUCCESS.

PUSH PAYLOADS ARE NOT AUTHORIZATION.

RLS AND SERVER-SIDE AUTHORIZATION ARE MANDATORY.

CLIENT-SIDE ROLE CHECKS ARE UX, NOT SECURITY.

PRESERVE HISTORY; DERIVE STATE.

WHEN IN DOUBT, DO NOT INVENT A NEW BUSINESS RULE.
