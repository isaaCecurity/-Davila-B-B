# NOTIFICATIONS-SPEC.md

## BakeFlow Notifications Specification

**Status:** Architecture / implementation specification
**Source of truth for:** notification events, delivery channels, templates, preferences, routing, deduplication, security, offline behavior, and notification lifecycle.

---

# 1. Purpose

BakeFlow notifications must keep users informed about events that require attention without turning the application into a noisy messaging system.

Notifications are a **derived communication layer**.

They must never become the authoritative source of business state.

The authoritative state remains in the domain tables such as:

- `tickets`
- `payments`
- `refunds`
- `cash_sessions`
- `daily_financial_audits`
- `organization_invites`
- `sync_operations`
- `sync_devices`
- `audit_log`
- organization/branch/user-role/permission tables

The notification system observes authoritative events and produces user-facing messages.

A notification being:
- created,
- delayed,
- duplicated,
- dismissed,
- or deleted

must never change the underlying business transaction.

---

# 2. Current database reality

The live Supabase database currently has no dedicated notification tables.

There is no deployed notification model for:

```text
notifications
notification_preferences
notification_templates
notification_deliveries
device_push_tokens
notification_events
```

Therefore this document defines the missing architecture rather than pretending that an existing notification implementation exists.

The live database does already provide the domain events that notifications will be derived from.

Relevant deployed structures include:

```text
tickets
ticket_items
customers
payments
refunds
cash_sessions
daily_financial_audits
organization_invites
sync_operations
sync_devices
sync_changes
audit_log
user_roles
roles
permissions
role_permissions
branch_assignments
branches
organizations
```

The current `tickets` table is particularly important because it already contains:

```text
created_at
created_by
assigned_to
correction_of_ticket_id
device_created_at
server_received_at
revision
sale_customer_type
archived_at
archived_by
archive_reason
```

This means notification logic must respect the project's immutable-ticket/correction/archive model.

The current `daily_financial_audits` table contains:

```text
audit_date
submitted_by
device_id
status
device_created_at
submitted_at
confirmed_at
confirmed_by
base_cash_session_revision
cash_session_id
```

This provides the foundation for offline financial-audit notifications.

The current `sync_operations` table contains:

```text
operation_id
tenant_id
branch_id
device_id
actor_id
entity_type
entity_id
operation_type
base_revision
device_created_at
received_at
status
error_code
error_message
applied_sequence_id
applied_at
result
```

This provides the foundation for synchronization-related notifications.

---

# 3. Core design principle

Notifications are generated from **domain events**, not from arbitrary frontend actions.

Preferred architecture:

```text
DOMAIN TRANSACTION
      |
      v
AUTHORITATIVE DATABASE CHANGE
      |
      v
DOMAIN EVENT
      |
      v
NOTIFICATION ROUTER
      |
      +------------------+
      |                  |
      v                  v
IN-APP              PUSH
      |
      +------------------+
      |
      v
OPTIONAL FUTURE CHANNELS
```

For MVP:

```text
IN-APP
PUSH
```

are the primary channels.

Email/SMS should not be introduced as default transactional notification channels unless a specific product requirement justifies them.

---

# 4. Notification categories

Every notification belongs to a stable category.

Recommended categories:

```text
ticket
finance
audit
sync
staff
organization
inventory
production
system
security
```

The category is used for:
- filtering
- preferences
- analytics
- routing
- UI grouping
- future channel policy

Do not use free-form category names throughout the application.

---

# 5. Notification severity

Every event has a severity:

```text
info
success
warning
critical
```

Recommended semantics:

### info

Useful information that does not require immediate action.

Example:

```text
Ticket #1042 was submitted.
```

### success

Confirmation that an operation completed.

Example:

```text
Daily financial audit submitted successfully.
```

### warning

Something requires attention but is not necessarily an emergency.

Example:

```text
A daily audit has a cash variance.
```

### critical

A security, financial, synchronization, or operational issue requires prompt attention.

Example:

```text
Offline synchronization failed for 5 operations.
```

Severity must not be confused with authorization.

A critical notification does not grant access to the underlying data.

---

# 6. Notification lifecycle

Every notification follows:

```text
CREATED
  |
  v
AVAILABLE
  |
  +--> READ
  |
  +--> DISMISSED
```

Delivery status is separate:

```text
PENDING
  |
  v
SENT
  |
  +--> DELIVERED
  |
  +--> FAILED
```

Do not combine:

```text
read status
```

with:

```text
push delivery status
```

They represent different concepts.

A user can:
- receive a push and never open the notification
- open an in-app notification without receiving push
- receive a notification after it has already been read on another device

---

# 7. Notification identity

Every generated notification must have a stable UUID.

Additionally, every event should have an idempotency key.

Recommended conceptual identity:

```text
event_id
notification_id
recipient_user_id
channel
```

For repeated domain events, the notification system must not create uncontrolled duplicates.

---

# 8. Idempotency

Notification creation must be idempotent.

Example:

```text
ticket_created
event_id = ABC
```

is processed twice.

Result:

```text
one logical notification
```

not:

```text
two identical notifications
```

Use a unique event/delivery key.

Conceptually:

```text
unique(
    event_id,
    recipient_id,
    channel
)
```

The exact schema may use a generated delivery key instead.

---

# 9. Multi-organization users

A user can belong to multiple organizations.

This is a critical BakeFlow requirement.

Notifications MUST therefore be tenant-scoped.

Every persisted notification should contain:

```text
tenant_id
recipient_user_id
```

