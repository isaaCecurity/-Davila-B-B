# OFFLINE-SYNC-MODEL.md

## Purpose

This document defines BakeFlow's production offline-first synchronization architecture.

Claude Code MUST treat this document as the source of truth for:
- offline persistence
- encrypted local data
- sync queue/outbox behavior
- synchronization RPCs
- idempotency
- revision ordering
- logical clocks
- conflict detection
- conflict resolution
- retry behavior
- multi-device convergence
- multi-organization isolation
- immutable tickets
- financial audit synchronization

This document exists because the offline system is a core BakeFlow differentiator, not a secondary convenience.

The application must remain operational when network connectivity is unavailable and must converge safely with Supabase/PostgreSQL when connectivity returns.

The database remains authoritative.

The device is an offline execution environment, not an alternate source of truth.

---

# 1. Core architecture

BakeFlow uses an offline-first architecture:

```text
React Native UI
      |
      v
Feature/domain service
      |
      +----------------------+
      |                      |
      v                      v
Encrypted Local DB       Sync Outbox
      |                      |
      +----------+-----------+
                 |
          Connectivity
                 |
                 v
        Synchronization Layer
                 |
                 v
          Supabase RPC/API
                 |
                 v
          PostgreSQL
```

The key rule is:

> Business operations are recorded locally first when necessary, then synchronized to the server through an explicit, idempotent protocol.

The UI must not directly decide how synchronization works.

The sync engine owns synchronization.

---

# 2. Offline-first does not mean serverless

Offline support does NOT mean the application creates an independent database universe.

The server remains authoritative for:
- organization membership
- role and permissions
- branch access
- financial truth
- ticket finality
- server-generated timestamps
- server revisions
- synchronization acceptance/rejection
- permanent deletion authorization
- audit state

The device is authoritative only for the local capture of operations that are explicitly permitted to happen offline.

---

# 3. Operations that may work offline

Offline capability is a product feature and must be intentionally scoped.

Current offline-capable operations include:

## Driver

The Driver can:
- view the locally available customer list
- select an existing customer
- create a new customer where permitted
- create a ticket
- create roadside-customer tickets without registering the customer
- submit tickets
- create correction tickets referencing prior tickets where the required source ticket is locally available
- continue operating when disconnected
- queue unsynchronized operations
- view synchronization state

A Driver cannot:
- set the ticket submission timestamp manually
- edit a submitted ticket
- cancel a submitted ticket
- hard-delete a ticket
- archive a ticket
- permanently delete data
- control whether synchronization occurs
- bypass organization/branch isolation

Ticket timestamping is automatic.

When a ticket is submitted locally, the client records the local capture timestamp for ordering/diagnostics, but the authoritative server submission timestamp is assigned by PostgreSQL when the operation is accepted.

---

# 4. Manager and Supervisor offline capability

Offline support is NOT limited to Drivers.

Managers and Supervisors may need offline access to daily financial/audit workflows.

The exact offline capabilities must remain domain-scoped, but the architecture must support:
- viewing required locally cached financial data
- preparing daily financial audit information
- recording permitted audit inputs
- saving audit work locally
- synchronizing audit operations automatically when connectivity returns

The Manager does NOT control synchronization.

There is no:

```text
Manager -> Start Sync
Manager -> Stop Sync
Manager -> Disable Sync
```

business authority.

Synchronization is an application capability that operates automatically.

---

# 5. Operations that must remain online

Some operations require a trusted server and MUST NOT be performed purely offline.

Examples:
- permanent deletion
- destructive deletion challenge creation/confirmation
- changing organization ownership
- changing high-risk permissions
- security-sensitive account operations
- operations requiring authoritative cross-device validation
- operations requiring server-only financial calculations where local correctness cannot be guaranteed

The product may expand this list later, but offline support must always be explicitly granted to an operation.

Default:

```text
not explicitly offline-safe
        =
online required
```

---

# 6. Local encrypted storage

All sensitive offline application data MUST be encrypted at rest on the device.

Do not rely on plain AsyncStorage for sensitive business data.

The local persistence layer should use an encrypted database/storage mechanism appropriate to React Native/Expo.

The architecture should separate:

```text
Encrypted domain database
Encrypted sync outbox
Secure credential/key storage
```

Authentication/session secrets should use platform secure storage.

Business data should use encrypted local persistence.

Do not put Supabase access tokens or sensitive credentials into ordinary unencrypted business-data tables.

---

# 7. Organization isolation on device

A Driver may belong to multiple organizations.

This is a critical security requirement.

The device MUST maintain explicit organization context.

Conceptually:

```text
Device
├── Organization A
│   ├── branch context
│   ├── cached data
│   └── outbox
│
└── Organization B
    ├── branch context
    ├── cached data
    └── outbox
```

Never allow a queued operation created for Organization A to be submitted under Organization B.

Every local operation MUST carry immutable tenant context such as:

```text
organization_id
branch_id
actor_user_id
device_id
operation_id
```

The server must independently verify those values.

The client is not trusted simply because it supplied the correct organization ID.

---

# 8. Active organization context

The UI must have an explicit active organization.

Recommended local state:

```text
activeOrganizationId
activeBranchId
```

The current organization/branch selection must be part of the operational context.

Before a Driver creates a ticket:

