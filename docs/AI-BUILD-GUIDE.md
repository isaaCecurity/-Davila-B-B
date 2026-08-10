# BakeFlow — AI-Assisted Implementation Guide (Claude Code)

> ## ⚠️ These six phases are already built
>
> This guide was written to drive the initial build. **That build has happened.** The live database (`tvfyxpafbpnkneujcnvr`) contains all 38 tables, ~65 functions, and 101 RLS policies covering every phase below. Running these prompts against production would attempt to re-create existing objects.
>
> **Keep this document for the phase structure and prompt style, not as a to-do list.** If you are adding a *new* domain (notifications, reporting, purchasing), copy the shape of a phase prompt — but take the actual specification from the concrete docs in §1, never from the EB chapters, and confirm against the live schema first.
>
> The repo also cannot currently rebuild that database: the baseline migration is an empty file. Read `PROJECT-OVERVIEW.md` §7 before touching migrations.

This document instructs an AI coding agent (like Claude Code) on how to extend the BakeFlow Supabase PostgreSQL backend incrementally.

BakeFlow is a mobile-first operational management platform for independent bakeries using a multi-tenant model. To ensure high data integrity, strict multi-tenant isolation, and complete financial correctness, **do not attempt to implement a whole domain at once.** Work in phases, verifying each before starting the next.

---

## 1. Reference Blueprint Documents

**Read the concrete `docs/*.md` files first.** They contain the actual tables, columns, RPC signatures, and policies. The EB chapters are *prose standards* — `CLAUDE.md` records that they contain almost no `CREATE TABLE` DDL, so instructing an agent to "match EB-011 exactly" sends it looking for column lists that do not exist.

| Phase / Focus | Read first (concrete) | Deep reference (prose, optional) |
|---|---|---|
| **High-Level Context** | `docs/PROJECT-OVERVIEW.md` | — |
| **Tables & columns** | `docs/SCHEMA-REFERENCE.md` | EB-007, EB-011, EB-016A/B |
| **RLS policies, JWT claims** | `docs/RLS-POLICY-PATTERNS.md` | EB-008, EB-010, EB-012 |
| **RPCs, errors, read conventions** | `docs/API-CONTRACT.md` | EB-009, EB-017 |
| **Status transitions** | `docs/STATE-MACHINES.md` | EB-013 Appendix A |
| **Roles & permissions** | `docs/ROLES-AND-PERMISSIONS.md` | — (supersedes EB-013 §3) |
| **What to test** | `docs/TESTING-STRATEGY.md` | EB-019 |

---

## 2. Core Architectural Rules for the AI

Every prompt given to Claude Code should reinforce these non-negotiable rules:
1. **Multi-Tenant Isolation:** Every tenant-scoped table MUST have `tenant_id UUID NOT NULL REFERENCES organizations(id)`, **set explicitly by the application on every insert**. Do **not** add `DEFAULT (auth.jwt() ->> 'tenant_id')::uuid` — a JWT-derived default breaks silently for service-role operations, migrations, and seeds, and is forbidden by `CLAUDE.md` rule 3, `SCHEMA-REFERENCE.md`, and `RLS-POLICY-PATTERNS.md` §1.6/§10. RLS is the enforcement layer; the explicit value is the source of truth. Audit check `A5` fails any table that carries such a default.
2. **No Money as Float:** All monetary columns MUST use `NUMERIC(19,4)`. Quantities are `NUMERIC(18,4)`, percentages `NUMERIC(5,2)`.
3. **No Hard Deletes:** Business-critical operational data is immutable or soft-deleted via `deleted_at`/`deleted_by`, never silently removed. See `SCHEMA-REFERENCE.md` §11.
4. **Primary Keys:** Every primary key MUST be a `UUID` defaulting to `gen_random_uuid()`.
5. **The entity is Ticket, not Order.** Tables are `tickets`/`ticket_items`; FKs are `ticket_id`. Some existing RPC arguments are named `p_order_id` for historical reasons — match the existing convention when editing those functions, and use `ticket` everywhere new.

---

## 3. The Build Roadmap (historical)

The six phases below were executed to produce the current schema. They are retained as a record of the intended build order and as a template for new work. **Verify against the live database before running any of them.**

---

### Phase 1: Core Organization & User Profiles
*Sets up the tenant root, branch, and user profile management (linked to Supabase auth.users).*

