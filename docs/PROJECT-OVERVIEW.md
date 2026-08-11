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

BakeFlow connects these steps so that one action (e.g. confirming a ticket) automatically informs the others (ingredient stock is checked, a production task is created, and the expected revenue is reflected in financial reporting) — without the owner having to manually reconcile everything at the end of the month.

> Earlier wording here said stock is "checked and **reserved**" on confirmation. No reservation mechanism exists in the schema — see the open items in §7. Stock is checked at production time, not held.

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
            ├── Tickets          (customer orders fulfilled from that branch)
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
4. **A customer places an order** → staff enters it as a **Ticket** (or a future customer-facing channel creates it) → the Ticket references Products, and the system checks whether enough ingredient stock exists to fulfill it.
5. **Production happens** → a Production Batch is created against the Ticket/Recipe, which consumes ingredient stock and produces finished Product stock.
6. **Ticket is fulfilled** → via pickup or Delivery, tracked per Branch.
7. **Payment is recorded** → against the Ticket, which updates the branch's cash/financial position.
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
- `EB-013` §3 ("User Roles...") is **outdated and superseded** by `docs/ROLES-AND-PERMISSIONS.md` on three points: it described Web as the primary operational surface (reversed — Mobile is operational, Web is management/config/analytics), a standalone `Manager` role (renamed to Branch Manager), and a fixed universal `Supervisor` permission set (Supervisor is optional and configured per-bakery by the Branch Manager). Its fourth claim — the `Ticket` entity — was **correct**; see the entry below.

- **Ticket vs Order — resolved 2026-08-09 in favour of Ticket.** Earlier revisions of this file, `CLAUDE.md`, and `ROLES-AND-PERMISSIONS.md` §5 asserted that the canonical sales entity was `Order`, that no `tickets` table existed, and that "ticket" should be normalized to "order" wherever found. Direct inspection of the live database contradicted all three: the deployed tables are **`tickets` and `ticket_items`**, every foreign key is `ticket_id`, the permission keys are `tickets.*`, and the RPCs are `confirm_ticket` / `cancel_ticket` / `complete_ticket` / `archive_ticket` / `update_ticket`. There is no `orders` table and never was one in production. Rather than rename a live schema, **Ticket is now canonical** and the documents were corrected to match. Normalize "order" → "ticket". One wart remains deliberately: several RPC arguments are named `p_order_id` while taking a `tickets.id`; renaming them would break the client contract. Guarded by `test_sales_entity_is_ticket_not_order` in `tests/test_spec_coverage.py`.

- **Ticket item freeze point — resolved in favour of `ready`.** `STATE-MACHINES.md` §1 claimed items become immutable at `confirmed`. The deployed `guard_ticket_item_mutation()` raises only when the parent is `ready`, `completed`, or `cancelled`, leaving items editable through `confirmed`, `scheduled`, and `in_production`. The deployed behaviour is authoritative and the document was corrected.

- **JWT hook name — resolved to `custom_access_token_hook(event jsonb)`.** `SCHEMA-REFERENCE.md` §9 previously named a `sync_jwt_claims()` function that does not exist in any environment.

- **`AI-BUILD-GUIDE.md` prescribed a forbidden `tenant_id` default.** Its §2 rule 1 mandated `DEFAULT (auth.jwt() ->> 'tenant_id')::uuid`, contradicting `CLAUDE.md` rule 3, `SCHEMA-REFERENCE.md`, and `RLS-POLICY-PATTERNS.md` §1.6/§10 — in the one document designed to be pasted into a coding agent. Removed, and guarded by `test_no_jwt_derived_tenant_id_default`.

- **The permission catalog exists.** `ROLES-AND-PERMISSIONS.md` §4 and `FRONTEND-STRUCTURE.md` §3 both stated no permission table existed. `permissions` (25 rows), `role_permissions` (93 grants), and `has_permission(text, uuid)` are all live. Documented in `ROLES-AND-PERMISSIONS.md` §4.

**Resolved 2026-08-10 by the clarification documents** (`BAKEFLOW-PROJECT-LOGIC-CLARIFICATION.md`, `REPORTING-MODEL.md`, `NOTIFICATIONS-SPEC.md`, `NOTIFICATION-DELIVERY-CHANNELS.md`, `OFFLINE-SYNC-MODEL.md`, `STORAGE-BUCKETS.md`, `SOFT-DELETE-AND-RETENTION.md`):