```text
authenticated user
        +
active organization
        +
active branch
        +
valid membership
        +
valid role/function
```

must all resolve correctly.

The ticket operation must bind to the selected organization/branch at creation time.

Do not let a later organization switch mutate the existing queued operation.

---

# 9. Organization-switch protection

A common dangerous scenario:

```text
Driver is in Organization A
creates offline ticket
switches to Organization B
sync starts
```

The ticket MUST still synchronize as an Organization A operation.

The operation must never inherit the currently selected organization at sync time.

Bad:

```text
outbox operation
  -> uses currentOrganizationId
```

Correct:

```text
outbox operation
  -> organization_id captured at operation creation
```

The server then validates that the authenticated user is still authorized for that organization.

If membership has been revoked, the operation must be rejected.

---

# 10. Local data model

The local database should distinguish between:

```text
domain records
sync metadata
outbox operations
conflict records
```

Do not overload domain tables with large amounts of sync-control state unless there is a clear reason.

Recommended conceptual entities for the local client:

```text
local_domain_records
sync_outbox
sync_conflicts
sync_state
device_context
```

The exact local schema may differ by implementation, but these responsibilities must remain clear.

**Corrected 2026-08-28 (AD-021, resolving BLOCKER-006).** `sync_conflicts` IS a
server-side table, authoritative — not only a client projection, and not merely
`sync_operations.status = 'CONFLICT'` with a message string. A conflict must survive
device loss, reinstall, local database corruption, and an organization switch, and must
remain visible to another authorized device or an administrator; a client-only record
cannot guarantee that. Minimum server contract: `id`, `tenant_id`, `branch_id`,
`entity_type`, `entity_id`, `operation_id`, `actor_id`, `device_id`, `operation_type`,
`operation_payload` (the original attempted operation, preserved for audit/recovery —
never discarded in favour of a human-readable message alone), `base_revision`,
`current_revision`, `conflict_code`, `conflict_status` (`OPEN | RESOLVED | DISMISSED`),
`created_at`, `resolved_at`, `resolved_by`, `resolution_type`, `resolution_payload`. The
client may still keep a local projection of server conflicts for UX; it is not the
record of truth. See AD-021 in `ARCHITECTURE_DECISIONS.md` for the full decision.

---

# 11. Sync outbox

Every offline mutation that needs server synchronization becomes an outbox operation.

Conceptual structure:

```text
sync_outbox
------------
operation_id
organization_id
branch_id
actor_user_id
device_id
entity_type
entity_id
operation_type
payload
base_revision
client_sequence
client_timestamp
created_at
attempt_count
next_attempt_at
status
last_error_code
last_error_message
```

Potential status values:

```text
PENDING
SYNCING
APPLIED
REJECTED
CONFLICT
DEAD_LETTER
```

Do not delete failed operations silently.

Retain enough metadata to diagnose why synchronization failed.

---

# 12. Operation IDs

Every mutation operation MUST have a globally unique:

```text
operation_id
```

Prefer UUID/UUIDv7 or another collision-resistant identifier appropriate to the implementation.

The operation ID is the primary idempotency key.

It must remain stable across retries.

Example:

```text
operation_id = 0198...
```

If the network fails after the server accepted the operation:

```text
client -> server
server -> commits
network timeout
client -> retries same operation_id
```

the server MUST recognize the duplicate and return the original result rather than applying the operation again.

---

# 13. Idempotency is mandatory

All sync mutation RPCs MUST be idempotent.

A retry must not create:
- duplicate tickets
- duplicate customers
- duplicate financial entries
- duplicate corrections
- duplicate inventory movements
- duplicate audit records

The server should maintain an idempotency record keyed by:

```text
organization_id
+
operation_id
```

The exact implementation may use a dedicated table or another robust PostgreSQL mechanism.

Never use only:

```text
operation_id
```

without tenant binding.

---

# 14. Idempotency result retention

When an operation is accepted, the server should persist enough result metadata to answer repeated requests.

Conceptually:

```text
operation_id
status
entity_type
entity_id
server_revision
result_payload/reference
processed_at
```

A retry should return the previous result.

Do not re-run the mutation simply because the client does not remember the response.

---

# 15. Operation payload immutability

Once an operation is submitted, its operation payload should be treated as immutable.

Do not reuse the same operation ID for a different payload.

Invalid:

```text
operation_id = X
payload = ticket A

retry:
operation_id = X
payload = ticket B
```

The server should reject the second request as an idempotency violation.

This protects against client bugs and malicious replay/manipulation.

---

# 16. Client sequence numbers

Each device should maintain a monotonic local sequence for mutation ordering.

Conceptually:

```text
device_id
client_sequence
```

Example:

```text
device A
1
2
3
4
5
```

The sequence is useful for:
- deterministic local ordering
- diagnostics
- replay detection
- dependency ordering
- debugging

It is NOT a substitute for server revisions.

Do not treat a device sequence as global truth.

---

# 17. Logical clocks

BakeFlow should use logical ordering rather than trusting wall-clock timestamps for conflict decisions.

Client timestamps can be wrong because:
- device clock may be incorrect
- timezone changes
- clock adjustments can move time backward
- offline devices can remain disconnected for hours/days
- multiple devices can have different clocks

Therefore:

