# BakeFlow — API Contract

**Status:** canonical. Derived from the conventions in `EB-009` and `EB-017`, made concrete.

---

## 1. Access model

BakeFlow has no bespoke REST backend. The client talks to Supabase directly:

| Operation type | Mechanism |
|---|---|
| Reads, simple filtered lists | PostgREST via `supabase-js`, protected by RLS |
| Single-row writes with no side effects | PostgREST insert/update, protected by RLS |
| **Anything multi-step, atomic, or financial** | Postgres RPC (`SECURITY DEFINER` where required) |
| Third-party calls, secrets, webhooks | Edge Function |

**The decision rule:** if an operation must either fully happen or not happen at all, it is an RPC. Never assemble a financial or stock operation from multiple client calls — a network failure between call two and call three leaves the books wrong, and Core Principle 3 says the system must never require manual reconciliation to fix numbers.

---

## 2. RPCs

These are the operations that must not be done client-side. Signatures below are the **deployed** ones, verbatim — argument names included, because PostgREST matches named arguments.

> **Naming wart, do not "fix":** several ticket RPCs take an argument named `p_order_id` that is in fact a `tickets.id`. The entity is Ticket (see `CLAUDE.md`); the argument name is historical. Renaming it is a breaking client change.

| RPC | Signature | Returns | Guarantees |
|---|---|---|---|
| `create_organization_with_owner` | `p_name text, p_branch_name text, p_timezone text` | jsonb | Creates org, first branch, assigns owner role, sets `profiles.tenant_id` — atomically. Client must refresh the session afterward, or `tenant_id` stays absent from the JWT. |
| `create_organization_invite` | `p_email text, p_role_key text, p_branch_id uuid, p_valid_days integer` | jsonb | Mints a raw token, stores only its hash, sets expiry. Delivery is the `send-invite-email` Edge Function, deployed and live-verified 2026-08-22 — see §7 and `BLOCKERS.md` §BLOCKER-001. |
| `accept_organization_invite` | `p_raw_token text` | jsonb | Hashes and matches token, checks expiry, creates `user_roles` and `branch_assignments`, marks invite accepted. |
| `confirm_ticket` | `p_order_id uuid` | jsonb | Validates ≥1 item, recomputes totals, issues invoice, transitions to `confirmed`. Works as specified — the defect that once made this unreachable was resolved 2026-08-14, see `STATE-MACHINES.md` §1. |
| `update_ticket` | `p_order_id uuid, p_customer_id uuid, p_fulfilment_type text, p_due_at timestamptz, p_discount_amount numeric, p_tax_amount numeric, p_assigned_to uuid, p_status text, p_cancelled_reason text` | jsonb | The general ticket mutation path — also the de facto RPC for the `draft→submitted`, `confirmed→scheduled`, `scheduled→in_production`, `in_production→ready`, and `ready→delivered` hops (see `STATE-MACHINES.md` §1), none of which has a dedicated RPC. `prevent_submitted_ticket_update()`, the trigger that once blocked all of this, was dropped 2026-08-14. As of 2026-08-22 its own role gate matches `guard_ticket_status_transition()`'s per-status actor list (cashier and baker can now advance a ticket through this RPC, not just owner/admin/branch_manager) — see `STATE-MACHINES.md` §1, defect 3. |
| `cancel_ticket` | `p_order_id uuid, p_reason text` | jsonb | Requires a reason. Voids the unpaid invoice. Works on any non-terminal status, per `guard_ticket_status_transition()`'s `cancelled` actor list — the "draft-only" defect this note used to describe was the same trigger bug resolved 2026-08-14. |
| `complete_ticket` | `p_order_id uuid, p_warehouse_id uuid` | jsonb | Writes the sale stock movement — which is why it takes a warehouse and must be an RPC. Reachable now that the full lifecycle is (`STATE-MACHINES.md` §1); its own `reference_type` bug (found separately) was fixed 2026-08-22, see `BLOCKERS.md`. |
| `complete_driver_field_sale` | `p_ticket_id uuid, p_warehouse_id uuid` | jsonb | ADR-001/AD-020 (2026-08-25), resolving BLOCKER-021: `draft → completed` directly for a driver-created, trip-linked **pickup** ticket, skipping the seven production hops — the goods are already loaded, not still being baked. Requires `driver_trip_id` set, that trip `in_transit`, the caller to be the trip's own driver (or a manager), and `fulfilment_type = 'pickup'` (a `delivery` ticket is refused, so AD-019's `deliveries` gate is never bypassed). `p_warehouse_id` defaults to the **trip's own warehouse**, not the branch default — the stock was in the vehicle's custody. See `STATE-MACHINES.md` §6. |
| `archive_ticket` | `p_ticket_id uuid, p_reason text` | `tickets` | Terminal archive. Sets `archived_at`/`archived_by`/`archive_reason`. Note this one uses `p_ticket_id`, unlike its siblings. Requires `tickets.archive`. |
| `record_payment` | `p_order_id uuid, p_amount numeric, p_method text, p_reference text, p_cash_session_id uuid, p_driver_trip_id uuid` | jsonb | Inserts payment, updates `amount_paid`, recomputes invoice status. Rejects `cash` without an open session **or** an active driver trip. `p_driver_trip_id` is the ADR-001/AD-018 addition (2026-08-24): when set, the payment is scoped to that trip's cash custody instead of the branch till — see `STATE-MACHINES.md` §6. `payments_custody_context_exclusive` rejects a call that sets both `p_cash_session_id` and `p_driver_trip_id`. |
| `record_refund` | `p_payment_id uuid, p_amount numeric, p_reason text` | jsonb | Refunds against a payment, capped at its amount by `guard_refund_total()`. **How a refund affects revenue, `amount_paid`, invoice status and cash-session expected cash is unresolved** — see the open questions in the project plan. |
| `open_cash_session` | `p_branch_id uuid, p_opening_float numeric` | jsonb | Fails if a session is already open for the branch. |
| `close_cash_session` | `p_session_id uuid, p_counted_amount numeric, p_note text` | jsonb | Computes expected, derives variance, requires a note when variance ≠ 0. As of ADR-001/AD-018 (2026-08-24), `expected_amount` also sums `physical_cash` from every `driver_trips` row this session settled via `complete_driver_trip` — driver cash only joins till custody at that point, never while a trip is still out. |
| `start_driver_trip` | `p_branch_id uuid, p_warehouse_id uuid` | jsonb | Opens a `driver_trips` row at `created`, enforced one active trip per driver by `driver_trips_one_active_per_driver`. |
| `verify_trip_loading` | `p_trip_id uuid, p_items jsonb, p_source_warehouse_id uuid` | jsonb | Writes `driver_trip` stock movements for what's physically loaded, transitions `created→loading→ready_to_depart`, sets `loading_verified_by`/`_at`. |
| `depart_driver_trip` | `p_trip_id uuid` | jsonb | `ready_to_depart→in_transit`, sets `departed_at`. |
| `return_driver_trip` | `p_trip_id uuid, p_items jsonb` | jsonb | `in_transit→returning`, sets `returned_at`; `p_items` is the returned-stock manifest, written back as `driver_trip` stock movements. |
| `reconcile_driver_trip` | `p_trip_id uuid, p_physical_cash numeric, p_variance_note text` | jsonb | `returning→reconciled`. Computes `expected_cash` from the trip's recorded cash movements, compares to `p_physical_cash`, records `cash_variance`; requires `p_variance_note` when variance ≠ 0 (mirrors `close_cash_session`'s own rule). |
| `complete_driver_trip` | `p_trip_id uuid, p_settlement_cash_session_id uuid` | jsonb | `reconciled→completed`. Links the trip to a branch cash session so its `physical_cash` is included at that session's next `close_cash_session` call — this is the only point a driver's cash joins branch till custody. |
| `adjust_stock` | `p_warehouse_id uuid, p_item_type text, p_item_id uuid, p_new_quantity numeric, p_reason text, p_note text` | jsonb | Computes the delta and inserts one `adjustment` movement. The client never sends a delta. |
| `complete_production_batch` | `p_batch_id uuid, p_actual_quantity numeric, p_ingredient_actuals jsonb, p_warehouse_id uuid` | jsonb | Re-checks stock, writes consume + output movements, sets status. Rolls back entirely on insufficient stock. |
| `fail_production_batch` | `p_batch_id uuid, p_reason text, p_ingredient_actuals jsonb, p_warehouse_id uuid` | jsonb | Writes consume movements for what was used; no output movement. |
| `transition_delivery` | `p_delivery_id uuid, p_to_status text, p_proof_url text, p_recipient_name text, p_reason text, p_driver_id uuid` | jsonb | Validates the transition and the caller's driver assignment. |
| `update_delivery_details` | `p_delivery_id uuid, p_address_line text, p_contact_phone text, p_scheduled_at timestamptz` | jsonb | Address/contact/schedule edits without a status change. |
| `update_invoice_due_at` | `p_invoice_id uuid, p_due_at timestamptz` | jsonb | The only permitted invoice mutation. |
| `process_sync_batch` | `p_device_id uuid, p_operations jsonb` | jsonb | Offline-sync gateway (push side). Each operation in the array may carry `domain_operation` (P3.7, 2026-08-28) — the fine-grained dispatch key (`ticket.create`, `ticket.item_update`, `customer.create`, `customer.update`, etc., AD-021's allowlist); omitting it means the operation is recorded but never applied (`REJECTED unsupported_operation_type`). May also carry `client_sequence` (P3.7, 2026-08-29) — captured verbatim, purely diagnostic, never enforced (OFFLINE-SYNC-MODEL.md §16). **Response shape corrected 2026-08-29**: each `results[]` entry now reflects the operation's actual post-dispatch outcome — `status` (`APPLIED/REJECTED/CONFLICT`), `error_code`, `result` — not a pre-dispatch snapshot (previously every operation reported `PENDING`/`CONFLICT` regardless of what actually happened). A replay (same `operation_id`, identical immutable context including `payload`) returns `replayed:true` plus the original `status`/`error_code`/`result`; a replay with an altered payload/`base_revision`/`branch_id`/`entity_type`/`domain_operation`/`tenant_id` is rejected outright (`42501`), not silently accepted. See §6 and `SCHEMA-REFERENCE.md` §12. **`customer.create` payload** (P3.7, 2026-08-29): `{full_name (required, 1-200 chars), phone?, email?, address_line?, notes?, is_walk_in?}` — result `{customer_id, full_name, revision:1}`. **`customer.update` payload**: `{customer_id (required, must equal the operation's own entity_id), full_name (required — full-value replacement, not a merge), phone?, email?, address_line?, notes?, is_walk_in?}` — result `{customer_id, full_name, revision}`. `customer.create` requires owner/admin/branch_manager/supervisor/cashier, or driver (`docs/ROLES-AND-PERMISSIONS.md`). `customer.update` is narrower, per an explicit product decision 2026-08-29 (`BLOCKERS.md` BLOCKER-024, resolved): owner, admin, or branch_manager always; supervisor only while holding the supervisor role in that tenant (today's coarse, role-level toggle — a finer per-supervisor manager-configurable grant was requested but has no backing schema yet, see `BLOCKERS.md` BLOCKER-025); driver and cashier cannot call `customer.update` at all, despite both holding `customer.create`. `customers` has no `branch_id` of its own — the operation's `branch_id` is optional/informational and, if supplied, is still checked by the existing generic branch-authorization gate. |
| `sync_pull` | `p_device_id uuid, p_cursor bigint default 0, p_page_size int default 200` | jsonb | P3.7 (2026-08-28), the pull side — previously did not exist at all. Returns `{changes, next_cursor, has_more, full_resync_required}` (the last field added 2026-08-29), cursor-paginated over `sync_changes.sequence_id`. A negative cursor is rejected (`22023`); a cursor ahead of everything the caller can see returns `full_resync_required:true` with an empty page instead of a silently-incomplete one — true cursor-expiry-via-retention-purge is not yet implemented (no retention policy exists for `sync_changes`, see `BLOCKERS.md` BLOCKER-023). `SECURITY INVOKER`: authorization is inherited from `sync_validate_device()` (device ownership/revocation) and the existing `sync_changes_select` RLS policy (tenant/branch/live-device), not reimplemented. |
| `sync_validate_device` | `p_device_id uuid` | `uuid` | Corrected 2026-08-28 (was documented as `TABLE(tenant_id uuid, branch_id uuid)`, which no `sync_devices` column can produce post-AD-005). Confirms the device is owned by the caller and not revoked; returns the owning `user_id`. Carries no tenant/branch — a device is user-owned, not organization-bound (AD-005); each operation in a batch carries its own `tenant_id`/`branch_id` instead, authorized separately by `process_sync_batch_context_validated()`. |
| `get_daily_revenue_summary` | `p_branch_id uuid, p_date date default null` | jsonb | P9.8 (2026-08-28), the revenue/cash half of `REPORTING-MODEL.md` §85 — COGS/gross-profit/margin excluded (BLOCKER-018). Read-only; the package's first RPC-backed *read* rather than a write. `p_date` defaults to "today" resolved against the **organization's own timezone**, never the caller's device clock. Every money field in the envelope is cast to `::text` — without it `jsonb_build_object()` embeds a bare JSON number and the client's `JSON.parse()` silently truncates precision, the same hazard `SCHEMA-REFERENCE.md`/`scalars.ts` document for un-cast table columns; caught live before any client code was written against this RPC. Requires `has_branch_access(p_branch_id)` and one of `owner/admin/branch_manager/cashier/accountant`. |

**`adjust_stock` takes a target quantity, not a delta.** The client showing "42.5 kg" and the user typing "40" means the delta is computed server-side from current truth. A client-computed delta races against concurrent movements.

**There is no `submit_ticket` RPC**, nor dedicated RPCs for `confirmed→scheduled`,
`scheduled→in_production`, `in_production→ready`, or `ready→delivered`. `update_ticket`
takes a `p_status` and is the confirmed, live-verified path for all five (2026-08-22) —
this is no longer an open question, see `STATE-MACHINES.md` §1 defect 3.

---

## 3. Error envelope

Every RPC raises with a structured message so the client can map errors to user-facing copy. Use Postgres error codes plus a stable machine key:

```sql
raise exception 'insufficient_stock: ingredient % short by %', v_name, v_short
  using errcode = 'P0001',
        detail  = json_build_object(
          'code', 'insufficient_stock',
          'ingredient_id', v_ingredient_id,
          'shortfall', v_short
        )::text;
```

Standard codes:

| Code | Meaning | User-facing message |
|---|---|---|
| `insufficient_stock` | Not enough ingredient for the operation | "Not enough {ingredient}. You have {n} {unit}, this needs {m}." |
| `invalid_transition` | Illegal state change | "This ticket is already {status}." |
| `session_already_open` | Second till session for a branch | "A till session is already open at this branch." |
| `variance_note_required` | Closing with variance and no note | "Add a note explaining the difference." |
| `order_locked` | Editing items on a frozen ticket | "This ticket can't be changed once it's ready." (The machine key stays `order_locked` — it is what `guard_ticket_item_mutation()` actually raises.) |
| `insufficient_role` | Caller lacks the role | "You don't have permission for this." |
| `refund_required` | Cancelling a paid ticket | "Record a refund before cancelling." |
| `duplicate_reference` | Unique constraint hit | "That {field} is already used." |
| `rate_limited` | A call-volume cap was hit (P6.6) | "You've done that too many times recently. Try again later." Distinct from `insufficient_role`: the caller is authorized, just over quota. |

The client maps `code` to copy. It never displays a raw Postgres message — `EB-015`'s clarity principle and Core Principle 5 both require plain language.

---

## 4. Read conventions

**Every list query is explicitly branch-filtered** even though RLS already scopes it. RLS is a safety net; an unfiltered query that returns all branches an owner can see is a UX bug and a performance problem.

**Pagination** uses keyset, not offset. Offset pagination drifts when rows are inserted mid-scroll, which happens constantly on a tickets list:

```js
supabase.from('tickets')
  .select('*, customer:customers(full_name), items:ticket_items(count)')
  .eq('branch_id', branchId)
  .is('deleted_at', null)
  .order('created_at', { ascending: false })
  .lt('created_at', cursor)
  .limit(20)
```

**Every read filters `deleted_at IS NULL`.** Soft delete is the deletion mechanism across the schema (`SCHEMA-REFERENCE.md` §11); a query that omits this shows users rows they deleted.

**Select explicit columns, never `*` in production paths** — embedded relations on a wide table cost real bandwidth on a Nigerian mobile connection.

**Money arrives as a string.** PostgREST serialises `NUMERIC` as a string to avoid JavaScript float corruption. Parse with a decimal library, never `parseFloat`. A `NUMERIC(19,4)` value of `184500.0000` parsed as a JS number and re-serialised is how rounding errors enter the system.

---

## 5. Realtime

Subscribe narrowly. Recommended channels only:

| Channel | Table | Filter | Why |
|---|---|---|---|
| Tickets board | `tickets` | `branch_id=eq.{id}` | Staff need new tickets without pulling to refresh |
| Production board | `production_batches` | `branch_id=eq.{id}` | Bakers see assignments appear |
| Stock alerts | `ingredient_stock_levels` | `branch_id=eq.{id}` | Low-stock warnings |

Do not subscribe to `stock_movements` — it is high-volume and the level tables carry the signal.

---

## 6. Offline behaviour

**Resolved 2026-08-10: offline operation is a first-class product capability, not an error state.** An earlier revision of this section said writes that move money or stock may never be queued offline. That rule is **withdrawn** — `BAKEFLOW-PROJECT-LOGIC-CLARIFICATION.md` §9–§16 and §57 establish offline-first as core product behaviour, and the deployed sync gateway implements it. See `docs/OFFLINE-SYNC-MODEL.md` for the full protocol and `SCHEMA-REFERENCE.md` §12 for the tables.

The rules that replace it:

- **Offline-first, not offline-only.** Online: client → server → database. Offline: client → encrypted local store → sync queue. Reconnect: encrypted queue → idempotent sync → server. The server stays authoritative for permissions, membership, financial truth, and final reporting.
- **Offline writes must be idempotent.** Every queued operation carries a stable `client_operation_id` alongside `device_id`, `tenant_id`, `branch_id`, and event type. A retried operation returns the existing result rather than creating a second business transaction. This applies to tickets, corrections, payments, refunds, audit actions, and inventory operations.
- **Never last-write-wins for financial or operational facts.** Accept the immutable original event and create an explicit correction or conflict record. Unresolvable conflicts preserve both sides plus conflict metadata for an authorized resolution workflow.
- **Business-event time is not sync time.** `device_created_at` (client clock), `server_received_at` (server clock), and `revision` are distinct and all three matter. Sync time must never be used as the reporting date — see `REPORTING-MODEL.md`.
- **A queued operation belongs to the organization it was created under**, never to whatever organization is active at flush time. A user may belong to several organizations; `process_sync_batch_context_validated()` exists for exactly this.
- **Local data is encrypted.** AsyncStorage or plaintext JSON is not sufficient for sensitive offline records, and keys must not sit beside the encrypted store.
- **Sync is automatic and not manager-controlled.** There is no approve/disable-sync authority switch. Managers may review conflicts where the product exposes that workflow.
- **Offline is not driver-only.** Manager and Supervisor close-of-day financial audit must work offline too.

The original concern — two cashiers offline on one till cannot both be right — is not dismissed; it is what the conflict-detection and idempotency rules above exist to answer.

TanStack Query handles read caching with `staleTime` per entity: catalog data 5 minutes, stock levels 30 seconds, tickets 15 seconds.

---

## 7. Edge Functions

Only for what genuinely cannot run in Postgres:

| Function | Purpose | Status |
|---|---|---|
| `send-invite-email` | Delivers invite token via email provider | **Deployed and live-verified 2026-08-22** — see `BLOCKERS.md` §BLOCKER-001 |
| `send-ticket-notification` | SMS/WhatsApp ticket confirmation to customer | **Not built** |
| `generate-report-pdf` | Renders financial report for download | **Not built** |

**Corrected 2026-08-22 (was stale since `b6d125e1`, 2026-08-20):** `supabase/functions/` exists in the repo and `send-invite-email` is implemented (`_shared/` scaffold, Resend adapter with mock fallback, deep-link generation, HTML/text templates — see `BACKEND_ROADMAP.md` P6.1/P6.2). **Deployed and live-verified the same day** (this paragraph itself went stale for a few hours after that — the status row above was updated, this explanatory text below it was not, until this pass caught the contradiction): a real signed-in call — mint via `create_organization_invite()`, dispatch via this function — succeeded end-to-end for the first time in the project's history. Full detail: `BLOCKERS.md` §BLOCKER-001.

**Rate limiting (P6.6, 2026-08-22).** `send-invite-email` calls `enforce_rate_limit()` — a
small SECURITY DEFINER Postgres function, callable only by `service_role` — immediately
before dispatch, capped at 20 calls per tenant per rolling hour. Over the cap raises
`code: 'rate_limited'` (`errcode='P0001'`), mapped to HTTP 429. Enforcement is per
`(tenant_id, scope)`, not per caller, because the resource being protected — a
transactional provider's per-recipient sending reputation and quota — is a tenant-level
concern; the calling actor is still recorded on each ledger row (`rate_limit_events`) for
traceability. `enforce_rate_limit()` takes `tenant_id`/`actor_id` as explicit, trusted
parameters rather than deriving them from the JWT (`current_tenant_id()`/`auth.uid()`),
which is exactly why it is `service_role`-only: broader `EXECUTE` would let any caller
target another tenant's quota. This is the intended reusable pattern for rate-limiting a
future Edge Function — call `enforce_rate_limit(p_tenant_id, p_actor_id, p_scope, p_limit,
p_window_minutes)` from the service-role client after authenticating and authorizing the
caller, using values already independently verified, never client-supplied ones. Verified
live: 20 real calls against the deployed function succeeded, a 21st was refused with 429
and the correct `rate_limited` body, and a second tenant's independent quota was
unaffected by the first exhausting its own — see `BACKEND_ROADMAP.md` P6.6 for the full
evidence trail.

**Providers (settled — clarification §35):** email via a transactional email provider; mobile push via **Expo Push** (which abstracts APNs/FCM); SMS via a separate transactional provider; WhatsApp via an approved business messaging channel. **Do not hard-code provider APIs through the codebase — use provider adapters**, so a channel can be swapped without touching business logic. Full detail in `docs/NOTIFICATION-DELIVERY-CHANNELS.md`.

**Notification delivery is an asynchronous side effect and must never determine business success** (clarification §33, §58). A ticket submits even if push is down; an invitation exists and can be retried even if email is down. Never roll back a business transaction because a notification failed.

**Push payloads are not authorization** (§36, §22). Send only `event_type`, `tenant_id`, `resource_id`, and short display text; the authenticated app then fetches the details and re-checks authorization. One physical device may receive notifications for several organizations.

Each function holds the service role key and therefore **re-implements tenant scoping in code** — RLS does not protect a service-role caller. Every Edge Function validates the caller's JWT, extracts `tenant_id`, and filters by it explicitly.
