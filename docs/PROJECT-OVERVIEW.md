# BakeFlow — Project Overview & Business Logic

**Read this document first**, before any file in `docs/engineering-bible/`. Those documents define detailed engineering standards; this document explains *what BakeFlow is and why it works the way it does*, so that every downstream decision (schema, API, UI) has the right context behind it.

---

## 1. What BakeFlow Is

BakeFlow is an **operational management platform for bakeries** — not just an accounting or expense-tracking app. Its job is to coordinate the things a real bakery actually runs on: people, production, inventory, orders, deliveries, and money — into a single connected system.

Financial reporting is an *output* of running the business correctly through BakeFlow, not the primary feature. A bakery owner who uses BakeFlow to record orders and manage inventory should get accurate financial visibility "for free," without needing bookkeeping knowledge.

**Target user:** independent bakery owners and their staff, starting in the Nigerian market. Most target users are not accountants and may be running the business primarily from a phone.

**Platform:** mobile-first (React Native + Expo), backed by Supabase (PostgreSQL, Auth, Storage).

---

## 2. The Problem BakeFlow Solves

Bakery owners currently juggle several disconnected tools and habits: a notebook or spreadsheet for orders, WhatsApp for taking customer requests, guesswork for ingredient stock levels, and little to no real financial visibility until something goes wrong (they run out of an ingredient mid-production, underprice a custom order, or can't tell if they're actually profitable).

BakeFlow connects these steps so that one action (e.g. confirming an order) automatically informs the others (ingredient stock is checked and reserved, a production task is created, and the expected revenue is reflected in financial reporting) — without the owner having to manually reconcile everything at the end of the month.

---

## 3. The Organizational Model (Tenant Hierarchy)

This is the structural backbone of the entire system, and every table, API endpoint, and permission check depends on it.

```
Organization  (the tenant — one bakery business)
    │
    └── Branch  (a physical location or operating unit)
            │
            ├── Employees        (staff assigned to that branch)
            ├── Inventory        (ingredients & stock, scoped to the branch)
            ├── Production       (batches made at that branch)
            ├── Orders           (customer orders fulfilled from that branch)
            ├── Deliveries       (dispatched from that branch)
            └── Cash Sessions    (till/reconciliation, per branch)
```

**Organization is the tenant boundary.** Every piece of data in BakeFlow belongs to exactly one Organization, and Organizations are completely isolated from one another (enforced via Row-Level Security in Postgres). A single-location bakery has one Organization with one Branch; a growing bakery can add more Branches under the same Organization without re-onboarding.

**Canonical naming for implementation:**
- The tenant-scoping column on every tenant-owned table is `tenant_id`, referencing `organizations.id`.
- Branch-scoped tables additionally carry a `branch_id`, referencing `branches.id`.
- Do not use `bakery_id` or `company_id` — both appeared in earlier drafts of these documents and have been superseded by the Organization → Branch model above.

> **Note on document history:** Earlier drafts of the engineering-bible documents used inconsistent terms for this concept ("Bakery," "Company," `bakery_id`, `company_id`, `organization_id`). These have all been resolved: **Organization → Branch is the confirmed model, and `tenant_id` is the canonical tenant-scoping column everywhere**, including in the implementation references (`EB-016A`/`EB-016B`) and in JWT claims (`auth.jwt() ->> 'tenant_id'`). The naming-consistency tests in `tests/test_spec_coverage.py` guard this. If any document appears to contradict this model, this document is authoritative — and the contradiction should be treated as a bug and fixed.

---

## 4. Core User Journey

A typical flow through the product, end to end:

1. **Owner signs up** → creates an Organization → creates its first Branch.
2. **Owner sets up the catalog** → adds Products and Recipes (a Recipe links a Product to the Ingredients and quantities required to make it).
3. **Owner or staff records Inventory** → starting stock of ingredients, with quantities and units.
4. **A customer places an Order** → staff enters it (or a future customer-facing channel creates it) → the Order references Products, and the system checks whether enough ingredient stock exists to fulfill it.
5. **Production happens** → a Production Batch is created against the Order/Recipe, which consumes ingredient stock and produces finished Product stock.
6. **Order is fulfilled** → via pickup or Delivery, tracked per Branch.
7. **Payment is recorded** → against the Order, which updates the branch's cash/financial position.
8. **Expenses are logged separately** (ingredient purchases, rent, utilities) as they occur.
9. **Owner views dashboards** → revenue, expenses, inventory levels, and profitability — all derived from steps 1–8, not manually re-entered.

Every one of the detailed EB documents (schema, API, business rules) exists to make one or more of these nine steps work correctly and safely.

