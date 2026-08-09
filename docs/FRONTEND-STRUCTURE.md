# BakeFlow — Frontend Repository Structure

**Status:** canonical, concrete. Derived from `EB-014` §2–3 (repository/application structure) and `EB-014` §5–6 (state/API layering), adapted to BakeFlow's actual domain and the Mobile/Web split in `docs/ROLES-AND-PERMISSIONS.md`. Read this before creating any frontend file or folder; consult EB-014 only for rationale it doesn't cover.

**Frontend status as of this document: pre-development.** No app code exists yet in this repository. This is the target structure to build into, not a description of what's already there.

---

## Canonical structure

```
bakeflow-frontend/
├── apps/
│   ├── mobile/                     # React Native + Expo Router — operational workspace
│   │   ├── app/                    # Expo Router routes only — no business logic here
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   ├── dashboard/          # monitoring views (Owner/Admin/Branch Manager/Supervisor)
│   │   │   ├── orders/
│   │   │   ├── production/
│   │   │   ├── inventory/
│   │   │   ├── delivery/           # Driver's primary workspace
│   │   │   ├── finance/            # cash sessions, payments, refunds
│   │   │   ├── customers/
│   │   │   ├── catalog/            # products, variants, recipes
│   │   │   ├── reports/            # lightweight, mobile-appropriate views
│   │   │   └── settings/           # personal settings only, not org/branch config
│   │   ├── components/             # app-specific, non-shared UI
│   │   ├── navigation/             # role/permission-aware route gating
│   │   ├── providers/              # QueryClientProvider, AuthProvider, etc.
│   │   ├── stores/                 # Zustand — see §3
│   │   ├── services/
│   │   ├── constants/
│   │   ├── assets/
│   │   └── platform/               # iOS/Android-specific code
│   │
│   └── web/                        # management/configuration/analytics workspace
│       ├── app/                    # routing (framework TBD when work starts)
│       ├── features/
│       │   ├── auth/
│       │   ├── dashboard/          # full analytics, not mobile's lightweight monitoring
│       │   ├── organization/       # Owner: manage org, branches, Branch Managers
│       │   ├── branch-settings/    # Branch Manager: configure branch, staff, functions
│       │   ├── permissions/        # Branch Manager: enable/configure Supervisor + future roles
│       │   ├── orders/             # oversight, not primary execution
│       │   ├── production/
│       │   ├── inventory/
│       │   ├── delivery/
│       │   ├── finance/
│       │   ├── customers/
│       │   ├── catalog/
│       │   └── reports/            # full reporting/export
│       ├── components/
│       ├── providers/
│       ├── stores/                 # same shape as mobile; web-specific stores added as needed
│       └── services/
│
├── packages/
│   ├── api/                        # single Supabase client, RPC wrappers, error normalization
│   ├── auth/                       # session + role/permission resolution — shared by both apps
│   ├── types/                      # generated from live DB schema (`supabase gen types`)
│   ├── validation/                 # Zod schemas mirroring DB constraints
│   ├── hooks/                      # cross-app TanStack Query hooks — see §2
│   ├── ui/                         # shared design-system components (EB-018 tokens)
│   ├── config/
│   └── utils/
│
├── tooling/                        # eslint, tsconfig, build config
├── docs/                           # frontend-specific docs (setup, contribution) — not the EB
├── scripts/
└── assets/                         # shared brand assets (logos, fonts, icons)
```

No additional top-level directories without a documented reason (EB-014 §2).

---

## 1. Backend logic split

Supabase owns all business rules — state transitions, financial math, stock reconciliation — via RPCs and triggers (`guard_order_status_transition`, `record_payment`, `complete_production_batch`, etc.). The frontend is a thin orchestration layer with no duplicated business logic.

Request flow (EB-014 §6):

```
Screen → Feature Hook → Feature Service → packages/api (shared client) → Supabase RPC
```

A screen never calls Supabase directly. A feature's `services/*.service.ts` never contains a business rule the database doesn't also enforce — if a screen needs to grey out an illegal action for UX, that's a client-side mirror of a database-enforced rule (see `docs/STATE-MACHINES.md`), never the sole enforcement point.

## 2. Mobile/Web hook boundary

`packages/hooks` splits along query vs. mutation:

- **Query hooks** (read data) are shared freely between `apps/mobile` and `apps/web` — both need to see the same live state.
- **Mutation hooks tied to operational RPCs** (`confirm_order`, `adjust_stock`, `open_cash_session`, `record_payment`, `transition_delivery`, etc.) are conventionally mobile-only, matching the Mobile = operational / Web = management split in `docs/ROLES-AND-PERMISSIONS.md`. Web is not technically blocked from importing them, but doing so is a signal something's been placed in the wrong app.

## 3. Zustand store responsibilities

One store, one responsibility (EB-014 §5) — no monolithic stores:

| Store | Responsibility |
|---|---|
| `auth.store.ts` | Current session |
| `organization.store.ts` | Active organization |
| `branch.store.ts` | Selected branch |
| `permissions.store.ts` | Resolved effective permissions for the current user (role defaults + any Supervisor-level overrides — see `docs/ROLES-AND-PERMISSIONS.md` §4) |
| `settings.store.ts` | User preferences |
| `sync.store.ts` | Offline/sync status (mobile) |
| `ui.store.ts` | Global UI state (modals, active tab, etc.) |

`permissions.store.ts` is forward-compatible with the function/permission catalog table once it's designed — it doesn't yet have a backing table to read from (checked live: none exists as of this document), but the store's shape shouldn't need to change when that table lands.

## 4. Feature-internal structure

Each entry under `features/` follows (EB-014 §3):

```
feature/
├── components/
├── hooks/
├── screens/
├── services/
├── types/
└── utils/
```

Additional subdirectories are fine when a feature's complexity justifies them; technical grouping alone should never be the top-level organizing principle — business capability is.