and where relevant:

```text
branch_id
```

A notification for Organization A must never appear in Organization B's notification feed.

The mobile app must also keep notification state scoped to the currently selected organization.

---

# 10. Organization context in notifications

Notifications should include explicit context when a user belongs to multiple organizations.

Example:

```text
BakeHouse Lekki
Ticket #1042 submitted
```

rather than simply:

```text
Ticket #1042 submitted
```

This reduces the risk of users acting in the wrong organization.

The application must not rely solely on notification text for tenant isolation.

Authorization is still enforced by RLS/domain permissions.

---

# 11. Branch context

For branch-scoped notifications, include branch context where useful.

Example:

```text
Lekki Branch
Daily audit submitted with ₦12,500 variance.
```

The notification payload should contain IDs, not only display strings.

Recommended:

```json
{
  "tenant_id": "...",
  "branch_id": "...",
  "entity_type": "daily_financial_audit",
  "entity_id": "..."
}
```

---

# 12. Notification event catalogue

The following events are part of the initial specification.

---

## 12.1 Ticket events

### TICKET_CREATED

Triggered when a ticket is successfully accepted into the authoritative system.

Recipients may include:
- Branch Manager
- Supervisor where configured
- relevant operational staff

Do NOT notify the ticket creator about their own successful submission unless explicitly configured.

For an offline-created ticket, do not treat local creation as equivalent to server acceptance.

---

### TICKET_SYNCED

Triggered when an offline ticket has been successfully synchronized.

Recipient:

```text
ticket creator
```

This is primarily useful to reassure a Driver that their offline ticket is now safely stored remotely.

Recommended default:

```text
in-app: yes
push: yes when the ticket originated offline
```

Do not generate this for ordinary online tickets.

---

### TICKET_SYNC_FAILED

Triggered when a ticket cannot be synchronized after the operation reaches a meaningful failure state.

Recipient:

```text
ticket creator
```

Potential additional recipient:

```text
operational administrator/support
```

only if the failure is persistent/systemic.

Do not expose internal database errors in the user-facing notification.

---

### TICKET_CORRECTION_CREATED

Triggered when a correction/amendment ticket references an earlier ticket.

Potential recipients:
- Branch Manager
- Supervisor
- relevant finance staff depending on permissions

The notification must link to:
- correction ticket
- original ticket

The original ticket itself is not edited.

---

### TICKET_ARCHIVED

Triggered when a ticket is archived.

Recipients depend on the actor and business policy.

If a Manager archives a ticket, avoid notifying the Manager about their own action unless audit confirmation is useful.

---

### TICKET_ASSIGNED

Triggered when a manager assigns a ticket to a Driver.

Recipient:

```text
assigned driver
```

This is particularly relevant for advance/customer-requested tickets.

---

### TICKET_DUE_SOON

Triggered when an assigned ticket is approaching `due_at`.

Recipient:

```text
assigned driver
```

This should be scheduled/event-driven rather than generated every time the ticket is opened.

The system must prevent repeated alerts for the same threshold.

---

### TICKET_OVERDUE

Triggered when a ticket passes its due time without reaching the required operational state.

Recipients:
- assigned Driver
- Supervisor
- Branch Manager

Exact recipients depend on permissions and branch configuration.

---

# 13. Ticket immutability rule

A submitted ticket cannot be updated or canceled.

Notifications must never suggest that a ticket can simply be edited.

Correct language:

```text
A correction is required.
```

Incorrect language:

```text
Edit ticket
Cancel ticket
```

If a ticket is archived, the notification must use archive terminology.

If a business correction is required, the system creates a correction ticket referencing the original.

---

# 14. Driver notifications

Drivers are primarily operational users.

Their notification stream should prioritize:

```text
ticket assignment
ticket due soon
ticket overdue
ticket correction
sync success
sync failure
device/sync issues
```

Do not flood Drivers with:
- organization analytics
- branch financial summaries
- administrative role changes unrelated to them
- every ticket created by another Driver

---

# 15. Supervisor notifications

Supervisor is a distinct role beneath Branch Manager.

The Supervisor has fewer privileges than the Branch Manager.

Supervisor notifications should focus on:
- operational issues
- tickets requiring attention
- corrections
- overdue work
- configured inventory/production alerts
- audit exceptions where permission allows
- synchronization problems affecting their operational scope

Do not assume Supervisor receives every Branch Manager notification.

Notification routing must follow permission scope.

---

# 16. Branch Manager notifications

The Branch Manager is the branch operational authority.

Potential notifications:

```text
ticket corrections
overdue tickets
daily audit submissions
cash variance
refunds
operational exceptions
staff issues
inventory alerts
production exceptions
sync failures
security/device events
```

The Manager should not control synchronization.

Sync notifications are informational/operational.

The synchronization engine operates independently.

---

# 17. Owner notifications

Owner-level notifications should focus on organization-wide exceptions and oversight.

Examples:

```text
major financial exceptions
branch audit issues
security issues
organization-level staff changes
critical sync/system failures
branch configuration changes
```

Do not send every operational ticket event to the Owner by default.

Owners should receive summarized/high-value information rather than operational noise.

---

# 18. Admin notifications

Admin is distinct from Owner.

The Admin may receive:
- security events
- organization configuration events
- permission/role events
- device/sync issues
- system-level exceptions
- destructive deletion events

The Admin must not automatically inherit Owner-only business notifications.

Routing is permission-based.

---

# 19. Financial notification events

Initial financial events:

```text
PAYMENT_RECORDED
REFUND_RECORDED
CASH_SESSION_OPENED
CASH_SESSION_CLOSED
CASH_VARIANCE_DETECTED
DAILY_AUDIT_SUBMITTED
DAILY_AUDIT_CONFIRMED
DAILY_AUDIT_REQUIRES_REVIEW
```

---

# 20. Payment notifications

### PAYMENT_RECORDED

Used primarily for operational confirmation and audit visibility.

Do not notify every manager about every payment by default if this produces excessive volume.

The finance workspace remains the authoritative detailed view.

---

# 21. Refund notifications

A refund is financially sensitive.

Potential recipients:

```text
Branch Manager
Owner/Admin according to permission
```

The notification should contain:
- amount
- ticket/payment reference
- branch
- reason summary where appropriate

Never include secrets or payment credentials.

---

# 22. Cash session notifications

### CASH_SESSION_OPENED

Optional informational event.

### CASH_SESSION_CLOSED

Important for branch financial operations.

### CASH_VARIANCE_DETECTED

High-priority financial exception.

This should normally notify:
- Branch Manager
- Supervisor if configured
- authorized finance users

Do not expose financial information to users without the relevant permission.

---

# 23. Daily financial audit notifications

The daily financial audit can be created offline by Manager/Supervisor users.

Important states include:

```text
created locally
queued
submitted
confirmed
variance
sync failure
```

Recommended notifications:

### DAILY_AUDIT_SUBMITTED

Notify the authorized branch oversight role when another user submits the audit.

### DAILY_AUDIT_REQUIRES_REVIEW

Triggered when variance or another configured exception requires review.

### DAILY_AUDIT_CONFIRMED

Notify the submitting user that the audit has been confirmed.

### DAILY_AUDIT_SYNC_FAILED

Notify the submitting user.

The Manager cannot turn synchronization off.

---

# 24. Offline synchronization notifications

Sync notifications are a special category.

The synchronization engine runs independently of managerial preference.

Managers do not receive a control such as:

```text
Disable synchronization
```

Notifications can report sync state but cannot disable the sync engine.

Events:

```text
SYNC_OPERATION_ACCEPTED
SYNC_OPERATION_FAILED
SYNC_BATCH_PARTIAL_FAILURE
SYNC_REQUIRES_RETRY
DEVICE_REVOKED
DEVICE_SYNC_DISABLED
FULL_RESYNC_REQUIRED
```

---

# 25. Sync notification noise control

Do not send one push notification for every successful background sync operation.

For example, if:

```text
50 tickets
+
12 customers
+
8 payments
```

synchronize successfully, do not generate 70 pushes.

Instead:

```text
Synchronization completed
70 operations synchronized.
```

or keep successful sync details inside the Sync Center.

Failures may warrant individual/actionable notifications.

---

# 26. Device notifications

The system already has `sync_devices`.

Potential events:

```text
DEVICE_REGISTERED
DEVICE_REVOKED
DEVICE_SYNC_BLOCKED
DEVICE_REQUIRES_REAUTH
```

Device revocation is security-sensitive.

Notify:
- affected user
- authorized Admin/security role

Do not notify unrelated staff.

---

# 27. Organization invitation notifications

The current database has `organization_invites`.

Events:

```text
INVITE_CREATED
INVITE_ACCEPTED
INVITE_EXPIRED
INVITE_REVOKED
```

Recipients:

```text
invitee
inviter/authorized administrator
```

Do not expose the raw invitation token in a notification record.

---

# 28. Permission and role notifications

Relevant events:

```text
ROLE_ASSIGNED
ROLE_CHANGED
ROLE_REVOKED
PERMISSION_SCOPE_CHANGED
BRANCH_ASSIGNMENT_CHANGED
```

A user should be notified when their access materially changes.

Example:

```text
Your role at Lekki Branch has changed to Supervisor.
```

For security-sensitive changes, push notification should remain available even if ordinary informational notifications are disabled.

---

# 29. Security notifications

Security events should include:

```text
NEW_DEVICE_REGISTERED
DEVICE_REVOKED
UNEXPECTED_SESSION
ROLE_PRIVILEGE_ESCALATION
PERMANENT_DELETION_COMPLETED
```

Security notifications are not ordinary marketing preferences.

Users should not be able to disable mandatory security alerts.

---

# 30. Permanent deletion notifications

Permanent deletion is exceptional and protected by the destructive deletion workflow.

Notification examples:

```text
Permanent deletion completed for archived ticket.
```

or:

```text
Permanent deletion request requires confirmation.
```

Do not include sensitive deletion challenge data.

The notification must never provide a bypass around the deletion challenge.

---

# 31. Inventory events

The live database contains inventory structures such as:

```text
ingredient_stock_levels
product_stock_levels
stock_movements
```

Initial inventory notification events:

```text
STOCK_LOW
STOCK_CRITICAL
STOCK_OUT
STOCK_ADJUSTMENT_REQUIRES_REVIEW
```

Recipients depend on branch/warehouse responsibility.

Do not notify Drivers unless inventory responsibility is explicitly assigned to them.

---

# 32. Production events

The database contains:

```text
production_batches
production_batch_ingredients
```

Potential events:

```text
PRODUCTION_BATCH_CREATED
PRODUCTION_BATCH_DELAYED
PRODUCTION_BATCH_COMPLETED
INGREDIENT_SHORTAGE
PRODUCTION_EXCEPTION
```

These should primarily route to operational users responsible for production.

---

# 33. Notification channels

## MVP

### In-app