---

## 5. Core Business Logic Principles

These five principles should override ambiguity anywhere else in the spec set:

1. **Multi-tenant isolation is non-negotiable.** No Organization can ever see another Organization's data. Every query, by default, is scoped by `tenant_id`.
2. **Money is never a float.** All monetary values use `NUMERIC(19,4)`. Rounding only happens at the point of final display or settlement, never mid-calculation.
3. **Operational correctness drives financial correctness**, not the other way around. If inventory and orders are tracked accurately, the financial picture falls out correctly — the system should never require manual financial reconciliation to "fix" numbers.
4. **Every significant business event is auditable.** Stock changes, order status changes, and payments should be traceable to who did what and when, permanently.
5. **The product should work for a non-accountant.** Every workflow should be understandable to a bakery owner with no bookkeeping background — this affects UI language and defaults more than the schema, but it should influence naming and error messages throughout.

---

## 6. Where to Find Detail — Reading Order for Claude Code

Read in roughly this order when building a given part of the system:

| Stage | Documents | Purpose |
|---|---|---|
| **1. Orientation** | This document | What the product is, why it's structured this way |
| **2. Foundations** | `EB-002`, `EB-003`, `EB-004`, `EB-005` | Engineering, architecture, security, and financial principles |
| **3. Domain language** | `EB-006` | Entity definitions and terminology |
| **4. Database** | `EB-007`, `EB-008`, `EB-011`, `EB-016A`, `EB-016B` | Schema, types, Supabase/RLS implementation |
| **5. Auth** | `EB-010`, `EB-012` | Identity, sessions, authorization |
| **6. Business logic** | `EB-013` | Operational workflows — the most detailed version of Section 4's user journey above |
| **7. API** | `EB-009`, `EB-017` | Backend contract |
| **8. Frontend** | `EB-014`, `EB-015`, `EB-018` | App structure, design system, screen specs |
| **9. Operations** | `EB-019` | CI/CD, environments, DevSecOps |
| **Not currently in scope** | `EB-020` | Enterprise-scale data governance content — set aside for MVP; see prior review notes |

---

## 7. Resolved Naming Decisions (Change Log)

All previously open terminology conflicts have been resolved. For the record:

- `EB-006` and `EB-020` previously used "Bakery" and "Company" as the tenant root — both now use **Organization** (verified by `tests/test_spec_coverage.py`).
- `EB-016A` and `EB-016B` previously used `organization_id` as the tenant-scoping column — both now use **`tenant_id`**, matching `EB-007`/`EB-011` and this document. The JWT tenant claim is likewise `tenant_id`.
- `EB-011` and `EB-016A` previously contained `NUMERIC(18,2)` in monetary contexts — the canonical monetary type is **`NUMERIC(19,4)`** everywhere (`NUMERIC(18,4)` remains correct for physical quantities, `NUMERIC(5,2)` for percentages).
- `EB-013`'s "Organization → Branches → Employees" hierarchy is the confirmed correct structure and is the reference implementation of Section 3 above.
- `EB-013` §3 ("User Roles...") is **outdated and superseded** by `docs/ROLES-AND-PERMISSIONS.md`. It described Web as the primary operational surface (reversed — Mobile is operational, Web is management/config/analytics), a standalone `Manager` role (renamed to Branch Manager), a fixed universal `Supervisor` permission set (Supervisor is optional and configured per-bakery by the Branch Manager), and a `Ticket` entity (the canonical entity is `Order`; there is no `tickets` table and none should be created).
- The Order state machine was expanded from 5 states to the full 8-state model per `EB-013` Appendix A (`draft → submitted → confirmed → scheduled → in_production → ready → delivered → completed`, plus `cancelled → archived`), and the `ready → delivered` transition now hard-requires the linked `deliveries` row to itself be `delivered` (pickup orders exempt). See `docs/STATE-MACHINES.md`.
- **Migration-sync gap (open, unresolved as of 2026-08-09):** the live Supabase database (project `tvfyxpafbpnkneujcnvr`) has migrations and schema changes that are **not** reflected in `supabase/migrations/` in this repository. Do not assume the committed migration files describe production. Before any further schema work, either (a) run `supabase db pull` against the live project to regenerate accurate migration files, or (b) treat direct database inspection (via the Supabase dashboard/CLI/MCP tools) as the source of truth over the committed `.sql` files. This applies in both directions — changes made directly against the live database also need to be captured back into version control, or the gap widens further.

If new conflicts are discovered during implementation, record the decision here and update the offending document in the same commit.
