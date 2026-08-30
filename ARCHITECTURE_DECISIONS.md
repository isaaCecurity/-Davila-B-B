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

## AD-021 — Offline sync: per-entity conflict strategy, server-authoritative `sync_conflicts` · APPROVED (tickets slice IMPLEMENTED 2026-08-28; protocol layer HARDENED 2026-08-29; CUSTOMER slice IMPLEMENTED 2026-08-29)
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

**Implemented 2026-08-28 — first vertical slice: tickets only.** `sync_conflicts` exists
live with RLS (visible to the operation's own actor and to owner/admin/branch_manager,
resolution pinned to `resolved_by = auth.uid()`, no client INSERT grant). The
operation-type reconciliation above was resolved by addition, not by widening the coarse
CHECK: a new nullable `domain_operation` column on both `sync_operations` and
`sync_changes`, carrying this decision's fine-grained allowlist as its own CHECK
constraint — the coarse column and its sole two producers (`process_sync_batch_context_
validated()`, `archive_ticket()`) are unchanged. `apply_sync_operation()` dispatches by
`domain_operation`; an unbuilt or missing value is `REJECTED` with
`unsupported_operation_type`, never left silently `PENDING`. Built and live-verified
(`tests/sql/p3_7_sync_apply_and_pull.sql`, 11/11): `ticket.create`, `ticket.item_update`,
and `sync_pull` (cursor/`has_more` pagination, `SECURITY INVOKER` so it inherits the
existing `sync_changes_select` RLS rather than reimplementing it). `tickets.revision` is
now actually incremented (`bump_ticket_revision()`, mirroring `bump_cash_session_
revision()` — nothing had ever bumped it before). Two pre-existing defects surfaced and
fixed as prerequisites, both re-verified with zero regression against
`tests/sql/driver_field_sale_rls.sql` and `tests/sql/security_multiorg_sync.sql`:
`ticket_items.line_total` is a `GENERATED ALWAYS` column, not a plain field a handler may
insert into; and `guard_driver_created_order_assignment()` called `has_role()`, which per
AD-003 reads only the caller's active-organization JWT claim — silently wrong for the
cross-org case this decision exists to handle, dormant only because no prior write path
could ever produce a mismatched `tenant_id`. Fixed via a new tenant-parameterized
`has_role_in(actor, tenant, roles)`, the same pattern `is_authorized_for_branch()` already
established. **Not yet built (as of 2026-08-28):** inventory/production/financial/customer
handlers, and the `sync_operations.operation_type`/idempotency gaps `SCHEMA-REFERENCE.md`
§12 listed (tenant-bound idempotency lookup, payload-hash immutability, `client_sequence`/
`depends_on_operation_id`, `ALREADY_APPLIED` status, tombstone retention).

**Hardened 2026-08-29 — protocol-correctness pass, tickets slice only, no new entities.**
Instruction was explicit: do not redesign the working context-validation/authorization/
idempotency/conflict-detection layer, and do not expand into inventory/production/financial/
customer handlers yet. Every item below closes or narrows one of the "not yet built" gaps
listed above; live verification live-traced first, code changed second.

- **A real, previously-undiscovered bug, found before writing anything new.** Live-tested a
	`ticket.create` that provably created a real ticket, then read the RPC's own returned
	JSON — it reported `{"status":"PENDING"}`. Root cause:
	`process_sync_batch_context_validated()`'s client-facing response was built from a local
	variable snapshotted **before** the `INSERT` that fires `sync_operations_dispatch` (an
	`AFTER INSERT` trigger applying the operation synchronously via `apply_sync_operation()`).
	Every operation's batch response reported its pre-dispatch status
	(`PENDING`/`CONFLICT`) forever, regardless of the real outcome — a client could never
	learn `APPLIED`/`REJECTED` from the synchronous call at all, only from a later
	`sync_pull()` re-read. Fixed by re-reading the row after `INSERT`. This resolves the
	`ALREADY_APPLIED`-semantics gap: no new status value was added (`status` describes the
	operation's own lifecycle; `replayed:true/false` — now also carried on the replay path —
	describes whether this particular call was a retry; conflating the two would let one
	operation carry two notions of truth), but the response now reliably distinguishes newly
	applied / already-applied / rejected / conflict / unsupported, which it previously could
	not do at all.
