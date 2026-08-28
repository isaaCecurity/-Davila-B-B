# BakeFlow — Schema Reference

**Status:** canonical concrete schema. The `EB` documents define *standards* (naming, types, invariants); this document applies them to produce the actual tables. When `EB-011` says "table names SHALL use lowercase plural snake_case," this document is the result of following that rule.

Every table below conforms to the non-negotiable rules in `CLAUDE.md`. Where this document and an `EB` document disagree on a concrete column, this document wins and the `EB` document should be corrected.

---

## Conventions applied to every table

- Primary key: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- Tenant scope: `tenant_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT` — set explicitly by the application, never defaulted from JWT
- Branch scope (where applicable): `branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT`
- Audit: `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `created_by UUID REFERENCES profiles(id)`
- Money: `NUMERIC(19,4)`. Quantities: `NUMERIC(18,4)`. Percentages: `NUMERIC(5,2)`.
- Every `tenant_id` column is indexed. Every foreign key is indexed.
- `updated_at` is maintained by a shared trigger (see §9), never by the application.

Below, **[std]** stands for the audit columns above, to keep the tables readable. Write them out in full in the migration.

---

## 1. Tenancy and identity

### `organizations`
The tenant root. Not itself tenant-scoped.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| name | TEXT NOT NULL | |
| slug | TEXT NOT NULL UNIQUE | URL-safe identifier |
| country_code | TEXT NOT NULL DEFAULT 'NG' | ISO 3166-1 alpha-2 |
| currency_code | TEXT NOT NULL DEFAULT 'NGN' | ISO 4217 |
| timezone | TEXT NOT NULL DEFAULT 'Africa/Lagos' | IANA |
| status | TEXT NOT NULL DEFAULT 'active' | CHECK IN ('active','suspended','closed') |
| [std] | | |

### `branches`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK | |
| name | TEXT NOT NULL | |
| code | TEXT NOT NULL | UNIQUE (tenant_id, code) |
| address_line | TEXT | |
| city | TEXT | |
| phone | TEXT | |
| is_primary | BOOLEAN NOT NULL DEFAULT false | Partial unique index: one true per tenant |
| status | TEXT NOT NULL DEFAULT 'active' | CHECK IN ('active','inactive') |
| [std] | | |

### `profiles`
Extends `auth.users`. Created by trigger on signup (§9).

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | REFERENCES auth.users(id) ON DELETE CASCADE — **not** generated |
| tenant_id | UUID FK | NULL until the user creates or joins an organization |
| primary_branch_id | UUID FK → branches | |
| full_name | TEXT NOT NULL DEFAULT '' | |
| phone | TEXT | |
| avatar_url | TEXT | |
| status | TEXT NOT NULL DEFAULT 'active' | CHECK IN ('active','suspended') |
| [std] | | `created_by` omitted |

> `profiles.tenant_id` is deliberately nullable — a user exists between signing up and creating an organization. Every *other* tenant-scoped table has `tenant_id NOT NULL`.

### `roles`
Platform-defined, not tenant-scoped. Seeded once.

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| key | TEXT NOT NULL UNIQUE | owner, admin, branch_manager, baker, cashier, driver, accountant |
| name | TEXT NOT NULL | Display name |
| rank | SMALLINT NOT NULL | Lower = more privileged; used for "at least manager" checks |

### `user_roles`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK | |
| profile_id | UUID NOT NULL FK → profiles | |
| role_id | UUID NOT NULL FK → roles | |
| branch_id | UUID FK → branches | NULL = role applies org-wide |
| [std] | | |

UNIQUE (tenant_id, profile_id, role_id, branch_id) — with a partial unique index handling the NULL branch case.

### `branch_assignments`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK | |
| profile_id | UUID NOT NULL FK | |
| branch_id | UUID NOT NULL FK | |
| is_default | BOOLEAN NOT NULL DEFAULT false | |
| [std] | | |

UNIQUE (tenant_id, profile_id, branch_id).

### `organization_invites`

| Column | Type | Notes |
|---|---|---|
| id | UUID PK | |
| tenant_id | UUID NOT NULL FK | |
| email | TEXT NOT NULL | |
| role_id | UUID NOT NULL FK | |
| branch_id | UUID FK | |
| token_hash | TEXT NOT NULL UNIQUE | Store the hash, never the raw token |
| status | TEXT NOT NULL DEFAULT 'pending' | CHECK IN ('pending','accepted','revoked','expired') |
| expires_at | TIMESTAMPTZ NOT NULL | |
| accepted_by | UUID FK → profiles | |
| accepted_at | TIMESTAMPTZ | |
| [std] | | |

---

## 2. Catalog

### `product_categories`
id, tenant_id, `name TEXT NOT NULL`, `sort_order SMALLINT NOT NULL DEFAULT 0`, [std]. UNIQUE (tenant_id, name).

### `products`

| Column | Type | Notes |
|---|---|---|
| id, tenant_id | | |
| category_id | UUID FK → product_categories | |
| name | TEXT NOT NULL | |
| description | TEXT | |
| image_url | TEXT | |
| is_active | BOOLEAN NOT NULL DEFAULT true | |
| [std] | | |

UNIQUE (tenant_id, name).

### `product_variants`
The sellable SKU. Price lives here, not on `products`.

| Column | Type | Notes |
|---|---|---|
| id, tenant_id | | |
| product_id | UUID NOT NULL FK | ON DELETE CASCADE |
| name | TEXT NOT NULL | "Medium", "Family size" |
| sku | TEXT NOT NULL | UNIQUE (tenant_id, sku) |
| unit_price | NUMERIC(19,4) NOT NULL | CHECK >= 0 |
| is_active | BOOLEAN NOT NULL DEFAULT true | |
| [std] | | |

### `ingredients`

| Column | Type | Notes |
|---|---|---|
| id, tenant_id | | |
| name | TEXT NOT NULL | UNIQUE (tenant_id, name) |
| unit_of_measure | TEXT NOT NULL | kg, g, l, ml, unit |
| reorder_level | NUMERIC(18,4) NOT NULL DEFAULT 0 | CHECK >= 0 |
| last_unit_cost | NUMERIC(19,4) | Most recent purchase price per UoM |
| is_active | BOOLEAN NOT NULL DEFAULT true | |
| [std] | | |

### `recipes`
The bill of materials for one variant.

| Column | Type | Notes |
|---|---|---|
| id, tenant_id | | |
| product_variant_id | UUID NOT NULL FK | |
| name | TEXT NOT NULL | |
| yield_quantity | NUMERIC(18,4) NOT NULL | CHECK > 0 — units produced per batch |
| version | INTEGER NOT NULL DEFAULT 1 | |
| is_active | BOOLEAN NOT NULL DEFAULT true | |
| [std] | | |

Partial unique index: one active recipe per variant.

### `recipe_ingredients`

| Column | Type | Notes |
|---|---|---|
| id, tenant_id | | |
| recipe_id | UUID NOT NULL FK | ON DELETE CASCADE |
| ingredient_id | UUID NOT NULL FK | |
| quantity | NUMERIC(18,4) NOT NULL | CHECK > 0 — per `yield_quantity` |
| [std] | | |

UNIQUE (recipe_id, ingredient_id).

---

## 3. Inventory

### `warehouses`
id, tenant_id, `branch_id NOT NULL`, `name TEXT NOT NULL`, `is_default BOOLEAN NOT NULL DEFAULT false`, [std]. UNIQUE (tenant_id, branch_id, name).

### `stock_movements`
**The source of truth for all stock.** Append-only.

| Column | Type | Notes |
|---|---|---|
| id, tenant_id | | |
| branch_id | UUID NOT NULL FK | |
| warehouse_id | UUID NOT NULL FK | |
| item_type | TEXT NOT NULL | CHECK IN ('ingredient','product') |
| ingredient_id | UUID FK | |
| product_variant_id | UUID FK | |
| quantity_delta | NUMERIC(18,4) NOT NULL | CHECK <> 0. Positive = in, negative = out |
| reason | TEXT NOT NULL | CHECK IN ('purchase','production_consume','production_output','sale','waste','adjustment','transfer_in','transfer_out','opening_balance') |
| reference_type | TEXT | 'ticket', 'production_batch', 'purchase' |
| reference_id | UUID | |
| unit_cost | NUMERIC(19,4) | Cost per unit at time of movement |
| note | TEXT | |
| [std] | | |

CHECK: exactly one of `ingredient_id` / `product_variant_id` is non-null, matching `item_type`.

**No UPDATE or DELETE is ever permitted on this table.** Corrections are new movements with `reason = 'adjustment'`. Enforced by RLS (no update/delete policies) and by a `BEFORE UPDATE OR DELETE` trigger that raises.

### `ingredient_stock_levels`
Derived cache. Maintained *only* by trigger from `stock_movements`.

id, tenant_id, `branch_id NOT NULL`, `warehouse_id NOT NULL`, `ingredient_id NOT NULL`, `quantity_on_hand NUMERIC(18,4) NOT NULL DEFAULT 0`, `updated_at`. UNIQUE (warehouse_id, ingredient_id).

### `product_stock_levels`
Same shape, keyed on `product_variant_id`. UNIQUE (warehouse_id, product_variant_id).

> Both level tables must be reconstructible from `stock_movements` alone. A reconciliation query proving `SUM(quantity_delta) = quantity_on_hand` for every key is part of the test suite (see `TESTING-STRATEGY.md`).

---

## 4. Sales

### `customers`
id, tenant_id, `full_name TEXT NOT NULL`, `phone TEXT`, `email TEXT`, `address_line TEXT`, `notes TEXT`, `is_walk_in BOOLEAN NOT NULL DEFAULT false`, [std]. Index on (tenant_id, phone).

### `tickets`
The customer order. **The table is `tickets`, not `orders`** — see the vocabulary note in `CLAUDE.md`. RPC arguments referring to a ticket are historically named `p_order_id`; that is a naming wart, not a second entity.

| Column | Type | Notes |
|---|---|---|
| id, tenant_id | | |
| branch_id | UUID NOT NULL FK | |
| customer_id | UUID FK | NULL for anonymous walk-in |
| ticket_number | TEXT NOT NULL | UNIQUE (tenant_id, ticket_number). Generated by `next_document_number()` via the `assign_order_number()` trigger. |
| status | TEXT NOT NULL DEFAULT 'draft' | CHECK IN ('draft','submitted','confirmed','scheduled','in_production','ready','delivered','completed','cancelled','archived') — the full 10-state model in `STATE-MACHINES.md` §1 |
| fulfilment_type | TEXT NOT NULL | CHECK IN ('pickup','delivery') |
| due_at | TIMESTAMPTZ | |
| subtotal_amount | NUMERIC(19,4) NOT NULL DEFAULT 0 | |
| discount_amount | NUMERIC(19,4) NOT NULL DEFAULT 0 | CHECK >= 0 |
| tax_amount | NUMERIC(19,4) NOT NULL DEFAULT 0 | CHECK >= 0 |
| total_amount | NUMERIC(19,4) NOT NULL DEFAULT 0 | CHECK >= 0 |
| amount_paid | NUMERIC(19,4) NOT NULL DEFAULT 0 | Maintained by trigger from `payments` |
| cancelled_reason | TEXT | Required when status = 'cancelled' |
| assigned_to | UUID FK → profiles | Staff member responsible for the ticket |
| correction_of_ticket_id | UUID FK → tickets | Set when this ticket corrects/reverses an earlier one — gated by the `tickets.correct` permission |
| sale_customer_type | TEXT | Walk-in vs registered classification |
| archived_at, archived_by, archive_reason | TIMESTAMPTZ / UUID / TEXT | Set by `archive_ticket()` |
| completed_at | TIMESTAMPTZ | Added 2026-08-28 (P9.8/REPORTING-MODEL.md §78). Stamped by `guard_ticket_status_transition()` the moment `status` reaches `completed`, on both entry paths (`delivered → completed` and the AD-020 `draft → completed` shortcut). This is the revenue-recognition timestamp `get_daily_revenue_summary()` reads — chosen over `delivered` because `completed` is where the sale stock movement is actually written (§1), the same event a future COGS calculation must key off. |
| device_created_at, server_received_at, revision | TIMESTAMPTZ / TIMESTAMPTZ / BIGINT | Offline-sync ordering — see §12 |
| [std] + `deleted_at`, `deleted_by` | | Soft delete — see §11 |

CHECK: `total_amount = subtotal_amount - discount_amount + tax_amount`.

### `ticket_items`

| Column | Type | Notes |
|---|---|---|
| id, tenant_id | | |
| ticket_id | UUID NOT NULL FK | ON DELETE CASCADE |
| product_variant_id | UUID NOT NULL FK | ON DELETE RESTRICT |
| quantity | NUMERIC(18,4) NOT NULL | CHECK > 0 |
| unit_price | NUMERIC(19,4) NOT NULL | **Snapshot at time of sale.** Never read live from the variant. |
| line_total | NUMERIC(19,4) NOT NULL | CHECK `= ROUND(quantity * unit_price, 4)` and CHECK `>= 0` (a negative line was an untracked discount) |
| [std] | | |

### `invoices`
id, tenant_id, `branch_id NOT NULL`, `ticket_id NOT NULL FK UNIQUE`, `invoice_number TEXT NOT NULL` (UNIQUE per tenant), `issued_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `due_at TIMESTAMPTZ`, `total_amount NUMERIC(19,4) NOT NULL`, `status TEXT NOT NULL DEFAULT 'issued'` CHECK IN ('draft','issued','partially_paid','paid','void'), [std].

