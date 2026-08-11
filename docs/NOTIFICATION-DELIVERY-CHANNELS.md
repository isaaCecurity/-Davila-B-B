# NOTIFICATION-DELIVERY-CHANNELS.md

## BakeFlow Notification Delivery, Providers & Event Routing

**Status:** Implementation specification
**Scope:** Invitation delivery, transactional email, SMS/WhatsApp, mobile push, provider abstraction, event routing, retries, preferences, security, and delivery observability.

---

# 1. Purpose

This document defines how BakeFlow turns application events into user-facing notifications.

It specifically resolves the current delivery gap:

> Invitation tokens can currently be created, but the invitation cannot be completed end-to-end because there is no production delivery path.

The notification system must therefore separate:

```text
business event
    ->
notification decision
    ->
recipient resolution
    ->
channel selection
    ->
provider adapter
    ->
delivery attempt
    ->
provider result
    ->
delivery status
```

The application must never make a provider API call directly from arbitrary feature code.

---

# 2. Core architecture

The notification subsystem should be event-driven.

```text
Domain action
    |
    v
Domain event / notification event
    |
    v
Notification orchestration
    |
    +--------------------+
    |                    |
    v                    v
Recipient resolution   Preferences
    |                    |
    +---------+----------+
              |
              v
       Notification job
              |
      +-------+-------+---------+
      |               |         |
      v               v         v
    Email            Push      SMS/WhatsApp
      |               |         |
      v               v         v
 Provider adapter  Push adapter Messaging adapter
      |               |         |
      +---------------+---------+
              |
              v
       Delivery result
              |
              v
      Audit / retry state
```

Feature code should emit an event or request a notification.

Feature code must not contain:

```text
sendEmail(...)
sendWhatsApp(...)
sendPush(...)
```

directly.

---

# 3. Provider abstraction

Providers are implementation details.

The notification system should expose internal interfaces such as:

```text
EmailProvider
SmsProvider
WhatsAppProvider
PushProvider
```

The rest of BakeFlow should depend on those interfaces rather than a specific vendor.

This allows a provider to be replaced without rewriting notification business logic.

---

# 4. Recommended MVP channel strategy

## Email

Use a transactional email provider with:
- API-based sending
- delivery status/webhooks
- bounce handling
- retry support
- domain authentication
- template support

The provider must be selected/configured separately from the notification rules.

The invitation flow depends on this channel.

---

# 5. Invitation delivery

## 5.1 Current problem

The database can mint invitation tokens, but token generation alone is not an invitation workflow.

The complete flow must be:

```text
Manager/Admin creates invitation
        |
        v
Invitation record created
        |
        v
Secure invitation token created
        |
        v
Notification job created
        |
        v
Email delivered
        |
        v
Recipient opens invitation link
        |
        v
Recipient authenticates/creates account
        |
        v
Invitation token verified
        |
        v
Membership activated
```

The system must not mark an invitation as delivered merely because the token was created.

---

# 6. Invitation security

Invitation URLs must contain a non-guessable, short-lived credential.

Do not put:
- organization secrets
- internal IDs unnecessarily
- role-management secrets
- service credentials

in the URL.

The token should be:
- high entropy
- single-purpose
- expiring
- revocable
- single-use after acceptance

The database should store a secure representation of the token where practical rather than relying on plaintext token persistence.

---

# 7. Invitation states

The invitation lifecycle should distinguish:

```text
created
queued
sent
delivered
opened
accepted
expired
revoked
failed
```

The exact live enum/status model must be inspected before implementation.

Do not overload:

```text
accepted
```

to mean:

```text
email delivered
```

---

# 8. Invitation retry

If an invitation email fails:

```text
invitation remains pending
delivery attempt = failed
```

The system should retry transient failures.

Permanent failures should stop automatic retries and expose a meaningful error.

The Manager/Admin should be able to request a new invitation according to the invitation rules.

Do not generate unlimited emails automatically.

---

# 9. Invitation provider failure

If the provider is unavailable:

```text
business invitation
    !=
delivery failure
```

The invitation record remains valid until expiration/revocation.

A failed email should not silently delete the invitation.

---

# 10. Email provider requirements

The selected email provider must support:

```text
transactional email
delivery API
webhooks/events
bounce reporting
complaint reporting where available
retry-safe sending
custom sender domain
```

The sender domain should eventually be authenticated with:

```text
SPF
DKIM
DMARC
```

Do not use a personal Gmail account as the production transactional mail system.

---

# 11. Email categories

