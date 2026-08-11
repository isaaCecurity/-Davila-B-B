# BakeFlow — State Machines

**Status:** canonical. Each entity below has exactly one legal set of transitions. `EB-013` describes these workflows in prose; this document is the enforceable version.

**Correction (2026-08-09):** the Ticket state machine below was expanded from 5 states to the full 8-state model (`draft → submitted → confirmed → scheduled → in_production → ready → delivered → completed`, plus `cancelled → archived`) to match `EB-013` Appendix A, and the `ready → delivered` transition now hard-requires a verified `deliveries` row. `EB-013` §3 (roles) is separately flagged outdated — see `docs/ROLES-AND-PERMISSIONS.md`, which supersedes it.

**Universal rules:**

1. Every transition is validated in the database, not only in the app. A status column with a `CHECK` constraint prevents invalid *values*; a trigger prevents invalid *transitions*.
2. Every transition writes an `audit_log` row recording actor, entity, from-state, to-state, and time.
3. Terminal states are terminal. No transition leaves them.
4. Transitions that move stock or money run inside a single transaction with the movement they cause. A batch that completes without writing its stock movements is a data-integrity failure, not a retry.

---

## 1. Ticket

The entity is **Ticket** (`tickets`, `ticket_items`) — see `CLAUDE.md`. Earlier revisions of this document called it Order.

```
draft ──► submitted ──► confirmed ──► scheduled ──► in_production ──► ready ──► delivered ──► completed
  │           │             │              │               │            │          │
  └───────────┴─────────────┴──────────────┴───────────────┴────────────┴──────────┴──► cancelled ──► archived
```

| From | To | Who | Preconditions | Side effects |
|---|---|---|---|---|
| — | draft | owner, admin, branch_manager, cashier | — | `ticket_number` assigned by `assign_order_number()` |
| draft | submitted | owner, admin, branch_manager, cashier | — | No dedicated RPC exists for this hop — see `API-CONTRACT.md` §2 |
| submitted | confirmed | owner, admin, branch_manager, cashier | ≥1 ticket item; totals computed | Invoice issued. **Items do not freeze here** — see Immutability below |
| confirmed | scheduled | owner, admin, branch_manager, cashier | — | — |
| scheduled | in_production | owner, admin, branch_manager, baker | A production batch exists for the ticket | — |
| in_production | ready | owner, admin, branch_manager, baker | All linked batches completed or failed | Finished stock available |
| ready | delivered | owner, admin, branch_manager, cashier | `fulfilment_type = 'pickup'`, **or** the linked `deliveries` row for this ticket has `status = 'delivered'` | — |
| delivered | completed | owner, admin, branch_manager, cashier | — | Sale stock movement written |
| any non-terminal | cancelled | owner, admin, branch_manager | `cancelled_reason` provided; if `amount_paid > 0`, a matching `refunds` total must already exist | Unpaid invoice voided. ("Reserved stock released" was in earlier drafts — **there is no reservation mechanism in the schema**; no table, column, or `stock_movements.reason` implements it. Treat reservations as unspecified, not as an existing behaviour.) |
| cancelled | archived | owner, admin, branch_manager | — | — |

**Terminal:** `completed`, `archived`. (`cancelled` is non-terminal — its only legal exit is `archived`.)

**The `ready → delivered` gate is enforced in the database, not just convention.** For `fulfilment_type = 'delivery'` tickets, the guard trigger looks up the linked `deliveries` row and blocks the transition unless that row's own status is `delivered`. This closes a gap where a ticket could previously reach a terminal-ish state with no verified delivery ever having happened. Pickup tickets skip this check — there's nothing to deliver.

**Payment is not a state.** A ticket tracks `amount_paid` independently of status. A ticket can be paid while still in production, or completed while unpaid (credit sale). Do not model payment as a ticket status — that conflation is the most common way this schema gets corrupted.

### Immutability — the hybrid rule

`BAKEFLOW-PROJECT-LOGIC-CLARIFICATION.md` §3 states that a submitted ticket cannot be updated, cancelled, or edited by anyone. Taken literally that would end the lifecycle at `submitted`. The resolved product decision (2026-08-10) is **hybrid**:

| Aspect of a submitted ticket | Rule |
|---|---|
| `subtotal_amount`, `total_amount`, `discount_amount`, `tax_amount`, `amount_paid` | **Frozen.** Financial history is never rewritten. |
| `ticket_items` (insert/update/delete) | **Frozen** — they determine the totals. |
| `customer_id`, `ticket_number`, `tenant_id`, `branch_id`, `fulfilment_type`, `created_by`, `created_at`, `device_created_at`, `sale_customer_type`, `correction_of_ticket_id` | **Frozen.** Identity and provenance. |
| `status` | **May advance** along the transition table above. Operational progress is not a history rewrite. |
| `assigned_to`, `due_at` | **May change.** Operational assignment, not financial fact. |
| `archived_at`, `archived_by`, `archive_reason` | **May be set once**, gated on `tickets.archive`. |

