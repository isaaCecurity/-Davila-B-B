# Multi-organization / offline-sync migrations — applied 2026-08-10

Eleven migrations were applied to the live project (`tvfyxpafbpnkneujcnvr`) and are
recorded, with their full statement text, in `supabase_migrations.schema_migrations`.

| Version | Name |
|---|---|
| 20260810141258 | `multiorg_01_active_organization_and_self_update_guard` |
| 20260810141318 | `multiorg_02_user_role_integrity_guard` |
| 20260810141339 | `multiorg_03_access_token_hook` |
| 20260810141429 | `multiorg_04_organization_and_profile_visibility` |
| 20260810141454 | `multiorg_05_invite_acceptance` |
| 20260810141719 | `multiorg_06_user_owned_sync_devices` |
| 20260810182112 | `multiorg_07_tenant_scoped_authorization_helpers` |
| 20260810182203 | `multiorg_08_operation_authoritative_sync_processor` |
| 20260810182219 | `multiorg_09_sync_operations_visibility_and_forced_rls` |
| 20260810182301 | `multiorg_10_force_rls_remaining_tables` |
| 20260810182611 | `multiorg_11_fix_null_claim_in_access_token_hook` |

## Materialising these as `.sql` files

They are **not** yet checked in as files. Materialise them from the authoritative
source rather than by hand — transcribing them risks exactly the repo/live drift
that `docs/PROJECT-OVERVIEW.md` §7 already documents:

```bash
supabase link --project-ref tvfyxpafbpnkneujcnvr
supabase db pull            # writes the remote history into supabase/migrations/
```

Or read the recorded text directly:

```sql
select version, name, unnest(statements)
from supabase_migrations.schema_migrations
where version >= '20260810141258'
order by version;
```

## What changed, in one line each

1. **01** — `profiles.active_tenant_id` + `set_active_organization()`; the self-update
   policy pins the new column so a client cannot write it directly.
2. **02** — `guard_user_role_integrity()` no longer requires
   `user_roles.tenant_id = profiles.tenant_id`. That single check made a second
   membership impossible to insert. Role validity, owner/admin org-wide rules and
   branch-belongs-to-organization are all preserved.
3. **03** — access-token hook: hardening (soft-deleted roles, suspended profiles)
   plus active-organization resolution. Roles are scoped to the active organization
   only; a union across organizations would be a privilege-escalation bug.
4. **04** — `organizations_select` widened to memberships so the switcher can name
   them; `profiles_select` / `profiles_update_admin` resolve staff through
   `user_roles` instead of the legacy single-tenant column.
5. **05** — invite acceptance no longer rejects a user who already belongs to
   another organization, and never silently moves their active organization.
6. **06** — `sync_devices` becomes user-owned: `tenant_id`/`branch_id` dropped,
   RLS forced, `sync_changes_select` and `sync_validate_device()` rewritten.
7. **07** — `is_member_of()` / `is_authorized_for_branch()`, tenant-parameterised
   and not executable by any client role. Branch-belongs-to-organization is checked
   **before** owner/admin authority is considered.
8. **08** — the sync processor: per-operation authorization, operation-authoritative
   routing, idempotency, stale-revision conflicts. `current_tenant_id()` appears
   nowhere in the sync path.
9. **09** — `sync_operations` visibility spans a user's authorized organizations
   instead of only the active one; RLS forced.
10. **10** — `FORCE ROW LEVEL SECURITY` on the five remaining tables so
    `assert_schema_invariants()` returns clean.
11. **11** — bug found by test S5: `jsonb_set()` is STRICT, so a null active
    organization made the whole hook return NULL. Present in the previously
    deployed hook and in the repository's unapplied hardened version too.

## Tests

`tests/sql/security_multiorg_sync.sql` — S1..S13 plus two escalation guards.
Run against a **branch** database; it creates fixtures and rolls back.