- **Offline writes — offline-first wins.** The `API-CONTRACT.md` §6 prohibition on queuing financial and stock writes is **withdrawn**. Offline operation is a first-class capability (clarification §9–§16, §57). Queued writes require stable `client_operation_id` idempotency, explicit organization/branch context carried on the queued operation itself, conflict records instead of last-write-wins, and encrypted local storage.
- **Refunds are financial events, and reporting derives the net result** (§30). A fully refunded ticket must remain distinguishable from "never paid" and from "paid and not refunded" — history is not rewritten to make either look tidy.
- **Costing is weighted-average** for MVP (§31). Not FIFO, not last-cost.
- **Reporting day is the organization's local calendar day** in its configured timezone (§28). Never sync time, never device timezone.
- **Revenue recognition follows `REPORTING-MODEL.md`**, not `payment_status = 'paid'` (§29).
- **Notification providers:** transactional email, Expo Push for mobile, separate SMS provider, approved WhatsApp channel — behind provider adapters (§35). Notification failure never fails the business operation (§33).
- **`tickets.update` / `tickets.cancel` granted to no role is deliberate**, following from the submitted-ticket immutability rule (§3). Not a defect.
- **Ticket immutability is hybrid** (product decision, 2026-08-10): money, items, and identity are frozen on submission; `status`, `assigned_to`, and `due_at` may still advance. See `STATE-MACHINES.md` §1.
- **Tax, discount, and unit conversion are out of scope** for now, by owner decision.

**Still open:**