Mandatory.

The notification center is the authoritative user-facing notification history.

### Push

Recommended for:
- urgent operational events
- assignments
- sync failures
- financial exceptions
- security events

---

# 34. Deferred channels

### Email

Useful for:
- periodic reports
- invitations
- selected administrative events
- future digests

Not required for the core operational MVP.

### SMS

Should be treated as a future/optional channel.

SMS is expensive and noisy and should only be used where the business case is clear.

Do not architect the MVP around SMS.

---

# 35. Channel priority

Default:

```text
critical
-> in-app + push

warning
-> in-app + push when actionable

info
-> in-app

success
-> in-app
```

Users may customize non-mandatory push categories.

Security notifications remain mandatory.

---

# 36. Notification preferences

Preferences should be user-level, not device-level.

A user can have multiple devices.

Conceptually:

```text
user
  |
  +-- notification preferences
  |
  +-- devices
```

Preferences should support:

```text
category
event type
in_app enabled
push enabled
```

Do not store one global:

```text
notifications_enabled
```

and assume that is sufficient.

---

# 37. Organization versus user preferences

Personal notification preferences belong to the user.

Organization configuration may control whether certain optional notification types are enabled for that organization.

Therefore:

```text
organization policy
        +
user preference
        +
permission
        +
event severity
```

determine delivery.

Mandatory security/system events override user opt-out.

---

# 38. Multi-organization preference isolation

Because a user may belong to multiple organizations, preferences may need organization scope for business-specific notifications.

Example:

```text
User U
Organization A -> ticket push enabled
Organization B -> ticket push disabled
```

Do not assume a single global preference is sufficient.

Security notifications may remain globally mandatory.

---

# 39. Device push tokens

Push tokens must be stored separately from notifications.

Recommended conceptual table:

```text
notification_devices
```

or reuse/extend the existing `sync_devices` only if the architecture can safely separate synchronization identity from push-delivery identity.

Do not automatically put push tokens into `profiles`.

A device can:
- receive push
- synchronize data
- be revoked
- change its push token

These lifecycles are related but not identical.

---

# 40. Push token security

Push tokens are sensitive infrastructure identifiers.

They must:
- be tenant/user scoped
- be protected by RLS
- never be exposed to other users
- be revocable
- support rotation
- support multiple devices

Do not log tokens in plaintext.

---

# 41. Notification templates

Templates should be stable identifiers rather than hardcoded strings scattered through feature code.

Example:

```text
ticket.created
ticket.assigned
ticket.sync_failed
finance.refund_recorded
finance.cash_variance
audit.submitted
audit.requires_review
sync.failed
security.device_revoked
```

The template system should support:

```text
title
body
deep_link
variables
```

---

# 42. Template variables

Use structured variables.

Example:

```json
{
  "ticket_number": "T-1042",
  "branch_name": "Lekki",
  "customer_name": "ABC Bakery",
  "amount": "12500"
}
```

Do not build notification text using unsafe raw concatenation throughout the application.

---

# 43. Localization

The template model should be localization-ready.

MVP may initially ship in English.

Do not hardcode English strings into the database as the only possible representation if a translation system is likely later.

Prefer:

```text
template_key
variables
locale
```

with rendering handled by the notification layer.

---

# 44. Deep links

Every actionable notification should provide a safe deep link target.

Example:

```text
bakeflow://tickets/{ticket_id}
```

or the equivalent Expo Router route.

The app must re-check authorization when opening the target.

A notification deep link is not an authorization token.

---

# 45. Deep-link tenant protection

A notification from Organization A must not allow the user to open Organization B data simply by modifying an ID.

The destination screen/API must validate:
- authenticated user
- tenant membership
- branch scope
- permission
- entity existence

---

# 46. Notification payload design

Persisted notification payload should contain structured references.

Example:

```json
{
  "entity_type": "ticket",
  "entity_id": "uuid",
  "branch_id": "uuid",
  "event_type": "ticket.correction_created"
}
```

Avoid duplicating the entire business record into the notification.

Notifications are pointers to authoritative state.

---

# 47. Snapshot text

It can be useful to store rendered title/body snapshots so historical notifications remain understandable even if:
- a ticket is later archived
- a customer name changes
- a branch name changes

However, sensitive information should be minimized.

Recommended:

```text
title_snapshot
body_snapshot
```

plus authoritative IDs.

---

# 48. Read/unread state

A notification should have:

```text
read_at
```

nullable.

Unread:

```text
read_at IS NULL
```

Read:

```text
read_at IS NOT NULL
```

Do not delete the notification simply because the user read it.

---

# 49. Dismissal

Optional:

```text
dismissed_at
```

Dismissal is a UI state.

It must not delete the underlying event or business record.

---

# 50. Expiration

Some notifications should expire.

Examples:

```text
ticket_due_soon
temporary_sync_warning
temporary_system_notice
```

A notification can have:

```text
expires_at
```

Expired notifications may remain historically stored but should no longer appear as actionable.

Critical audit/security notifications should not expire prematurely.

---

# 51. Retention

Notification retention should be shorter than core business/audit retention unless there is a specific reason otherwise.

Notifications are derived communication data.

Do not retain notification payloads containing sensitive business information indefinitely.

The retention policy should be documented separately from business-record retention.

---

# 52. Notification database model

The initial implementation should consider these tables:

```text
notifications
notification_deliveries
notification_preferences
notification_templates
notification_device_tokens
```

Potential event/outbox support:

```text
notification_events
```

However, do not add all of these tables blindly.