So the money and the identity of a submitted ticket are immutable; its operational progress is not. A financial correction is still a new ticket referencing the original via `correction_of_ticket_id` (permission `tickets.correct`) — never an edit — per clarification §4.

> ### ⚠️ The deployed database does not yet implement this rule, and has two defects
>
> **Defect 1 — the machine is unreachable past `submitted`, so three RPCs can never succeed.**
> `prevent_submitted_ticket_update()` currently blocks **`status`** for any ticket already in `submitted`, `completed`, `fulfilled`, `paid`, `cancelled`, or `closed`. It is a `BEFORE UPDATE` trigger, and `prevent_submitted_ticket_update` sorts before `tickets_guard_status_transition`, so it fires first and raises `42501` on every onward transition. Meanwhile `guard_ticket_status_transition()` permits only `['submitted','cancelled']` out of `draft`. The consequence: `confirm_ticket()` (which sets `status='confirmed'`) fails from `draft` with `invalid_transition` and from `submitted` with `42501` — **it cannot succeed in any state**. `complete_ticket()` and `cancel_ticket()` fail the same way on anything already submitted. Only `draft → submitted` and `draft → cancelled → archived` are reachable today; `confirmed`, `scheduled`, `in_production`, `ready`, `delivered`, and `completed` are dead states.
> *Remediation:* remove `status`, `assigned_to`, and `due_at` from the guarded column list in `prevent_submitted_ticket_update()`, leaving `guard_ticket_status_transition()` as the sole authority on status.
>
> **Defect 2 — a submitted ticket's money is not actually frozen.**
> `prevent_submitted_ticket_update()` guards 20 columns but **omits `subtotal_amount` and `total_amount`**, and `guard_ticket_item_mutation()` blocks item mutation only at `ready`, `completed`, and `cancelled` — **`submitted` is not in its list**. So on a submitted ticket you can still edit `ticket_items`, and `recalculate_ticket_totals()` will rewrite the parent's `subtotal_amount`; a direct `UPDATE tickets SET total_amount = …` also passes. This defeats the strongest invariant in the system.
> *Remediation:* add `subtotal_amount` and `total_amount` to the guarded column list, and add `'submitted'` (plus the other frozen statuses) to `guard_ticket_item_mutation()`.
>
> Both are documented only — **no migration has been written or applied**, per the owner's decision of 2026-08-10. No production data is at risk today: the database holds zero tickets.

`guard_ticket_item_mutation()` raises the `order_locked` error code.

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
| — | pending | owner, admin, branch_manager, cashier | Ticket `fulfilment_type = 'delivery'` | — |
| pending | assigned | owner, admin, branch_manager | `driver_id` set to a user with the driver role | — |
| assigned | in_transit | assigned driver, branch_manager | Ticket status = `ready` | `dispatched_at` set |
| in_transit | delivered | assigned driver | `proof_url` or `recipient_name` present | `delivered_at` set; parent ticket may move to `completed` |
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

Invoice status is derived from payments, not set by hand. `apply_payment_to_ticket()` recomputes it after every payment:

- Sum of payments = 0 → `issued`
- 0 < sum < total → `partially_paid`
- Sum ≥ total → `paid`

`void` is the only manually triggered transition, permitted to owner and admin, and only when no payments exist against the invoice.

---

## 6. Implementation pattern

Implement one guard function per entity rather than scattering checks. All five are deployed: `guard_ticket_status_transition()`, `guard_production_batch_transition()`, `guard_delivery_transition()`, `guard_cash_session_transition()`, and invoice status derived via `apply_payment_to_ticket()`.

The ticket guard, as illustration:

```sql
create or replace function guard_ticket_status_transition()
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
    raise exception 'invalid ticket transition: % -> %', old.status, new.status;
  end if;

  -- Pickup tickets have nothing to deliver; delivery tickets must show their
  -- linked deliveries row as actually delivered before the ticket can follow.
  if new.status = 'delivered' and new.fulfilment_type = 'delivery' then
    select d.status into v_delivery_status from deliveries d where d.ticket_id = new.id;
    if v_delivery_status is distinct from 'delivered' then
      raise exception 'ticket requires linked delivery to be delivered first';
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