### `payments`

| Column | Type | Notes |
|---|---|---|
| id, tenant_id | | |
| branch_id | UUID NOT NULL FK | |
| ticket_id | UUID FK | |
| invoice_id | UUID FK | |
| cash_session_id | UUID FK | Required when method = 'cash' |
| amount | NUMERIC(19,4) NOT NULL | CHECK > 0 |
| method | TEXT NOT NULL | CHECK IN ('cash','card','transfer','pos','credit') |
| reference | TEXT | Transfer reference, POS terminal ref |
| received_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| [std] | | |

Payments are **append-only**. A refund is a separate row in `refunds`, never a negative payment and never a delete.

### `refunds`
id, tenant_id, branch_id, `payment_id NOT NULL FK`, `amount NUMERIC(19,4) NOT NULL CHECK > 0`, `reason TEXT NOT NULL`, `refunded_at TIMESTAMPTZ NOT NULL DEFAULT now()`, [std]. CHECK: total refunds against a payment cannot exceed its amount (enforced by trigger).

---

## 5. Production

### `production_batches`

| Column | Type | Notes |
|---|---|---|
| id, tenant_id | | |
| branch_id | UUID NOT NULL FK | |
| batch_number | TEXT NOT NULL | UNIQUE (tenant_id, batch_number) |
| recipe_id | UUID NOT NULL FK | |
| ticket_id | UUID FK | NULL for stock-building batches |
| planned_quantity | NUMERIC(18,4) NOT NULL | CHECK > 0 |
| actual_quantity | NUMERIC(18,4) | Set on completion |
| status | TEXT NOT NULL DEFAULT 'scheduled' | CHECK IN ('scheduled','in_progress','completed','failed','cancelled') |
| started_at, completed_at | TIMESTAMPTZ | |
| assigned_to | UUID FK → profiles | |
| failure_reason | TEXT | Required when status = 'failed' |
| [std] | | |