- **Multi-organization users — DECIDED (yes) 2026-08-10; foundation migration written, not applied.** `supabase/migrations/20260810140000_multi_organization_membership.sql`. The audit found the membership model **already exists**: `user_roles (tenant_id, profile_id, role_id, branch_id)` is per-organization with soft delete and no constraint tying a profile to one tenant, so a user can already be Driver in A and Supervisor in B. Per the decision §22, no competing `organization_memberships` table was created. The dependency map explains why this is tractable: **100 of 101 RLS policies read the tenant through `current_tenant_id()`, and only 5 functions touch `profiles.tenant_id`** — so redefining what the helper resolves to leaves all 100 policies correct untouched. The design separates **membership** (`user_roles`, the security boundary) from **active organization** (`profiles.active_tenant_id`, UI context, §13); the token hook now mints the active organization *only when live membership backs it*, with roles scoped to that organization; `set_active_organization()` is the only validated switch path, backed by a guard trigger; and `accept_organization_invite()` becomes additive so accepting B no longer costs you A (§19). New `is_member_of()` queries tables rather than the claim, and is what the sync worker must use so a queued operation follows its original organization rather than the active one (§7, §9). Remaining: `create_organization_with_owner()`, the two guard functions, the sync worker itself, dropping the legacy column, and tests A–J. Listed explicitly at the end of that migration.
- **Superseded — original finding: one user = one organization was enforced in the database, and every clarification document assumed the opposite.** `profiles` has a single `tenant_id` column; `accept_organization_invite()` raises `'this user already belongs to a different organization'` when a profile's `tenant_id` differs from the invite's; `custom_access_token_hook()` mints a single `tenant_id` claim; and `current_tenant_id()` — which every RLS policy depends on — reads that one claim. Meanwhile `BAKEFLOW-PROJECT-LOGIC-CLARIFICATION.md` §19–§22, §45 and §60 state that a driver may belong to multiple organizations and call it "a major security boundary", and `OFFLINE-SYNC-MODEL.md` §7–§9 builds the entire offline queue-ownership model on per-organization device partitioning. **These cannot both stand.** Supporting multi-organization users is a schema-migration-scale change touching `profiles`, the JWT hook, `current_tenant_id()`, and therefore every RLS policy in the database. Resolve this before building notifications, offline sync, or reporting scope rules, because all three inherit the answer.
- **🔴 The offline sync gateway cannot process a single operation.** `process_sync_batch()` validates device and tenant/branch context correctly, then delegates to `process_sync_batch_context_validated()`, whose entire body raises `'sync worker migration requires deployment of the existing sync operation implementation'`. The operation processor was never deployed. Offline operation is described throughout the specs as the core product differentiator and none of it can currently run. Detail in `SCHEMA-REFERENCE.md` §12.
- **No pull RPC exists.** `OFFLINE-SYNC-MODEL.md` §22 describes push *and* pull; only push-side functions are deployed. No cursor/pagination contract, no `CURSOR_TOO_OLD` → full-resync path.
- **Storage — addressed, migration written but not applied.** `supabase/migrations/20260810130000_storage_buckets_and_policies.sql` makes the four buckets reproducible from the repo for the first time and replaces the four operation-partitioned policies with eleven per-bucket ones: avatars writable only by their owning user, `product-images` gated on `products.manage`, and **`delivery-proofs`/`receipts` given no UPDATE and no DELETE policy at all** — omitting the policy is the prohibition, so uploaded evidence is immutable to every client. Receipt reads now additionally require `financial.view`, so a Driver can no longer download every receipt. Branch isolation is enforced via `has_branch_access()` on path segment 2, with a mandatory not-null guard because `has_branch_access()` returns true for owner/admin regardless of argument. Two `IMMUTABLE` path helpers parse the tenant and branch segments and return NULL on anything malformed — verified against `storage.foldername`, including that `../../etc/passwd` and a segment-less path both fail closed. Original findings below, retained for the record.
- **Storage — the original findings.** Tenant isolation held, but three weaknesses were live. All four `storage.objects` policies do gate on `(storage.foldername(name))[1] = current_tenant_id()::text`, and because `current_tenant_id()` returns NULL when the claim is absent they fail closed — one tenant cannot read another's files. However the policies are partitioned by *operation*, not by bucket, which produces: **(1)** one SELECT rule spanning all four buckets with no role check, so a Driver can download every receipt in the tenant; **(2)** the UPDATE policy covers all four buckets with **no role check**, while DELETE is correctly restricted to `owner`/`admin`/`branch_manager` on `avatars`/`product-images` only — so the delete restriction on financial evidence is trivially bypassed by overwriting a receipt instead of deleting it; **(3)** the UPDATE `with_check` omits `bucket_id`, so an object can be moved between buckets within the tenant prefix. Also: **no branch isolation anywhere** (`has_branch_access()` is never called in a storage policy) and **none of the buckets or policies exist in `supabase/migrations/`** — they were created out-of-band, so the repo cannot reproduce them. Storage currently holds zero objects, making this the cheapest possible moment to fix the path convention and split the policies per bucket. `STORAGE-BUCKETS.md` §18 forbids exactly the single-broad-rule design that is deployed.
- **Notifications: nothing exists, and three live constraints will shape whatever is built.** No notification tables, no push-token storage (`sync_devices` has no token column), no edge functions, and **no `pg_cron`/`pg_net`/`pgmq` installed** — so the database can neither schedule a job nor make an outbound HTTP call. Beyond that: **(a)** `verify_tenant_columns()`/`assert_schema_invariants()` reject any `public` table whose `tenant_id` is nullable or lacks an FK to `organizations`, so a `notification_preferences` table with a nullable `tenant_id` for "global" preferences will fail the invariant check; **(b)** `sync_operations` RLS is `actor_id = auth.uid()`, so no manager can see another user's sync failures — a manager-facing sync-failure notification has no readable source; **(c)** `products`/`product_variants` have no reorder threshold (only `ingredients.reorder_level`), so finished-goods low-stock alerts have nothing to fire on. Two notification specs (`NOTIFICATIONS-SPEC.md`, `NOTIFICATION-DELIVERY-CHANNELS.md`) overlap on preferences, token model, telemetry and retention with different channel priorities and **no precedence rule between them** — reconcile before writing any migration.
- **Reusable rather than rebuilt:** `sync_changes` is already an ordered, tenant-scoped, transactional change feed — evaluate consuming it as the notification outbox before inventing `notification_events`. `has_permission()`/`has_branch_access()` already do permission-driven recipient resolution, and the due-date indexes for scheduled scans already exist.
- **`create_organization_invite()` returns the raw token to the calling client**, and `accept_organization_invite()` never checks that the accepting user's email matches `organization_invites.email` — so anyone holding the link gains the invited role. Also, no function can set `status='revoked'`, making that state unreachable.

