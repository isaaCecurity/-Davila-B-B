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
| draft | submitted | owner, admin, branch_manager, cashier | — | No dedicated `submit_ticket` RPC — reached via `update_ticket(p_status := 'submitted')`, verified live 2026-08-22 (see note below) |
| submitted | confirmed | owner, admin, branch_manager, cashier | ≥1 ticket item; totals computed | Invoice issued. **Items do not freeze here** — see Immutability below |
| confirmed | scheduled | owner, admin, branch_manager, cashier | — | Via `update_ticket(p_status := 'scheduled')` |
| scheduled | in_production | owner, admin, branch_manager, baker | **Not enforced** — see note below | Via `update_ticket(p_status := 'in_production')` |
| in_production | ready | owner, admin, branch_manager, baker | **Not enforced** — see note below | Via `update_ticket(p_status := 'ready')`. Finished stock available |
| ready | delivered | owner, admin, branch_manager, cashier | `fulfilment_type = 'pickup'`, **or** the linked `deliveries` row for this ticket has `status = 'delivered'` | Via `update_ticket(p_status := 'delivered')` |
| delivered | completed | owner, admin, branch_manager, cashier | — | Sale stock movement written; `completed_at` stamped (added 2026-08-28, P9.8 — the reporting-layer revenue-recognition timestamp, see `SCHEMA-REFERENCE.md` §4) |
| any non-terminal | cancelled | owner, admin, branch_manager | `cancelled_reason` provided; if `amount_paid > 0`, a matching `refunds` total must already exist | Unpaid invoice voided. ("Reserved stock released" was in earlier drafts — **there is no reservation mechanism in the schema**; no table, column, or `stock_movements.reason` implements it. Treat reservations as unspecified, not as an existing behaviour.) |
| cancelled | archived | owner, admin, branch_manager | — | — |