BakeFlow email should initially be limited to transactional/product-critical messages.

Examples:

```text
organization invitation
password/account recovery
security alert
important role/permission change
critical financial notification where enabled
```

Marketing email is out of scope for the core notification system.

---

# 12. SMS and WhatsApp

SMS and WhatsApp should be treated as separate channels.

Do not model:

```text
SMS = WhatsApp
```

even if one provider can deliver both.

They have different:
- consent rules
- templates
- delivery semantics
- costs
- user expectations
- provider APIs

---

# 13. SMS provider

The SMS provider must support:

```text
transactional messages
international phone numbers where required
delivery status
retry/error information
rate limiting
```

The phone number must be normalized to an international format.

Do not store multiple incompatible formats such as:

```text
080...
+23480...
23480...
```

as separate identities.

---

# 14. WhatsApp provider

WhatsApp should use an approved business messaging provider/API.

Do not implement WhatsApp notifications through:
- personal WhatsApp accounts
- unofficial automation
- browser scraping
- WhatsApp Web automation

The integration must respect WhatsApp business/template rules.

---

# 15. WhatsApp templates

Outbound business-initiated WhatsApp messages may require approved templates depending on the conversation context.

Templates should therefore be versioned/configured separately from notification events.

Example conceptual template:

```text
ticket_delivery_update_v1
```

not hard-coded in application feature logic.

---

# 16. Push notification architecture

For the React Native + Expo mobile application, the preferred MVP architecture is:

```text
Expo Notifications
        |
        v
Expo Push Service
        |
        +------ Android
        |        |
        |        v
        |       FCM
        |
        +------ iOS
                 |
                 v
                APNs
```

The application should use Expo's push-token abstraction initially rather than building a direct FCM/APNs transport layer unless there is a concrete requirement to bypass Expo.

---

# 17. Expo Push versus direct FCM/APNs

## MVP recommendation

Use:

```text
Expo Push Notifications
```

because the mobile application is Expo-based.

Benefits:

- simpler React Native integration
- one application-level push-token model
- easier notification setup
- less platform-specific infrastructure
- easier development/testing

---

# 18. When direct FCM/APNs becomes justified

Move toward direct platform providers only if BakeFlow requires:

```text
advanced platform-specific delivery controls
very high notification volume
provider-specific features
direct delivery telemetry
strict latency requirements
custom native notification behavior
```

Do not introduce direct FCM/APNs merely because they exist.

That would increase infrastructure complexity prematurely.

---

# 19. Push token model

A user may have multiple devices.

Therefore:

```text
user
  |
  +-- device 1
  +-- device 2
  +-- device 3
```

must be supported.

A single:

```text
user.push_token
```

field is insufficient.

The existing `sync_devices` concept must not automatically be treated as a push-token registry unless its contract explicitly supports it.

A dedicated device-notification registration model may be required.

---

# 20. Push token lifecycle

The system must support:

```text
registered
active
invalid
revoked
```

Push tokens can change.

The client must refresh/register its token when appropriate.

Invalid tokens returned by the provider must be disabled rather than retried forever.

---

# 21. Device security

A push token is not an authentication credential.

Never use:

```text
push_token
```

as proof of user identity or organization membership.

Notification authorization must still derive from:

```text
authenticated user
+
organization membership
+
role/permission
```

---

# 22. Notification preferences

Users should eventually be able to configure notification preferences per event/category/channel where appropriate.

Example:

```text
ticket updates:
push = on
email = off
SMS = off

security alerts:
push = on
email = on

marketing:
off
```

Critical security/authorization events may not be suppressible.

---

# 23. Organization versus personal preferences

Separate:

```text
user preference
```

from:

```text
organization notification policy
```

A user should not be able to disable a notification that the organization has defined as mandatory if the event is operationally/security critical.

---

# 24. Notification priority

Events should have priority levels:

```text
critical
high
normal
low
```

Examples:

```text
security event -> critical
invitation -> high
ticket assignment -> high
daily summary -> normal
non-critical reminder -> low
```

Priority can affect:
- channel selection
- retry policy
- batching
- UI presentation

---

# 25. Notification event model

Each notification event should conceptually contain:

```text
event_id
event_type
organization_id
branch_id
actor_user_id
subject_type
subject_id
occurred_at
payload
```

The event itself should identify what happened.

Notification rendering then determines how to communicate it.

---

# 26. Idempotency

The same business event must not produce duplicate notifications simply because:
- an RPC retried
- a device synced twice
- a worker restarted
- a webhook was delivered twice

