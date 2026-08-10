# BakeFlow — Roles, Permissions & Mobile/Web Workspace Split

**Status:** canonical. This document supersedes `EB-013-Business-Rules-Operational-Workflows-Domain-Logic.md`, Section 3 ("User Roles, Organizational Responsibilities, Operational Authority & Permission Boundaries"), which contains multiple outdated statements — see §5 below. Do not implement against EB-013 §3.

---

## 1. Application workspace model

BakeFlow has two frontend surfaces, sharing one backend, one set of business rules, and mostly-shared frontend code (`packages/api`, `packages/types`, `packages/validation`, `packages/auth`, the read side of `packages/hooks`). They are not two systems that happen to agree — they are one system with two front doors. A ticket confirmed on mobile is the same ticket row visible instantly on web.

What differs between them is **which screens and actions each app's UI chooses to surface**, not the underlying logic.

**Mobile — the operational workspace.** Primary interface for day-to-day execution:
- Tickets, production, inventory operations, deliveries, cash sessions
- Operational task execution
- Alerts/notifications relevant to the user's responsibilities

**Web — the management, configuration, monitoring & analytics workspace.** Primary interface for:
- Dashboards, analytics, reports
- Organization/branch configuration, settings
- User and role management, function/permission configuration
- Operational oversight (monitoring, not primary execution)

This is not a hard technical restriction — the backend does not prevent a Branch Manager from calling an operational RPC through the web client. It is a product-architecture decision: mobile's UI is built to *do* things, web's UI is built to *see and configure* things. `packages/hooks` should still separate query hooks (shared freely) from mutation hooks tied to operational actions (`confirm_ticket`, `adjust_stock`, `open_cash_session`, etc.) so this boundary is structurally easy to keep, not just a convention someone has to remember.

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
| **Owner** | Monitor dashboards, tickets, production, inventory, deliveries, cash; receive alerts; high-level oversight across branches | Manage org & branches; manage Branch Managers; configure business-wide & branch settings; manage users/access; dashboards, analytics, reports; monitor all operational domains |
| **Admin** | Monitor dashboards/tickets/production/inventory/deliveries/cash per assigned permissions; perform authorized operational actions | Manage users; manage authorized branch/system settings; configure operational settings; dashboards, analytics, reports — all permission-gated, never assumed to equal Owner |
| **Branch Manager** | Full operational execution for their branch: manage tickets, production, inventory, deliveries, cash sessions; manage staff operationally | Configure branch settings & staff; register/manage users; enable/disable optional functions; **register Supervisors and configure their permissions**; manage domain configuration; dashboards, analytics, reports |
| **Supervisor** | Whatever operational functions the Branch Manager enabled (tickets/production/inventory/deliveries/cash/staff coordination — default set in §4) | Whatever monitoring/reporting/config functions the Branch Manager enabled |
| **Cashier** | Create/manage tickets, process payments, open/close cash sessions, record transactions | Limited: view relevant tickets, sales info, cash sessions, reports. No Branch Manager configuration authority. |
| **Baker** | View production schedule, produce assigned batches, record completion/shortages/damage | Limited: view production info/history, relevant product/recipe/inventory info |
| **Driver** | Primary workspace. View assigned deliveries, update delivery status, confirm pickup/delivery, record outcomes/failures | Limited or none: view assigned deliveries, delivery history |
| **Accountant** *(disabled in MVP 1)* | Future: financial dashboards, transactions, cash sessions, sales, reports, alerts | Future: financial dashboards/reports, revenue analysis, cash/transaction review, export |

---

## 4. Function/permission model (Supervisor and beyond)

The application must not hard-code `role → fixed permission set`. The model is:

```
Role → available functions → configurable permissions
```

A Branch Manager can toggle individual functions on/off per Supervisor (and this mechanism should extend to future granular roles, not just Supervisor).

**The catalog now exists.** An earlier revision of this document said it did not. Live: `permissions` (25 rows) and `role_permissions` (93 grants), read by `has_permission(required_permission text, target_branch_id uuid)`. `roles` carries 8 rows with a `rank` (lower = more privileged), and `private.can_manage_target_role(role_id)` gates who may grant which role.

### Role ranks

| Rank | Key | Display name |
|---|---|---|
| 1 | `owner` | Owner |
| 2 | `admin` | Admin |
| 3 | `branch_manager` | Manager *(display name is "Manager" in the DB; the canonical term is Branch Manager)* |
| 4 | `supervisor` | Supervisor |
| 8 | `accountant` | Accountant |
| 9 | `baker` | Baker |
| 10 | `cashier` | Cashier |
| 11 | `driver` | Driver |

Ranks 5–7 are deliberately unused, leaving room to insert roles without renumbering.

### Permission keys (25)

`branch.manage`, `branch.view`, `customers.create`, `customers.update`, `customers.delete`, `financial.audit.confirm`, `financial.audit.submit`, `financial.expense.create`, `financial.expense.update`, `financial.expense.delete`, `financial.view`, `pricing.manage`, `products.manage`, `records.permanent_delete`, `reports.view`, `staff.manage`, `staff.view`, `sync.submit`, `sync.view`, `tickets.archive`, `tickets.cancel`, `tickets.correct`, `tickets.create`, `tickets.update`, `tickets.view`.

