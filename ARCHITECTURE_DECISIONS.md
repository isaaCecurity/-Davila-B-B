# BakeFlow — Architecture Decisions

Locked decisions. Agents must not redesign these. A conflicting generic
recommendation loses; raise a blocker instead.

Status legend: **IMPLEMENTED** = applied and verified against the live database or
repository. **APPROVED** = decided, not yet built. **DEFERRED** = intentionally later.

---

## AD-001 — Tenancy: Organization → Branch · IMPLEMENTED
Canonical column is `tenant_id` (never `organization_id`/`bakery_id`). Branch-scoped
tables additionally carry `branch_id`. Set `tenant_id` explicitly on every insert.

## AD-002 — Multi-organization membership · IMPLEMENTED
A user may belong to many organizations. **`user_roles` is the membership model** —
no `organization_memberships` table. `profiles.tenant_id` is the originating "home"
organization, not an authorization boundary.
*Evidence:* migration `20260810141318`; `guard_user_role_integrity()` no longer
requires `user_roles.tenant_id = profiles.tenant_id`.

## AD-003 — JWT carries only the active organization · IMPLEMENTED
`tenant_id` = active organization; `roles` = roles **within that organization only**.
A flat array unioned across organizations is a privilege-escalation bug: `has_role()`
cannot tell which organization granted a role.
*Evidence:* migrations `20260810141339`, `20260810182611`; tests S5c/S5c2.

## AD-004 — Active organization is UI context, membership-validated · IMPLEMENTED
`profiles.active_tenant_id`, changed only via `set_active_organization()`. Direct
client writes are blocked by the pinned `profiles_update_self` policy.
*Evidence:* migration `20260810141258`; tests G1/G2.

## AD-005 — Devices are user-owned · IMPLEMENTED
`sync_devices` has no `tenant_id`/`branch_id`. One device legitimately serves several
organizations. Columns were dropped, not nulled: `verify_tenant_columns()` rejects a
nullable `tenant_id` outside `profiles`.
*Evidence:* migration `20260810141719`; test S10a.

## AD-006 — Sync routing is operation-authoritative · IMPLEMENTED
An operation's immutable `tenant_id` decides its destination. Never the device, never
`current_tenant_id()`, never the active organization, never a batch-level parameter.
One batch may span organizations.
*Evidence:* migration `20260810182203`; tests S1–S4, S10b.

## AD-007 — Immutable operation context · IMPLEMENTED
`operation_id`, `tenant_id`, `branch_id`, `actor_id`, `device_id`,
`device_created_at` are stored verbatim. `actor_id` comes from the authenticated
device relationship; a payload `actor_id` is ignored. The server owns `received_at`.
*Evidence:* tests S9, S12.

## AD-008 — Branch authorization order · IMPLEMENTED
Branch-belongs-to-organization is checked **before** owner/admin authority, so a
branch id from Bakery B can never be authorized by ownership in Bakery A.
*Evidence:* migration `20260810182112`; test S2.

## AD-009 — Sync gateway boundary · APPROVED
The gateway authenticates the device, authorizes per operation, preserves immutable
context, enforces idempotency, and **records** operations. It does **not** write
business tables. Per-entity application and conflict semantics are a later task.
No last-write-wins.

## AD-010 — Money and quantities · IMPLEMENTED
Money `NUMERIC(19,4)`; quantities `NUMERIC(18,4)`; percentages `NUMERIC(5,2)`.
Rounding only at final display or settlement.

## AD-011 — Ticket is the canonical order entity · IMPLEMENTED
Tables `tickets`/`ticket_items`; permissions `tickets.*`. Order means Ticket. Live RPC
arguments named `p_order_id` take a `tickets.id` — do not rename.

## AD-012 — Soft delete · IMPLEMENTED
`deleted_at`/`deleted_by` plus a hash-confirmed permanent-delete flow gated by
`records.permanent_delete`. No casual `DELETE`.

## AD-013 — Offline storage · APPROVED (not built)
One SQLCipher database **per authenticated user**, spanning that user's
organizations. Key: 32 CSPRNG bytes in SecureStore, never derived from any
application value. Never silently re-key. Expo Go is not a target runtime.

## AD-014 — Supabase auth session storage · IMPLEMENTED
Store the Supabase auth session in chunked `expo-secure-store` entries protected by the
platform Keychain/Keystore. The storage adapter must handle SecureStore's per-value size
limit, remove stale chunks on overwrite, and treat incomplete writes as no session.
No AsyncStorage and no plaintext session file are permitted. Auth session, SQLCipher key,
and business database remain separate. `expo-crypto` is used for randomness where needed,
not as a cipher; it does not provide AES-GCM.
*Evidence:* `packages/auth/chunked-storage.ts` and its executed storage checks.