Use an idempotency key derived from the domain event.

Conceptually:

```text
organization_id
+
event_type
+
subject_id
+
event_revision
+
recipient_id
+
channel
```

The exact key depends on the event.

---

# 27. Retry model

Notification delivery must distinguish:

```text
transient failure
permanent failure
provider rejection
invalid recipient
expired token
rate limited
```

Transient errors:

```text
retry
```

Permanent errors:

```text
mark failed
```

Invalid push token:

```text
disable token
```

Do not endlessly retry permanent failures.

---

# 28. Backoff

Use exponential backoff with a bounded retry count.

Example conceptual schedule:

```text
attempt 1
attempt 2
attempt 3
attempt 4
```

The exact delay should be configurable.

Do not use aggressive immediate loops against providers.

---

# 29. Provider webhooks

Email/SMS/WhatsApp providers may asynchronously report:

```text
sent
delivered
failed
bounced
rejected
```

Provider webhooks must be authenticated/verified.

Do not trust arbitrary HTTP requests claiming:

```text
message delivered
```

---

# 30. Notification delivery versus business event

A notification failure must not roll back the business operation.

Example:

```text
ticket submitted
+
push notification fails
```

The ticket must remain submitted.

Similarly:

```text
invitation created
+
email provider unavailable
```

The invitation remains valid/pending.

Notification delivery is an asynchronous side effect.

---

# 31. Events that should notify recipients

The following is the initial recommended event catalogue.

---

## 31.1 Organization invitation

**Event:**

```text
organization.invitation.created
```

**Recipient:**

```text
invited email address
```

**Channel:**

```text
email
```

**Priority:**

```text
high
```

**Required:** YES

---

## 31.2 Invitation resent

**Event:**

```text
organization.invitation.resent
```

**Recipient:**

```text
invited email
```

**Channel:**

```text
email
```

**Priority:**

```text
high
```

---

## 31.3 Role/permission changed

**Event:**

```text
membership.role_changed
```

**Recipient:**

```text
affected user
```

**Channels:**

```text
push
email
```

for security-sensitive changes.

---

## 31.4 Membership revoked

**Event:**

```text
membership.revoked
```

**Recipient:**

```text
affected user
```

**Channels:**

```text
push
email
```

The event must not leak unnecessary organizational information.

---

## 31.5 Ticket assigned

**Event:**

```text
ticket.assigned
```

**Recipient:**

```text
assigned driver/supervisor/authorized user
```

**Channel:**

```text
push
```

Email may be optional for users who are offline or have configured it.

---

## 31.6 Ticket correction/amendment

**Event:**

```text
ticket.corrected
```

**Recipients:**

Authorized stakeholders whose workflow depends on the ticket.

Potential:

```text
Branch Manager
Supervisor
assigned Driver
```

The exact recipient scope must follow branch permissions.

---

## 31.7 Ticket delivery/submission

**Event:**

```text
ticket.delivered
```

Internal operational recipients may receive:

```text
push
```

Customer notification should be a separate customer communication rule.

Do not automatically expose internal ticket data to customers.

---

## 31.8 Sync exception

**Event:**

```text
sync.exception
```

**Recipients:**

```text
authorized operational manager/supervisor
```

**Channel:**

```text
push
```

Only notify on actionable sync failures.

Normal offline synchronization must not generate user notifications.

---

# 32. Important offline rule

BakeFlow's offline architecture must NOT turn ordinary offline behavior into notifications.

These are not notification events:

```text
device went offline
ticket stored locally
normal sync queued
normal sync completed
```

They are application/system states.

Only actionable failures or conflicts should generate notifications.

---

# 33. Financial audit notifications

Potential events:

```text
financial_audit.completed
financial_audit.variance_detected
```

Variance notifications should go to authorized:

```text
Branch Manager
Owner/Admin where configured
```

not automatically to Drivers.

---

# 34. Payment notifications

Potential events:

```text
payment.recorded
payment.failed
refund.created
refund.completed
```

Internal recipients should depend on role and workflow.

Customer-facing payment notifications should be separately configurable.

---

# 35. Refund notifications

A refund event may notify:

```text
authorized finance/management users
```

and optionally:

```text
customer
```

through the customer's configured channel.

Do not expose internal refund reasons or audit metadata unnecessarily.

---

# 36. Inventory notifications

Potential events:

```text
stock.low
stock.out
stock.adjusted
stock.waste_recorded
```

Recipients:

```text
Supervisor
Branch Manager
authorized inventory users
```

Drivers should not automatically receive inventory alerts unless their role requires them.

---

# 37. Production notifications

Potential events:

```text
production.batch.created
production.batch.completed
production.exception
```

Recipients:

```text
production-authorized users
Supervisor
Branch Manager
```

Only actionable events should generate push notifications.

---

# 38. Security notifications

Security-sensitive events should receive stronger treatment.

Examples:

```text
new device/session
password/account recovery
role change
membership revoked
destructive action requested/completed
permanent deletion challenge initiated/completed
```

Recommended channels:

```text
push + email
```

where contact information is available.

---

# 39. Permanent deletion notifications

The exceptional destructive workflow should generate an audit/security notification.

Example:

```text
permanent_deletion.requested
permanent_deletion.completed
```

Recipients:

```text
authorized Owner/Admin/Manager
```

according to the destructive-action scope.

Do not notify every user in the organization.

---

# 40. Customer notification architecture

Customer notifications should not be coupled directly to internal staff notifications.

Use separate recipient policies.

Example:

```text
ticket.delivered
        |
        +--> internal notification
        |
        +--> customer notification
```

This prevents accidentally sending internal operational data to customers.

---

# 41. Customer channel preference

For registered customers, supported communication channels can eventually include:

```text
email
SMS
WhatsApp
```

depending on the contact data and consent.

For roadside customers who are not registered, BakeFlow should not require customer notification infrastructure.

---

# 42. Driver roadside customer rule

A roadside customer may be recorded without a registered customer profile.

Therefore:

```text
no customer account
```

must not prevent the ticket from being created.

Customer notification should only be attempted when a valid customer communication endpoint is explicitly available.

---

# 43. Templates

Templates must be versioned.

Conceptually:

```text
notification_template
    event_type
    channel
    locale
    version
    subject
    body
    active
```

Do not hard-code complete notification copy across multiple React Native screens/functions.

---

# 44. Template variables

Templates should receive controlled variables.

Example invitation:

```text
recipient_name
organization_name
inviter_name
role
invitation_url
expires_at
```

Do not pass arbitrary database rows directly into templates.

---

# 45. Localization

The notification layer should be capable of locale selection.

MVP can start with the application's supported default language.

The architecture should not make localization impossible later.

---

# 46. Deep links

Push notifications and emails may contain links into the app.

The link must:
- identify the intended resource/action
- require authentication where appropriate
- re-check authorization after opening
- never grant access merely because the user has the link

An invitation link is a special authentication/onboarding flow and must be handled separately.

---

# 47. Notification payload minimization

Push payloads should not contain sensitive financial or customer data unnecessarily.

Prefer:

```text
event_type
resource_id
short display text
```

and let the authenticated app fetch authorized details.

Do not put full:
- customer records
- payment details
- financial reports
- internal notes

into push payloads.

---

# 48. Secrets

Provider credentials must remain server-side.

Never place:

```text
email API keys
SMS API keys
WhatsApp credentials
provider secrets
```

in:
- React Native bundle
- Expo public configuration
- client-side environment variables
- database rows readable by ordinary users

Use Supabase Edge Functions/server-side secrets or the project's secure secret mechanism.

---

# 49. Provider configuration

Provider configuration should be environment-specific:

```text
development
staging
production
```

Do not hard-code provider credentials into migrations.

---

# 50. Observability

Every delivery attempt should be traceable.

Minimum conceptual fields:

```text
notification_id
event_id
recipient_id
channel
provider
provider_message_id
status
attempt_count
last_attempt_at
delivered_at
failed_at
failure_code
```

Do not log:
- provider API secrets
- invitation plaintext tokens
- authentication credentials
- unnecessary customer PII

---

# 51. Notification retention

Notification delivery history should be retained long enough for:
- troubleshooting
- security auditing
- delivery disputes
- invitation troubleshooting

Retention must follow the broader BakeFlow retention policy.

Do not retain provider payloads indefinitely if they contain unnecessary personal data.

---

# 52. Rate limiting

Notification delivery must be rate limited.

Prevent:
- notification storms
- duplicate retries
- malicious event generation
- accidental loops
- provider abuse

Especially protect:

```text
SMS
WhatsApp
email
```

because they may incur direct costs.

---

# 53. Cost control

Channel priority should generally be:

```text
push
    |
    v
email
    |
    v
SMS/WhatsApp
```

depending on event criticality and user preference.

Do not send expensive SMS/WhatsApp messages for events that can safely be delivered through push.