> **Four keys are granted to no role at all:** `tickets.update`, `tickets.cancel`, `sync.submit`, `sync.view`. `has_permission()` therefore denies these to everyone.
>
> For `tickets.update` and `tickets.cancel` this is **deliberate, not unfinished**. `BAKEFLOW-PROJECT-LOGIC-CLARIFICATION.md` §3 states that a submitted ticket cannot be updated or cancelled by anyone — "authority does not create an exception" — and §60 repeats it as non-negotiable. Granting either key to any role would contradict the product rule. They exist as catalog entries so the concepts are nameable, and are enforced independently by the `prevent_submitted_ticket_update()` trigger rather than by permission. **Do not "fix" these by granting them.**
>
> `sync.submit` and `sync.view` are a different case: clarification §10 says synchronization is a platform capability that no one approves or controls, so a permission gate may simply be the wrong mechanism. Whether to grant them or retire them is genuinely open.

### Live grants by role

| Role | Permissions |
|---|---|
| **owner** | branch.manage, branch.view, customers.create/update/delete, financial.audit.confirm/submit, financial.expense.create/update/delete, financial.view, pricing.manage, products.manage, reports.view, staff.manage, staff.view, tickets.correct, tickets.create, tickets.view |
| **admin** | everything owner has, **plus** `records.permanent_delete` and `tickets.archive` |
| **branch_manager** | identical to admin |
| **supervisor** | branch.view, customers.create/update, financial.audit.submit, financial.expense.create/update, financial.view, reports.view, staff.view, tickets.correct/create/view |
| **accountant** | financial.audit.confirm/submit, financial.expense.create/update/delete, financial.view, reports.view |
| **cashier** | customers.create/update, financial.audit.submit, financial.view, reports.view, tickets.create, tickets.view |
| **baker** | tickets.view |
| **driver** | customers.create/update, tickets.correct, tickets.create, tickets.view |

Three things in this table are surprising enough to call out rather than let someone discover them mid-build:

1. **Owner cannot permanently delete records or archive tickets** — `records.permanent_delete` and `tickets.archive` go to admin and branch_manager only. Deliberate segregation of duties, or an oversight? Unconfirmed.
2. **`branch_manager` and `admin` have identical permission sets**, despite §2 describing them as different scopes of authority. Branch scoping is enforced separately by `has_branch_access()`, so they are not equivalent in practice — but the permission layer alone does not distinguish them.
3. **Driver holds `tickets.create` and `tickets.correct`.** §5 below lists "Drivers create walk-in tickets" as outdated EB-013 content; the deployed grants implement it anyway. The database, not that table row, reflects current intent.

Supervisor's live grant set is close to the default below but not identical — it includes `tickets.correct` and both expense permissions, and excludes any production- or delivery-specific key (there are none in the catalog).

**Default Supervisor permission set** (the product-level intent; every value is independently toggleable per bakery):

| Function | Default |
|---|---|
| Tickets — monitor/manage | On |
| Production — coordinate | On |
| Inventory — monitor | On |
| Deliveries — coordinate | On |
| Cash — view only (not open/close) | On (view), Off (custody) |
| Reports — view | On |
| Staff management, pricing, org/branch config | Off |

> The catalog has no keys for production, inventory, or deliveries — those four "On" defaults have nothing to bind to yet. Extending `permissions` to cover them is outstanding work.

A Branch Manager can raise, lower, or fully reconfigure this for any individual Supervisor at any time. The per-Supervisor override mechanism itself — a `user_permissions` table or equivalent — is **not built**; `role_permissions` is role-level only, so today every Supervisor in every bakery has the same set.

---

## 5. What was wrong in EB-013 §3, and why

| EB-013 §3 statement | Status |
|---|---|
| Web is the primary operational workspace for Managers | Outdated — reversed |
| Mobile is mainly observational for Managers | Outdated — reversed |
| "Manager" is a standalone canonical role | Outdated — renamed to Branch Manager |
| Supervisor is a fixed position in a universal hierarchy with one permission set | Outdated — Supervisor is optional/configurable, no fixed set |
| Hierarchy `Owner → Admin → Manager → Supervisor → Driver → Baker` | Outdated — see §2 tree above |
| Drivers "create walk-in tickets"; Ticket is the core sales entity | **Correct — not outdated.** A previous revision of this table said the opposite (that the canonical entity was Order and no `tickets` table existed). The live database has `tickets` and `ticket_items`, `tickets.*` permission keys, and grants `tickets.create` to `driver`. Normalize "order" to "ticket", not the other way round. |

If any other document (including other EB chapters) references "Manager" as a standalone role or describes Web as operationally primary, treat this document as authoritative and flag the conflict rather than silently following the older text. References to "Ticket" as an entity are correct and should be left alone.
