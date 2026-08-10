# BakeFlow — Implementation Log

Append-only. Every entry records commands actually executed and their output.
Never record planned work here.

---

## 2026-08-10 · Multi-organization membership & offline sync foundation

**Scope:** B1–B4. Applied to live project `tvfyxpafbpnkneujcnvr`.

**Migrations applied (11)** — `20260810141258` … `20260810182611`, indexed in
`supabase/migrations/README-multiorg-2026-08-10.md`.

**Functions changed:** `set_active_organization` (new), `is_member_of` (new),
`is_authorized_for_branch` (new), `guard_user_role_integrity`,
`custom_access_token_hook`, `accept_organization_invite`, `sync_validate_device`,
`process_sync_batch`, `process_sync_batch_context_validated`.

**Policies changed:** `profiles_update_self`, `profiles_select`,
`profiles_update_admin`, `organizations_select`, `sync_changes_select`,
`sync_devices_*` (3), `sync_operations_select`.

**Schema:** `profiles.active_tenant_id` added; `sync_devices.tenant_id`/`branch_id`
dropped; `FORCE ROW LEVEL SECURITY` on 7 tables.

**Three defects found and fixed beyond plan:**
1. `guard_user_role_integrity()` required `user_roles.tenant_id = profiles.tenant_id`,
   making a second membership impossible to insert.
2. `jsonb_set()` is STRICT — a null active organization made the token hook return
   NULL. Present in the previously deployed hook *and* the repo's unapplied hardened
   version; never exercised because the case could not exist under single-tenancy.
3. `profiles_select`/`profiles_update_admin` matched staff on `profiles.tenant_id`,
   so a Bakery B admin could not see a driver whose home organization was Bakery A.

**Verification actually executed:**
- `pytest -q` → 12 passed
- `assert_schema_invariants()` → clean
- Security suite S1–S13 + G1/G2 → 15/15
- `tsc --noEmit` (strict) → exit 0
- `eslint .` → exit 0
- `expo install --check` → up to date
- `expo prebuild --platform android --clean` → exit 0, no warnings
- `expo-doctor` → 19/20 (the failure is a TLS error reaching Expo's API)
- Duplicate check → single `react@19.2.3`, single `expo@57.0.12`
- Live row counts after fixture teardown → 0 users / 0 orgs / 0 operations

**Native verification:** `android/gradle.properties` contains
`expo.sqlite.useSQLCipher=true`; 11 Expo modules and 6 RN modules autolinked.

**Not done (deliberate):** per-entity operation application; the gateway records
authorized operations only.

---

## 2026-08-10 · Agency agent setup

Installed 9 specialists into `.claude/agents/` with a BakeFlow governance preamble;
staged 4 deferred agents in `.claude/agents-deferred/`; created the 7 control files.
No BakeFlow feature code was written.

---

## 2026-08-10 · VERIFICATION pass — authorization foundation (steps 1–6)

Read-only re-verification of the multi-organization authorization foundation against
the live project, plus one new behavioural test. No migrations were applied.

**Verified against the live database (all PASS):**

| Step | Assertion | Evidence |
|---|---|---|
| 1 | `profiles_update_self` WITH CHECK pins `active_tenant_id`, `tenant_id`, `primary_branch_id`, `status`, `deleted_at`, `deleted_by` | `pg_policy` |
| 2 | `profiles.active_tenant_id` is `uuid` NULL with FK to `organizations`; `set_active_organization()` is SECURITY DEFINER, pins `search_path`, validates membership **and** `status='active'`; EXECUTE granted to `authenticated`, denied to `anon` | `information_schema`, `pg_proc`, `has_function_privilege` |
| 3 | Token hook reads `active_tenant_id`, filters `user_roles.deleted_at` + `roles.deleted_at` + profile `status`/`deleted_at`, scopes roles to the active organization only, and coalesces the null tenant so `jsonb_set`'s STRICT behaviour cannot return NULL | `pg_get_functiondef` |
| 4 | `guard_user_role_integrity()` no longer requires `profiles.tenant_id = NEW.tenant_id` (multi-org membership insertable) while still enforcing branch-belongs-to-organization; `organizations_select`, `profiles_select`, `profiles_update_admin` all resolve via `user_roles` | `pg_get_functiondef`, `pg_policy` |
| 5 | `accept_organization_invite` has no "already belongs to a different organization" rejection, seeds `profiles.tenant_id` only when NULL, sets `active_tenant_id` only when NULL | `pg_get_functiondef` |
| 6 | `sync_devices` has no `tenant_id`/`branch_id`; FORCE RLS on `sync_devices` + `sync_operations`; `sync_validate_device` returns `uuid` and checks ownership + revocation; no sync function references `current_tenant_id()`; internal helpers not EXECUTE-able by `authenticated`/`anon`; inner processor takes 3 args (no batch-level tenant) | `pg_proc`, `pg_class`, `has_function_privilege` |

`assert_schema_invariants()` — executed, no violations.
Row counts before and after — 0 users / 0 orgs / 0 profiles / 0 devices / 0 operations / 0 branches.

**Test-coverage gap found and closed.** A textual ordering check on
`is_authorized_for_branch()` produced a false negative (the word "owner" appears in an
explanatory comment above the branch check). Reading the body confirmed the ordering is
correct — but it revealed that no *behavioural* test covered the cross-organization
branch case. S2 only covered an unauthorized branch inside the actor's own organization.

Added **S2b** to `tests/sql/security_multiorg_sync.sql` and executed it: a user who is
**owner** in Bakery A (organization-wide authority) submitting an operation for Bakery A
that names Branch B2 (a branch of Bakery B) is refused, and zero rows are written.
Fixtures were removed; counts returned to 0.

Security suite is now **16 assertions** (S1, S2, S2b, S3, S4, S5a–d, S6–S13, G1, G2).

**No implementation work was performed. B7 was not started.**