- **Payload-hash/immutability, resolved without a hash column.** The replay/idempotency
	comparison previously checked only `tenant_id`/`actor_id`/`device_id`/`entity_id`/
	`operation_type` — a same-`operation_id` replay with a *different* payload,
	`base_revision`, `branch_id`, `entity_type`, or `domain_operation` was silently accepted
	as an identical retry. Widened to compare all of these; any mismatch raises the same
	pre-existing `operation replay with altered immutable context` (42501), no new error
	class invented. Payload comparison uses jsonb `=` (structural equality, confirmed live to
	be independent of key order — Postgres canonicalizes jsonb storage, unlike plain `json`)
	rather than a text hash: strictly correct and avoids a class of false-mismatch rejection a
	naive hash-of-serialized-text approach would risk. A malformed (non-object) payload is now
	rejected at the gateway boundary (22023) rather than silently reaching a handler.
- **Tenant-bound idempotency, confirmed already correct, not rebuilt.** `operation_id` is
	globally unique (`sync_operations_operation_id_key`), but the pre-existing tenant-mismatch
	branch of the replay check already raised 42501 and never returned another tenant's stored
	result — this was true before this pass and is now covered by live tests rather than only
	asserted.
- **`client_sequence`, added as diagnostic-only, deliberately not enforced.**
	`OFFLINE-SYNC-MODEL.md` §16 states it is "NOT a substitute for server revisions... do not
	treat a device sequence as global truth" and specifies no gap-detection or ordering-
	rejection semantics anywhere. A new nullable `sync_operations.client_sequence` column
	captures it verbatim; nothing compares, blocks, or dedupes on it. Inventing enforcement
	semantics would have violated this pass's own guardrail against making legitimate offline
	retries or out-of-order deliveries permanently unusable.
