# CLAUDE.md — BakeFlow

BakeFlow is a mobile-first operational management platform for independent bakeries (starting with the Nigerian market). It connects orders, inventory, production, deliveries, and finance into one system so a bakery owner gets accurate financial visibility without bookkeeping knowledge.

**Status:** backend is live and ahead of this repo (see `docs/PROJECT-OVERVIEW.md` §migration-sync for the gap — reconcile before assuming the committed migrations reflect production). Frontend is pre-development: no app code exists yet. Application code will be built phase-by-phase per `docs/AI-BUILD-GUIDE.md`, into the structure defined in `docs/FRONTEND-STRUCTURE.md`.

## Tech stack

- **Mobile app** (operational workspace — primary, build first): React Native + Expo, Expo Router
- **Web app** (management/config/analytics workspace — reserved, build after mobile is underway): framework TBD, same backend
- **Backend:** Supabase (PostgreSQL, Auth, Storage, Row-Level Security) — shared by both apps, no duplicated logic
- **State:** Zustand (client state), TanStack Query (server state) — see `docs/FRONTEND-STRUCTURE.md` for store/hook boundaries between the two apps

## Non-negotiable rules

These override anything ambiguous or contradictory found elsewhere. If an EB document appears to conflict with this file, this file and `docs/PROJECT-OVERVIEW.md` win — flag the conflict rather than silently following the EB document.

1. **Tenant model:** `Organization` (the tenant, one bakery business) → `Branch` (physical location). Every tenant-owned table has `tenant_id UUID NOT NULL REFERENCES organizations(id)`. Branch-scoped tables additionally have `branch_id UUID NOT NULL REFERENCES branches(id)`.
2. **Canonical column name is `tenant_id`** — never `organization_id`, `bakery_id`, or `company_id`. The JWT tenant claim is also `tenant_id` (`auth.jwt() ->> 'tenant_id'`).
3. **Set `tenant_id` explicitly on every insert.** Do not use a JWT-derived column default — it breaks silently for service-role operations, migrations, and seeds. RLS is the enforcement layer; the explicit value is the source of truth.
4. **RLS enabled on every table**, policies scoped by `tenant_id` (and `branch_id` where branch-level access applies). No Organization can ever read another Organization's data.
5. **Money is `NUMERIC(19,4)`. Never float, never `NUMERIC(18,2)`.** Physical quantities are `NUMERIC(18,4)`; percentages are `NUMERIC(5,2)`. Rounding happens only at final display or settlement, never mid-calculation.
6. **Primary keys are `UUID DEFAULT gen_random_uuid()`.** Not BIGINT, not `uuid_generate_v4()`.
7. **Stock levels are never updated directly.** All stock changes go through inserts into an immutable `stock_movements` ledger; current levels are maintained by trigger from movements.
8. **No silent deletes of business-critical data.** Operational records (orders, payments, stock movements, cash sessions) are immutable or archived, never hard-deleted.
9. **Every significant business event is auditable** — who, what, when. All tables carry `created_at`/`updated_at` `TIMESTAMPTZ` columns.
10. **Naming:** lowercase plural snake_case table names; foreign keys as `{entity}_id`.

## Domain vocabulary (canonical)

Organization, Branch, Employee, Customer, Product, Product Variant, Ingredient, Recipe (BOM linking a variant to ingredients), Order, Invoice, Payment, Production Batch, Stock Movement, Warehouse, Delivery, Cash Session. Roles: Owner, Admin, Branch Manager, Cashier, Baker, Driver, Accountant (architecturally present, disabled in MVP 1), Supervisor (optional, enabled and configured per-bakery by the Branch Manager — see `docs/ROLES-AND-PERMISSIONS.md`).

**"Ticket" is not a BakeFlow entity.** If you encounter it in an older EB chapter, it means Order — normalize the wording, don't create a Ticket table. **"Manager"** alone means Branch Manager; there is no separate Manager role.

## How to use the docs

The EB documents in `docs/engineering-bible/` are **prose standards, not schema dumps** — they contain almost no `CREATE TABLE` DDL. When asked to create tables, design them in conformance with the standards; do not search for pre-written column lists that don't exist.