**Correction (2026-08-23) — the `scheduled→in_production` and `in_production→ready`
preconditions above were unsanctioned.** This table previously claimed "a production
batch exists for the ticket" and "all linked batches completed or failed" as
preconditions for these two hops. Traced against `EB-013` Appendix A (the canonical
lifecycle reference this document's own header cites as its source) and the rest of
`EB-013`: **neither precondition appears anywhere in the engineering bible.** Appendix
A's Order Lifecycle section gives only the state sequence and two unrelated rules
("completed orders SHALL never re-enter production," "cancelled orders SHALL not
produce revenue") — no batch-linkage requirement. `production_batches.ticket_id` does
exist, so the check would be mechanically possible, but building it would mean inventing
a business rule with no source, which `CLAUDE.md`'s blocker discipline exists to prevent.
Surfaced during a security review of P6.6: unblocking bakers to call `update_ticket()` for
these two hops made the never-enforced precondition newly *reachable* (a baker can now
move a ticket to `in_production`/`ready` with zero linked batches), which is what
prompted checking whether it was ever meant to be real. It wasn't — corrected here rather
than adding trigger logic for a rule that was never approved. If a real batch-linkage
requirement is wanted, it needs to be raised as a genuine product decision, not inferred
from this document's own prior, unsourced claim.

**Terminal:** `completed`, `archived`. (`cancelled` is non-terminal — its only legal exit is `archived`.)

**The `ready → delivered` gate is enforced in the database, not just convention.** For `fulfilment_type = 'delivery'` tickets, the guard trigger looks up the linked `deliveries` row and blocks the transition unless that row's own status is `delivered`. This closes a gap where a ticket could previously reach a terminal-ish state with no verified delivery ever having happened. Pickup tickets skip this check — there's nothing to deliver.

**Payment is not a state.** A ticket tracks `amount_paid` independently of status. A ticket can be paid while still in production, or completed while unpaid (credit sale). Do not model payment as a ticket status — that conflation is the most common way this schema gets corrupted. The same discipline applies to driver trip custody and cash — see §6 "What is not a ticket state" below.

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

> ### ✅ Both defects resolved — 2026-08-14
>
> **Defect 1 — RESOLVED.** `prevent_submitted_ticket_update()` (the trigger that blocked all onward transitions) has been **dropped** — both the trigger and the function no longer exist in the database. `guard_ticket_status_transition()` is now the sole authority on status. Every transition in the state machine above is now reachable. `confirm_ticket()`, `complete_ticket()`, `cancel_ticket()` and `archive_ticket()` all work as specified.
>
> **Defect 2 — RESOLVED.** `guard_ticket_status_transition()` now freezes `subtotal_amount` the moment a ticket leaves `draft`. Any attempt to change `subtotal_amount` on a non-draft ticket raises `42501` with code `immutable_field`. `total_amount` is `GENERATED ALWAYS AS ((subtotal_amount - discount_amount) + tax_amount) STORED` and cannot be written directly — no separate guard is needed.
>
> *Migration applied:* `drop_prevent_submitted_ticket_update_and_harden_guard` — 2026-08-14. Zero rows affected (live DB holds zero tickets).

> ### ✅ Defect 3 resolved — 2026-08-22: `update_ticket()`'s own role gate contradicted this table
>
> Defect 1's resolution (above) made every hop in this state machine legal at the trigger
> level, but `update_ticket()` — the only RPC that reaches five of these hops (`draft →
> submitted`, `confirmed → scheduled`, `scheduled → in_production`, `in_production →
> ready`, `ready → delivered`), since none of them has its own dedicated RPC — carried a
> **coarser, contradicting role gate of its own**: only `owner/admin/branch_manager` or
> `cashier` could call it at all, and cashiers were blocked from touching `p_status`
> outright. In practice this meant **cashiers could never advance a ticket past `draft`
> through this RPC, and bakers could never call it at all** — silently contradicting this
> table's `cashier` and `baker` columns above, for every non-terminal hop except
> `submitted → confirmed` (which has its own RPC, `confirm_ticket()`, and was unaffected).
>
> Fixed: `update_ticket()` no longer re-implements a per-status role check. It now defers
> entirely to `guard_ticket_status_transition()` — the single source of truth for the
> table above — for whether a given (status, role) combination is legal, exactly as
> `confirm_ticket()`, `cancel_ticket()` and `complete_ticket()` already did. Pricing,
> assignment, and cancellation fields remain manager-only inside the RPC itself, and a
> baker calling this RPC may only change `status`, never the other editable fields.
>
> Verified live in a rolled-back transaction (simulated cashier and baker JWTs): a cashier
> now advances `draft → submitted → confirmed → scheduled`; a baker now advances
> `scheduled → in_production → ready`; a cashier attempting `scheduled → in_production` is
> still correctly refused (`insufficient_role`, baker/manager only); a baker attempting to
> also edit `customer_id` or to cancel is still correctly refused; manager behavior,
> including setting `discount_amount` together with a status change, is unchanged.
>
> *Migration applied:* `fix_update_ticket_status_role_gate_matches_guard_trigger` —
> 2026-08-22.

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

## 6. Driver Trip

Added by ADR-001 (`docs/ADR-001-Driver-Workflow-Redesign-MVP.md`, Approved 2026-08-24;
Phases 2–3 live 2026-08-24). Entity is **Driver Trip** (`driver_trips`) — the
operational/custody wrapper around a driver's field activity for one loading-to-return
cycle. A driver may run multiple trips per day; each is reconciled independently (ADR-001
§23 item 2).

```
created ──► loading ──► ready_to_depart ──► in_transit ──► returning ──► reconciled ──► completed
```

| From | To | Who | Preconditions | Side effects |
|---|---|---|---|---|
| — | created | driver (self) | Branch access to `p_branch_id`; warehouse belongs to that branch; **no other active (non-`completed`) trip already exists for this driver** — enforced by a partial unique index, not the guard trigger (INSERT, not an UPDATE OF status the trigger fires on) | Via `start_driver_trip()` |
| created | loading | owner, admin, branch_manager, supervisor, baker (the verifier — not the driver) | — | Via `verify_trip_loading()`. Writes one `transfer_out`/`transfer_in` movement pair per loaded item (source warehouse → the trip's own warehouse) |
| loading | ready_to_depart | same verifier, same call | — | Reached inside the same `verify_trip_loading()` invocation as the hop above — `loading` and `ready_to_depart` are both real, guard-checked, audit-logged transitions, but occur atomically in one RPC call, never as two separate client actions. `loading_verified_by`/`loading_verified_at` set |
| ready_to_depart | in_transit | the trip's own driver (`driver_id = auth.uid()`) | Trip status must already be `ready_to_depart` (checked in the RPC, redundant with but consistent with the guard) | Via `depart_driver_trip()`. `departed_at` set |
| in_transit | returning | the trip's own driver | — | Via `return_driver_trip()`. Writes the reverse `transfer_out`/`transfer_in` pair per returned item (trip warehouse → source warehouse); `returned_at` set |
| returning | reconciled | owner, admin, branch_manager, supervisor | `variance_note` present when `cash_variance ≠ 0` | Via `reconcile_driver_trip()`. `expected_cash` computed from the trip's own `payments` rows (never trusted from the client, mirrors `close_cash_session()`'s own discipline); `physical_cash`, `cash_variance`, `reconciled_by`, `reconciled_at` set |
| reconciled | completed | owner, admin, branch_manager | `p_settlement_cash_session_id` must reference an **open** session at the trip's own branch | Via `complete_driver_trip()`. `settlement_cash_session_id` recorded |

**Terminal:** `completed`. Trips are never deleted (`prevent_driver_trip_delete()` raises
unconditionally on `DELETE`) and never reopened.

**Role enforcement lives in the RPCs, not the trigger.** Unlike `guard_delivery_
transition()`, `guard_driver_trip_transition()` only checks state-transition legality (the
table above) and writes the `audit_log` row — it has no `has_role()`/ownership check of its
own. Each RPC independently checks role/branch-access/trip-ownership before ever issuing
the `UPDATE`. This is a deliberate asymmetry, not an oversight: every write path to
`driver_trips` is RPC-only — `authenticated` holds no direct `INSERT`/`UPDATE`/`DELETE`
grant on the table at all (verified live; the default-privilege grant Postgres gives new
tables was found and explicitly revoked) — so there is no raw-`UPDATE` path for the trigger
to need to defend against on its own, unlike `deliveries`, which the RLS `deliveries_update`
policy does expose to direct client writes.

**One active trip per driver** is enforced by a partial unique index, mirroring cash
sessions' "one open per branch":

```sql
create unique index driver_trips_one_active_per_driver
  on driver_trips (tenant_id, driver_id)
  where status <> 'completed' and deleted_at is null;
```

Multiple trips per day remain allowed — they are simply sequential, never concurrent.

### Loading verification and inventory custody

Loading is **one-party**: the verifying supervisor/manager/baker's own `verify_trip_
loading()` call both records what was loaded and verifies it, atomically — there is no
separate driver-side "propose loading" step (ADR-001 §23 item 5, resolved on approval).

A driver's vehicle is represented as an ordinary `warehouses` row (`driver_trips.
warehouse_id`) — no new inventory concept was introduced. Custody transfer reuses the
existing `stock_movements` `transfer_out`/`transfer_in` reasons exactly as any other
warehouse-to-warehouse move would, tagged `reference_type = 'driver_trip'`,
`reference_id = driver_trips.id` (the only schema change `stock_movements` needed was
adding `'driver_trip'` to its `reference_type` CHECK). Loading pulls from the branch's
default warehouse unless an explicit source is given; return reverses the same pair.

Selling from the trip's own warehouse needs no new machinery: a trip-linked ticket's
`complete_ticket(p_order_id, p_warehouse_id)` call simply passes the trip's `warehouse_id`
in place of the branch default. `complete_ticket()` itself was inspected and required no
change — it already took an explicit warehouse and writes the existing `sale` movement
reason unchanged.

### Trip-scoped payments and cash custody (AD-018)

**Driver cash in custody ≠ cash physically in the branch till**
(`ARCHITECTURE_DECISIONS.md` AD-018). `record_payment()` accepts an optional
`p_driver_trip_id`: when set, the payment is tagged `driver_trip_id` instead of
`cash_session_id` and skips the open-till-session requirement entirely — cash a driver is
holding never inflates the branch's till session while the trip is still `in_transit`.

```sql
alter table payments add constraint payments_cash_needs_custody_context check (
  method <> 'cash' or cash_session_id is not null or driver_trip_id is not null
);
alter table payments add constraint payments_custody_context_exclusive check (
  cash_session_id is null or driver_trip_id is null
);
```

A payment belongs to exactly one custody context — the till **or** a trip, never both.

`reconcile_driver_trip()` computes `expected_cash` as the sum of the trip's own
`cash`-method payments, compared against the physical cash the driver actually returns.
`close_cash_session()` was extended to fold a **completed** trip's `physical_cash` into
whichever branch session its `settlement_cash_session_id` names, alongside the existing
`opening_float + cash_in − cash_out` terms — this is the actual mechanism by which
reconciled trip cash enters the till. It never rewrites the original trip-scoped payment
rows; the branch session's expected amount is computed fresh at close time exactly as it
already was, just with one more summed term.

**Do not make payment a Ticket state** (unchanged from §1) — the same applies to driver
trip cash. Custody and reconciliation status are tracked on `payments`/`driver_trips`,
never folded into `tickets.status` or `driver_trips.status` itself.

### Ticket ↔ driver-trip assignment guard

`tickets.driver_trip_id` links a ticket to the trip fulfilling it (Path A: manager-
assigned, linked once the trip is `in_transit`; Path B: driver-created, linked at
creation). Setting or changing it is guarded by `guard_ticket_driver_trip_assignment()`
(`BEFORE INSERT OR UPDATE OF driver_trip_id`):

- the named trip must exist in the ticket's own tenant and branch;
- the trip must be `in_transit` — a ticket cannot link to a trip that hasn't departed yet
  or has already returned;
- the trip's `driver_id` must match the ticket's `created_by` (Path B) or `assigned_to`
  (Path A) — a ticket cannot be linked to a trip belonging to a different driver.

This closes a gap the `tickets_insert`/`tickets_update` RLS policies leave open on their
own: those policies already permit a `driver` to insert/update a ticket they created or
are assigned to (this was already true before ADR-001 — Path B needed no new RLS policy),
but say nothing about which trip it may reference. This guard is what actually enforces
that a ticket only ever belongs to its own driver's own active trip.

### Driver field-sale shortcut (AD-020)

A driver-created, trip-linked roadside sale is stock that is **already produced and
already loaded** — §1's seven forward hops describe a baking pipeline that has already
happened before the driver departed. `complete_driver_field_sale(p_ticket_id,
p_warehouse_id)` lets such a ticket take `draft → completed` directly, bypassing
`submitted`/`confirmed`/`scheduled`/`in_production`/`ready`/`delivered` entirely — but only
when every one of these holds, all checked by the RPC before it touches the row:

- `tickets.driver_trip_id` is set;
- that trip's `status = 'in_transit'`;
- the caller is the trip's own driver (`driver_trips.driver_id = auth.uid()` — the same
  identity the assignment guard above already establishes at link time) or a manager;
- `fulfilment_type = 'pickup'` — refused outright for `'delivery'`, so this hop can never
  substitute for the `deliveries` gate below;
- the ticket has at least one item.

It then performs the same side effects the normal lifecycle would have: recomputes
`subtotal_amount` from items (`confirm_ticket()`'s own mechanism), issues the invoice
(`confirm_ticket()`'s insert, same `ON CONFLICT (ticket_id)` upsert), and writes the sale
stock movement (`complete_ticket()`'s mechanism) — **against the driver trip's own
warehouse**, not the branch's default, since the goods were in the vehicle's custody per
`verify_trip_loading()`, not on the branch shelf. `completed_at` is stamped here too — the
guard trigger's revenue-recognition stamp (§1, added 2026-08-28) fires on `status =
'completed'` regardless of which of the two entry paths reached it, so a field sale
counts toward `get_daily_revenue_summary()` exactly like a normal completion.

**Guard mechanism**: `guard_ticket_status_transition()` gained `'completed'` as a legal
target from `'draft'`, gated by a transaction-local flag
(`bakeflow.driver_field_sale_rpc`) that only `complete_driver_field_sale()` ever sets —
the identical technique `guard_production_batch_transition()` already uses for
`bakeflow.production_batch_rpc` (§7). `authenticated` holds no `UPDATE` grant on `tickets`
at all (`INSERT`/`SELECT` only, matching `deliveries`), so the flag is defence in depth
against any future RPC or migration path, not a client bypass that was otherwise reachable.

**Not affected by this shortcut**: `record_payment()`'s driver-trip-scoped branch is
unchanged — recording a payment against a `draft` ticket already worked before this
decision and still does. A ticket may be `completed` via this path while `amount_paid <
total_amount`; that is a credit sale, exactly as legitimate here as anywhere else in the
schema (§1, "payment is not a state").

Full decision text: **AD-020** (`ARCHITECTURE_DECISIONS.md`), resolving **BLOCKER-021**.

### `deliveries` remains authoritative (AD-019)

A driver trip is an operational/custody wrapper — it does not replace or bypass the
`deliveries` state machine (§3 above). For a trip-linked, `fulfilment_type = 'delivery'`
ticket, completing the sale inside the trip is the commercial transaction only;
`ready → delivered` still hard-requires the linked `deliveries` row to itself be
`delivered`, exactly as §1 already states. No RPC introduced by this section writes to
`deliveries` — `complete_ticket()` was inspected and confirmed unchanged, and no trip RPC
calls `transition_delivery()` on a ticket's behalf. Integrating trip completion with
delivery proof (if ever wanted) is future work this ADR does not authorize.

### What is not a ticket state

Neither the driver trip lifecycle above nor a ticket's link to one (`driver_trip_id`) is a
`tickets.status` value, and none of it is folded into the Ticket state machine in §1. A
ticket's own status (`draft` → … → `completed`/`cancelled` → `archived`) advances exactly
as §1 describes regardless of which trip, if any, fulfilled it. `driver_trips.status` is a
separate lifecycle on a separate table, cross-referenced only via `tickets.driver_trip_id`
and `payments.driver_trip_id` — the same "payment is not a state" discipline in §1 applies
here: custody, loading, and reconciliation are operational/financial facts tracked on
their own entities, not additional ticket statuses.

---

## 7. Implementation pattern

Implement one guard function per entity rather than scattering checks. All six entity
guards are deployed: `guard_ticket_status_transition()`, `guard_production_batch_
transition()`, `guard_delivery_transition()`, `guard_cash_session_transition()`,
`guard_driver_trip_transition()`, and invoice status derived via `apply_payment_to_
ticket()`. A narrower, seventh guard — `guard_ticket_driver_trip_assignment()` — enforces
a single foreign-key-shaped invariant (§6) rather than a full state machine, so it is
listed separately from the entity guards above.

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