## AD-015 — Web workspace deferred · IMPLEMENTED
`apps/web` stays on React 18 and is outside the active npm workspace. Do not upgrade
it for consistency; do not re-add it until web development begins.

## AD-016 — Permissions not yet enforced server-side · APPROVED (backlog)
`has_permission()` gates **zero** of 101 policies; role-based RLS is authoritative.
Do not retrofit permission enforcement without a separate decision.

## AD-018 — Driver trip cash custody is distinct from branch till custody · APPROVED
Resolves BLOCKER-019. Driver-collected cash belongs to the active `driver_trip`'s cash
custody context while the driver is out — it is linked to the branch's cash session but
must **not** increase the branch drawer's `expected_cash` while it remains with the
driver. Two custody contexts, not one collapsed model:

1. **Branch cash session / till custody** — the existing `cash_sessions` machinery,
	 unchanged. `expected_cash` continues to mean physical drawer cash only.
2. **Driver trip cash custody** — cash the driver is holding, tracked against the trip,
	 contributing to the trip's own expected-cash-return figure, not the branch drawer's.

At trip reconciliation: expected driver cash (from the trip's recorded cash movements) is
compared against physical cash returned; any discrepancy is recorded explicitly, never
silently corrected. Only once accepted does the returned cash enter the branch cash
session's own recorded cash (a normal cash-in to the till, through whatever mechanism the
existing cash-session model already uses for that — no new till-side accounting concept).

**Do not duplicate `cash_sessions`' accounting logic.** The trip-cash-custody schema
follows the same shape (recorded movements, an expected-vs-actual comparison, an explicit
variance field) rather than inventing a parallel ledger design.

## AD-019 — `deliveries` remains the sole authority for physical delivery state · APPROVED
Resolves BLOCKER-020. `driver_trips` is an operational/custody wrapper; it does not
replace or bypass the existing `deliveries` state machine and its `guard_delivery_
transition()` invariants (`STATE-MACHINES.md`). Three responsibilities stay separated:

- **Ticket/sale completion** — the commercial transaction was recorded.
- **Driver trip** — operational context for the driver's field activity (custody, route,
	reconciliation).
- **`deliveries`** — authoritative physical-delivery / proof-of-delivery state. Unchanged.

For a trip-linked, `fulfilment_type = 'delivery'` ticket: the ticket links to the trip:
completing its sale must **not** silently transition the linked `deliveries` row.
`ready → delivered` continues to require the existing verified `deliveries` row exactly as
today (`STATE-MACHINES.md` §60) — trip work integrates with `deliveries`, it does not
redefine its authority. Any future RPC touching a trip-linked ticket's delivery status
must call the existing delivery-transition path, not a new one.

## AD-020 — Driver field-sale tickets take a shortened `draft → completed` lifecycle · APPROVED
Resolves BLOCKER-021. A driver-created, trip-linked roadside/field-sale ticket sells stock
that is **already produced and already loaded** (per `verify_trip_loading()`) — the seven
production-pipeline hops (`submitted → confirmed → scheduled → in_production → ready →
delivered → completed`) describe a baking process that has already happened before the
driver departed. Forcing that ticket through all seven hops, or adding `driver` to their
actor lists, would either misrepresent what the driver is doing or let a driver silently
skip the production controls a made-to-order ticket still needs.

**Explicitly not done:** `driver` was not added to any of the seven existing forward-hop
actor lists in `guard_ticket_status_transition()`, and `draft → completed` is not
universally legal for any ticket. The shortcut is a new, narrowly-gated hop, reachable only
through `complete_driver_field_sale(p_ticket_id, p_warehouse_id)`, itself gated by:

- the ticket is linked to a `driver_trip_id`;
- that trip is currently `in_transit`;
- the caller is that trip's own driver (`driver_trips.driver_id = auth.uid()`, the same
	identity the assignment guard already establishes at link time) or a manager;
- `fulfilment_type = 'pickup'` — a `delivery`-fulfilment ticket is refused outright, so
	**AD-019 is untouched**: `deliveries` stays the sole proof-of-delivery authority for
	every ticket that needs one;
- the ticket has at least one item.