- **`depends_on_operation_id` — left unbuilt, is an open blocker, not guessed at.**
	`OFFLINE-SYNC-MODEL.md` §49 only says operations "may need to be rejected or placed into a
	dependency-failed state" — no concrete server behaviour. Existing per-handler existence
	checks (e.g. `apply_ticket_item_update`'s product-variant lookup) already give correct
	safety for the realistic cross-batch case, and within one batch, sequential single-
	transaction processing already gives correct ordering. Real blocking/queuing semantics for
	a not-yet-applied dependency need a fresh architecture decision before being built — see
	BLOCKERS.md.
- **`sync_pull()` cursor validation, implemented for the well-defined cases only.** A
	negative cursor is rejected (22023). A cursor ahead of everything the caller can see
	returns `full_resync_required:true` with an empty page rather than a silently-incomplete
	one. True cursor-expiry-via-retention-purge is **not** implemented: live evidence checked
	first — `sync_changes` has no `deleted_at`/TTL/archival column, and a repo-wide grep of
	`supabase/migrations` for purge/retention/archive/tombstone/TTL touching `sync_changes`
	returns zero hits. It is a true append-only ledger today, so that staleness case cannot
	currently occur; implementing detection for it would mean inventing a retention policy
	that does not exist. Open blocker, not guessed at — see BLOCKERS.md.
- **A security defect, incidental to the above, found and fixed.** A routine
	`get_advisors()` security check (run as due diligence before declaring this pass done)
	found `apply_ticket_create(sync_operations)` and `apply_ticket_item_update(sync_operations)`
	left `PUBLIC`-executable — the former even by `anon` — since the migration that created
	them never revoked the default grant. Both are `SECURITY DEFINER` and re-derive
	authorization from whatever `actor_id`/`tenant_id` the caller supplies in the row
	argument; correct when reachable only via `trg_dispatch_sync_operation()` from an
	already-authorized row, but a caller reaching them directly via PostgREST with any valid
	actor/tenant/role combination could have created real tickets, bypassing every check in
	`process_sync_batch()` entirely. Revoked (`p3_7_revoke_public_execute_on_internal_sync_
	handlers`), matching this repo's own precedent
	(`20260813234856_revoke_anon_execute_on_internal_functions`) and the same convention
	`security_multiorg_sync.sql`'s S11b already checks for `is_member_of()`/
	`is_authorized_for_branch()`. `apply_sync_operation()`, `trg_dispatch_sync_operation()`,
	`bump_ticket_revision()`, and this pass's own `has_role_in()` were fixed the same way for
	defense in depth; `sync_pull()` keeps its `authenticated` grant but loses a stray `anon`
	one.
- **`operation_type` reconciliation, re-traced, unchanged.** A repo-wide search (migrations,
	docs, tests, the frontend) found zero producers or consumers of `operation_type`/
	`domain_operation` outside this backend work — the frontend sync client does not exist
	yet. The additive `domain_operation` column strategy from 2026-08-28 remains fully
	compatible; the coarse `operation_type` CHECK is untouched, guarded by a new regression
	test asserting its exact value set.
- **Verification:** `tests/sql/p3_7_protocol_correctness.sql` (new, 18/18, live). Re-run
	clean, zero regression: `tests/sql/p3_7_sync_apply_and_pull.sql` (11/11),
	`tests/sql/security_multiorg_sync.sql` (22/23 — same pre-existing unrelated
	`rate_limit_events` gap), `tests/sql/driver_trips_rls.sql` (20/20),
	`tests/sql/financial_write_rls.sql` (28/28), `tests/sql/driver_field_sale_rls.sql`
	(8/8), `pytest` (12/12), `tsc --noEmit`, `eslint --max-warnings=0`, production `expo
	export --platform web`.
- **Still not built:** inventory/production/financial/customer handlers (deliberately, per
	this pass's own scope instruction); `depends_on_operation_id` enforcement; true
	cursor-expiry-via-retention-purge. All three are documented as open blockers in
	BLOCKERS.md, not guessed at.

**Implemented 2026-08-29, later same day — second vertical slice: CUSTOMER.** Instruction:
build `customer.create`/`customer.update` on the existing pipeline, reuse everything already
working, don't guess business rules, leave `customer.soft_delete` and every other entity
untouched. Live schema traced first, as with every prior step of this decision.

- **Live schema confirmed the surface before any code was written.** `public.customers` is
	tenant-scoped only — no `branch_id`, no `revision` column, no credit/balance column (credit
	is derived elsewhere, from tickets/payments, never stored on the customer row).
	`sync_operations.domain_operation`'s CHECK constraint already allowlisted
	`'customer.create'` and `'customer.update'` from the 2026-08-28 migration that added the
	column, unused until now — and conspicuously did **not** allowlist any
	`customer.soft_delete` value, which independently confirms create/update is the intended
	surface for this entity, not delete.
- **A live discrepancy between two authorization sources, resolved with evidence, not a
	coin flip.** `customers_insert`/`customers_update` RLS (the raw-table policies) admit only
	owner/admin/branch_manager/cashier — no driver, no supervisor. `docs/ROLES-AND-
	PERMISSIONS.md`'s live `role_permissions` grants (owner/admin/branch_manager/supervisor/
	cashier/driver for both `customers.create` and `customers.update`) disagree, and that
	document explicitly states the live grants table — not a hand-maintained RLS array —
	"reflects current intent," citing the identical, already-accepted gap for
	`tickets.create`/driver (§4, point 3 of its own "surprising things" list).
	`docs/ADR-001-Driver-Workflow-Redesign-MVP.md` (Approved 2026-08-24) independently and
	explicitly describes driver-created customers as a required product flow (§7, point 9 of
	its trip walkthrough), settling the question a second, unrelated way. `apply_customer_
	create`/`apply_customer_update` use `has_role_in()` — the same handler-level primitive
	`apply_ticket_create` already established, not the raw RLS array and not
	`has_permission()` — with the role set the permissions catalog and ADR-001 agree on:
	owner/admin/branch_manager/supervisor/cashier/driver. The RLS array itself was left
	unchanged: it is a separate, pre-existing staleness that does not affect the sync handler
	(SECURITY DEFINER, does not consult table RLS), out of scope for this pass.
- **`customer.update` authorization, initially implemented, then revised by an explicit
	product decision the same day.** First cut: the literal, unscoped `role_permissions`
	grant (owner/admin/branch_manager/supervisor/cashier/driver) was implemented rather than
	inventing `apply_ticket_item_update`'s ownership-scoping pattern
	(`created_by = actor OR assigned_to = actor`), since nothing in the schema,
	`role_permissions`, or ADR-001 established that restriction for customers, and `customers`
	has no `assigned_to`-equivalent column to express it against — flagged as BLOCKERS.md
	BLOCKER-024 rather than guessed. **Asked, and answered directly by the product owner the
	same day:** not ticket-style ownership-scoping, but a role restriction narrower than
	`customer.create` — owner/admin/branch_manager always; supervisor only while holding the
	supervisor role in that tenant; driver and cashier excluded entirely from
	`customer.update` (both keep `customer.create`). Implemented and live-verified: the
	handler's role array is now `ARRAY['owner','admin','branch_manager','supervisor']`.
	BLOCKER-024 is resolved. The decision also asked for a finer, per-supervisor
	manager-configurable toggle beyond simple role-presence — that has no backing schema
	anywhere in this codebase (`docs/ROLES-AND-PERMISSIONS.md` documents the identical gap as
	not built) and was not invented; tracked as new **BLOCKER-025**.
- **Full-value replacement, not a field-level merge.** `customer.update` overwrites
	`full_name`/`phone`/`email`/`address_line`/`notes`/`is_walk_in` wholesale from the payload
	every call, per `OFFLINE-SYNC-MODEL.md`'s stated no-field-level-merge principle for this
	architecture (the same doc that specifies ticket item/amount edits as
	`base_revision`-checked, not merged) — a partial-patch interpretation was considered and
	rejected as inconsistent with that stated principle, not chosen as a default.
- **Revision tracking needed no new column.** The generic gateway already computes
	conflict-relevant revision from `sync_changes.revision` keyed by `entity_id`, independent
	of whatever the entity's own table stores — this is how the existing conflict check in
	`process_sync_batch_context_validated()` already works for every entity type, tickets
	included. `apply_customer_create` writes `sync_changes.revision = 1`; `apply_customer_
	update` computes `max(revision)+1` from `sync_changes` for that `entity_id`. No revision
	column was added to `customers` itself, since nothing else needs to read one there.
- **`customer.create` then `ticket.create` referencing the new customer: the honest
	two-call path works, tested; the single-batch case remains BLOCKER-022, not worked around.**
	`customer.create` does not accept a client-supplied id (matching `apply_ticket_create`'s
	own precedent — the real id is server-generated, returned in the result), so a client
	cannot construct one offline batch containing both operations before either applies; it
	must complete the customer sync, receive the real `customer_id`, then submit the ticket
	sync as a separate call. Tested and passing (`tests/sql/p3_7_customer_sync.sql` T1). No
	`depends_on_operation_id`-style workaround was invented for the single-batch case — see
	BLOCKERS.md BLOCKER-022, updated with this finding.
- **Security, checked the same way as the 2026-08-29 protocol pass.** `apply_customer_
	create(sync_operations)` and `apply_customer_update(sync_operations)` were `REVOKE`d from
	`PUBLIC`/`anon`/`authenticated` in the same migration that created them, not as an
	afterthought — confirmed via `has_function_privilege()` and independently via a clean
	`get_advisors(type: 'security')` run (neither function appears among the anon- or
	authenticated-executable findings; the one expected finding, `process_sync_batch` itself
	being `authenticated`-executable, is by design, matching the existing pattern).
- **Verification:** `tests/sql/p3_7_customer_sync.sql` (new, 18/18, then revised to 21/21
	after the `customer.update` role-scope decision — see below). Re-run clean, zero
	regression: `tests/sql/p3_7_protocol_correctness.sql` (17/17 — its header's prior "18/18"
	was a pre-existing miscount, corrected the same pass this was noticed), `tests/sql/p3_7_
	sync_apply_and_pull.sql` (11/11); full matrix in `IMPLEMENTATION_LOG.md` 2026-08-29.
- **Still not built:** inventory/production/financial handlers, `customer.soft_delete`
	(deliberately — not in `domain_operation`'s CHECK constraint), `depends_on_operation_id`
	enforcement, true cursor-expiry-via-retention-purge, per-supervisor manager-configurable
	permission overrides (new, non-blocking: BLOCKER-025). `customer.update`'s role scope
	(BLOCKER-024) is RESOLVED — see the postscript below for the decision and its
	implementation. None of these are guessed at.

**Revised 2026-08-29, later same day — `customer.update` role scope decided (BLOCKER-024
resolved).** The product owner was asked directly whether `customer.update` should be
ownership-scoped like `apply_ticket_item_update` (driver restricted to
`created_by = actor OR assigned_to = actor`) or left as the unscoped grant first
implemented. The answer given was neither: a role-based restriction narrower than
`customer.create` — **owner, admin, and branch_manager may always edit an existing
customer; supervisor may edit only while holding the supervisor role in that tenant; driver
and cashier may not edit an existing customer at all** (both keep `customer.create`,
unaffected — confirmed explicitly this narrowing applies to `update` only). Implemented:
`apply_customer_update`'s `has_role_in()` array changed from
`['owner','admin','branch_manager','supervisor','cashier','driver']` to
`['owner','admin','branch_manager','supervisor']`; grants re-verified `REVOKE`d from
`anon`/`authenticated` after the change. `tests/sql/p3_7_customer_sync.sql` grew from 18 to
21 assertions (driver-only and cashier-only now proven `REJECTED`; branch_manager-only and
supervisor-only proven `APPLIED`) — 21/21 passed live. The decision additionally asked for a
per-supervisor, manager-configurable toggle finer than simple role-presence; that has no
backing schema anywhere in this codebase (`docs/ROLES-AND-PERMISSIONS.md` documents the
identical gap explicitly as not built) and was not invented — opened as new **BLOCKER-025**
rather than guessed at.

**Extended 2026-08-30 — INVENTORY vertical slice, two of five operations.** Continuing P3.7
into the next entity AD-021 already scoped ("Inventory — append-only domain operations
(`inventory.adjust`, `.receive`, `.consume`, `.waste`, `.transfer`), never a synchronized
absolute quantity... only a server-side rule violation (e.g. resulting negative stock)
becomes a conflict/rejection"). Live investigation before writing anything found the online
RPC `adjust_stock(p_warehouse_id, p_item_type, p_item_id, p_new_quantity, p_reason, p_note)`
is the only existing precedent for a management/production stock write: it accepts `reason
IN ('adjustment','waste','opening_balance')`, gates `'adjustment'`/`'opening_balance'` to
owner/admin/branch_manager and `'waste'` to owner/admin/branch_manager/baker, and forbids a
positive delta under `reason='waste'`. Built `apply_inventory_adjust()`/
`apply_inventory_waste()` mirroring those two reasons' role gates verbatim (an existing,
human-approved rule, not invented). Unlike `adjust_stock()`'s absolute-`p_new_quantity`
shape (workable online against a `FOR UPDATE`-locked read of current on-hand, not reliable
for an offline-queued operation), both new handlers take an explicit `quantity_delta`
directly in the payload — matching AD-021's own "append-only, never a synchronized absolute
quantity" framing more literally than the online RPC's own shape does — and reject only if
applying it would drive on-hand negative, AD-021's own named example of a rejection.
`sync_changes.operation_type='EVENT'` (not `'CREATE'`) is used for both, matching AD-021's
own text ("tickets: event/state-machine... inventory: append-only") for a fact that happened
rather than a mutable entity that was created.

**`inventory.receive`, `.consume`, and `.transfer` were investigated and deliberately NOT
built this pass** — each was found to have no clean precedent to mirror, unlike adjust/waste:
no RPC anywhere writes `reason='purchase'` (the same gap **BLOCKER-018** already names —
`stock_movements.unit_cost` is 100% NULL and nothing captures a purchase-cost event at all);
`reason='transfer_in'/'transfer_out'` is written exclusively by the driver-trip lifecycle
(`verify_trip_loading`/`return_driver_trip`), always linked to a specific trip, with no
generic warehouse-to-warehouse manual-transfer RPC to mirror and no decided answer for who
may perform one; `reason='production_consume'` is written exclusively inside
`complete_production_batch()`/`fail_production_batch()`, tied to a real batch, so a
standalone "consume" with no batch link has no defined meaning and would overlap unclearly
with adjust/waste. Opened as new, non-blocking **BLOCKER-026** rather than guessed at. All
three remain allowlisted in `domain_operation`'s CHECK (unchanged from AD-021) and are
correctly `REJECTED unsupported_operation_type` by the existing dispatcher fallback.

**Security, checked the same way as every prior P3.7 pass.** `apply_inventory_adjust`/
`apply_inventory_waste` were `REVOKE`d from `PUBLIC`/`anon`/`authenticated` in the same
migration that created them — confirmed via `has_function_privilege()` and independently via
a clean `get_advisors(type: 'security')` run (neither function appears in the findings).

**Verification:** `tests/sql/p3_7_inventory_sync.sql` (new, 14/14 live, including
negative-stock rejection, cross-tenant/cross-branch denial, replay idempotency, and a check
that `.receive`/`.consume`/`.transfer` still correctly fall through to
`unsupported_operation_type`). Re-run clean, zero regression: `tests/sql/p3_7_customer_sync.
sql` (21/21, re-verified after the dispatcher change). Full detail:
`IMPLEMENTATION_LOG.md` 2026-08-30.

**Still not built:** `inventory.receive`/`.consume`/`.transfer` (BLOCKER-026),
production/financial handlers, `customer.soft_delete` (deliberately — not in
`domain_operation`'s CHECK constraint), `depends_on_operation_id` enforcement, true
cursor-expiry-via-retention-purge, per-supervisor manager-configurable permission overrides
(BLOCKER-025). None of these are guessed at.

**Extended 2026-08-30, later same day — PRODUCTION vertical slice, two of five operations.**
Continuing P3.7 into the next entity AD-021 scoped ("Production — operation-based +
state-machine validation, same shape as tickets (`production.start`, `.complete`, `.cancel`,
`.record_output`, `.record_waste`), validated against `guard_production_batch_transition()`").
Live investigation before writing anything read `production_batches`' full CHECK/status-machine
shape and `guard_production_batch_transition()`'s own body: allowed hops are `scheduled` →
{`in_progress`, `cancelled`}, `in_progress` → {`completed`, `failed`}; `completed`/`failed`
additionally require a `bakeflow.production_batch_rpc` transaction-local flag (BLOCKER-017's
own technique) set only by `complete_production_batch()`/`fail_production_batch()` — a direct
UPDATE to either can never succeed. Built `apply_production_start()`/`apply_production_cancel()`
as plain guard-validated `UPDATE`s (`scheduled`→`in_progress`/`cancelled`), each with an
explicit `has_role_in(actor, tenant, roles)` pre-check mirroring the guard trigger's own actor
lists verbatim (`in_progress`: owner/admin/branch_manager/baker; `cancelled`: owner/admin/
branch_manager, no baker) — the existing, human-approved rule, not invented.

**A real, pre-existing defect was found and fixed as a prerequisite, live-reproduced before
fixing.** `guard_production_batch_transition()`'s own role check used `has_role(actors)` — the
session JWT's role claim, reflecting the session's *active* organization — not `new.tenant_id`,
the row's own tenant. Live-reproduced: a session active in org B, holding `branch_manager`
there, could flip an org A batch's status with zero role in org A at all. This is the exact
active-org-assumption bug class AD-006 already fixed for `is_authorized_for_branch()`/
`has_role_in()` elsewhere; this table's own trigger had never been touched by that fix, and was
dormant only because no prior write path could ever produce a mismatched `tenant_id` — until
this sync slice's explicit-tenant model made it reachable (the identical shape as the
`guard_driver_created_order_assignment()` defect found and fixed in the first P3.7 ticket
slice, 2026-08-28). Fixed via migration
`fix_guard_production_batch_transition_tenant_scoped_role_check`: the check now reads
`has_role_in(auth.uid(), new.tenant_id, actors)`. Re-verified live, same transaction as the
fix: the cross-org false-accept no longer occurs, a correctly org-scoped actor still succeeds,
and the existing online `complete_production_batch()` happy path (same-org, the only path that
existed before this pass) is completely unaffected.

**`production.complete`/`.record_output`/`.record_waste` were investigated and deliberately
NOT built.** AD-021's own text names all five production operations in one line but never
specifies `.record_output`'s or `.record_waste`'s payload or their relationship to the existing
`complete_production_batch()`/`fail_production_batch()` RPCs, which already combine a status
flip with ingredient-consume and product-output stock movements in one call. Whether the two
new names are synonyms for `.complete`/a "fail" op not in the allowlist, finer-grained
decomposed events, or something else is not decided anywhere. **A related defect was also
found while investigating:** both existing RPCs derive their own tenant via
`current_tenant_id()` (the session's active org), the same active-org-assumption bug class just
fixed in the trigger — but on a bigger, currently-untested surface (ingredient movements,
output movement, insufficient-stock rollback). Fixing that speculatively, before knowing what
`.record_output`/`.record_waste` are even meant to do, would risk guessing twice. Opened new,
non-blocking **BLOCKER-027** rather than guessed at. All three remain allowlisted in
`domain_operation`'s CHECK (unchanged from AD-021) and are correctly `REJECTED
unsupported_operation_type` by the existing dispatcher fallback.

**Security, checked the same way as every prior P3.7 pass.** `apply_production_start`/
`apply_production_cancel` were `REVOKE`d from `PUBLIC`/`anon`/`authenticated` in the same
migration that created them — confirmed via `has_function_privilege()` and independently via a
clean `get_advisors(type: 'security')` run (neither function, nor the patched trigger, appears
in the findings).

**Verification:** `tests/sql/p3_7_production_sync.sql` (new, 13/13 live, including the fixed
trigger's cross-org rejection, role-set differences between `start` and `cancel`, invalid-
transition/not-found rejection, cross-tenant denial, replay idempotency, and a check that
`.complete` still correctly falls through to `unsupported_operation_type`). Re-run clean, zero
regression: `tests/sql/p3_7_customer_sync.sql` (quick regression check re-confirmed after the
production dispatcher change). Full detail: `IMPLEMENTATION_LOG.md` 2026-08-30.

**Still not built (at that point):** `inventory.receive`/`.consume`/`.transfer` (BLOCKER-026),
`production.complete`/`.record_output`/`.record_waste` (BLOCKER-027), financial handlers,
`customer.soft_delete` (deliberately — not in `domain_operation`'s CHECK constraint),
`depends_on_operation_id` enforcement, true cursor-expiry-via-retention-purge, per-supervisor
manager-configurable permission overrides (BLOCKER-025). None of these are guessed at.

---

**Extended 2026-08-30, later same day — FINANCIAL vertical slice, three of four operations.**
Continuing P3.7 into AD-021's last unbuilt entity ("Payments/Expenses — append-only + explicit
reversal"). Live investigation found `record_payment()` and `record_refund()` as clean, live,
human-approved precedent RPCs for `payment.create`/`.reverse` — both use `has_role()`/
`has_branch_access()` (session-active-org), the exact AD-006 gap already fixed elsewhere this
session, so the new handlers mirror their business logic and role lists verbatim but authorize
via `has_role_in(actor, tenant, roles)` against `p_operation.tenant_id`/`branch_id`, never the
session's active org. Built `apply_payment_create()` mirroring `record_payment()` in full,
including the AD-018 driver-trip cash-custody branch and the cash-till-session branch;
`guard_payment_relationships()`/`apply_payment_to_ticket()` — existing triggers already keyed off
`NEW.tenant_id`, not session state — do the branch/overpayment/invoice/session validation and the
`tickets.amount_paid`/`invoices.status` derivation automatically, so the handler doesn't duplicate
it. Built `apply_payment_reverse()` mirroring `record_refund()` in full; `guard_refund_total()`
re-validates the over-refund guard as a second line of defense. Both `payments` and `refunds`
carry `prevent_financial_mutation()` (append-only at the database level), so `operation_type =
'EVENT'` is correct for both `payment.create` and `payment.reverse` — matching the inventory-
movement convention, not `'CREATE'`. A payment's lifecycle (create, then any reversals) is
tracked in `sync_changes` keyed by the ORIGINAL payment's `entity_id`, incrementing revision —
the same shared-entity-id ledger convention `production.start`/`.cancel` already established.

**Role source for `payment.create`/`.reverse`:** there is no `financial.payment.*` key in the
`role_permissions` catalog (`docs/ROLES-AND-PERMISSIONS.md` only covers `financial.expense.*`
and `financial.audit.*`) — unlike `customer.create`, there is no more-current catalog to defer
to, so `record_payment()`/`record_refund()`'s own `has_role()` arrays are the only live rule,
mirrored as-is.

**`expense.create` has no RPC precedent** — expenses are inserted directly by clients, gated by
the live `expenses_insert` RLS policy (`owner/admin/branch_manager/cashier/accountant`). That
array disagrees with the `role_permissions` catalog's `financial.expense.create` grants
(`owner/admin/branch_manager/supervisor/accountant` — no cashier) on both `cashier` and
`supervisor`. Unlike the `customer.create` precedent (a stale EB-013 doc vs. a current, deployed
catalog, with a documented resolution favoring the catalog), this is two independently live,
deployed mechanisms disagreeing with each other — not resolved here, logged in
`IMPLEMENTATION_LOG.md` and mirrored to the RLS array, since that's what actually gates expense
creation today for direct client inserts. `expenses` carries no immutability trigger and its own
`expenses_update` RLS policy permits direct edits, so `'CREATE'` (new mutable entity) is correct
for `expense.create`, unlike payments' `'EVENT'`.

**`expense.reverse` was investigated and deliberately NOT built.** AD-021 calls for "append-only
+ explicit reversal" for expenses too, but no reversal RPC, no reversal/correction table, and no
correcting-entry trigger exist anywhere in the live schema for expenses — and the live
`expenses_update` RLS policy's direct-edit path actively contradicts the append-only assumption
AD-021 wants here. Building it would mean inventing one of at least two incompatible designs
without a product decision on which. Opened new, non-blocking **BLOCKER-028** rather than guessed
at. It remains allowlisted in `domain_operation`'s CHECK (unchanged from AD-021) and is correctly
`REJECTED unsupported_operation_type` by the existing dispatcher fallback.

**Security, checked the same way as every prior P3.7 pass.** `apply_payment_create`/
`apply_payment_reverse`/`apply_expense_create` were `REVOKE`d from `PUBLIC`/`anon`/`authenticated`
in the same migrations that created them — confirmed via `has_function_privilege()` and
independently via a clean `get_advisors(type: 'security')` run (none of the three appear in the
findings; only the pre-existing, unrelated `record_payment`/`record_refund` anon/authenticated
warnings remain, untouched by this pass).

**Verification:** `tests/sql/p3_7_financial_sync.sql` (new, 27/27 live, covering both handlers'
full payload validation, the driver-trip custody path, the cash-session path, overpayment/
over-refund rejection, cancelled-ticket rejection, role gating for all three operations, cross-
tenant denial, replay idempotency, and a check that `.reverse` for expenses still correctly falls
through to `unsupported_operation_type`). Re-run clean, zero regression:
`tests/sql/p3_7_customer_sync.sql` (quick regression check re-confirmed after the financial
dispatcher change, including the `domain_operation` CHECK constraint's D1 guard). Full detail:
`IMPLEMENTATION_LOG.md` 2026-08-30.

**Still not built:** `inventory.receive`/`.consume`/`.transfer` (BLOCKER-026),
`production.complete`/`.record_output`/`.record_waste` (BLOCKER-027), `expense.reverse`
(BLOCKER-028), `customer.soft_delete` (deliberately — not in `domain_operation`'s CHECK
constraint), `depends_on_operation_id` enforcement, true cursor-expiry-via-retention-purge,
per-supervisor manager-configurable permission overrides (BLOCKER-025). None of these are guessed
at. P3.7's `domain_operation` allowlist is now fully covered except these deliberately-open
items.