### `production_batch_ingredients`
Actual consumption, which may differ from the recipe.

id, tenant_id, `batch_id NOT NULL FK` (CASCADE), `ingredient_id NOT NULL FK`, `planned_quantity NUMERIC(18,4) NOT NULL`, `actual_quantity NUMERIC(18,4)`, `waste_quantity NUMERIC(18,4) NOT NULL DEFAULT 0 CHECK >= 0`, [std]. UNIQUE (batch_id, ingredient_id).

---

## 6. Delivery

### `deliveries`

| Column | Type | Notes |
|---|---|---|
| id, tenant_id | | |
| branch_id | UUID NOT NULL FK | |
| ticket_id | UUID NOT NULL FK UNIQUE | |
| driver_id | UUID FK → profiles | |
| status | TEXT NOT NULL DEFAULT 'pending' | CHECK IN ('pending','assigned','in_transit','delivered','failed','returned') |
| address_line | TEXT NOT NULL | |
| contact_phone | TEXT | |
| scheduled_at, dispatched_at, delivered_at | TIMESTAMPTZ | |
| proof_url | TEXT | Photo or signature in Supabase Storage |
| recipient_name | TEXT | |
| failure_reason | TEXT | |
| [std] | | |

---

## 7. Cash

### `cash_sessions`

