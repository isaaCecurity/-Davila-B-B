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

## 2. Required RPCs

These are the operations that must not be done client-side.

| RPC | Arguments | Returns | Guarantees |
|---|---|---|---|
| `create_organization_with_owner` | name, branch_name, timezone | organization, branch, profile | Creates org, first branch, assigns owner role, sets `profiles.tenant_id` — atomically. Client must refresh session afterward. |
| `accept_organization_invite` | raw_token | organization, role | Hashes and matches token, checks expiry, creates `user_roles` and `branch_assignments`, marks invite accepted. |
| `confirm_order` | order_id | order | Validates ≥1 item, recomputes totals, issues invoice, transitions to `confirmed`, freezes items. |
| `cancel_order` | order_id, reason | order | Validates refund exists if paid, releases reservations, voids unpaid invoice. |
| `record_payment` | order_id, amount, method, reference, cash_session_id | payment, order | Inserts payment, updates `amount_paid`, recomputes invoice status. Rejects `cash` without an open session. |
| `complete_production_batch` | batch_id, actual_quantity, ingredient_actuals[] | batch, movements[] | Re-checks stock, writes consume + output movements, sets status. Rolls back entirely on insufficient stock. |
| `fail_production_batch` | batch_id, reason, ingredient_actuals[] | batch | Writes consume movements for what was used; no output movement. |
| `adjust_stock` | warehouse_id, item_type, item_id, new_quantity, reason, note | movement | Computes the delta and inserts one `adjustment` movement. The client never sends a delta. |
| `open_cash_session` | branch_id, opening_float | session | Fails if a session is already open for the branch. |
| `close_cash_session` | session_id, counted_amount, note | session | Computes expected, derives variance, requires note when variance ≠ 0. |
| `transition_delivery` | delivery_id, to_status, proof_url, recipient_name, reason | delivery | Validates the transition and the caller's driver assignment. |

**`adjust_stock` takes a target quantity, not a delta.** The client showing "42.5 kg" and the user typing "40" means the delta is computed server-side from current truth. A client-computed delta races against concurrent movements.

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
| `invalid_transition` | Illegal state change | "This order is already {status}." |
| `session_already_open` | Second till session for a branch | "A till session is already open at this branch." |
| `variance_note_required` | Closing with variance and no note | "Add a note explaining the difference." |
| `order_locked` | Editing items on a frozen order | "This order can't be changed once it's ready." |
| `insufficient_role` | Caller lacks the role | "You don't have permission for this." |
| `refund_required` | Cancelling a paid order | "Record a refund before cancelling." |
| `duplicate_reference` | Unique constraint hit | "That {field} is already used." |

The client maps `code` to copy. It never displays a raw Postgres message — `EB-015`'s clarity principle and Core Principle 5 both require plain language.

---

## 4. Read conventions

**Every list query is explicitly branch-filtered** even though RLS already scopes it. RLS is a safety net; an unfiltered query that returns all branches an owner can see is a UX bug and a performance problem.

**Pagination** uses keyset, not offset. Offset pagination drifts when rows are inserted mid-scroll, which happens constantly on an orders list:

```js
supabase.from('orders')
  .select('*, customer:customers(full_name), items:order_items(count)')
  .eq('branch_id', branchId)
  .order('created_at', { ascending: false })
  .lt('created_at', cursor)
  .limit(20)
```

**Select explicit columns, never `*` in production paths** — embedded relations on a wide table cost real bandwidth on a Nigerian mobile connection.

**Money arrives as a string.** PostgREST serialises `NUMERIC` as a string to avoid JavaScript float corruption. Parse with a decimal library, never `parseFloat`. A `NUMERIC(19,4)` value of `184500.0000` parsed as a JS number and re-serialised is how rounding errors enter the system.

---

## 5. Realtime

Subscribe narrowly. Recommended channels only:

| Channel | Table | Filter | Why |
|---|---|---|---|
| Orders board | `orders` | `branch_id=eq.{id}` | Staff need new orders without pulling to refresh |
| Production board | `production_batches` | `branch_id=eq.{id}` | Bakers see assignments appear |
| Stock alerts | `ingredient_stock_levels` | `branch_id=eq.{id}` | Low-stock warnings |

Do not subscribe to `stock_movements` — it is high-volume and the level tables carry the signal.

---

## 6. Offline behaviour

`EB-018` requires offline support. The rule that matters:

**Reads may be cached; writes that move money or stock may not be queued optimistically.** A cached orders list shown while offline is fine. A payment recorded offline and synced later is not — two cashiers offline on the same till produce an unresolvable variance. Financial and stock writes require connectivity and fail loudly.

TanStack Query handles read caching with `staleTime` per entity: catalog data 5 minutes, stock levels 30 seconds, orders 15 seconds.

---

## 7. Edge Functions

Only for what genuinely cannot run in Postgres:

| Function | Purpose |
|---|---|
| `send-invite-email` | Delivers invite token via email provider |
| `send-order-notification` | SMS/WhatsApp order confirmation to customer |
| `generate-report-pdf` | Renders financial report for download |

Each holds the service role key and therefore **re-implements tenant scoping in code** — RLS does not protect a service-role caller. Every Edge Function validates the caller's JWT, extracts `tenant_id`, and filters by it explicitly.
