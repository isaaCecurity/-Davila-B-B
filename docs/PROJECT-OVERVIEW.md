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

> **Note on document history:** Earlier engineering-bible documents (`EB-006`, `EB-011`, `EB-020`) used inconsistent terms for this concept — some called the tenant "Bakery," others called it "Company." **Organization → Branch is the confirmed, correct model.** If you are reading `EB-006` or `EB-020` and encounter "Bakery" or "Company" used as the tenant root, treat this document as authoritative and mentally substitute "Organization." These documents should be updated to match; see the reading-order table below.

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
| **3. Domain language** | `EB-006` | Entity definitions and terminology *(note: tenant terminology here is superseded — see Section 3 above)* |
| **4. Database** | `EB-007`, `EB-008`, `EB-011`, `EB-016A`, `EB-016B` | Schema, types, Supabase/RLS implementation |
| **5. Auth** | `EB-010`, `EB-012` | Identity, sessions, authorization |
| **6. Business logic** | `EB-013` | Operational workflows — the most detailed version of Section 4's user journey above |
| **7. API** | `EB-009`, `EB-017` | Backend contract |
| **8. Frontend** | `EB-014`, `EB-015`, `EB-018` | App structure, design system, screen specs |
| **9. Operations** | `EB-019` | CI/CD, environments, DevSecOps |
| **Not currently in scope** | `EB-020` | Enterprise-scale data governance content — set aside for MVP; see prior review notes |

---

## 7. Open Items

- `EB-006` and `EB-020` still reference "Bakery" and "Company" respectively as the tenant root — these should be edited to say "Organization" for full consistency with this document.
- `EB-013`'s "Organization → Branches → Employees" hierarchy is the confirmed correct structure and should be treated as the reference implementation of Section 3 above.