The MVP can use:

```text
notifications
notification_deliveries
notification_preferences
notification_device_tokens
```

with templates maintained in application code initially.

A database template table becomes justified when:
- admin-managed templates are required
- localization is required
- template editing is required
- non-developers need template control

---

# 53. Recommended `notifications` fields

Conceptual structure:

```text
id UUID PK
tenant_id UUID NOT NULL
branch_id UUID NULL
recipient_user_id UUID NOT NULL

event_type TEXT NOT NULL
category TEXT NOT NULL
severity TEXT NOT NULL

title TEXT NOT NULL
body TEXT NOT NULL

entity_type TEXT NULL
entity_id UUID NULL

payload JSONB NOT NULL DEFAULT '{}'

read_at TIMESTAMPTZ NULL
dismissed_at TIMESTAMPTZ NULL
expires_at TIMESTAMPTZ NULL

created_at TIMESTAMPTZ NOT NULL
```

Do not add `deleted_at` merely because every business table has one.

Notification cleanup can use retention/expiry rather than soft deletion where appropriate.

If the repository-wide soft-delete convention explicitly requires it, document why notification retention still differs operationally.

---

# 54. Recommended `notification_deliveries` fields

Conceptual:

```text
id UUID PK
notification_id UUID NOT NULL
recipient_user_id UUID NOT NULL
channel TEXT NOT NULL

status TEXT NOT NULL

provider_message_id TEXT NULL
attempt_count INTEGER NOT NULL
last_attempt_at TIMESTAMPTZ NULL
delivered_at TIMESTAMPTZ NULL
failed_at TIMESTAMPTZ NULL

error_code TEXT NULL
error_message TEXT NULL

created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
```

Unique constraint:

```text
(notification_id, channel, device/token where applicable)
```

must prevent duplicate delivery records.

---

# 55. Recommended preferences model

Conceptual:

```text
id UUID PK
tenant_id UUID NULL
user_id UUID NOT NULL

event_type TEXT NOT NULL

in_app_enabled BOOLEAN NOT NULL
push_enabled BOOLEAN NOT NULL

created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
```

Use nullable `tenant_id` only if global preferences are intentionally supported.

Do not create ambiguous preference precedence.

Document:

```text
mandatory event
>
organization policy
>
user preference
>
channel availability
```

---

# 56. Recommended device token model

Conceptual:

```text
id UUID PK
user_id UUID NOT NULL
tenant_id UUID NOT NULL
device_id UUID NULL

platform TEXT NOT NULL
push_token TEXT NOT NULL
provider TEXT NOT NULL

last_seen_at TIMESTAMPTZ
revoked_at TIMESTAMPTZ

created_at TIMESTAMPTZ NOT NULL
updated_at TIMESTAMPTZ NOT NULL
```

Never expose push tokens in normal notification API responses.

---

# 57. RLS

Every notification table exposed through `public` must have RLS enabled.

A user may:

```text
SELECT own notifications
UPDATE own read/dismiss state
```

A user must not:

```text
SELECT another user's notifications
UPDATE another user's notifications
```

Notification creation should normally be backend-controlled.

Do not allow arbitrary clients to create notifications for other users.

---

# 58. Notification insertion security

Preferred:

```text
domain event
   |
trusted backend
   |
notification creation
```

Avoid:

```text
mobile client
   |
insert into notifications
```

because a malicious client could manufacture:

```text
critical financial alerts
security alerts
false manager notifications
```

---

# 59. RLS tenant isolation

Every query must enforce:

```text
tenant_id
+
recipient_user_id
```

where applicable.

For branch-scoped notifications:

```text
tenant_id
+
branch_id
```

must also be respected.

---

# 60. Notification access must not bypass business authorization

A notification may tell a user:

```text
Ticket #1042 requires correction.
```

but opening the ticket must still enforce ticket authorization.

Never use notification existence as proof of permission.

---

# 61. Notification generation and transactions

Critical notification generation should be tied to successful domain state changes.

Avoid sending:

```text
Payment recorded
```

before the payment transaction commits.

Preferred:

```text
DB transaction commits
      |
      v
event/outbox
      |
      v
notification
```

This prevents false notifications for rolled-back transactions.

---

# 62. Event/outbox pattern

For reliability, use a transactional event/outbox pattern for important events.

Conceptually:

```text
BEGIN
  business mutation
  insert domain event/outbox row
COMMIT
```

A worker then processes:

```text
outbox
-> notification
-> delivery
```

This prevents notification loss when the database transaction succeeds but an external push call fails.

---

# 63. Do not call push providers inside business transactions

Bad:

```text
BEGIN
payment insert
push notification
COMMIT
```

If push stalls, the financial transaction stalls.

Correct:

```text
BEGIN
payment insert
event/outbox insert
COMMIT

worker
-> push
```

---

# 64. Push delivery retries

Push failures should be classified:

```text
transient
permanent
invalid_token
rate_limited
provider_error
```

Transient failures retry.

Invalid tokens should be revoked/disabled.

Do not retry permanent failures forever.

---

# 65. Rate limiting

Notification generation must be rate-limited.

A single incident should not create thousands of push notifications.

Examples:

```text
sync failure
-> aggregate repeated failures

stock low
-> suppress duplicates until state changes

ticket overdue
-> one notification per threshold
```

---

# 66. Aggregation

When many events occur in a short window, aggregate them.

Example:

```text
23 new tickets were submitted at Lekki Branch.
```

instead of:

```text
23 separate pushes
```