The RPC performs the same side effects the normal lifecycle would have: recomputes
`subtotal_amount` from items (`confirm_ticket()`'s mechanism), issues the invoice
(`confirm_ticket()`'s insert), and writes the sale stock movement (`complete_ticket()`'s
mechanism) — **out of the driver trip's own warehouse**, not the branch default, since the
goods were in the vehicle's custody, not the branch shelf. Payment/credit stays exactly as
already decided: `record_payment()`'s existing driver-trip-scoped branch is unchanged and
untouched by this decision, and `amount_paid < total_amount` remains a legitimate credit
sale, same as any other ticket.

**Guard mechanism**: `guard_ticket_status_transition()` gained `'completed'` as a legal
target from `'draft'`, but only reachable when a transaction-local flag
(`bakeflow.driver_field_sale_rpc`) is set — the same technique `guard_production_batch_
transition()` already established for BLOCKER-017. `complete_driver_field_sale()` sets it
immediately before its own status UPDATE; no other caller (including a raw table write) can
set it, so the hop is refused everywhere except through that one function. `authenticated`
in fact holds no `UPDATE` grant on `tickets` at all (`INSERT`/`SELECT` only, matching
`deliveries`' posture) — the flag is defence in depth against any future RPC or migration
path, not a client bypass that was otherwise reachable.

## AD-017 — MVP financial rules · APPROVED
The MVP uses the Engineering Bible financial model and defers tax, discounts, COGS,
gross profit, margin, and refunds. Existing schema objects and API contracts for
deferred capabilities remain dormant and are not exposed by MVP workflows.

- Money remains `NUMERIC(19,4)` per AD-010. Quantities remain `NUMERIC(18,4)`.
- Revenue is recognized when a ticket reaches `delivered` or `completed`, using
	`tickets.fulfilled_at` as the business-event timestamp. Revenue is independent of
	payment collection.
- Product pricing uses effective-dated price history. The price active when a ticket
	is created is copied to its ticket items and remains frozen for that ticket.
- A credit sale creates no payment row. Outstanding balance is derived from the ticket
	total less actual payments. Later settlement creates a new append-only payment row.
- MVP payment methods are `cash`, `card`, `transfer`, and `pos`. Overpayments are
	rejected against the current outstanding balance.
- Invoices are issued on confirmation and become void on cancellation only when no
	payment exists. Paid or partially paid tickets are not cancelled in MVP and may only
	be archived; refunds remain deferred.
- Cash sessions follow the branch-level state machine in `STATE-MACHINES.md`: one open
	session per branch, with expected drawer cash equal to opening float plus cash
	payments minus cash expenses. Non-cash expenses do not reduce expected drawer cash.
- Customer balances and ledger views are derived from tickets, invoices, and payments;
	they are not duplicated in a second source-of-truth ledger.

## AD-021 — Offline sync: per-entity conflict strategy, server-authoritative `sync_conflicts` · APPROVED
Resolves BLOCKER-006. Completes AD-009's deferred "per-entity application and conflict
semantics" and reaffirms AD-006 (operation-authoritative routing) rather than replacing it.
**Last-write-wins remains prohibited everywhere**, per `OFFLINE-SYNC-MODEL.md` §32/§62.

**Terminology correction applied to the source decision.** The decision as given uses
"Tickets" and "Orders" as two separate entities with two separate strategies. BakeFlow has
no `orders` table — AD-011 is explicit that Order means Ticket and forbids the word in code.
Read together, the two subsections describe two strategies for the **same** `tickets`/
`ticket_items` entity pair, not two entities: ticket **creation and lifecycle transitions**
are event/state-machine-validated (the "Tickets" strategy below), while **in-place edits to
an existing ticket's items/amounts during the window `STATE-MACHINES.md` already allows**
(confirmed/scheduled/in_production — see `TESTING-STRATEGY.md` §6) are revision-checked (the
"Orders" strategy below, renamed). Operation types are named accordingly — `ticket.create`,
`ticket.transition`, `ticket.item_update`, never `order.*`.

**Per-entity strategy:**

- **Tickets** — operation-based + server state-machine validation. Creation is idempotent
	on `operation_id`. `tenant_id`/`branch_id` are immutable on the operation and route
	independently of the actor's current active organization (AD-006, restated). Lifecycle
	transitions are validated against `guard_ticket_status_transition()`; an invalid or stale
	transition is a conflict, never a silent overwrite.
- **Ticket item/amount edits within the permitted mutable window** — optimistic concurrency
	via `base_revision`. No automatic field-level merge in MVP: `base_revision != current
	revision` is always a conflict, never a merge attempt.
- **Inventory** — append-only domain operations (`inventory.adjust`, `.receive`, `.consume`,
	`.waste`, `.transfer`), never a synchronized absolute quantity. Concurrent legitimate
	adjustments both apply; only a server-side rule violation (e.g. resulting negative stock)
	becomes a conflict/rejection.
- **Production** — operation-based + state-machine validation, same shape as tickets
	(`production.start`, `.complete`, `.cancel`, `.record_output`, `.record_waste`), validated
	against `guard_production_batch_transition()`.
- **Financial records (payments, expenses)** — append-only + compensating operation.
	Creation is idempotent; posted records are immutable; corrections are explicit reversal
	operations (`payment.reverse`, `expense.reverse`), never an in-place amount edit.
- **Customers** — optimistic concurrency via `base_revision`, explicit conflict on mismatch,
	no automatic field-level merge in MVP.
- **Products/catalog** — server-authoritative; offline read/cache only. Offline catalog
	create/edit is out of first sync scope. Historical ticket items keep their frozen price
	(AD-017) regardless of later catalog price changes.

**`sync_conflicts` is a server table, authoritative — not only a client projection.**
This **corrects** `OFFLINE-SYNC-MODEL.md` §10, which previously said a conflict is recorded
only as `sync_operations.status = 'CONFLICT'` with no dedicated table and explicitly said a
server table was "not required." That guidance is superseded: a conflict must survive device
loss, reinstall, local DB corruption, and an organization switch, and must remain visible to
another authorized device or an administrator. Minimum contract: `id`, `tenant_id`,
`branch_id`, `entity_type`, `entity_id`, `operation_id`, `actor_id`, `device_id`,
`operation_type`, `operation_payload` (the original attempted operation, preserved —
never discarded in favour of a message string), `base_revision`, `current_revision`,
`conflict_code`, `conflict_status` (`OPEN | RESOLVED | DISMISSED`), `created_at`,
`resolved_at`, `resolved_by`, `resolution_type`, `resolution_payload`. The client may keep a
local projection for UX; it is not the record of truth.

**`operation_type` is a finite, allowlisted set of domain operations, dispatched to
registered handlers — never arbitrary CRUD/SQL.** Unknown types are rejected outright. The
payload is typed domain data (`{"quantity": 5, "reason": "waste"}`), never an instruction
(`{"sql": "UPDATE ..."}`). The envelope's authoritative fields — `operation_id`,
`operation_type`, `tenant_id`, `branch_id`, `entity_id`, `base_revision`,
`device_created_at` — reuse the immutable-context fields AD-007 already established; this is
not a second competing routing model.

**Conflict outcomes:** `APPLIED`, `DUPLICATE`/`ALREADY_APPLIED`, `REJECTED`, `CONFLICT`,
`RETRYABLE_FAILURE` (transient/network — distinct from a business conflict). A `CONFLICT`
operation is preserved and stops retrying automatically; it does not disappear and does not
loop.

**Organization routing and the authorization chain apply to every entity above, not only
tickets.** AD-006's rule — an operation's immutable `tenant_id`/`branch_id` decides its
destination, never the actor's active organization, never the device — governs inventory,
production, financial, customer, and catalog operations identically. Re-verified live
2026-08-28 rather than assumed: `sync_devices` carries no `tenant_id`/`branch_id` at all
(AD-005), so per-operation authorization is the only mechanism that can exist. The chain is
`is_member_of(actor, operation.tenant_id)` (live membership, active profile) then, where a
branch applies, `is_authorized_for_branch()` — which checks the branch belongs to that same
tenant **before** any owner/admin shortcut, matching AD-008. Both functions were read live
and are correct. Conflict *resolution* must not weaken this chain: resolving or dismissing a
conflict is itself an operation against the entity's tenant/branch and needs the same
authorization, not a lesser one — this was implicit in the source decision and is made
explicit here.

**`sync_conflicts` is tenant-owned data and gets RLS like every other table (CLAUDE.md rule
4), not a special case.** Not stated by the source decision, added here because it is
non-negotiable project-wide, not optional per table: RLS enabled, policies scoped by
`tenant_id` (and `branch_id` where the underlying entity is branch-scoped), `tenant_id` set
explicitly on insert. Visibility should follow the same membership the entity itself would —
an actor sees a conflict on an operation they could see the entity for, not every conflict
in the tenant by default; the exact role gate for viewing/resolving/dismissing (owner/admin
only, or wider) is implementation detail, not decided here, but "RLS exists and is
tenant-scoped" is not optional and must not be deferred to "later."

**Not decided by this entry — implementation, not architecture:** exact `sync_conflicts`
column types/indexes and RLS role gate, the final operation-type allowlist beyond the
entities above, and the pull-RPC contract. Re-verified live 2026-08-28 rather than trusting
prior documentation: `process_sync_batch_context_validated()` is **not** a stub — migration
`20260810182203` (the same one AD-006 already cites) implemented real idempotency,
authorization, and stale-revision conflict detection; only the pull RPC and the actual
per-entity write to `sync_changes`/business tables remain unbuilt
(`SCHEMA-REFERENCE.md` §12, corrected in the same pass as this entry). One further
reconciliation is now open, not decided here: `sync_operations.operation_type`'s live CHECK
allows only six coarse values (`CREATE/UPDATE/SOFT_DELETE/EVENT/COMMAND/CORRECTION`), not
this decision's fine-grained allowlist (`ticket.create`, `inventory.adjust`, etc.) — whether
that becomes a new column or a widened CHECK is P3.7 implementation work. Do not re-litigate
the conflict model itself while building any of this.
