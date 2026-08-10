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
| `create_organization_invite` | `p_email text, p_role_key text, p_branch_id uuid, p_valid_days integer` | jsonb | Mints a raw token, stores only its hash, sets expiry. **Delivery is not implemented** — see §7. |
| `accept_organization_invite` | `p_raw_token text` | jsonb | Hashes and matches token, checks expiry, creates `user_roles` and `branch_assignments`, marks invite accepted. |
| `confirm_ticket` | `p_order_id uuid` | jsonb | Validates ≥1 item, recomputes totals, issues invoice, transitions to `confirmed`. **⚠️ Cannot succeed in any state as deployed** — see the defect note in `STATE-MACHINES.md` §1. |
| `update_ticket` | `p_order_id uuid, p_customer_id uuid, p_fulfilment_type text, p_due_at timestamptz, p_discount_amount numeric, p_tax_amount numeric, p_assigned_to uuid, p_status text, p_cancelled_reason text` | jsonb | The general ticket mutation path. Direct UPDATE on a submitted ticket is blocked by `prevent_submitted_ticket_update()`. |
| `cancel_ticket` | `p_order_id uuid, p_reason text` | jsonb | Requires a reason. Voids the unpaid invoice. **⚠️ Works only on `draft` tickets as deployed**; a submitted ticket is archived, not cancelled (clarification §5). |
| `complete_ticket` | `p_order_id uuid, p_warehouse_id uuid` | jsonb | Writes the sale stock movement — which is why it takes a warehouse and must be an RPC. **⚠️ Unreachable as deployed** (`delivered` cannot be reached). |
| `archive_ticket` | `p_ticket_id uuid, p_reason text` | `tickets` | Terminal archive. Sets `archived_at`/`archived_by`/`archive_reason`. Note this one uses `p_ticket_id`, unlike its siblings. Requires `tickets.archive`. |
| `record_payment` | `p_order_id uuid, p_amount numeric, p_method text, p_reference text, p_cash_session_id uuid` | jsonb | Inserts payment, updates `amount_paid`, recomputes invoice status. Rejects `cash` without an open session. |
| `record_refund` | `p_payment_id uuid, p_amount numeric, p_reason text` | jsonb | Refunds against a payment, capped at its amount by `guard_refund_total()`. **How a refund affects revenue, `amount_paid`, invoice status and cash-session expected cash is unresolved** — see the open questions in the project plan. |
| `open_cash_session` | `p_branch_id uuid, p_opening_float numeric` | jsonb | Fails if a session is already open for the branch. |
| `close_cash_session` | `p_session_id uuid, p_counted_amount numeric, p_note text` | jsonb | Computes expected, derives variance, requires a note when variance ≠ 0. |
| `adjust_stock` | `p_warehouse_id uuid, p_item_type text, p_item_id uuid, p_new_quantity numeric, p_reason text, p_note text` | jsonb | Computes the delta and inserts one `adjustment` movement. The client never sends a delta. |
| `complete_production_batch` | `p_batch_id uuid, p_actual_quantity numeric, p_ingredient_actuals jsonb, p_warehouse_id uuid` | jsonb | Re-checks stock, writes consume + output movements, sets status. Rolls back entirely on insufficient stock. |
| `fail_production_batch` | `p_batch_id uuid, p_reason text, p_ingredient_actuals jsonb, p_warehouse_id uuid` | jsonb | Writes consume movements for what was used; no output movement. |
| `transition_delivery` | `p_delivery_id uuid, p_to_status text, p_proof_url text, p_recipient_name text, p_reason text, p_driver_id uuid` | jsonb | Validates the transition and the caller's driver assignment. |
| `update_delivery_details` | `p_delivery_id uuid, p_address_line text, p_contact_phone text, p_scheduled_at timestamptz` | jsonb | Address/contact/schedule edits without a status change. |
| `update_invoice_due_at` | `p_invoice_id uuid, p_due_at timestamptz` | jsonb | The only permitted invoice mutation. |
| `process_sync_batch` | `p_device_id uuid, p_operations jsonb` | jsonb | Offline-sync gateway. See §6 and `SCHEMA-REFERENCE.md` §12. |
| `sync_validate_device` | `p_device_id uuid` | `TABLE(tenant_id uuid, branch_id uuid)` | Resolves the tenant/branch a device is bound to. |

**`adjust_stock` takes a target quantity, not a delta.** The client showing "42.5 kg" and the user typing "40" means the delta is computed server-side from current truth. A client-computed delta races against concurrent movements.

**There is no `submit_ticket` RPC.** The state machine requires `draft → submitted → confirmed`, but no RPC performs the first hop; `update_ticket` takes a `p_status` and is the de facto path. Worth resolving explicitly.

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
| `send-invite-email` | Delivers invite token via email provider | **Not built** |
| `send-ticket-notification` | SMS/WhatsApp ticket confirmation to customer | **Not built** |
| `generate-report-pdf` | Renders financial report for download | **Not built** |

**None of these exist.** `supabase/functions/` is not present in the repo and zero functions are deployed. The practical consequence: `create_organization_invite()` mints tokens correctly, but nothing can deliver one, so **inviting a user to an organization cannot currently be completed end-to-end**. Clarification §34 is explicit that minting a token is not delivering an invitation.

**Providers (settled — clarification §35):** email via a transactional email provider; mobile push via **Expo Push** (which abstracts APNs/FCM); SMS via a separate transactional provider; WhatsApp via an approved business messaging channel. **Do not hard-code provider APIs through the codebase — use provider adapters**, so a channel can be swapped without touching business logic. Full detail in `docs/NOTIFICATION-DELIVERY-CHANNELS.md`.

**Notification delivery is an asynchronous side effect and must never determine business success** (clarification §33, §58). A ticket submits even if push is down; an invitation exists and can be retried even if email is down. Never roll back a business transaction because a notification failed.

**Push payloads are not authorization** (§36, §22). Send only `event_type`, `tenant_id`, `resource_id`, and short display text; the authenticated app then fetches the details and re-checks authorization. One physical device may receive notifications for several organizations.

Each function holds the service role key and therefore **re-implements tenant scoping in code** — RLS does not protect a service-role caller. Every Edge Function validates the caller's JWT, extracts `tenant_id`, and filters by it explicitly.