---

# 54. Offline and notification queues

Offline-created events must be idempotent.

Example:

```text
Driver creates ticket offline
        |
        v
ticket sync operation
        |
        v
server accepts once
        |
        v
ticket.created event once
        |
        v
notification job once
```

A sync retry must not create duplicate notifications.

---

# 55. Event ordering

Some notifications depend on ordering.

Example:

```text
ticket.assigned
ticket.corrected
ticket.delivered
```

The notification system should preserve the relevant event/revision ordering.

Do not notify:

```text
ticket.delivered
```

before the server has accepted the underlying ticket event.

---

# 56. Correction notifications

Because submitted tickets cannot be edited:

```text
correction = new event
```

Therefore a correction notification should reference:

```text
original_ticket_id
correction_ticket_id
```

where authorized.

Do not send a misleading notification saying:

```text
Ticket updated
```

if the system's actual business model is immutable ticket + correction.

Use terminology such as:

```text
Ticket corrected
```

---

# 57. Archiving notifications

Archiving is not deletion.

If archive events are notified:

```text
ticket.archived
```

the message should explicitly communicate archival rather than deletion.

---

# 58. Notification permissions

A user must only receive notifications for data they are authorized to view.

Recipient resolution should therefore perform authorization-aware filtering.

Never:

```text
select all branch users
```

and then send sensitive data blindly.

---

# 59. Multi-organization safety

A user may belong to multiple organizations.

Every notification must carry organization context.

Recipient resolution must validate:

```text
recipient user
+
organization membership
+
branch assignment
+
role/permission
```

A notification generated in Organization A must never leak Organization A data into the user's Organization B context.

Push notifications are especially important here because a single device may be associated with multiple organizations.

---

# 60. Organization context in push

Push notifications should include enough context for the app to switch to the correct workspace safely.

For example:

```text
organization_id
resource_type
resource_id
```

may be included if those identifiers are not sensitive.

The app must still verify access through the authenticated backend.

Never treat push payload organization IDs as trusted authorization.

---

# 61. Recommended initial event matrix

| Event | Driver | Supervisor | Branch Manager | Admin | Owner | Customer |
|---|---:|---:|---:|---:|---:|---:|
| Organization invitation | — | — | — | configurable | configurable | — |
| Ticket assigned | Push | Push if relevant | Optional | — | — | — |
| Ticket corrected | Push if assigned | Push | Push | configurable | configurable | optional |
| Ticket delivered | — | Push/optional | Push/optional | configurable | configurable | optional |
| Financial audit completed | — | Push if authorized | Push | configurable | configurable | — |
| Cash variance | — | Push if authorized | Push | configurable | configurable | — |
| Refund completed | — | authorized only | Push | configurable | configurable | optional |
| Stock low | — | Push | Push | configurable | configurable | — |
| Production exception | — | Push | Push | configurable | configurable | — |
| Role changed | — | Push + Email | Push + Email | Push + Email | Push + Email | — |
| Membership revoked | — | Push + Email | Push + Email | Push + Email | Push + Email | — |
| Security event | — | Push + Email if authorized | Push + Email | Push + Email | Push + Email | — |
| Sync exception | Push if own workflow affected | Push | Push | configurable | configurable | — |

This is the starting matrix, not permission bypass logic.

---

# 62. Events that should NOT notify by default

Do not notify users for every database mutation.

Avoid notifications for:

```text
normal sync completion
normal local queue creation
ordinary page/view events
routine audit-log inserts
every stock movement
every ticket database update
every query
```

Notification volume must remain useful.

---

# 63. MVP channel decisions

For the initial BakeFlow mobile release:

```text
Transactional invitation:
EMAIL

Operational staff alerts:
EXPO PUSH

Security-sensitive alerts:
PUSH + EMAIL

Customer transactional communication:
SMS/WHATSAPP where explicitly configured

Marketing:
OUT OF SCOPE
```

This is intentionally conservative.

---

# 64. Provider implementation recommendation

The architecture should be:

```text
Supabase Edge Function / server-side worker
        |
        +--> Email adapter
        |
        +--> Push adapter
        |
        +--> SMS adapter
        |
        +--> WhatsApp adapter
```

The database records the job and state.

The provider credentials remain outside the client.

---

# 65. What Claude Code must NOT do

Claude Code must not:

1. Send email directly from React Native.
2. Put email/SMS/WhatsApp API keys in Expo.
3. Treat push tokens as authentication.
4. Assume one push token per user.
5. Send notifications directly from database triggers without an idempotent delivery architecture.
6. Create duplicate notification jobs when sync retries.
7. Treat invitation token creation as successful invitation delivery.
8. Mark an invitation delivered before the provider confirms the appropriate delivery state.
9. Send internal financial information to customers.
10. Send one organization's notification to another organization.
11. bypass RLS for convenience.
12. use SMS/WhatsApp for every event.
13. make direct FCM/APNs mandatory for the MVP.
14. introduce a provider-specific API throughout feature code.
15. expose invitation tokens in logs.
16. put sensitive data in push payloads.
17. make notification delivery block ticket creation.
18. retry permanent provider failures forever.
19. treat archive as delete.
20. reintroduce mutable ticket semantics.

---

# 66. Required implementation phases

## Phase 1 — Invitation delivery

Implement:

```text
invitation created
    ->
email job
    ->
email provider
    ->
delivery status
    ->
invitation acceptance
```

This is the most immediate missing end-to-end capability.

---

## Phase 2 — Push infrastructure

Implement:

```text
device registration
push token storage
Expo Push integration
notification job
delivery status
invalid token cleanup
```

---

## Phase 3 — Event routing

Implement the initial event catalogue:

```text
ticket assigned
ticket corrected
financial audit variance
refund completed
stock low
production exception
role changed
membership revoked
security events
sync exception
```

---

## Phase 4 — SMS/WhatsApp

Add only when customer/operational workflows require them.

Do not block the MVP on every channel.

---

# 67. Required tests

## Invitation

```text
invitation created
=> email job exists

provider success
=> sent/delivered state updates

provider failure
=> retry

expired invitation
=> cannot be accepted

revoked invitation
=> cannot be accepted
```

## Push

```text
one user
=> multiple devices

invalid token
=> token disabled

same event retried
=> one notification

offline sync retried
=> one notification
```

## Multi-organization

```text
User belongs to Org A + Org B

Org A event
=> only Org A context/data

Org B event
=> only Org B context/data
```

## Permissions

```text
Driver
=> cannot receive unauthorized management notifications

Supervisor
=> branch-scoped

Branch Manager
=> branch-scoped

Owner/Admin
=> according to explicit permissions
```

## Provider failure

```text
ticket succeeds
provider fails
=> ticket remains successful
```

## Security

```text
push payload
=> no sensitive financial/customer data

provider secret
=> never available to client
```

---

# 68. Final decisions

For BakeFlow's current scope:

```text
INVITES
=
transactional email.

PUSH
=
Expo Push for MVP.

ANDROID
=
Expo Push abstracts FCM.

IOS
=
Expo Push abstracts APNs.

DIRECT FCM/APNs
=
deferred until a concrete requirement justifies it.

SMS
=
separate transactional channel.

WHATSAPP
=
separate approved business messaging channel.

NOTIFICATION ARCHITECTURE
=
event-driven + queued + idempotent.

DELIVERY
=
asynchronous.

BUSINESS OPERATIONS
=
must not depend on notification delivery succeeding.

INVITATIONS
=
not complete until there is an actual delivery path.

PUSH TOKENS
=
multiple devices per user.

AUTHORIZATION
=
always server-side.

MULTI-ORG
=
organization context is mandatory.

OFFLINE SYNC
=
must be idempotent and must not duplicate notifications.

SECURITY
=
provider credentials server-side; sensitive data excluded from push payloads.
```

---

# 69. Immediate implementation priority

The first implementation task should be the invitation path:

```text
Create invitation
        |
        v
Generate secure invitation credential
        |
        v
Persist invitation
        |
        v
Create idempotent notification job
        |
        v
Transactional email provider
        |
        v
Provider delivery webhook
        |
        v
Update delivery state
        |
        v
Recipient opens secure invitation
        |
        v
Authenticate/create account
        |
        v
Validate invitation
        |
        v
Activate membership
```

Until this path exists, organization invitations are not an end-to-end feature even if the database successfully creates invitation tokens.

---

# 70. Specification boundary

This document defines:

```text
which channels exist
which provider architecture is expected
which events can produce notifications
who can receive them
how delivery is secured
how delivery is retried
how offline events interact with notification delivery
```

It does not lock a specific commercial vendor for every channel.

Provider selection should be finalized during implementation after considering:
- Nigeria delivery coverage
- pricing
- WhatsApp business requirements
- transactional email deliverability
- API reliability
- webhook support
- regulatory/consent requirements
- expected BakeFlow volume