| Column | Type | Notes |
|---|---|---|
| id, tenant_id | | |
| branch_id | UUID NOT NULL FK | |
| opened_by | UUID NOT NULL FK → profiles | |
| closed_by | UUID FK → profiles | |
| opening_float | NUMERIC(19,4) NOT NULL | CHECK >= 0 |
| expected_amount | NUMERIC(19,4) | Computed at close |
| counted_amount | NUMERIC(19,4) | Entered at close |
| variance_amount | NUMERIC(19,4) | GENERATED: counted − expected |
| variance_note | TEXT | Required when variance <> 0 |
| status | TEXT NOT NULL DEFAULT 'open' | CHECK IN ('open','closed') |
| opened_at | TIMESTAMPTZ NOT NULL DEFAULT now() | |
| closed_at | TIMESTAMPTZ | |
| [std] | | |

Partial unique index: **one open session per branch at a time.** Sessions are never deleted.

### `expenses`
id, tenant_id, `branch_id NOT NULL`, `category TEXT NOT NULL` (ingredients, rent, utilities, salaries, transport, other), `amount NUMERIC(19,4) NOT NULL CHECK > 0`, `description TEXT`, `paid_method TEXT`, `cash_session_id UUID FK`, `incurred_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `receipt_url TEXT`, [std].

---

## 8. Audit

### `audit_log`
Satisfies Core Principle 4. Append-only, never updated or deleted.

id, tenant_id, `actor_id UUID FK → profiles`, `entity_type TEXT NOT NULL`, `entity_id UUID NOT NULL`, `action TEXT NOT NULL` (insert/update/delete/status_change), `before JSONB`, `after JSONB`, `occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()`.

Index on (tenant_id, entity_type, entity_id, occurred_at DESC).

---

## 9. Functions and triggers

This section reflects the functions actually deployed. Where a historical name differs from what it operates on, the live name is given and the wart is noted — do not "fix" these names in isolation, since RPC signatures are part of the client contract.

### Shared

| Name | Type | Purpose |
|---|---|---|
| `set_updated_at()` | BEFORE UPDATE trigger | Sets `updated_at = now()`. Attached to every table carrying `updated_at`. |
| `handle_new_user()` | AFTER INSERT on `auth.users` | Creates the matching `profiles` row. SECURITY DEFINER. |
| `custom_access_token_hook(event jsonb)` | Auth hook | Embeds `tenant_id` and role keys into the access token. **This is the live name** — earlier drafts of this document called it `sync_jwt_claims()`, which does not exist. Body and caveats in `RLS-POLICY-PATTERNS.md` §9. |
| `current_tenant_id()`, `has_role(text[])`, `has_branch_access(uuid)`, `has_permission(text, uuid)` | RLS helpers | See `RLS-POLICY-PATTERNS.md` §2. |
| `log_audit_event(tenant, entity_type, entity_id, action, before, after)` | SECURITY DEFINER | The audit-log writer. Satisfies Core Principle 4 and the per-transition rule in `STATE-MACHINES.md`. |
| `next_document_number(tenant, doc_type)` | SECURITY DEFINER | Allocates the next number from `document_sequences`. Backs ticket, invoice and batch numbering. |

### Stock

| Name | Type | Purpose |
|---|---|---|
| `apply_stock_movement()` | AFTER INSERT on `stock_movements` | Upserts the matching stock level row. The only writer of the level tables. |
| `prevent_stock_movement_mutation()` | BEFORE UPDATE OR DELETE on `stock_movements` | Raises unconditionally. |

**Negative stock:** `apply_stock_movement()` raises if the resulting `quantity_on_hand` would be below zero for a movement with `reason IN ('production_consume','sale')`. Adjustments and waste may go negative only if the tenant has explicitly enabled it — default is deny.

### Tickets

| Name | Type | Purpose |
|---|---|---|
| `recalculate_ticket_totals()` | on `ticket_items` | Recomputes subtotal and total on the parent ticket. |
| `guard_ticket_item_mutation()` | BEFORE INSERT/UPDATE/DELETE on `ticket_items` | Raises `order_locked` if the parent ticket status is `ready`, `completed`, or `cancelled`. **Items stay editable through `confirmed`, `scheduled`, and `in_production`** — this is the authoritative freeze point; `STATE-MACHINES.md` §1's claim that items freeze at `confirmed` is wrong. |
| `guard_ticket_status_transition()` | BEFORE UPDATE OF status on `tickets` | Enforces the 10-state machine. |
| `guard_order_item_price()` | on `ticket_items` | Price-snapshot integrity. Name says `order`, table is `ticket_items`. |
| `guard_order_actor_and_assignment()`, `guard_driver_created_order_assignment()` | on `tickets` | Actor/assignment rules, including the driver-created-ticket case. Names say `order`, table is `tickets`. |
| `assign_order_number()` | BEFORE INSERT on `tickets` | Populates `ticket_number` via `next_document_number()`. Name says `order`. |
| `prevent_submitted_ticket_update()` | on `tickets` | Blocks direct update of a submitted ticket outside the RPCs. |
| `apply_payment_to_ticket()` | AFTER INSERT on `payments` | Updates `tickets.amount_paid` and invoice status. |

### Payments, refunds, cash

| Name | Type | Purpose |
|---|---|---|
| `prevent_financial_mutation()` | on `payments`, `refunds` | Append-only enforcement. |
| `guard_payment_relationships()` | on `payments` | Validates ticket/invoice/cash-session coherence. |
| `guard_refund_total()` | on `refunds` | Refunds against a payment may not exceed it. |
| `guard_cash_session_transition()`, `prevent_cash_session_delete()`, `bump_cash_session_revision()` | on `cash_sessions` | State machine, no-delete, offline revision counter. |
| `guard_expense_cash_session()` | on `expenses` | Ties cash expenses to an open session. |
| `guard_daily_financial_audit_mutation()` | on `daily_financial_audits` | Freezes confirmed/rejected rows and enforces segregation of duties — see §13. |

### Production, delivery, identity

| Name | Type | Purpose |
|---|---|---|
| `guard_production_batch_transition()`, `assign_batch_number()`, `copy_batch_planned_ingredients()` | on `production_batches` | State machine, numbering, and planned-ingredient snapshot from the recipe. |
| `guard_delivery_transition()` | on `deliveries` | Delivery state machine, including the driver-assignment check. |
| `guard_user_role_integrity()`, `guard_profile_primary_branch()` | on `user_roles`, `profiles` | Prevent cross-tenant role and branch assignment. |
| `prevent_audit_log_mutation()` | on `audit_log` | Append-only enforcement. |
| `private.can_manage_target_role(uuid)` | SECURITY DEFINER, `private` schema | Rank-based check for who may grant a given role. Not client-callable. |

### Self-verification functions

Deployed and callable, and the natural backing for the checks in `TESTING-STRATEGY.md`: `verify_rls_coverage()`, `verify_tenant_columns()`, `verify_money_columns()`, `verify_quantity_columns()`, `verify_stock_reconciliation()`, `assert_schema_invariants()`.

### Client RPCs

`create_organization_with_owner`, `create_organization_invite`, `accept_organization_invite`, `confirm_ticket`, `update_ticket`, `cancel_ticket`, `complete_ticket`, `archive_ticket`, `record_payment`, `record_refund`, `open_cash_session`, `close_cash_session`, `adjust_stock`, `complete_production_batch`, `fail_production_batch`, `transition_delivery`, `update_delivery_details`, `update_invoice_due_at`, `process_sync_batch`, `sync_validate_device`. Signatures in `API-CONTRACT.md` §2.

---

## 10. Build order

Tables must be created in this order for foreign keys to resolve. It matches the phases in `AI-BUILD-GUIDE.md`.

1. `organizations` → `branches` → `profiles` → `roles`
2. `user_roles` → `branch_assignments` → `organization_invites`
3. `product_categories` → `products` → `product_variants` → `ingredients` → `recipes` → `recipe_ingredients`
4. `warehouses` → `stock_movements` → `ingredient_stock_levels` → `product_stock_levels`
5. `customers` → `tickets` → `ticket_items` → `invoices` → `cash_sessions` → `payments` → `refunds`
6. `production_batches` → `production_batch_ingredients` → `deliveries` → `expenses` → `audit_log`
7. `permissions` → `role_permissions` → `document_sequences` → `permanent_deletion_challenges` → `daily_financial_audits` → `sync_devices` → `sync_changes` → `sync_operations`

> `cash_sessions` is created in phase 5 rather than 6 because `payments.cash_session_id` references it.

> Phase 7 covers the subsystems documented in §11–§13, which the original six phases predate.

---

## 11. Soft delete and permanent deletion

Core rule 8 in `CLAUDE.md` forbids hard-deleting business data. The live mechanism:

- Most tables carry **`deleted_at TIMESTAMPTZ`** and **`deleted_by UUID`**. Deletion is an UPDATE setting both. Every RLS policy and every read path must filter `deleted_at IS NULL`; a policy that forgets this leaks deleted rows (audit check `B9`).
- Ledger tables (`stock_movements`, `payments`, `refunds`, `audit_log`) are append-only and are not soft-deleted either — corrections are new rows.
- **`permanent_deletion_challenges`** backs a deliberate two-step hard delete for the rare cases that require one: `tenant_id`, `target_table`, `target_id`, `requested_by`, `confirmation_phrase_hash`, `expires_at`, `consumed_at`. The caller must echo a confirmation phrase whose hash matches. `confirmation_phrase_hash` must never be readable by clients.
- Gated by the **`records.permanent_delete`** permission, granted only to `admin` and `branch_manager` — notably **not** to `owner`.

## 12. Offline sync

> **Policy resolved 2026-08-10:** offline-first is the product rule; the old `API-CONTRACT.md` §6 prohibition is withdrawn. See `docs/OFFLINE-SYNC-MODEL.md` for the full protocol.
>
> ### Corrected 2026-08-28, while recording AD-021 (BLOCKER-006): the "stub" claim below was stale, not current
>
> This section previously said `process_sync_batch_context_validated()` was a stub that
> raised unconditionally on every call, and that claim was repeated without re-verification
> in several other documents while resolving BLOCKER-006 today. **Re-read live from
> `pg_proc`, it is not a stub.** Migration `20260810182203_multiorg_08_operation_
> authoritative_sync_processor` — the same migration AD-006 already cites as its own
> IMPLEMENTED evidence — replaced the stub body a full 18 days before this section's own
> claim was written, and nothing since ever corrected this section to match. The two
> documents contradicted each other about the identical function the whole time.
>
> **What the live function actually does**, confirmed by reading its body: authenticates
> the caller and resolves the device via `sync_validate_device()` (ownership + not-revoked
> only — see below); for each operation, looks up `sync_operations` by `operation_id` and,
> if found, refuses a replay whose immutable context (`tenant_id`/`actor_id`/`device_id`/
> `entity_id`/`operation_type`) differs from the stored row rather than silently returning
> another tenant's or another operation's result; authorizes the operation's own
> `tenant_id`/`branch_id` (never the caller's active organization) via `is_member_of()` and
> `is_authorized_for_branch()` — both re-read live and confirmed to match AD-008's
> branch-before-owner ordering; compares `base_revision` against the current max
> `sync_changes.revision` for that entity and records `CONFLICT` rather than applying a
> stale write; then inserts the operation into `sync_operations` as `PENDING` or
> `CONFLICT`. `sync_operations` holds zero rows because nothing has been pushed through it
> yet, not because the function cannot succeed.
>
> **What is still genuinely missing — this is the real, narrower P3.7 gap**: nothing
> writes to `sync_changes`, nothing applies the operation to a business table, no revision
> is ever incremented, and there is no dispatch to a per-entity handler at all — the
> function only *records* a validated, conflict-checked intent. This matches AD-009's
> gateway boundary exactly ("authenticates, authorizes, preserves context, enforces
> idempotency, and records operations... does not write business tables"). AD-021 (2026-08-28)
> decided the per-entity handler contract this gap needs; building the handlers,
> `sync_changes` emission, and revision increment is P3.7's remaining, unstarted work.
>
> **One further, real gap surfaced by this re-read**: `sync_operations.operation_type` is
> constrained to six coarse values (`CREATE/UPDATE/SOFT_DELETE/EVENT/COMMAND/CORRECTION` —
> confirmed via `pg_constraint`), not the fine-grained domain-operation allowlist AD-021
> defines (`ticket.create`, `inventory.adjust`, etc.). There is no live column for the
> fine-grained type yet. AD-021 did not decide how to reconcile this — a new column, or
> widening this CHECK — and that decision is still open for P3.7 implementation.

- **`sync_devices`** — `id`, `user_id`, `device_label`, `platform`, `app_version`,
	`last_seen_at`, `revoked_at`, `created_at`, `updated_at`. **Confirmed live 2026-08-28: no
	`tenant_id`, no `branch_id`** — this row previously listed both; that was stale and
	contradicted AD-005 (IMPLEMENTED), which already correctly states the columns were
	dropped. A registered client device is user-owned, not organization-bound; one device
	may serve several organizations (AD-005). Contains **no push token** — notifications
	need their own table.
- **`sync_changes`** — the server-side change feed, ordered by the `sequence_id` bigint
	primary key (not a separately named sequence — corrected 2026-08-28, confirmed live).
	Columns: `sequence_id, tenant_id, branch_id, entity_type, entity_id, operation_type,
	revision, changed_at, changed_by, payload`. Zero rows — nothing has ever been applied.
- **`sync_operations`** — inbound client operations, status `PENDING | APPLIED | REJECTED |
	CONFLICT`. Columns also include `applied_sequence_id`/`applied_at` (present but unused
	today — the future link to the `sync_changes` row an operation produced once applied)
	and `result jsonb`. `sync_validate_device()` returns the device's owning `user_id`
	only, **not** `TABLE(tenant_id, branch_id)` as `API-CONTRACT.md`'s RPC table still
	states — confirmed live 2026-08-28; a device has no tenant/branch to resolve since
	AD-005. `API-CONTRACT.md` needs the same correction; not made in this pass, flagged
	here per the spec-contradiction rule so it isn't lost.
- **`process_sync_batch(p_device_id uuid, p_operations jsonb)`** and
	**`process_sync_batch_context_validated(p_device_id uuid, p_operations jsonb, p_actor
	uuid)`** — the gateway RPCs, implemented (see the corrected note above). Signature
	corrected 2026-08-28 — previously documented as taking `(device_id, operations, tenant_id,
	branch_id)`, which does not match the live function and cannot: each operation in the
	batch carries its own `tenant_id`/`branch_id`, since one batch may legitimately span
	organizations (AD-006).
- **`sync_validate_device(p_device_id uuid)`** — returns `uuid`, the device's owning
	`user_id`, after confirming the caller owns it and it is not revoked. Corrected
	2026-08-28 — previously documented as returning `TABLE(tenant_id, branch_id)`, which is
	impossible now that `sync_devices` carries neither column (AD-005). It does **not**
	check organization membership; that happens in
	`process_sync_batch_context_validated()` via `is_member_of()`/`is_authorized_for_branch()`
	against each operation's own `tenant_id`/`branch_id`, not in this function.
- Ordering columns on `tickets`: `device_created_at` (client clock), `server_received_at` (server clock), `revision` (monotonic counter, now actually incremented — see below). `cash_sessions` also carries a revision, bumped by `bump_cash_session_revision()`.

### P3.7, first vertical slice — implemented and live-verified 2026-08-28

`tests/sql/p3_7_sync_apply_and_pull.sql`, 11/11. Builds on the gateway above without
modifying it (its own body is byte-identical except one additive field capture, noted
below).

- **`sync_conflicts`** — the server table AD-021 decided, not a client-only projection.
	`id, tenant_id, branch_id, entity_type, entity_id, operation_id (UNIQUE, FK to
	sync_operations), actor_id, device_id, operation_type, operation_payload, base_revision,
	current_revision, conflict_code, conflict_status (OPEN|RESOLVED|DISMISSED), created_at,
	resolved_at, resolved_by, resolution_type, resolution_payload`. RLS forced: visible to
	the operation's own `actor_id` or to `owner/admin/branch_manager` in that tenant;
	resolution (`UPDATE`) restricted to the same manager tier, `WITH CHECK (resolved_by =
	auth.uid())` — the same authorship-forgery class of bug fixed on `expenses_insert`
	earlier this project. No `INSERT` grant for `authenticated` at all — written only by the
	`SECURITY DEFINER` apply path.
- **`domain_operation`** — new nullable `text` column on both `sync_operations` and
	`sync_changes`, CHECK-constrained to AD-021's finite allowlist. Added rather than
	widening the existing coarse `operation_type` CHECK (`CREATE/UPDATE/SOFT_DELETE/EVENT/
	COMMAND/CORRECTION`), which stays exactly as it was — `archive_ticket()`, its only other
	producer, is untouched. `process_sync_batch_context_validated()` gained one additive
	line capturing this field from the operation envelope; every pre-existing line
	(idempotency, authorization, conflict detection) is unchanged, re-verified against
	`tests/sql/security_multiorg_sync.sql` (22/23 — the one failure is `rate_limit_events`
	having no RLS policies, pre-existing and unrelated).
- **`apply_sync_operation(p_operation_id uuid)`** — the dispatcher, fired by a new `AFTER
	INSERT ON sync_operations` trigger (`sync_operations_dispatch`, `WHEN (NEW.status IN
	('PENDING','CONFLICT'))`). A `CONFLICT` row gets a `sync_conflicts` entry with the
	original payload preserved; a `PENDING` row with a known `domain_operation` dispatches
	to a handler; anything else — no handler built yet, or no `domain_operation` supplied —
	becomes `REJECTED` with `error_code = 'unsupported_operation_type'`, never left silently
	`PENDING`. **Never lets a handler's exception escape**: one bad operation in a batch
	cannot roll back the others (OFFLINE-SYNC-MODEL.md §23).
- **`apply_ticket_create(p_operation sync_operations)`** and
	**`apply_ticket_item_update(p_operation sync_operations)`** — the first two handlers.
	Both are `SECURITY DEFINER` and re-implement the equivalent of `tickets_insert`/
	`ticket_items_insert`'s RLS role gate themselves, via the new `has_role_in(actor,
	tenant, roles)` — **not** by relying on that RLS, which keys off `current_tenant_id()`/
	`has_role()`, both scoped to the caller's *active* organization (AD-003) and therefore
	wrong for a cross-org offline operation. `apply_ticket_item_update()` does not insert
	`ticket_items.line_total` — confirmed live via `information_schema.columns.is_generated`
	that it is `GENERATED ALWAYS AS (round(quantity * unit_price, 4)) STORED`, not a plain
	column; a first attempt that included it failed `428C9`.
- **`has_role_in(p_actor uuid, p_tenant uuid, p_role_keys text[])`** — new, mirrors
	`is_authorized_for_branch()`'s existing owner/admin query shape. Also fixed a real,
	previously-dormant bug this surfaced: `guard_driver_created_order_assignment()` called
	`has_role(['driver'])` (active-org-scoped) instead of a tenant-parameterized check —
	silently wrong only for a `tenant_id != current_tenant_id()` write, which no path could
	produce before P3.7's handlers existed. Fixed to call `has_role_in(auth.uid(),
	NEW.tenant_id, ...)`; re-verified against `tests/sql/driver_field_sale_rls.sql` (8/8,
	no regression) plus a direct online-case check (driver-created ticket still
	self-assigns).
- **`bump_ticket_revision()`** — new `BEFORE UPDATE ON tickets` trigger, named
	`tickets_bump_revision` to sort alphabetically ahead of `tickets_guard_status_
	transition`/`tickets_set_updated_at`, mirroring `bump_cash_session_revision()`'s exact
	body and trigger-ordering precedent. `tickets.revision` defaulted to `1` and was never
	incremented by anything before this — confirmed live via `pg_proc` grep (only
	`archive_ticket()` referenced it, and only to read it).
- **`sync_pull(p_device_id uuid, p_cursor bigint DEFAULT 0, p_page_size int DEFAULT 200)`**
	— the previously-entirely-absent pull RPC. Deliberately `SECURITY INVOKER`: it does not
	reimplement authorization. Device ownership/revocation is checked by calling the
	existing, unmodified `sync_validate_device()`; tenant membership, branch access, and
	"caller has a live device" are enforced by the existing, unmodified `sync_changes_select`
	RLS policy, inherited by running as the caller. Returns
	`{changes: [...], next_cursor, has_more}`.

**Not built by this slice:** inventory/production/financial/customer handlers (each
`REJECTED unsupported_operation_type` until built); `CURSOR_TOO_OLD`/`FULL_RESYNC_REQUIRED`;
and the gaps below that predate this slice and are unchanged by it.

### What the deployed schema does provide

The table design is genuinely good and satisfies much of `OFFLINE-SYNC-MODEL.md`:

| Requirement | Deployed support |
|---|---|
| §12 stable idempotency key | `sync_operations.operation_id` UNIQUE, plus UNIQUE `(device_id, operation_id)` |
| §18 server revision | `sync_changes.revision`, UNIQUE `(entity_id, revision)`, CHECK `revision > 0` |
| §25/§27 pull cursor and ordering | `sync_changes.sequence_id` — a monotonic bigint PK, the natural cursor |
| §31 conflict classes | `sync_operations.status` CHECK `PENDING/APPLIED/REJECTED/CONFLICT`, plus `error_code`/`error_message` |
| §61 optimistic concurrency | `sync_operations.base_revision`, CHECK `> 0` when present |
| §73 three distinct times | `device_created_at` (capture) vs `received_at` (server) vs `sync_changes.changed_at` |
| §33/§65 event semantics and tombstones | `operation_type` CHECK includes `CREATE/UPDATE/SOFT_DELETE/EVENT/COMMAND/CORRECTION` |
| §45/§46 device identity and revocation | `sync_devices.revoked_at`, enforced by `sync_validate_device()` |
| §47 permission recheck at sync time | corrected 2026-08-28 — not `sync_validate_device()` (device ownership/revocation only). `process_sync_batch_context_validated()` re-verifies live `user_roles` membership and branch access per operation via `is_member_of()`/`is_authorized_for_branch()`, re-read live and confirmed to match AD-008's branch-before-owner order |
| §21 cross-org binding | corrected 2026-08-28 — no FK on `sync_devices` (it has no `tenant_id`/`branch_id` to bind, per AD-005). Enforced instead per-operation: `is_authorized_for_branch()` requires the target branch's own `tenant_id` to match the operation's `tenant_id` before any owner/admin shortcut is consulted, so a branch id from another tenant is never authorized |

### What is missing

- ~~No pull RPC at all.~~ **Resolved 2026-08-28** — `sync_pull()` exists and is
	live-verified (see the P3.7 section above). What's still missing from §22/§66/§67: no
	`CURSOR_TOO_OLD` → `FULL_RESYNC_REQUIRED` path, and no tombstone-retention guarantee
	(last bullet below) for a client resuming after a very long gap.
- **Idempotency lookup is not tenant-bound, though the live function does not leak
	across tenants.** §13 says explicitly: *"Never use only `operation_id` without tenant
	binding."* The live UNIQUE constraint and lookup are both global on `operation_id`
	alone (`UNIQUE (operation_id)`, plus `UNIQUE (device_id, operation_id)`). **Re-read
	live 2026-08-28:** `process_sync_batch_context_validated()` does check the found row's
	`tenant_id` (and `actor_id`/`device_id`/`entity_id`/`operation_type`) against the
	incoming operation and **refuses** a mismatch (`42501`) rather than returning the
	stored result — so a cross-tenant replay collision fails closed, it does not leak
	another tenant's `result`. The residual gap is availability, not confidentiality: two
	different tenants can never legitimately reuse the same `operation_id` (astronomically
	unlikely for a UUID, but structurally possible), and the lookup should still move to a
	composite `(tenant_id, operation_id)` key so that isn't even a theoretical class of bug.
- **No payload-immutability check** (§15). Nothing stores a payload hash, so the same `operation_id` resubmitted with a different payload cannot be detected.
- **No `client_sequence`** (§16) and **no `depends_on_operation_id`** (§49), so device-local ordering and dependency chains (create customer → create ticket referencing it) have nowhere to live.
- **No `ALREADY_APPLIED` status** (§24) — the CHECK allows only four values, so a replay cannot be distinguished from a first application in the stored row.
- ~~No fine-grained domain-operation type.~~ **Resolved 2026-08-28** — the new
	`domain_operation` column (see the P3.7 section above) carries AD-021's fine-grained
	allowlist; the coarse `operation_type` CHECK is untouched. Handlers exist today only for
	`ticket.create`/`ticket.item_update`; every other allowlisted value is accepted by the
	CHECK but `REJECTED unsupported_operation_type` at dispatch until its handler is built.
- **No retention policy** for `sync_changes` tombstones (§66).

## 13. Daily financial audits

`daily_financial_audits` is the end-of-day cash count per branch, and a control that no existing doc describes.

- Columns include `tenant_id`, `branch_id`, `audit_date`, `opening_balance`, `expected_cash`, `physical_cash`, `variance`, `status`, `submitted_by`, `confirmed_by`, `confirmed_at`. UNIQUE `(tenant_id, branch_id, audit_date)`.
- Money columns are `NUMERIC(19,4)`; CHECK `variance = physical_cash - expected_cash`.
- Status: `DRAFT | PENDING_SYNC | REQUIRES_RECONCILIATION | CONFIRMED | REJECTED`. Note these are UPPERCASE, unlike every other status column in the schema.
- `guard_daily_financial_audit_mutation()` blocks DELETE; freezes `tenant_id`/`branch_id`/`audit_date`/`submitted_by`; refuses any change once `CONFIRMED` or `REJECTED`; requires owner/admin/branch_manager to confirm or reject; and enforces **segregation of duties — `confirmed_by` may not equal `submitted_by`**.
- Permissions: `financial.audit.submit` (owner, admin, branch_manager, supervisor, cashier, accountant) and `financial.audit.confirm` (owner, admin, branch_manager, accountant).