```text
client_timestamp
```

is informational/diagnostic.

It is not authoritative conflict ordering.

---

# 18. Server revision

The server must provide authoritative revision ordering for synchronized mutable entities.

Conceptually:

```text
revision
```

is monotonically increasing for an entity or synchronization stream.

Example:

```text
customer A
revision 41
revision 42
revision 43
```

A client reading revision 42 knows it is based on server state 42.

A mutation can provide:

```text
base_revision = 42
```

The server can then detect whether the record changed before applying the operation.

---

# 19. Revision versus timestamp

Never use:

```text
updated_at > client_timestamp
```

as the primary conflict mechanism.

Use:

```text
base_revision
```

against authoritative server revision.

Timestamps remain useful for:
- display
- auditing
- diagnostics
- sorting where business rules explicitly permit it

They are not a safe concurrency primitive.

---

# 20. Hybrid logical ordering

The synchronization system may use a hybrid logical clock or server sequence for cross-operation ordering.

The minimum requirement is:

```text
client sequence
+
server revision
+
server timestamp
```

must be available where needed.

Do not introduce a complex distributed clock algorithm unless it solves an actual product requirement.

The MVP should prefer PostgreSQL-controlled revisions and explicit operation sequencing.

---

# 21. Four live synchronization tables

The four live server-side synchronization/domain tables referenced by the API contract MUST have their synchronization responsibilities explicitly documented before implementation changes.

For each table, Claude Code must document:

```text
table purpose
tenant scope
branch scope
primary key
revision field
created_at
updated_at
soft-delete/archive fields
offline-readable?
offline-writable?
allowed offline operations
conflict strategy
idempotency requirements
```

Do not assume all four tables use the same conflict strategy.

The domain determines the synchronization behavior.

**Resolved 2026-08-28 (AD-021, BLOCKER-006).** Per-entity strategy for the initial syncable
scope: tickets (creation + lifecycle transitions) — operation-based, state-machine
validated; ticket item/amount edits within the mutable window (`STATE-MACHINES.md` §6) —
`base_revision`-checked optimistic concurrency, no field-level merge; inventory — append-only
domain operations (`inventory.adjust`/`.receive`/`.consume`/`.waste`/`.transfer`), never a
synchronized absolute quantity; production — operation-based, state-machine validated;
payments/expenses — append-only + explicit reversal, never an in-place amount edit;
customers — `base_revision`-checked optimistic concurrency; products/catalog —
server-authoritative, offline read/cache only, no offline create/edit in first scope.
`operation_type` is a finite allowlist of domain operations (`ticket.create`,
`ticket.transition`, `ticket.item_update`, `inventory.adjust`, `production.start`,
`payment.reverse`, etc. — never `order.*`; AD-011 forbids "order" naming in code) dispatched
to registered handlers; unknown types are rejected. Full decision: AD-021.

---

# 22. Two synchronization RPCs

The two synchronization RPCs must be treated as the server synchronization boundary.

Their exact signatures must remain aligned with the current `API-CONTRACT.md` and generated database types.

Conceptually the responsibilities are:

```text
push local operations
        +
pull server changes
```

The RPC contract must define:
- request schema
- response schema
- authentication
- organization validation
- branch validation
- idempotency
- ordering
- revision handling
- conflict behavior
- rejection codes
- retry behavior

Do not create a second parallel sync API without updating the contract.

Do not silently change an RPC signature without updating:
- API contract
- database migration
- generated types
- frontend sync service
- tests

---

# 23. Push protocol

Conceptual flow:

```text
Client
  |
  | batch of operations
  v
sync push RPC
  |
  +-- authenticate
  +-- validate tenant
  +-- validate branch
  +-- validate device
  +-- validate actor
  +-- validate operation IDs
  +-- validate operation ordering
  +-- check idempotency
  +-- validate base revisions
  +-- apply/reject/conflict
  |
  v
response per operation
```

The server must process each operation deterministically.

A batch must not assume every operation succeeds.

---

# 24. Push response

Each operation should receive an explicit outcome.

Conceptual response:

```text
operation_id
status
entity_type
entity_id
server_revision
server_timestamp
error_code
conflict_details
```

Status should distinguish at least:

```text
APPLIED
ALREADY_APPLIED
REJECTED
CONFLICT
```

Do not collapse all failures into:

```text
SYNC_FAILED
```

The client needs to know whether to:
- remove from outbox
- retry
- surface a user action
- mark a conflict
- refresh state

---

# 25. Pull protocol

Pull should be based on an authoritative synchronization cursor.

Conceptually:

```text
cursor
```

or:

```text
last_server_revision
```

The client asks:

```text
give me changes after cursor X
```

The server returns:
- changes
- next cursor
- whether more pages exist

Example:

```text
changes[]
next_cursor
has_more
```

Never rely on:

```text
WHERE updated_at > last_sync_time
```

alone.

Timestamp-only sync can miss records due to clock precision and concurrent writes.

---

# 26. Sync cursor storage

The client should persist sync state per organization and, where required, per branch/scope.

Conceptually:

```text
sync_state
-----------
organization_id
branch_id
cursor
last_successful_sync_at
last_attempt_at
status
```

Do not use one global cursor for all organizations.

Do not use one organization cursor for unrelated synchronization scopes if the server contract requires separate streams.