#### Prompt for Claude Code (Phase 1):
```markdown
Context: We are starting the implementation of the BakeFlow backend on Supabase.
Goal: Implement Phase 1 of the database schema (Organizations, Branches, and User Profiles).

Refer to these files in the repository:
1. `docs/PROJECT-OVERVIEW.md` (for the tenant model context)
2. `docs/engineering-bible/EB-011-Database-Schema-Domain-Model-Standards.md`
3. `docs/engineering-bible/EB-008-Supabase-Architecture-Standards.md`
4. `docs/engineering-bible/EB-016A-Database-Implementation-Reference.md`

Tasks:
1. Write the SQL DDL to create the following tables in the public schema:
   - `organizations` (the root tenant boundary)
   - `branches` (scoped to an organization)
   - `profiles` (extends `auth.users`, mapping a user to a tenant_id and a primary branch_id)
2. Ensure all columns match the specification in EB-011 exactly:
   - Primary keys are UUIDs.
   - Use correct defaults and foreign keys.
3. Implement a PostgreSQL function and trigger on `auth.users` that automatically creates a `public.profiles` row when a new user signs up in Supabase.
4. Enable Row-Level Security (RLS) on `organizations`, `branches`, and `profiles`. Write the initial RLS policies based on `auth.jwt() ->> 'tenant_id'` to isolate tenants completely.

Please generate the migrations or SQL script, explain the design, and write a verification script to test that:
- Trigger creates profiles correctly.
- RLS isolates organizations correctly.
```

---

### Phase 2: Role-Based Access Control (RBAC) & Invites
*Establishes user roles, branch-level assignments, and tenant invitation workflows.*

#### Prompt for Claude Code (Phase 2):
```markdown
Context: Phase 1 is complete. Now we need to implement Roles, Branch Assignments, and Member Invitations.
Goal: Implement Phase 2 of the database schema (RBAC & Identity).

Refer to these files:
1. `docs/engineering-bible/EB-011-Database-Schema-Domain-Model-Standards.md`
2. `docs/engineering-bible/EB-012-Authentication-Authorization-Security-Architecture.md`
3. `docs/engineering-bible/EB-016A-Database-Implementation-Reference.md`

Tasks:
1. Write SQL DDL to create:
   - `roles` (pre-defined platform roles: Owner, Admin, Branch Manager, Supervisor, Baker, Cashier, Driver, Accountant — see `docs/ROLES-AND-PERMISSIONS.md` §4 for the live `rank` values)
   - `permissions` and `role_permissions` (the permission catalog read by `has_permission()`)
   - `user_roles` (junction table linking profile to role, scoped by `tenant_id`)
   - `branch_assignments` (linking profiles to branches for multi-branch assignment)
   - `organization_invites` (for inviting new staff members to an organization)
2. Implement database-level functions:
   - A secure function to update JWT claims in Supabase Auth custom claims so `tenant_id` and `role` are embedded inside the user session token (refer to EB-008 and EB-012 standards).
3. Enable RLS on all tables and define policies ensuring:
   - Only Owners and Admins of the tenant can create roles or invite members.
   - Users can only read their own roles and branch assignments.

Generate the SQL migration and explain how the custom JWT claims sync works.
```

---

### Phase 3: Catalog & Recipes (Product Domain)
*Sets up the sellable catalog, categories, ingredients, and the recipes governing production.*

#### Prompt for Claude Code (Phase 3):
```markdown
Context: Core auth and tenant profiles are complete. Now we need to establish the catalog of Products, Ingredients, and Recipes.
Goal: Implement Phase 3 of the database schema (Product Domain).

Refer to these files:
1. `docs/engineering-bible/EB-006-Domain-Model-Ubiquitous-Language.md` (Section 5)
2. `docs/engineering-bible/EB-011-Database-Schema-Domain-Model-Standards.md`
3. `docs/engineering-bible/EB-016A-Database-Implementation-Reference.md`

Tasks:
1. Write the SQL DDL to create the following tables (ensure all are scoped by `tenant_id`):
   - `product_categories`
   - `products` (sellable items)
   - `product_variants` (SKU level: e.g., Medium Bread, Family Size)
   - `ingredients` (raw materials used in recipes)
   - `recipes` (standardized specification for manufacturing variants)
   - `recipe_ingredients` (junction table defining bill of materials - BOM)
2. Ensure correct constraints:
   - Product pricing must be `NUMERIC(19,4)`.
   - SKU codes must be unique within a tenant.
3. Enable RLS on all these tables. Write policies allowing:
   - All employees of the tenant to read catalog and recipes.
   - Only authorized roles (Owner, Admin, Branch Manager — there is no "Production Manager" role) to create, update, or delete products and recipes. Prefer the `products.manage` / `pricing.manage` permission keys over hard-coded role lists.

Please provide the SQL migration and explain the foreign key mappings.
```

---

### Phase 4: Inventory & Stock Movements
*Implements localized warehouse storage, real-time stock levels, and historical stock movements.*

