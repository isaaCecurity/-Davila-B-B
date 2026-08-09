# BakeFlow — State Machines

**Status:** canonical. Each entity below has exactly one legal set of transitions. `EB-013` describes these workflows in prose; this document is the enforceable version.

**Correction (2026-08-09):** the Order state machine below was expanded from 5 states to the full 8-state model (`draft → submitted → confirmed → scheduled → in_production → ready → delivered → completed`, plus `cancelled → archived`) to match `EB-013` Appendix A, and the `ready → delivered` transition now hard-requires a verified `deliveries` row. `EB-013` §3 (roles) is separately flagged outdated — see `docs/ROLES-AND-PERMISSIONS.md`, which supersedes it.

**Universal rules:**

1. Every transition is validated in the database, not only in the app. A status column with a `CHECK` constraint prevents invalid *values*; a trigger prevents invalid *transitions*.
2. Every transition writes an `audit_log` row recording actor, entity, from-state, to-state, and time.
3. Terminal states are terminal. No transition leaves them.
4. Transitions that move stock or money run inside a single transaction with the movement they cause. A batch that completes without writing its stock movements is a data-integrity failure, not a retry.

---

## 1. Order

```
draft ──► submitted ──► confirmed ──► scheduled ──► in_production ──► ready ──► delivered ──► completed
  │           │             │              │               │            │          │
  └───────────┴─────────────┴──────────────┴───────────────┴────────────┴──────────┴──► cancelled ──► archived
```

| From | To | Who | Preconditions | Side effects |
|---|---|---|---|---|
| — | draft | owner, admin, branch_manager, cashier | — | Order number assigned |
| draft | submitted | owner, admin, branch_manager, cashier | — | — |
| submitted | confirmed | owner, admin, branch_manager, cashier | ≥1 order item; totals computed | Order items become immutable; invoice issued |
| confirmed | scheduled | owner, admin, branch_manager, cashier | — | — |
| scheduled | in_production | owner, admin, branch_manager, baker | A production batch exists for the order | — |
| in_production | ready | owner, admin, branch_manager, baker | All linked batches completed or failed | Finished stock available |
| ready | delivered | owner, admin, branch_manager, cashier | `fulfilment_type = 'pickup'`, **or** the linked `deliveries` row for this order has `status = 'delivered'` | — |
| delivered | completed | owner, admin, branch_manager, cashier | — | Sale stock movement written |
| any non-terminal | cancelled | owner, admin, branch_manager | `cancelled_reason` provided; if `amount_paid > 0`, a matching `refunds` total must already exist | Reserved stock released; unpaid invoice voided |
| cancelled | archived | owner, admin, branch_manager | — | — |

**Terminal:** `completed`, `archived`. (`cancelled` is non-terminal — its only legal exit is `archived`.)

**The `ready → delivered` gate is enforced in the database, not just convention.** For `fulfilment_type = 'delivery'` orders, the guard trigger looks up the linked `deliveries` row and blocks the transition unless that row's own status is `delivered`. This closes a gap where an order could previously reach a terminal-ish state with no verified delivery ever having happened. Pickup orders skip this check — there's nothing to deliver.

**Payment is not a state.** An order tracks `amount_paid` independently of status. An order can be paid while still in production, or completed while unpaid (credit sale). Do not model payment as an order status — that conflation is the most common way this schema gets corrupted.

**Immutability:** `order_items` cannot be inserted, updated, or deleted once the parent order is `ready`, `completed`, or `cancelled`. Enforced by `guard_order_item_mutation()`. A correction after that point is a refund plus a new order, never an edit.

**Cancellation after payment** requires a `refunds` row. The trigger blocks the transition if `amount_paid > 0` and no matching refund exists.

---

## 2. Production batch

```
scheduled ──► in_progress ──► completed
    │              │
    │              └──► failed
    └──► cancelled
```

| From | To | Who | Preconditions | Side effects |
|---|---|---|---|---|
| — | scheduled | owner, admin, branch_manager, baker | Active recipe exists for the variant | Planned ingredients copied from recipe |
| scheduled | in_progress | owner, admin, branch_manager, baker | Sufficient ingredient stock | `started_at` set |
| in_progress | completed | owner, admin, branch_manager, baker | `actual_quantity` recorded | **Atomic:** consume movements for each ingredient, output movement for finished product, `completed_at` set |
| in_progress | failed | owner, admin, branch_manager, baker | `failure_reason` provided | Consume movements written for ingredients actually used; **no output movement** |
| scheduled | cancelled | owner, admin, branch_manager | Not yet started | None — no stock touched |

**Terminal:** `completed`, `failed`, `cancelled`.

**Completion is a single RPC**, `complete_production_batch()`. It must not be assembled from separate client calls. Inside one transaction it: re-checks stock, inserts one `production_consume` movement per ingredient, inserts one `production_output` movement for the variant, sets `actual_quantity`, sets status. If any step raises, the whole thing rolls back and the batch stays `in_progress`.

