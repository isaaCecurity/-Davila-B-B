# Supabase Migration History & Governance

**Status:** Reconciled 2026-08-31 (supersedes the 2026-08-20 version of this document, which
made a false coverage claim that stood undetected for ~3 weeks — see §4 for what actually
happened and BLOCKERS.md BLOCKER-002 for full detail).

**Supabase Project ID:** `tvfyxpafbpnkneujcnvr`

---

## 1. Overview

`20260809_live_schema.sql` is the authoritative baseline DDL for the `public` schema (plus the
minimal `storage` objects BakeFlow depends on: bucket rows and `storage.objects` policies). It
was regenerated from scratch 2026-08-31 via live introspection against the production database
(not `pg_dump` — see the file's own header for why), and its coverage was verified against live
`COUNT` queries at generation time: **40 tables, 173 foreign keys, 138 check constraints, 238
non-constraint indexes, 98 functions (97 public + 1 private), 58 triggers, 40/40 tables RLS
enabled AND forced, 104 public-schema RLS policies + 4 storage.objects policies.** These counts
are restated in the file's own header — treat that header, not this document, as the current
source of truth for exact figures, since it is regenerated alongside the DDL and this document
is not.

The 14 granular `.sql` migration files below `20260809_live_schema.sql` are retained for
historical/audit context only. They do NOT need to be replayed to reconstruct the schema — the
baseline file alone is sufficient, since it reflects the schema as it stands today, not as it
stood after any specific one of them.

---

## 2. Remote vs. Local Migration Inventory

**This table is a historical snapshot as of 2026-08-10 and is known to be roughly three weeks
stale relative to the live database** (which has had dozens of further migrations applied since,
across P3.7's several vertical slices and other work — see `IMPLEMENTATION_LOG.md` for the
detailed, dated record of each). It is kept for its original historical value, not as a current
inventory. Do not use it to answer "what does the live schema look like today" — use
`20260809_live_schema.sql`'s own header counts, or query the live database directly, for that.

| Timestamp / File | Subject / Scope | Status |
|---|---|---|
| `20260809_live_schema.sql` | Consolidated baseline DDL — regenerated 2026-08-31, see §1 | Repo Baseline |
| `20260809190000_fix_rls_helper_execute_grants.sql` | RLS helper function execution security | Local Historical |
| `20260809190100_harden_role_grants.sql` | Role permission grants hardening | Local Historical |
| `20260809190200_fix_offline_sync_tenancy.sql` | Offline sync tenancy fixes | Local Historical |
| `20260809190300_index_foreign_keys.sql` | Foreign key performance indexes | Local Historical |
| `20260809200000_lock_down_function_execute_grants.sql` | Function execute ACL locking | Local Historical |
| `20260809200100_harden_access_token_hook.sql` | Custom access token JWT claims hook | Local Historical |
| `20260809200200_revoke_dormant_grants_and_force_rls.sql` | Force RLS on all tenant tables | Local Historical |
| `20260809200300_restrict_secret_hash_columns.sql` | Token hash column privacy | Local Historical |
| `20260809200400_integrity_indexes_and_timeouts.sql` | Statement timeouts & integrity indexes | Local Historical |
| `20260810110000_add_ticket_fulfilled_at.sql` | Fulfilment timestamp on tickets | Local Historical |
| `20260810120000_reporting_views.sql` | Financial & operational reporting views | Local Historical |
| `20260810130000_storage_buckets_and_policies.sql` | Storage buckets & isolated RLS policies | Local Historical |
| `20260810140000_multi_organization_membership.sql` | Multi-tenant organization user membership | Local Historical |
| *(everything after 2026-08-10)* | Every P3.7 slice, financial hardening, security fixes, etc. | Applied live via `mcp__supabase__apply_migration`, not written as files here — see `IMPLEMENTATION_LOG.md` |

---

## 3. Governance Rules for Future Migrations

1. **New Migrations**: Create timestamps using standard Supabase naming: `YYYYMMDDHHMMSS_description.sql`.
2. **Explicit `tenant_id`**: Every new table must carry `tenant_id UUID NOT NULL REFERENCES organizations(id)` and RLS enabled + forced (`ALTER TABLE ... FORCE ROW LEVEL SECURITY`).
3. **No Destructive Drops**: Never drop business data tables. Use soft-delete or archiving per `CLAUDE.md` rules.
4. **Keep the baseline honest (new, 2026-08-31).** This is the rule whose absence caused
   BLOCKER-002 in the first place: after any migration that adds/drops a table, function,
   trigger, or RLS policy, regenerate `20260809_live_schema.sql` using the same live-
   introspection method (see its own header) and re-run the acceptance-criteria count
   comparison — do not just assume it still matches. A baseline nobody re-checks will drift
   silently, exactly as happened here for three weeks. If regenerating immediately isn't
   practical for a given change, at minimum update the header's verified-counts block to note
   it's now stale, rather than leaving a false "accurate as of" claim standing — a stale-but-
   labeled baseline is recoverable; a stale-and-confidently-labeled one is what caused this.
5. **Never claim a coverage number without having just verified it.** BLOCKER-002 happened
   because a document asserted specific counts ("37 tables... RLS policies") that were never
   actually checked against the live database at the time they were written, and nothing ever
   re-checked them afterward. Any future claim in this file of the shape "N tables/policies/
   functions" must be backed by a `COUNT(*)` run in the same session that states it.

---

## 4. What actually went wrong (2026-08-20 → 2026-08-31), for the record

The 2026-08-20 version of this document and of `20260809_live_schema.sql` claimed the baseline
covered "all 37 core tables... and forced RLS policies." Live-verified 2026-08-31 (during a
project-progress review, not a migration task) to be false: the file had 23 `CREATE TABLE`
statements and zero `CREATE POLICY`/`ENABLE ROW LEVEL SECURITY`/`CREATE FUNCTION`/
`CREATE TRIGGER` statements — meaning even the 23 tables it did define carried no security or
business logic at all. Entire domains built after 2026-08-10 (production, financial, offline
sync, driver trips, audit) were absent. `.github/workflows/ci.yml`'s own comment, which still
described this as unresolved, turned out to be the accurate account; this document's "RESOLVED"
status was the error. See `BLOCKERS.md` BLOCKER-002 and `IMPLEMENTATION_LOG.md` 2026-08-31 for
the full timeline, including the count-by-count verification performed against the live
database before this reconciliation was trusted.