---

# 27. Pull ordering

Server changes must have deterministic ordering.

Recommended ordering:

```text
server_revision ASC
```

or another explicitly documented monotonic synchronization sequence.

The client should apply changes in server-defined order.

Never sort server changes by client timestamp.

---

# 28. Pagination

Sync must support pagination.

A large offline gap may produce thousands of changes.

Do not return an unbounded synchronization payload.

The pull API should support:
- cursor
- page size
- next cursor
- continuation

The client must safely resume after an interrupted page.

Do not advance the cursor until the page has been successfully applied/persisted.

---

# 29. Cursor advancement invariant

Critical rule:

```text
receive changes
      |
      v
validate
      |
      v
persist changes transactionally
      |
      v
advance cursor
```

Never:

```text
advance cursor
      |
      v
persist changes
```

If the app crashes after the cursor advances but before data is persisted, data can be permanently skipped.

Cursor advancement must be atomic with successful local persistence.

---

# 30. Conflict definition

A conflict occurs when the local operation is based on state that is no longer current and cannot safely be merged automatically.

Example:

```text
Server revision = 20

Device A reads revision 20
Device B reads revision 20

Device A updates -> revision 21

Device B submits update with base_revision 20
```

Device B's operation is now based on stale state.

The server must not blindly overwrite revision 21.

---

# 31. Conflict classes

Use explicit conflict classes.

### Non-conflicting/idempotent

Example:
- repeated archive request
- repeated sync operation with same operation ID

Result:

```text
ALREADY_APPLIED
```

### Stale mutation

Example:
- update based on old revision

Result:

```text
CONFLICT
```

### Authorization failure

Example:
- user membership revoked while offline

Result:

```text
REJECTED
AUTHORIZATION_FAILED
```

### Lifecycle violation

Example:
- attempting to modify submitted immutable ticket

Result:

```text
REJECTED
IMMUTABLE_ENTITY
```

### Validation failure

Example:
- product no longer exists
- required field invalid

Result:

```text
REJECTED
VALIDATION_FAILED
```

### Tenant violation

Result:

```text
REJECTED
TENANT_SCOPE_VIOLATION
```

---

# 32. Conflict resolution principle

Do NOT implement generic last-write-wins across all BakeFlow data.

That would be dangerous for:
- tickets
- financial records
- inventory
- audits
- corrections

Conflict strategy must be entity-specific.

Recommended strategies:

```text
immutable event creation
server rejection + correction
optimistic concurrency
field-level merge only where safe
server-authoritative state
```

---

# 33. Tickets use event semantics

Submitted tickets are immutable.

Therefore ticket synchronization should NOT resolve conflicts by overwriting ticket fields.

A ticket creation is an event:

```text
CREATE_TICKET
```

Once accepted, it cannot become:

```text
UPDATE_TICKET
```

A correction is:

```text
CREATE_CORRECTION_TICKET
```

referencing the original.

This makes ticket synchronization significantly safer.

**Note (AD-021):** this event-only rule governs ticket *creation and lifecycle
transitions*. It does not forbid the separate, narrower case of editing an existing
ticket's items/amounts while `STATE-MACHINES.md` §6 still permits mutation (confirmed,
scheduled, in_production) — that case uses `base_revision`-checked optimistic concurrency
instead (§21, AD-021), not an event, and not a field-level merge. Once a ticket leaves the
mutable window, no further edit path exists offline or online; only a correction ticket
does.

---

# 34. Ticket duplicate protection

A driver may submit a ticket offline and then retry after reconnect.

The same ticket must not be created twice.

Use:

```text
operation_id
```

as the idempotency key.

Do not rely on:
- customer ID
- amount
- product
- timestamp
- device timestamp

to determine whether a ticket is a duplicate.

Those values can legitimately repeat.

---

# 35. Ticket timestamps

The Driver cannot manually choose the authoritative submission time.

Offline capture may record:

```text
client_created_at
```

for diagnostics.

The server assigns:

```text
server_created_at
```

when the operation is accepted.

The application must distinguish:

```text
captured_at
submitted_to_server_at
```

when both are needed.

Do not pretend the offline client timestamp is the server submission timestamp.

---

# 36. Correction synchronization

A correction ticket references the original ticket.

Offline correction is allowed only when the local client has enough information to safely reference the source.

The correction must contain:

```text
correction_of_ticket_id
```

or the exact canonical field defined by the database.

The server must validate:
- source ticket exists
- source ticket belongs to same organization
- source ticket belongs to permitted branch/scope
- source ticket is eligible for correction
- correction has not already been applied if the operation is retried

Do not modify the original ticket.

---

# 37. Customer creation offline

A Driver may create a customer offline when the customer is not already registered.

The local customer needs a stable client-generated ID.

Use a UUID/UUIDv7 or equivalent globally unique identifier so dependent offline tickets can reference it immediately.

Example:

```text
offline customer
id = client-generated UUID

offline ticket
customer_id = same UUID
```

When synchronized, the server should preserve the identity where the schema/protocol permits it.

Do not generate a temporary numeric ID and later rewrite every dependent record unless the synchronization layer explicitly supports identity mapping.

---

# 38. Roadside customers

Roadside customers do not require registration.

The offline model must therefore distinguish:

```text
registered customer ticket
```

from:

```text
roadside/anonymous customer ticket
```

Do not create fake customer rows such as:

```text
Walk-in Customer
Roadside Customer
Anonymous Customer
```

just to satisfy a foreign key.

Use the canonical ticket/customer model defined by the database.

---

# 39. Offline financial audits

Daily financial audit operations must synchronize safely.

Audit data is financially important.

Do not use last-write-wins to silently overwrite an audit.

If two devices prepare conflicting audit states:

```text
Supervisor device
Manager device
```

the server must detect the conflict.

The appropriate response is:

```text
CONFLICT
```

followed by explicit user review or a domain-specific reconciliation operation.

Never silently pick whichever device synchronized last.

---

# 40. Inventory synchronization

Inventory is concurrency-sensitive.

Do not synchronize:

```text
stock = 120
```

as a blind overwrite if multiple devices can modify stock.

Prefer event/adjustment semantics where possible:

```text
STOCK_ADJUSTMENT +5
STOCK_ADJUSTMENT -2
```

or server-side atomic adjustment functions.

The exact strategy must match the live inventory schema.

The server remains authoritative for stock totals.

---

# 41. Financial mutation synchronization

Financial mutations should be event-like and idempotent.

Do not synchronize a mutable total such as:

```text
cash_balance = 50000
```

as the primary mutation.

Prefer:
- payment event
- refund event
- expense event
- audit submission
- adjustment/reconciliation event

The server computes authoritative totals.

---

# 42. Offline deletion synchronization

Soft deletion is synchronized as a mutation event.

Example:

```text
operation_type = SOFT_DELETE
```

The server:
- validates actor
- validates tenant
- validates permission
- validates current lifecycle
- records deletion actor/time
- increments revision
- returns authoritative state

Permanent deletion cannot be represented as a normal offline outbox operation.

---

# 43. Archive synchronization

Archive is similarly a server-validated lifecycle transition.

Example:

```text
operation_type = ARCHIVE
```

The server must enforce the role/permission rules.

A Driver cannot queue:

```text
ARCHIVE_TICKET
```

and expect the server to accept it.

Offline operation does not bypass authorization.

---

# 44. Sync authorization

Every push must be authenticated.

The server must derive:

```text
auth.uid()
```

and validate:
- user membership
- organization
- branch
- role
- permission
- operation/entity compatibility

Do not trust:
- client role
- client organization ID
- client branch ID
- client actor ID
- client permission list

Those are hints/context, not security boundaries.

---

# 45. Device identity

Each registered device should have a stable device identifier.

Conceptually:

```text
device_id
user_id
organization_id
platform
created_at
last_seen_at
revoked_at
```

The exact live schema may differ.

The sync system should be able to identify which device generated an operation.

If a device is revoked, future sync attempts must be rejected.

Already accepted operations remain historical.

---

# 46. Device revocation

Revoking a device must not allow it to continue syncing indefinitely.

Server behavior:

```text
device revoked
    |
    v
future push/pull rejected
```

The client should transition into an appropriate blocked/re-authentication state.

Do not allow the device to continue based solely on cached permissions.

---

# 47. Permission changes while offline

Offline permissions are snapshots.

If a user is demoted or removed from an organization while offline:

```text
offline operation created
```

does not guarantee acceptance.

When synchronized, the server rechecks current authorization.

Possible result:

```text
REJECTED
AUTHORIZATION_FAILED
```

The client must not treat cached role state as authoritative.

---

# 48. Branch changes while offline

The same rule applies to branch assignment.

A user may create an offline operation while assigned to Branch A.

If their branch access changes before synchronization:

```text
server validates current access
```

The old operation is not automatically re-bound to Branch B.

Never mutate the operation's branch context after creation.

---

# 49. Dependency ordering

Offline operations may depend on earlier operations.

Example:

```text
1. CREATE_CUSTOMER
2. CREATE_TICKET(customer_id)
```

The client must not send operation 2 before operation 1 is accepted if the server requires the customer to exist first.

Possible dependency metadata:

```text
depends_on_operation_id
```

The sync engine must respect dependency ordering.

If operation 1 fails:

```text
operation 2
```

may also need to be rejected or placed into a dependency-failed state.

Do not send dependent operations blindly.

---

# 50. Batch synchronization

The sync engine should batch operations for efficiency.

However, batching must not compromise:
- authorization
- idempotency
- dependency ordering
- transaction safety
- conflict reporting

A batch is not necessarily one database transaction.

The server must define whether operations are:
- independently committed
- atomically grouped
- dependency chained

Do not assume "batch" means "all-or-nothing."

---

# 51. Retry policy

Retries should use controlled backoff.

Example conceptual strategy:

```text
attempt 1 -> immediate retry
attempt 2 -> short delay
attempt 3 -> longer delay
...
```

Use exponential backoff with jitter where appropriate.

Do not retry permanent failures indefinitely.

Retryable:

```text
NETWORK_ERROR
TIMEOUT
TEMPORARY_SERVER_ERROR
```

Usually non-retryable:

```text
VALIDATION_FAILED
AUTHORIZATION_FAILED
TENANT_SCOPE_VIOLATION
IMMUTABLE_ENTITY
PERMISSION_DENIED
INVALID_OPERATION
```