**Negative stock is refused.** If consumption would drive `quantity_on_hand` below zero, the RPC raises and the batch does not complete. Do not "allow it and reconcile later" — that breaks Core Principle 3.

**Failed batches still consume.** Ingredients used in a failed batch are gone. Record the consumption; record waste in `production_batch_ingredients.waste_quantity`. A failed batch that consumed nothing is a data error.

---

## 3. Delivery

```
pending ──► assigned ──► in_transit ──► delivered
                              │
                              ├──► failed ──► returned
                              └──► returned
```

| From | To | Who | Preconditions | Side effects |
|---|---|---|---|---|
| — | pending | owner, admin, branch_manager, cashier | Order `fulfilment_type = 'delivery'` | — |
| pending | assigned | owner, admin, branch_manager | `driver_id` set to a user with the driver role | — |
| assigned | in_transit | assigned driver, branch_manager | Order status = `ready` | `dispatched_at` set |
| in_transit | delivered | assigned driver | `proof_url` or `recipient_name` present | `delivered_at` set; parent order may move to `completed` |
| in_transit | failed | assigned driver, branch_manager | `failure_reason` provided | — |
| failed | returned | assigned driver, branch_manager | — | Return stock movement written |
| in_transit | returned | assigned driver, branch_manager | — | Return stock movement written |

**Terminal:** `delivered`, `returned`.

A driver may only transition deliveries where `driver_id = auth.uid()`. This is enforced in the policy, not only in the UI.

---

## 4. Cash session

```
open ──► closed
```

Deliberately minimal. The complexity is in the preconditions, not the states.

| From | To | Who | Preconditions | Side effects |
|---|---|---|---|---|
| — | open | cashier, branch_manager, owner, admin | **No other open session for this branch**; `opening_float` ≥ 0 | `opened_at`, `opened_by` set |
| open | closed | the opening cashier, branch_manager, owner, admin | `counted_amount` entered; `variance_note` present when variance ≠ 0 | `expected_amount` computed; `variance_amount` derived; `closed_at`, `closed_by` set |

**Terminal:** `closed`. Sessions are never reopened and never deleted.

**Expected amount** = `opening_float` + cash payments recorded against this session − cash expenses recorded against this session. Computed inside `close_cash_session()` at close time, never by the client.

**Variance is recorded, never corrected.** If the drawer is short, the session closes short with a note. Do not adjust `counted_amount` to make it balance — the variance is the audit signal, and hiding it defeats the point of the session.

**One open session per branch** is enforced by a partial unique index, not by an application check:

```sql
create unique index cash_sessions_one_open_per_branch
  on cash_sessions (branch_id) where status = 'open';
```

---

## 5. Invoice

```
draft ──► issued ──► partially_paid ──► paid
            │              │
            └──────────────┴──► void
```

Invoice status is derived from payments, not set by hand. `apply_payment_to_order()` recomputes it after every payment:

- Sum of payments = 0 → `issued`
- 0 < sum < total → `partially_paid`
- Sum ≥ total → `paid`

`void` is the only manually triggered transition, permitted to owner and admin, and only when no payments exist against the invoice.

---

## 6. Implementation pattern

Implement one guard function per entity rather than scattering checks:

```sql
create or replace function guard_order_status_transition()
returns trigger language plpgsql as $$
declare
  allowed text[];
  v_delivery_status text;
begin
  if new.status = old.status then
    return new;
  end if;

  allowed := case old.status
    when 'draft'         then array['submitted', 'cancelled']
    when 'submitted'     then array['confirmed', 'cancelled']
    when 'confirmed'     then array['scheduled', 'cancelled']
    when 'scheduled'     then array['in_production', 'cancelled']
    when 'in_production' then array['ready', 'cancelled']
    when 'ready'         then array['delivered', 'cancelled']
    when 'delivered'     then array['completed', 'cancelled']
    when 'cancelled'     then array['archived']
    else array[]::text[]
  end;

  if not (new.status = any(allowed)) then
    raise exception 'invalid order transition: % -> %', old.status, new.status;
  end if;

  -- Pickup orders have nothing to deliver; delivery orders must show their
  -- linked deliveries row as actually delivered before the order can follow.
  if new.status = 'delivered' and new.fulfilment_type = 'delivery' then
    select d.status into v_delivery_status from deliveries d where d.order_id = new.id;
    if v_delivery_status is distinct from 'delivered' then
      raise exception 'order requires linked delivery to be delivered first';
    end if;
  end if;

  if new.status = 'cancelled' and coalesce(new.cancelled_reason, '') = '' then
    raise exception 'cancellation requires a reason';
  end if;

  return new;
end $$;
```

Attach as `BEFORE UPDATE OF status`. The `else array[]::text[]` branch is what makes terminal states terminal — no enumeration of "cannot leave completed" is needed.

**The client mirrors these rules but does not own them.** A screen should grey out illegal actions for usability, and the database should reject them for correctness. Both, always.