Read per task, not all at once (some files are 30k+ lines — grep for specific topics instead of reading whole files):

**Derived documents come first.** The `docs/*.md` files below distil the EB chapters into concrete, actionable form. Read those; consult the EB chapters only for rationale or detail they don't cover.

| Task | Read first (concrete) | Deep reference (prose) |
|---|---|---|
| Orientation | `docs/PROJECT-OVERVIEW.md` | — |
| Build phases & prompts | `docs/AI-BUILD-GUIDE.md` | — |
| Creating tables | `docs/SCHEMA-REFERENCE.md` | EB-007, EB-011, EB-016A/B |
| RLS policies, JWT claims | `docs/RLS-POLICY-PATTERNS.md` | EB-008, EB-010, EB-012 |
| Status transitions, workflows | `docs/STATE-MACHINES.md` | — (EB-013's own state-machine appendix is fine; its §3 on roles is not — see below) |
| Roles, permissions, Mobile/Web split | `docs/ROLES-AND-PERMISSIONS.md` | — (supersedes EB-013 §3 entirely; do not read EB-013 §3 for this) |
| Frontend folder structure | `docs/FRONTEND-STRUCTURE.md` | EB-014 §2–3, §5–6 only if the concrete doc doesn't cover something |
| RPCs, errors, queries | `docs/API-CONTRACT.md` | EB-009, EB-017 |
| Colors, type, components | `docs/DESIGN-TOKENS.md` | EB-015, EB-018 |
| What to test, per phase | `docs/TESTING-STRATEGY.md` | EB-019 |
| CI/CD & operations | — | EB-019 |
| Out of MVP scope — skip | — | EB-020 |

If a `docs/*.md` file and an EB chapter disagree on a concrete value, the `docs/*.md` file wins and the EB chapter should be corrected in the same commit.

**Known-outdated EB content — do not implement against these, even if a task seems to point there:**
- **EB-013 §3** ("User Roles..."): describes Web as the primary operational surface, a `Manager` role, a fixed universal `Supervisor`, and a `Ticket` entity. All four are wrong. Use `docs/ROLES-AND-PERMISSIONS.md` instead. EB-013's other sections (state machines, business rules for non-role topics) are not affected by this and can still be read normally.

**Low-signal chapters — skip unless specifically asked to audit documentation quality itself.** These are almost entirely generic "SHALL" governance prose with very few concrete, BakeFlow-specific, checkable claims (verified by direct reading, not assumption). Reading them for an implementation task burns tokens for near-zero signal: **EB-000, EB-001, EB-002, EB-003, EB-004, EB-005, EB-006, EB-019, EB-020**. If a task seems to require one of these, check the table above first — a `docs/*.md` concrete doc almost certainly already covers what's needed. The exception within this range: EB-005 (Financial Integrity) and EB-004 (Security) may contain a genuinely load-bearing principle occasionally referenced elsewhere — if something cites one by name, grep for that specific claim rather than reading the chapter start to finish.

**EB-016A/EB-016B are not schema dumps despite the name.** They contain naming/type/indexing *standards* (33K + 24K lines), not table-by-table `CREATE TABLE` definitions for domains like orders, payments, or production. For actual current schema, query the live database directly (Supabase project `tvfyxpafbpnkneujcnvr`) — the committed migrations in `supabase/migrations/` are known to be behind production; see the migration-sync gap noted in `docs/PROJECT-OVERVIEW.md`.

## Workflow

- Build incrementally per the phases in `docs/AI-BUILD-GUIDE.md`; verify each phase (apply migration, test RLS isolation, test triggers) before starting the next.
- After schema changes, run `pytest` — `tests/test_spec_coverage.py` guards naming invariants and requirement-ID uniqueness.
- Don't commit `__pycache__/`, `.pyc`, or `.pytest_cache/` (see `.gitignore`).
- When you hit a spec contradiction, stop and surface it; record the resolution in `docs/PROJECT-OVERVIEW.md` §7 and fix the offending document in the same commit.