Conflict may require user/domain resolution rather than automatic retry.

---

# 52. Dead-letter operations

An operation that cannot be automatically resolved should enter:

```text
DEAD_LETTER
```

or equivalent persistent error state.

Do not delete it.

The user/support tooling should be able to inspect:
- operation ID
- entity
- timestamp
- error code
- server response
- retry count

Sensitive payloads must not be exposed indiscriminately.

---

# 53. Sync status in the UI

The UI should expose meaningful state.

Examples:

```text
Saved offline
Waiting to sync
Syncing
Synced
Needs attention
```

Do not display misleading:

```text
Saved
```

when the data exists only locally.

For tickets, the Driver should clearly understand:

```text
Ticket saved on device
Awaiting synchronization
```

without implying the server has accepted it.

---

# 54. Server acknowledgement

A ticket or financial event becomes server-authoritative only after the server acknowledges acceptance.

Local creation is not equivalent to server acceptance.

The UI should distinguish:

```text
LOCAL_ONLY
SYNC_PENDING
SERVER_ACCEPTED
SYNC_REJECTED
CONFLICT
```

This state must be derived from synchronization metadata.

---

# 55. Sync rejection handling

If a ticket is rejected during synchronization:
- do not silently delete it
- preserve the local record
- preserve the operation
- record rejection reason
- surface actionable information
- prevent duplicate retries if the rejection is permanent
- allow domain-specific remediation where appropriate

For an immutable ticket, do not "fix" the rejected ticket by editing it.

Create a new corrected operation when the business rules permit.

---

# 56. Security model

Offline encryption protects data at rest.

It does NOT replace:
- Supabase RLS
- server authorization
- tenant isolation
- device validation
- role/permission validation
- audit logging

The security chain is:

```text
encrypted local storage
+
authenticated sync
+
server-side authorization
+
RLS
+
tenant isolation
+
audit trail
```

All layers are required.

---

# 57. RLS implications

Synchronization RPCs must operate safely with Supabase RLS.

If using `SECURITY DEFINER` functions, they must be hardened with:

```sql
SECURITY DEFINER
SET search_path TO 'public'
```

and explicit authorization checks.

Do not use `SECURITY DEFINER` as a way to bypass authorization.

Do not let an RPC accept arbitrary tenant IDs and return arbitrary tenant changes.

---

# 58. Search path and function security

Sync functions must:
- use a controlled `search_path`
- qualify database objects where appropriate
- avoid unsafe dynamic SQL
- validate all identifiers/IDs
- restrict EXECUTE privileges
- be callable only by intended application roles

Example principle:

```sql
REVOKE ALL ON FUNCTION public.sync_push(...) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_push(...) TO authenticated;
```

The exact live function signature must match the API contract.

---

# 59. Sync transaction boundaries

A push operation should apply a mutation and its idempotency record atomically.

Conceptually:

```text
BEGIN

check operation_id

if already processed:
    return previous result

validate authorization
validate revision
apply domain mutation
record server revision
record idempotency result

COMMIT
```

If the transaction fails:

```text
ROLLBACK
```

No partial mutation should remain.

---

# 60. Revision update rule

Whenever a synchronized mutation changes a revisioned entity:

```text
old revision
    ->
new revision
```

must occur atomically with the mutation.

Never update revision in a separate asynchronous process that could leave:

```text
data changed
revision unchanged
```

or:

```text
revision changed
data unchanged
```

---

# 61. Optimistic concurrency

For mutable entities, use:

```text
base_revision
```

provided by the client.

Server rule:

```text
if base_revision != current_revision
    -> conflict or domain-specific resolution
else
    -> apply
    -> increment revision
```

Do not use blind overwrite.

For entities that are inherently event-based, revision conflicts may not apply in the same way.

Document the exception.

---

# 62. Last-write-wins restrictions

Do not use generic:

```text
last write wins
```

for all tables.

LWW may be acceptable for low-risk preferences or explicitly mergeable configuration.

It is not acceptable as the default for:
- tickets
- financial transactions
- audits
- inventory movements
- immutable history

If LWW is used for an entity, document why.

---

# 63. Multi-device convergence

The fundamental sync guarantee is:

> If all valid operations eventually reach the server and all authorized devices successfully consume server changes, all devices converge to the same server-authoritative state.

The system must avoid permanent divergence caused by:
- lost cursor
- duplicate operation
- non-idempotent retry
- hidden conflict
- client-clock ordering
- organization context switching
- partial page application

---

# 64. Pull/apply transaction

When pulling server changes:

```text
BEGIN local transaction

apply page of server changes
update sync cursor

COMMIT
```

If local persistence fails:

```text
ROLLBACK
```

and do not advance the cursor.

This guarantees the next sync can safely retry the same page.

---

# 65. Tombstones

Soft-deleted/archived records may need synchronization as tombstone/lifecycle events.

Do not simply omit deleted records from pull results.

If Device B still has:

```text
Customer A
```

and Device A soft-deletes it, Device B needs a synchronization event telling it to mark the record deleted/archived.

Conceptually:

```text
entity_id
entity_type
revision
lifecycle_state = DELETED
deleted_at
deleted_by
```

The exact payload must match the live API contract.

---

# 66. Tombstone retention

