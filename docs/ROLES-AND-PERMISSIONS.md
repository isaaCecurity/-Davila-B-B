# BakeFlow — Roles, Permissions & Mobile/Web Workspace Split

**Status:** canonical. This document supersedes `EB-013-Business-Rules-Operational-Workflows-Domain-Logic.md`, Section 3 ("User Roles, Organizational Responsibilities, Operational Authority & Permission Boundaries"), which contains multiple outdated statements — see §5 below. Do not implement against EB-013 §3.

---

## 1. Application workspace model

BakeFlow has two frontend surfaces, sharing one backend, one set of business rules, and mostly-shared frontend code (`packages/api`, `packages/types`, `packages/validation`, `packages/auth`, the read side of `packages/hooks`). They are not two systems that happen to agree — they are one system with two front doors. An order confirmed on mobile is the same order row visible instantly on web.

What differs between them is **which screens and actions each app's UI chooses to surface**, not the underlying logic.

**Mobile — the operational workspace.** Primary interface for day-to-day execution:
- Orders, production, inventory operations, deliveries, cash sessions
- Operational task execution
- Alerts/notifications relevant to the user's responsibilities

**Web — the management, configuration, monitoring & analytics workspace.** Primary interface for:
- Dashboards, analytics, reports
- Organization/branch configuration, settings
- User and role management, function/permission configuration
- Operational oversight (monitoring, not primary execution)

This is not a hard technical restriction — the backend does not prevent a Branch Manager from calling an operational RPC through the web client. It is a product-architecture decision: mobile's UI is built to *do* things, web's UI is built to *see and configure* things. `packages/hooks` should still separate query hooks (shared freely) from mutation hooks tied to operational actions (`confirm_order`, `adjust_stock`, `open_cash_session`, etc.) so this boundary is structurally easy to keep, not just a convention someone has to remember.

---

## 2. Canonical roles

```
Organization
│
├── Owner
├── Admin
│
└── Branch
    │
    ├── Branch Manager
    ├── Cashier
    ├── Baker
    ├── Driver
    ├── Accountant*
    │
    └── Supervisor*
          └── functions/permissions configured by Branch Manager
```
`*` = optional / feature-gated.

1. **Owner** — highest organizational authority.
2. **Admin** — assists Owner; permission-controlled, not automatically unlimited.
3. **Branch Manager** — canonical manager role for a branch. Any reference to "Manager" elsewhere in the docs means Branch Manager; there is no separate "Manager" role.
4. **Supervisor** — optional, configurable. Not every bakery has one. A Branch Manager enables the Supervisor function, registers Supervisors, and assigns each one a set of permissions from the function catalog (see §4). There is no single fixed Supervisor permission set — two bakeries can configure Supervisors differently.
5. **Cashier** — operational, sales/cash-facing.
6. **Baker** — operational, production-facing.
7. **Driver** — operational, delivery-facing. Mobile is the Driver's primary and near-exclusive workspace.
8. **Accountant** — canonical role, architecturally supported, but **disabled/not enabled for MVP 1**. Do not remove it from the role model just because it isn't exposed to customers yet.

---

## 3. Role-by-role: Mobile vs Web

| Role | Mobile | Web |
|---|---|---|
| **Owner** | Monitor dashboards, orders, production, inventory, deliveries, cash; receive alerts; high-level oversight across branches | Manage org & branches; manage Branch Managers; configure business-wide & branch settings; manage users/access; dashboards, analytics, reports; monitor all operational domains |
| **Admin** | Monitor dashboards/orders/production/inventory/deliveries/cash per assigned permissions; perform authorized operational actions | Manage users; manage authorized branch/system settings; configure operational settings; dashboards, analytics, reports — all permission-gated, never assumed to equal Owner |
| **Branch Manager** | Full operational execution for their branch: manage orders, production, inventory, deliveries, cash sessions; manage staff operationally | Configure branch settings & staff; register/manage users; enable/disable optional functions; **register Supervisors and configure their permissions**; manage domain configuration; dashboards, analytics, reports |
| **Supervisor** | Whatever operational functions the Branch Manager enabled (orders/production/inventory/deliveries/cash/staff coordination — default set in §4) | Whatever monitoring/reporting/config functions the Branch Manager enabled |
| **Cashier** | Create/manage orders, process payments, open/close cash sessions, record transactions | Limited: view relevant orders, sales info, cash sessions, reports. No Branch Manager configuration authority. |
| **Baker** | View production schedule, produce assigned batches, record completion/shortages/damage | Limited: view production info/history, relevant product/recipe/inventory info |
| **Driver** | Primary workspace. View assigned deliveries, update delivery status, confirm pickup/delivery, record outcomes/failures | Limited or none: view assigned deliveries, delivery history |
| **Accountant** *(disabled in MVP 1)* | Future: financial dashboards, transactions, cash sessions, sales, reports, alerts | Future: financial dashboards/reports, revenue analysis, cash/transaction review, export |

---

## 4. Function/permission model (Supervisor and beyond)

The application must not hard-code `role → fixed permission set`. The model is:

```
Role → available functions → configurable permissions
```

A Branch Manager can toggle individual functions on/off per Supervisor (and this mechanism should extend to future granular roles, not just Supervisor). This needs a real function/permission catalog at the database level — **this does not exist yet** as of this document (checked live: `roles` is `id/key/name/rank`, `user_roles` links one role per profile with an optional `branch_id`, no permission table). Designing that table is separate, tracked work — see the project's open items, not this document.

**Default Supervisor permission set** (a sensible starting point; every value below is independently toggleable per bakery, and the catalog itself should be extensible as new functions are added over time):

| Function | Default |
|---|---|
| Orders — monitor/manage | On |
| Production — coordinate | On |
| Inventory — monitor | On |
| Deliveries — coordinate | On |
| Cash — view only (not open/close) | On (view), Off (custody) |
| Reports — view | On |
| Staff management, pricing, org/branch config | Off |

A Branch Manager can raise, lower, or fully reconfigure this for any individual Supervisor, at any time, with no schema change required once the permission catalog exists.

---

## 5. What was wrong in EB-013 §3, and why

| EB-013 §3 statement | Status |
|---|---|
| Web is the primary operational workspace for Managers | Outdated — reversed |
| Mobile is mainly observational for Managers | Outdated — reversed |
| "Manager" is a standalone canonical role | Outdated — renamed to Branch Manager |
| Supervisor is a fixed position in a universal hierarchy with one permission set | Outdated — Supervisor is optional/configurable, no fixed set |
| Hierarchy `Owner → Admin → Manager → Supervisor → Driver → Baker` | Outdated — see §2 tree above |
| Drivers "create walk-in tickets"; Ticket is the core sales entity | Outdated terminology — the canonical entity is **Order**; the live database has no `tickets` table. Do not introduce one to preserve old wording — normalize "ticket" to "order" wherever it's found. |

If any other document (including other EB chapters) references "Manager" as a standalone role, "Ticket" as an entity, or describes Web as operationally primary, treat this document as authoritative and flag the conflict rather than silently following the older text.
