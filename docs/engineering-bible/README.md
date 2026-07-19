# BakeFlow

BakeFlow is a mobile-first finance and operations tracker built for independent bakeries — starting with the Nigerian market. It helps bakery owners track income, expenses, inventory, and orders without needing a background in bookkeeping.

**Status:** Pre-development — this repository currently contains the full engineering specification ("Engineering Bible") that will guide implementation. No application code has been written yet.

---

## What's in this repo

This is a spec-driven project. Before writing code, the architecture, data model, security posture, and business rules are fully documented in `docs/engineering-bible/`. The intent is to use these documents as the authoritative build guide — including as structured context fed into Claude Code — so implementation follows a single, consistent source of truth rather than being figured out ad hoc.

```
docs/
  engineering-bible/
    EB-000 → EB-019   Numbered specification chapters (see table below)
```

## Engineering Bible — chapter index

| Doc | Title | Covers |
|---|---|---|
| EB-000 | Engineering Documentation Standard | How these documents are written, versioned, and governed |
| EB-001 | Document Governance | Ownership, review cycle, change control |
| EB-002 | Engineering Principles | Core engineering values for the codebase |
| EB-003 | Architecture Principles | High-level system architecture philosophy |
| EB-004 | Security Principles | CIA triad, least privilege, defense-in-depth, auditability |
| EB-005 | Financial Integrity Principles | Rules for correctness in monetary calculations |
| EB-006 | Domain Model & Ubiquitous Language | Canonical business terminology (e.g. "Bakery" = tenant) |
| EB-007 | Database Design Standards | Primary keys, multi-tenancy, data types |
| EB-008 | Supabase Architecture Standards | How Supabase (Postgres, Auth, Storage) is used |
| EB-009 | API & Backend Standards | Request/response conventions, error handling |
| EB-010 | Authentication, Authorization & Identity Standards | Sessions, tokens, identity model |
| EB-011 | Database Schema & Domain Model Standards | Full table-by-table schema definition |
| EB-012 | Authentication, Authorization & Security Architecture | Concrete auth implementation architecture |
| EB-013 | Business Rules, Operational Workflows & Domain Logic | How bakery operations actually work |
| EB-014 | Frontend Architecture Standards | App structure, routing, state management |
| EB-015 | Design System & UI Standards | Visual and component standards |
| EB-016A/B | Database Implementation Reference | Concrete SQL: types, functions, triggers |
| EB-017 | Backend API Specification | Endpoint-by-endpoint API contract |
| EB-018 | Frontend Engineering & UX Specification | Screen-by-screen frontend spec |
| EB-019 | Engineering Governance, SDLC, DevSecOps & Platform Operations | CI/CD, environments, operational standards |

## Planned tech stack

- **Mobile app:** React Native + Expo, Expo Router for navigation
- **Backend:** Supabase (PostgreSQL, Auth, Storage, Row-Level Security)
- **State management:** Zustand (client state), TanStack Query (server state)
- **Data integrity:** `NUMERIC(19,4)` for all monetary values, UUIDv4 primary keys, multi-tenant isolation via `tenant_id` + RLS

## How this is being built

The engineering bible was drafted with ChatGPT, then audited for internal consistency (naming conventions, data types, and architectural decisions cross-checked across documents) before being used to drive implementation. This README will be updated once implementation begins with setup instructions, environment variables, and a getting-started guide.

## License

Not yet decided — this project is currently private-development-stage.