Do not immediately purge synchronization metadata for deleted records.

A device that has been offline for a long period may need the tombstone to converge.

Retention for sync tombstones must be longer than the maximum supported offline window, or the server must provide a full-resync mechanism.

If the server can no longer provide incremental changes safely:

```text
CURSOR_TOO_OLD
```

should trigger:

```text
FULL_RESYNC_REQUIRED
```

rather than silently producing incomplete data.

---

# 67. Full resynchronization

The sync engine must have a recovery path.

Possible causes:
- cursor invalid
- cursor too old
- local database corruption
- device restored from backup
- sync metadata lost
- server retention window exceeded

The recovery sequence:

```text
invalidate local sync cursor
        |
        v
download authorized current snapshot
        |
        v
reconcile local state
        |
        v
rebuild sync cursor
        |
        v
replay remaining local outbox
```

Never blindly overwrite unsynchronized local operations during full resync.

The outbox must be preserved and reconciled.

---

# 68. Local database corruption

If encrypted local storage is corrupted:
- preserve any recoverable outbox
- do not claim server sync succeeded
- require recovery/re-authentication as appropriate
- rebuild local cache from server
- preserve pending operations where safely possible

The sync layer must fail closed rather than silently losing business operations.

---

# 69. Logout behavior

Logging out must not automatically destroy unsynchronized business operations without an explicit policy.

Before logout, the application should attempt synchronization where possible.

If pending operations remain:
- warn the user
- preserve encrypted local outbox according to the security model
- prevent another user from accessing the previous user's operations

A subsequent user on the same device must never inherit another user's pending operations.

---

# 70. User/device boundary

The local outbox must be bound to:
- authenticated user
- organization
- device

Do not treat a device as sufficient authorization.

A shared device can have multiple users.

Pending operations must not cross user sessions unless the product explicitly supports secure continuation.

---

# 71. Clock handling

Use UTC internally.

Store:
- server timestamps as `timestamptz`
- client timestamps as UTC where available

Do not use local formatted strings for synchronization.

Client clock drift should never cause data corruption.

If the client clock is obviously invalid, record diagnostics but continue using server revision/ordering for authority.

---

# 72. Monotonic local time

Where platform APIs support a monotonic clock, it may be used for measuring:
- retry intervals
- sync duration
- connection timing

Do not use monotonic device time as a persisted business timestamp.

---

# 73. Sync event ordering

There are three distinct concepts and Claude Code must not conflate them:

### Business timestamp

When the business event occurred.

### Client capture sequence/time

When the offline device recorded it.

### Server synchronization revision/time

When the server accepted and ordered it.

They may differ.

Example:

```text
Ticket captured offline:
2026-08-10 09:00

Device reconnects:
2026-08-10 12:00

Server accepts:
2026-08-10 12:01

server_revision:
84721
```

Do not rewrite the business timestamp merely because synchronization happened later.

---

# 74. Offline ticket timestamp requirement

The Driver does not manually set ticket time.

The UI should not provide a date/time field for manual selection.

The app automatically records the capture/submission event.

Server acceptance time remains authoritative for server synchronization.

If the business requires the original event time, that must be derived from the application's automatic capture timestamp, not user input.

---

# 75. Data validation before enqueue

Offline operations must be validated locally before being placed into the outbox.

Use the shared validation package.

However:

> Local validation is not authorization.

The server must validate again.

Local validation provides:
- faster UX
- reduced invalid queue entries
- early feedback

Server validation provides:
- security
- authoritative business rules
- current state validation

---

# 76. Payload limits

Offline payloads must be bounded.

Do not allow arbitrary massive JSON payloads into the outbox.

Define limits for:
- payload size
- text fields
- number of line items
- batch size
- number of operations per request

Reject or split oversized payloads before synchronization.

Never use an unbounded offline queue without monitoring.

---

# 77. Sensitive data in payloads

Do not put secrets into synchronization payloads.

Never store:
- auth tokens
- passwords
- raw payment credentials
- service-role keys
- destructive confirmation secrets

Business data may be stored according to the offline policy, but it must remain encrypted.

---

# 78. Sync logging

Logs must be useful but safe.

Log:
- operation ID
- entity type
- status
- error code
- timing
- retry count
- server revision

Do not log:
- full customer PII unnecessarily
- full financial payloads
- auth tokens
- challenge secrets
- encryption keys

Use correlation IDs for troubleshooting.

---

# 79. Observability

The synchronization layer should expose metrics such as:
- pending operation count
- oldest pending operation age
- successful sync count
- rejected operation count
- conflict count
- average sync duration
- retry count
- full resync count
- cursor failures

These metrics are operational diagnostics, not business data.

---

# 80. Testing matrix

Every sync implementation must test at least:

### Basic offline

```text
disconnect
create valid operation
persist locally
reconnect
sync
verify server state
```

### Retry

```text
server accepts
response lost
client retries same operation_id
verify one mutation
```

### Duplicate

```text
same operation twice
verify one mutation
```

### Stale revision

```text
device A updates revision N
device B submits base_revision N-1
verify conflict
```

### Authorization revocation

```text
create offline operation
revoke permission
sync
verify rejection
```

### Organization switch

```text
create operation in Org A
switch to Org B
sync
verify operation remains Org A
```

