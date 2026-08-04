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
| reference_type | TEXT | 'order', 'production_batch', 'purchase' |
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

### `orders`

| Column | Type | Notes |
|---|---|---|
| id, tenant_id | | |
| branch_id | UUID NOT NULL FK | |
| customer_id | UUID FK | NULL for anonymous walk-in |
| order_number | TEXT NOT NULL | UNIQUE (tenant_id, order_number) |
| status | TEXT NOT NULL DEFAULT 'draft' | CHECK IN ('draft','confirmed','in_production','ready','completed','cancelled') |
| fulfilment_type | TEXT NOT NULL | CHECK IN ('pickup','delivery') |
| due_at | TIMESTAMPTZ | |
| subtotal_amount | NUMERIC(19,4) NOT NULL DEFAULT 0 | |
| discount_amount | NUMERIC(19,4) NOT NULL DEFAULT 0 | CHECK >= 0 |
| tax_amount | NUMERIC(19,4) NOT NULL DEFAULT 0 | CHECK >= 0 |
| total_amount | NUMERIC(19,4) NOT NULL DEFAULT 0 | CHECK >= 0 |
| amount_paid | NUMERIC(19,4) NOT NULL DEFAULT 0 | Maintained by trigger from `payments` |
| cancelled_reason | TEXT | |
| [std] | | |

CHECK: `total_amount = subtotal_amount - discount_amount + tax_amount`.

### `order_items`

| Column | Type | Notes |
|---|---|---|
| id, tenant_id | | |
| order_id | UUID NOT NULL FK | ON DELETE CASCADE |
| product_variant_id | UUID NOT NULL FK | ON DELETE RESTRICT |
| quantity | NUMERIC(18,4) NOT NULL | CHECK > 0 |
| unit_price | NUMERIC(19,4) NOT NULL | **Snapshot at time of order.** Never read live from the variant. |
| line_total | NUMERIC(19,4) NOT NULL | CHECK `= ROUND(quantity * unit_price, 4)` |
| [std] | | |

### `invoices`
id, tenant_id, `branch_id NOT NULL`, `order_id NOT NULL FK UNIQUE`, `invoice_number TEXT NOT NULL` (UNIQUE per tenant), `issued_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `due_at TIMESTAMPTZ`, `total_amount NUMERIC(19,4) NOT NULL`, `status TEXT NOT NULL DEFAULT 'issued'` CHECK IN ('draft','issued','paid','partially_paid','void'), [std].

### `payments`

| Column | Type | Notes |
|---|---|---|
| id, tenant_id | | |
| branch_id | UUID NOT NULL FK | |
| order_id | UUID FK | |
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
| order_id | UUID FK | NULL for stock-building batches |
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
| order_id | UUID NOT NULL FK UNIQUE | |
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

## 9. Required functions and triggers

| Name | Type | Purpose |
|---|---|---|
| `set_updated_at()` | BEFORE UPDATE trigger | Sets `updated_at = now()`. Attached to every table. |
| `handle_new_user()` | AFTER INSERT on `auth.users` | Creates the matching `profiles` row. SECURITY DEFINER. |
| `apply_stock_movement()` | AFTER INSERT on `stock_movements` | Upserts the matching stock level row. The only writer of level tables. |
| `prevent_stock_movement_mutation()` | BEFORE UPDATE OR DELETE on `stock_movements` | Raises unconditionally. |
| `recalculate_order_totals()` | AFTER INSERT/UPDATE/DELETE on `order_items` | Recomputes subtotal and total on the parent order. |
| `apply_payment_to_order()` | AFTER INSERT on `payments` | Updates `orders.amount_paid` and invoice status. |
| `guard_order_item_mutation()` | BEFORE INSERT/UPDATE/DELETE on `order_items` | Raises if parent order status is ready, completed, or cancelled. |
| `complete_production_batch()` | RPC (SECURITY DEFINER) | Atomically: validates stock, inserts consumption movements, inserts output movement, sets status. Raises on insufficient stock. |
| `close_cash_session()` | RPC (SECURITY DEFINER) | Computes expected, records counted, sets variance, closes. Requires a note when variance ≠ 0. |
| `sync_jwt_claims()` | Auth hook | Embeds `tenant_id` and role keys into the access token. |

**Negative stock:** `apply_stock_movement()` raises if the resulting `quantity_on_hand` would be below zero for a movement with `reason IN ('production_consume','sale')`. Adjustments and waste may go negative only if the tenant has explicitly enabled it — default is deny.

---

## 10. Build order

Tables must be created in this order for foreign keys to resolve. It matches the phases in `AI-BUILD-GUIDE.md`.

1. `organizations` → `branches` → `profiles` → `roles`
2. `user_roles` → `branch_assignments` → `organization_invites`
3. `product_categories` → `products` → `product_variants` → `ingredients` → `recipes` → `recipe_ingredients`
4. `warehouses` → `stock_movements` → `ingredient_stock_levels` → `product_stock_levels`
5. `customers` → `orders` → `order_items` → `invoices` → `cash_sessions` → `payments` → `refunds`
6. `production_batches` → `production_batch_ingredients` → `deliveries` → `expenses` → `audit_log`

> `cash_sessions` is created in phase 5 rather than 6 because `payments.cash_session_id` references it.