Aggregation should never hide critical security or financial events.

---

# 67. Deduplication

Notifications should be deduplicated by meaningful state transition.

Bad:

```text
STOCK_LOW
STOCK_LOW
STOCK_LOW
```

every time a stock query runs.

Correct:

```text
stock transitions:
normal -> low
```

creates one event.

When stock returns to normal and later becomes low again:

```text
normal -> low
```

may create another notification.

---

# 68. Scheduled notifications

Some events require time-based evaluation:

```text
ticket_due_soon
ticket_overdue
```

These should be generated by a scheduled backend process.

Do not depend on the Driver opening the app at the right time.

---

# 69. Offline behavior

Notifications themselves are not the source of truth offline.

The offline application should prioritize synchronized domain state.

A device may receive a push notification while offline state is stale.

When the app opens:
1. authenticate
2. determine active organization
3. sync required domain state
4. fetch notifications
5. resolve deep links against current authorization/state

Do not let an old push payload directly mutate business data.

---

# 70. Offline notification creation

The Driver does not need to create notification records while offline.

For offline tickets:

```text
local ticket
-> sync
-> authoritative ticket event
-> server notification
```

This avoids duplicate notifications.

The same principle applies to offline daily financial audits.

---

# 71. Notification synchronization

Notifications themselves may be synchronized to the device.

The mobile app should maintain:
- local notification cache
- read state
- notification cursor/version where required

Read state can be synchronized across devices.

Example:

```text
Device A reads notification
      |
      v
server read_at updated
      |
      v
Device B refreshes
      |
      v
notification appears read
```

---

# 72. Push versus sync

Push is a wake-up/attention mechanism.

It is NOT the synchronization mechanism.

The correct flow is:

```text
server event
   |
   +--> push notification
   |
   +--> sync state remains authoritative
```

When a push arrives, the client may refresh/sync.

Never treat the push payload as the complete authoritative state.

---

# 73. Background synchronization

Managers cannot disable synchronization.

The notification system must not introduce a user-facing setting that stops sync merely because notification delivery is disabled.

These are separate:

```text
notifications
≠
synchronization
```

---

# 74. Permission changes

If a user's role changes while the device is offline:

```text
server authorization
```

remains authoritative after reconnect.

Notifications should not grant old permissions.

If a role is revoked, the application should:
- refresh authorization
- invalidate stale local access
- stop future unauthorized notification delivery
- optionally notify the user

---

# 75. Security event delivery

Mandatory security notifications should not be disabled by ordinary preference settings.

Examples:

```text
device revoked
role privilege changed
security event
permanent deletion completed
```

---

# 76. Notification API contract

The shared `packages/api` layer should expose functions such as:

```text
listNotifications()
getUnreadNotificationCount()
markNotificationRead()
markNotificationsRead()
dismissNotification()
registerNotificationDevice()
revokeNotificationDevice()
updateNotificationPreferences()
```

Notification creation should not be exposed as a normal client mutation.

Backend-only operations:

```text
emitNotification()
processNotificationEvent()
deliverNotification()
retryNotificationDelivery()
```

---

# 77. Shared package boundaries

Recommended:

```text
packages/api
    notification API wrappers

packages/types
    generated DB types

packages/validation
    notification payload schemas

apps/mobile/features/notifications
    notification UI

apps/mobile/stores
    notification state/cache

apps/mobile/services
    push registration/deep linking

backend/edge functions
    event processing/delivery
```

Do not put notification business logic inside Expo Router route files.

---

# 78. UI requirements

The mobile notification center should support:

```text
Unread count
All
Unread
Category filtering
Read state
Timestamp
Organization context
Branch context where relevant
Deep link
```

Critical notifications should be visually distinct.

Do not make every notification red or urgent.

---

# 79. Notification grouping

The notification center should group related notifications where practical.

Example:

```text
Today

Finance
  2 notifications

Operations
  5 notifications

Sync
  1 notification
```

This is preferable to a flat high-volume stream.

---

# 80. Notification content rules

Notification text must:
- be concise
- state what happened
- state what needs attention
- identify relevant entity
- avoid secrets
- avoid internal database terminology
- avoid exposing authorization details

Good:

```text
Cash variance detected at Lekki Branch.
Expected ₦120,000; counted amount differs.
Review the daily audit.
```

Bad:

```text
daily_financial_audits row 82f... failed status check.
```

---

# 81. Sensitive data rules

Do not put in push payloads:
- authentication tokens
- invitation tokens
- full payment credentials
- secrets
- internal security metadata
- unnecessary customer personal data

Push payloads can appear on lock screens.

For sensitive notifications, use generic text:

```text
A financial event requires your attention.
Open BakeFlow to review.
```

The full details should be behind authenticated app access.

---

# 82. Customer privacy

Customer names should only appear in notifications when necessary.

For sensitive environments, prefer:

```text
Ticket #1042 requires correction.
```

over:

```text
John Doe's ₦500,000 ticket requires correction.
```

The exact policy can vary by notification category.

---

# 83. Audit trail

Notification creation/delivery does not replace `audit_log`.

Business actions continue to use:

```text
audit_log
```

Notification events may optionally reference the audit event.

Do not create a second authoritative audit system inside notifications.

---

# 84. Observability

The notification system should track:

```text
events generated
notifications created
deliveries attempted
deliveries succeeded
deliveries failed
invalid tokens
retry counts
average delivery latency
```

Metrics should be aggregated and must not leak tenant data.

---

# 85. Failure behavior

If push delivery fails:

```text
business operation remains successful
notification remains in-app
delivery failure is recorded
retry may occur
```

A failed notification must never roll back:
- ticket creation
- payment
- refund
- cash audit
- synchronization

---

# 86. Provider abstraction

Do not hardcode the application around one push provider.

Use a provider abstraction:

```text
PushProvider
  send()
  validateToken()
  revokeToken()
```

This makes provider migration possible.

Expo push infrastructure can be used by the mobile MVP, but the application layer should not scatter provider-specific calls through feature code.

---

# 87. Email provider abstraction

Email is deferred.

If introduced:

```text
EmailProvider
```

should follow the same architecture.

Do not couple domain events directly to one email provider.

---

# 88. Notification preference defaults

Recommended defaults:

| Category | In-app | Push |
|---|---:|---:|
| Ticket assignment | ON | ON |
| Ticket correction | ON | ON |
| Ticket due soon | ON | ON |
| Ticket overdue | ON | ON |
| Sync success | ON | OFF |
| Sync failure | ON | ON |
| Daily audit submitted | ON | ON |
| Financial variance | ON | ON |
| Refund | ON | ON |
| Security | ON | ON / mandatory |
| Inventory low | ON | configurable |
| Production exception | ON | configurable |
| General info | ON | OFF |

The final defaults can be adjusted after UX testing.

---

# 89. Notification event registry

The implementation should maintain one canonical event registry.

Example:

```ts
type NotificationEvent =
  | "ticket.created"
  | "ticket.synced"
  | "ticket.sync_failed"
  | "ticket.correction_created"
  | "ticket.archived"
  | "ticket.assigned"
  | "ticket.due_soon"
  | "ticket.overdue"
  | "finance.payment_recorded"
  | "finance.refund_recorded"
  | "finance.cash_session_closed"
  | "finance.cash_variance"
  | "audit.submitted"
  | "audit.requires_review"
  | "audit.confirmed"
  | "audit.sync_failed"
  | "sync.operation_failed"
  | "sync.batch_partial_failure"
  | "sync.full_resync_required"
  | "sync.device_revoked"
  | "staff.role_assigned"
  | "staff.role_changed"
  | "staff.role_revoked"
  | "staff.branch_assignment_changed"
  | "organization.invite_created"
  | "organization.invite_accepted"
  | "organization.invite_expired"
  | "security.device_revoked"
  | "security.permission_changed"
  | "security.permanent_deletion_completed"
  | "inventory.stock_low"
  | "inventory.stock_critical"
  | "inventory.stock_out"
  | "production.batch_delayed"
  | "production.ingredient_shortage";
```

The registry should be reviewed before adding new events.

---

# 90. Event routing model

Each event should define:

```text
event type
category
severity
eligible recipient roles
scope
default channels
preference overridable?
aggregation policy
deduplication key
deep-link target
```

Example:

```text
ticket.assigned

category:
ticket

severity:
info

recipients:
assigned driver

channels:
in-app + push

user opt-out:
allowed

deep-link:
ticket detail

dedupe:
ticket_id + assignment revision
```

---

# 91. Recipient calculation

Recipients should be calculated from authoritative authorization data.

Do not hardcode:

```text
branch_manager_user_id
```

inside a notification function.

Use:
- user roles
- branch assignments
- permissions
- organization membership
- explicit assignment fields

This allows the hierarchy to evolve.

---

# 92. Role hierarchy

Current relevant hierarchy:

```text
Owner
  |
Admin
  |
Branch Manager
  |
Supervisor
  |
Driver
```

This is a simplified conceptual hierarchy.

Actual notification routing must use permissions and scope, not merely numeric role rank.

Supervisor is below Branch Manager and has fewer privileges.

Admin is distinct from Owner.

Do not collapse these roles into one generic manager role.

---

# 93. Driver multi-organization protection

A Driver may belong to multiple organizations.

Every notification query must therefore be scoped by:

```text
recipient user
+
tenant
```

The active organization selector must not be used as the only security mechanism.

A malicious client must not be able to switch:

```text
tenant_id
```

in a notification request and retrieve another organization's notifications.

---

# 94. Notification API authorization

Every notification API call must verify:

```text
auth.uid()
```

and tenant membership.

Do not trust:
- client-provided recipient ID
- client-provided tenant ID
- client-provided branch ID

as proof of authorization.

---

# 95. Indexing

Recommended indexes include:

```text
notifications(recipient_user_id, created_at DESC)

notifications(tenant_id, recipient_user_id, created_at DESC)

notifications(recipient_user_id, read_at, created_at DESC)

notifications(tenant_id, branch_id, created_at DESC)

notification_deliveries(notification_id)

notification_deliveries(recipient_user_id, status)

notification_preferences(user_id, tenant_id, event_type)

notification_device_tokens(user_id, revoked_at)
```

Exact indexes must be verified against actual query plans after implementation.

---

# 96. Retention and cleanup

Notifications are derived data.

A cleanup process may remove old notifications after the documented retention period.

Recommended conceptual lifecycle:

```text
active
  |
  v
expired/retained
  |
  v
retention cutoff
  |
  v
permanent cleanup
```

Do not use notification cleanup to delete the underlying business entity.

---

# 97. Migration requirements

When the notification schema is introduced:

1. Create tables through migrations.
2. Enable RLS.
3. Add indexes.
4. Add constraints.
5. Add policies.
6. Add notification API types.
7. Add event registry.
8. Add backend event/outbox handling.
9. Add push token registration.
10. Add notification center UI.
11. Add tests.
12. Verify cross-organization isolation.