- **Two ticket defects, documented but not fixed** (owner decision: document only, no migration). (1) `prevent_submitted_ticket_update()` blocks `status`, making `confirmed` through `completed` unreachable and rendering `confirm_ticket()`, `complete_ticket()`, and `cancel_ticket()` unable to succeed on a submitted ticket. (2) The same trigger omits `subtotal_amount` and `total_amount`, and `guard_ticket_item_mutation()` omits `submitted`, so a submitted ticket's money can still be rewritten via its items. Full detail and remediation in `STATE-MACHINES.md` §1.
- **Fulfilment timestamp — addressed, migration written but not applied.** `REPORTING-MODEL.md` §5/§8/§78 recognize revenue on the fulfilment event and require its business-event timestamp; `tickets` had none, so a pickup sale made offline would have had its revenue land on the day the device reconnected — the exact failure §10 warns against. `supabase/migrations/20260810110000_add_ticket_fulfilled_at.sql` adds `tickets.fulfilled_at`: client-supplied for offline sales, server-stamped when online, bounded by two CHECK constraints (not before `device_created_at`, not in the future, each with one hour of clock slack), immutable once set, and indexed for date-range reporting. It backfills from `deliveries.delivered_at` then the audit log. The reporting views prefer it, then `deliveries.delivered_at`, then the audit log, and expose `recognition_basis`/`recognition_is_authoritative` per row so an approximate figure is never passed off as exact.
- **`payments` has no status column.** `REPORTING-MODEL.md` §78 requires successful payments to be distinguishable from failed or voided ones. The only available signal today is `deleted_at`, which conflates "voided payment" with "soft-deleted row". If voided payments become real, add an explicit status rather than overloading soft delete.
- **Revenue is unreachable until the hybrid immutability remediation lands.** Revenue recognition depends on `delivered`/`completed`, which the deployed `prevent_submitted_ticket_update()` makes unreachable. Until that is fixed, every revenue view correctly returns zero rows.
- **Stock reservations** are referenced by §2 of this document, `STATE-MACHINES.md`, and `API-CONTRACT.md`, and implemented by nothing — no table, no column, no `stock_movements.reason` value.
- **No `draft → submitted` RPC** exists, though the state machine requires that hop.
- **`sync.submit` / `sync.view` permissions are granted to no role**, and clarification §10 suggests a permission gate may be the wrong mechanism for a platform capability nobody approves.
- **The 9 hardening migrations in `supabase/migrations/` are not applied to production** and share no version with the 6 migrations the database has recorded. Deliberate, per owner decision; the consequence is that `anon` can execute several RPCs over REST and revoked users keep privileges until their JWT expires.
- **The repo still cannot rebuild the database.** `supabase db pull` refuses because of the history divergence, and `db dump` could not complete from the current environment.
- The Ticket state machine was expanded from 5 states to the full 8-state model per `EB-013` Appendix A (`draft → submitted → confirmed → scheduled → in_production → ready → delivered → completed`, plus `cancelled → archived`), and the `ready → delivered` transition now hard-requires the linked `deliveries` row to itself be `delivered` (pickup orders exempt). See `docs/STATE-MACHINES.md`.
- **Migration-sync gap (open, quantified 2026-08-09):** the live Supabase database (project `tvfyxpafbpnkneujcnvr`) and `supabase/migrations/` have **no migration versions in common**. The database records 6 migrations (`20260809191552` → `20260809194312`); the repo holds 9 different ones (`20260809190000` → `20260809200400`). Worse, **the repo cannot rebuild the database at all**: the intended baseline `supabase/migrations/20260809_live_schema.sql` is a 0-byte file, and the five migrations that originally created the schema (2,306 lines) were deleted in commit `9b92105`. A `supabase db reset` would fail on the first statement, since every remaining file is an ALTER/GRANT against tables that would not exist.

  Until this is closed, **treat direct database inspection (Supabase dashboard/CLI/MCP) as the source of truth** over any `.sql` file or any document. The fix is `supabase db pull` to regenerate a real baseline, plus a committed `supabase/seed.sql` for the 8 roles, 25 permissions and 93 role-permission grants (`config.toml` already points `[db.seed]` at a file that does not exist).

If new conflicts are discovered during implementation, record the decision here and update the offending document in the same commit.