### Branch change

```text
create in Branch A
change assignment
sync
verify server authorization behavior
```

### Dependency

```text
create customer
create ticket referencing customer
sync
verify dependency order
```

### Cursor safety

```text
receive page
crash before cursor commit
restart
replay page safely
```

### Pagination

```text
large change set
multiple pages
verify no missing/duplicate changes
```

### Full resync

```text
invalidate cursor
perform full resync
preserve/reconcile pending outbox
```

### Immutable ticket

```text
offline UPDATE_TICKET
verify rejection
```

### Correction

```text
offline CREATE_CORRECTION_TICKET
verify original remains unchanged
```

### Financial audit conflict

```text
two devices submit conflicting audit state
verify explicit conflict
verify no silent overwrite
```

### Offline encryption

Verify sensitive local records are not stored as plaintext in ordinary storage.

---

# 81. Claude Code implementation instructions

Before changing synchronization code:

1. Read `API-CONTRACT.md` completely, especially §6.
2. Inspect the live Supabase schema.
3. Inspect the exact signatures of the two sync RPCs.
4. Inspect the four live tables referenced by the API contract.
5. Inspect current RLS policies.
6. Inspect generated Supabase types.
7. Search the repository for all existing sync code.
8. Search for `operation_id`, `revision`, `cursor`, `sync`, `outbox`, `offline`, `conflict`, `idempotency`.
9. Do not invent a second sync protocol.
10. Do not rename or alter the existing sync RPCs without updating the API contract and migrations.
11. Preserve existing database behavior unless the documented model requires a correction.
12. Implement idempotency before optimizing throughput.
13. Implement revision/concurrency protection before implementing conflict UI.
14. Never use client timestamps as authoritative conflict ordering.
15. Never use generic last-write-wins for financial or immutable data.
16. Preserve organization and branch context on every queued operation.
17. Never derive an operation's organization from the current UI context during synchronization.
18. Keep offline data encrypted.
19. Keep permanent deletion online-only.
20. Keep synchronization automatic; it is not controlled by Manager permissions.
21. Add tests for duplicate/retry/stale revision/tenant isolation before calling the implementation complete.

---

# 82. Code review checklist

Before merging sync changes:

- [ ] API contract §6 reviewed
- [ ] live RPC signatures verified
- [ ] live table schema verified
- [ ] RLS verified
- [ ] operation IDs are stable and unique
- [ ] idempotency is server-enforced
- [ ] repeated requests return the previous result
- [ ] operation payload cannot mutate under the same ID
- [ ] organization is captured at operation creation
- [ ] branch is captured at operation creation
- [ ] user/device identity is captured
- [ ] server revalidates authorization
- [ ] client timestamps are not used as authoritative conflict ordering
- [ ] server revisions are authoritative
- [ ] stale revisions are detected
- [ ] conflict classes are explicit
- [ ] ticket updates are rejected after submission
- [ ] corrections create new tickets
- [ ] financial mutations do not use blind last-write-wins
- [ ] cursor advancement is atomic with local persistence
- [ ] pagination is supported
- [ ] full resync exists
- [ ] tombstones are supported where required
- [ ] offline data is encrypted
- [ ] permanent deletion is online-only
- [ ] failed operations are retained
- [ ] retryable and permanent errors are distinguished
- [ ] dependency ordering is enforced
- [ ] payload sizes are bounded
- [ ] sensitive data is excluded from logs
- [ ] organization-switch scenario is tested
- [ ] revoked-user scenario is tested
- [ ] duplicate-ticket scenario is tested
- [ ] financial-audit conflict scenario is tested

---

# 83. Final synchronization contract

BakeFlow's synchronization system follows these non-negotiable rules:

```text
LOCAL FIRST
    ↓
ENCRYPTED STORAGE
    ↓
IMMUTABLE OUTBOX OPERATION
    ↓
STABLE OPERATION ID
    ↓
AUTOMATIC RETRY
    ↓
SERVER AUTHENTICATION
    ↓
TENANT + BRANCH VALIDATION
    ↓
IDEMPOTENCY CHECK
    ↓
REVISION / CONCURRENCY CHECK
    ↓
DOMAIN-SPECIFIC MUTATION
    ↓
SERVER REVISION
    ↓
ACKNOWLEDGEMENT
    ↓
PULL SERVER CHANGES
    ↓
APPLY LOCALLY
    ↓
ADVANCE CURSOR
```

The synchronization system must guarantee:

1. No duplicate business mutations from retries.
2. No cross-organization synchronization.
3. No unauthorized offline operation becoming valid merely because it was created while online.
4. No client-clock-based destructive conflict resolution.
5. No silent overwriting of financial or immutable history.
6. No modification of submitted tickets.
7. Corrections are new ticket events.
8. Offline data is encrypted.
9. Server state remains authoritative.
10. Devices eventually converge when valid operations and server changes are successfully exchanged.
11. Failed/conflicting operations remain diagnosable.
12. Synchronization cannot be disabled or selectively controlled by a Manager as a business permission.

This document is the source of truth for BakeFlow's offline-first synchronization model. Any implementation that contradicts this document must be treated as an architectural change requiring explicit review and corresponding updates to `API-CONTRACT.md`, database migrations, generated types, tests, and engineering documentation.