#### Prompt for Claude Code (Phase 4):
```markdown
Context: Phase 3 is complete. Now we need to manage physical stock levels.
Goal: Implement Phase 4 of the database schema (Inventory Domain).

Refer to these files:
1. `docs/engineering-bible/EB-011-Database-Schema-Domain-Model-Standards.md`
2. `docs/engineering-bible/EB-016A-Database-Implementation-Reference.md`
3. `docs/engineering-bible/EB-013-Business-Rules-Operational-Workflows-Domain-Logic.md`

Tasks:
1. Write the SQL DDL for:
   - `warehouses` (scoped to a `branch_id`)
   - `ingredient_stock_levels` (current physical stock of ingredients per warehouse)
   - `product_stock_levels` (current physical stock of finished goods per branch/warehouse)
   - `stock_movements` (immutable ledger of stock increases/decreases with reasons: purchase, consumption, waste, adjustment)
2. Create PostgreSQL triggers/functions:
   - A function that automatically updates the corresponding row in `ingredient_stock_levels` or `product_stock_levels` whenever a new row is inserted into `stock_movements`. Stock levels must never be updated directly — always through inserting a movement.
3. Enable RLS on all tables, isolating data by `tenant_id`. Policies must verify branch-level access (e.g., users assigned to Branch A can only view/adjust stock for Branch A warehouses).

Provide the SQL migration and explain how stock levels remain consistent with movements.
```

---

### Phase 5: Sales Orders & Payments
*Handles custom/retail orders, billing, payments, and the customer database.*

#### Prompt for Claude Code (Phase 5):
```markdown
Context: Core catalog and stock tracking are complete. Now we implement commercial transactions.
Goal: Implement Phase 5 of the database schema (Sales & Financial Domains).

Refer to these files:
1. `docs/engineering-bible/EB-011-Database-Schema-Domain-Model-Standards.md`
2. `docs/engineering-bible/EB-016B-Database-Implementation-Reference.md`
3. `docs/engineering-bible/EB-005-Financial-Integrity-Principles.md`

Tasks:
1. Write the SQL DDL for:
   - `customers` (guest/anonymous profile or registered)
   - `tickets` (scoped to `branch_id`, tracking the full 10-state machine: draft, submitted, confirmed, scheduled, in_production, ready, delivered, completed, cancelled, archived — see `docs/STATE-MACHINES.md` §1)
   - `ticket_items` (scoped to `tickets`, tracking quantity and price)
   - `invoices` (billing document linked to a ticket)
   - `payments` (linked to invoices or customer credit, tracking cash, card, transfer)
2. Ensure financial invariants:
   - Prices, totals, discounts, taxes must be `NUMERIC(19,4)`.
   - Prevent updating ticket items once a ticket is marked ready, completed, or cancelled.
3. Enable RLS on these tables scoped by `tenant_id` and `branch_id`.
4. Do **not** transition ticket state from payment status. Payment is not a state: a ticket can be paid while in production, or completed while unpaid on credit. `docs/STATE-MACHINES.md` §1 calls this conflation the most common way this schema gets corrupted. Track `amount_paid` independently.

Provide the SQL script and detail how monetary rounding calculations are protected.
```

---

### Phase 6: Production, Deliveries, & Cash Till Sessions
*Sets up manufacturing batches, delivery logistics, and cash drawer auditing.*

#### Prompt for Claude Code (Phase 6):
```markdown
Context: The commercial and inventory systems are fully in place. We now require production execution, logistics, and retail cash reconciliation.
Goal: Implement Phase 6 of the database schema (Production, Delivery, & Cash domains).

Refer to these files:
1. `docs/engineering-bible/EB-011-Database-Schema-Domain-Model-Standards.md`
2. `docs/engineering-bible/EB-013-Business-Rules-Operational-Workflows-Domain-Logic.md`
3. `docs/engineering-bible/EB-016B-Database-Implementation-Reference.md`

Tasks:
1. Write the SQL DDL for:
   - `production_batches` (tracks batch status: scheduled, in_progress, completed, failed)
   - `production_batch_ingredients` (records actual ingredient quantities consumed during a batch)
   - `deliveries` (tracks shipping details, routes, drivers, and Proof of Delivery)
   - `cash_sessions` (till sessions tracking starting cash, actual sales, expenses, and variance during checkout)
2. Write functions and triggers:
   - Completing a `production_batch` must automatically insert `stock_movements` to consume ingredients (BOM) and insert finished products into inventory.
   - Cash sessions must prevent deletion and track all opening/closing adjustments.
3. Apply RLS policies to restrict:
   - Production actions to Bakers and Managers.
   - Deliveries to assigned Drivers.
   - Cash sessions to the active Cashier of that specific branch till.

Provide the final database migrations, explain the state machines, and outline how the system prevents negative inventory during batch consumption.
```

---

## 4. Operational Best Practices with Claude Code

- **Apply Migrations Iteratively:** Run each phase's SQL script on your Supabase development database, verify the schema is updated, and check that no RLS policy blocks basic operations.
- **Run the Spec Verification Suite:** After completing all database schema migrations, execute `pytest` in your repository to ensure that all requirement IDs remain unique and no naming invariants have been broken. Note that `pytest` only lints Markdown — it does not touch the database. For the database, run `tests/db_security_audit.sql` and the `verify_*()` functions listed in `SCHEMA-REFERENCE.md` §9.
- **Maintain a Clean Workspace:** Ensure Claude Code does not leave any compiled `.pyc` files or cache artifacts staged in git. Keep the repository as clean as specified in `.gitignore`.
