# BakeFlow — Technical Debt

Known, accepted, and tracked. Not blockers; each is safe to continue past.

| ID | Item | Impact | Evidence |
|---|---|---|---|
| TD-001 | `has_permission()` gates **zero** of 101 RLS policies. Role-based RLS is authoritative; the 25 permission keys and 93 grants are effectively client-side only. | Two authorization models coexist conceptually. | Measured: 0 policies reference `has_permission`, 62 reference `has_role`. |
| TD-002 | Four permission keys are granted to no role: `tickets.update`, `tickets.cancel`, `sync.submit`, `sync.view`. UI gated on them is hidden for everyone. | Dead permission surface. | `docs/FRONTEND-STRUCTURE.md` §113. |
| TD-003 | 14 stale `.sql` migrations in `supabase/migrations/` were never applied and do not correspond to the live schema. | The repo cannot rebuild the database. | See BLOCKER-002. |
| TD-004 | The 11 applied migrations exist only in `supabase_migrations.schema_migrations`, not as repo files. | Same as TD-003. | `supabase/migrations/README-multiorg-2026-08-10.md`. |
| TD-005 | Per-Supervisor permission overrides have no backing table; `role_permissions` is role-level only, so every Supervisor resolves identically. | Supervisor configurability is unimplementable today. | `docs/FRONTEND-STRUCTURE.md` §113. |
| TD-006 | `user_roles` has no unique constraint on `(tenant_id, profile_id, role_id)`; `ON CONFLICT DO NOTHING` in invite acceptance cannot dedupe. | Duplicate membership rows are possible. | Observed in `accept_organization_invite()`. |
| TD-007 | Skia's native binaries are unverified. `npm rebuild` exits 0 but creates no `libs/`. | Only a real device/emulator build confirms it. | `install-libs.js` copies from platform binary packages. |
| TD-008 | Two notification specs (`NOTIFICATIONS-SPEC.md`, `NOTIFICATION-DELIVERY-CHANNELS.md`) overlap with no precedence rule. | Ambiguity before notification work. | `docs/PROJECT-OVERVIEW.md` §146. |
| TD-009 | `corepack enable` could not be run (`EPERM`, needs admin). npm 10.8.2 is reachable via `corepack npm`, not automatically. | Developers may silently use npm 11. | `engines.npm` warns; `.npmrc` documents it. |