Do not create notification tables manually in the Supabase dashboard and leave migrations out of the repository.

---

# 98. Testing matrix

## Tenant isolation

```text
User A / Org A
cannot read Org B notifications.
```

## Recipient isolation

```text
User A
cannot read User B notifications.
```

## Branch isolation

```text
Supervisor Branch A
cannot receive/read Branch B notifications.
```

## Role routing

```text
Driver
does not receive manager-only financial notifications.
```

## Security override

```text
security notification
cannot be disabled through ordinary preference settings.
```

## Idempotency

```text
same event processed twice
=
one logical notification.
```

## Push failure

```text
push provider fails
=
in-app notification remains available.
```

## Offline ticket

```text
offline ticket
-> sync
-> one authoritative ticket event
-> one sync confirmation notification.
```

## Offline audit

```text
offline audit
-> sync
-> no duplicate audit notification.
```

## Multi-device read

```text
Device A marks read
-> Device B eventually sees read.
```

## Role revocation

```text
role revoked
-> future notifications stop
-> stale notification cannot bypass authorization.
```

## Deep link

```text
notification deep link
-> authorization rechecked
-> unauthorized target rejected.
```

## Aggregation

```text
100 successful sync operations
!=
100 push notifications.
```

---

# 99. MVP scope

Implement first:

```text
In-app notification center
Push notifications
Notifications table
Delivery tracking
User preferences
Device push-token registration
Ticket notifications
Finance/audit notifications
Sync failure notifications
Role/security notifications
Tenant/branch RLS
Idempotency
Deep links
Read/unread state
```

Defer:

```text
Email
SMS
Admin-editable templates
Advanced localization
Complex digest engine
Marketing notifications
AI-generated notification text
```

---

# 100. What must NOT be implemented

Do not implement:

```text
notification-driven business state
```

Do not let notifications:
- edit tickets
- cancel tickets
- approve refunds
- close cash sessions
- override RLS
- bypass permissions
- disable synchronization
- authorize deletion
- modify inventory directly

Notifications are communication, not authorization.

---

# 101. Final architecture

The intended architecture is:

```text
                    BAKEFLOW DOMAIN
                         |
        +----------------+----------------+
        |                |                |
      Tickets         Finance           Sync
        |                |                |
        +----------------+----------------+
                         |
                    DOMAIN EVENT
                         |
                         v
                  EVENT / OUTBOX
                         |
                         v
               NOTIFICATION ROUTER
                         |
          +--------------+--------------+
          |              |              |
      Preferences     Recipient       Scope
          |           Resolution         |
          +--------------+--------------+
                         |
                         v
                   NOTIFICATION
                         |
             +-----------+-----------+
             |                       |
          IN-APP                   PUSH
             |                       |
             v                       v
      Notification Center      Push Provider
```

The critical architectural boundaries are:

```text
Business state
    !=
Notification state

Push delivery
    !=
Synchronization

Notification visibility
    !=
Authorization

Read state
    !=
Delivery state

User preference
    !=
Security policy

Notification
    !=
Audit log
```

---

# 102. Final Claude Code rules

Claude Code MUST:

1. Treat this file as the notification architecture source of truth.
2. Inspect the live schema before creating migrations.
3. Do not assume notification tables already exist.
4. Preserve the `tickets` terminology; do not reintroduce `orders`.
5. Respect immutable submitted tickets.
6. Use correction tickets rather than ticket edits.
7. Respect archive/soft-delete rules.
8. Respect Owner/Admin/Branch Manager/Supervisor/Driver distinctions.
9. Scope every notification by tenant.
10. Account for users belonging to multiple organizations.
11. Never trust client-supplied tenant/branch/recipient IDs.
12. Keep notification creation backend-controlled.
13. Use idempotent event processing.
14. Do not send push notifications inside business transactions.
15. Use an outbox/event pattern for important notifications.
16. Treat push as an attention mechanism, not synchronization.
17. Do not allow notification preferences to disable synchronization.
18. Keep security notifications mandatory.
19. Keep sensitive data out of push payloads.
20. Re-check authorization when a deep link is opened.
21. Aggregate noisy events.
22. Retry transient delivery failures.
23. Retire invalid push tokens.
24. Keep notification retention separate from business-record retention.
25. Add RLS to every notification table.
26. Add indexes for recipient/tenant/read queries.
27. Test cross-organization isolation.
28. Test multi-device behavior.
29. Test offline ticket and financial-audit flows.
30. Keep all notification behavior represented in migrations and repository code.

---

# 103. Implementation decision summary

The current database provides the **business events and authorization structures**, but it does not yet provide the notification subsystem.

Therefore the correct implementation path is:

```text
CURRENT LIVE DATABASE
        |
        v
DOMAIN EVENTS / OUTBOX
        |
        v
NOTIFICATION TABLES
        |
        v
RLS + INDEXES
        |
        v
NOTIFICATION ROUTER
        |
        +----> IN-APP
        |
        +----> PUSH
```

The first database implementation should not attempt to build every future notification capability.

Build a secure, tenant-isolated, idempotent notification core around the events that matter to the BakeFlow MVP:

```text
Tickets
Financial audit
Finance exceptions
Offline synchronization
Assignments
Role/security changes
Organization invitations
```

Then add inventory, production, reporting, email, SMS, and advanced digest functionality as those features become active.

The notification subsystem must remain a **derived, reliable, permission-aware communication layer** over BakeFlow's authoritative business data.
