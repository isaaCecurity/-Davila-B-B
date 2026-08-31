# Supabase Migration History & Governance

**Status:** STALE — reopened as BLOCKER-002 2026-08-31. This document's "37 tables... RLS
policies" claim was verified false against the live database the same day: the baseline file
has 23 tables and zero RLS policies/functions/triggers, and this document's own inventory
table stops at 2026-08-10, roughly three weeks behind the live schema. See `BLOCKERS.md`
BLOCKER-002 for full detail. Do not treat this file as an accurate reconciliation until that
blocker is resolved — the rules in §3 are still fine to follow for new migrations, but §1/§2's
factual claims are not current.

**Supabase Project ID:** `tvfyxpafbpnkneujcnvr`

---

## 1. Overview

This document reconciles the migration tracking history between the live Supabase database and the local git repository (resolving **BLOCKER-002**).

Historically:
- The live database holds 17 applied migrations (`20260809191552` … `20260810182611`).
- The local repository retains 14 granular migration files in `supabase/migrations/` plus a baseline schema snapshot (`20260809_live_schema.sql`).

Per architecture decisions, the local `.sql` files are retained for historical context while `20260809_live_schema.sql` serves as the authoritative baseline DDL.

---

## 2. Remote vs. Local Migration Inventory

| Timestamp / File | Subject / Scope | Status |
|---|---|---|
| `20260809_live_schema.sql` | Consolidated Baseline DDL (37 tables, constraints, RLS policies) | Repo Baseline |
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

---

## 3. Governance Rules for Future Migrations

1. **New Migrations**: Create timestamps using standard Supabase naming: `YYYYMMDDHHMMSS_description.sql`.
2. **Explicit `tenant_id`**: Every new table must carry `tenant_id UUID NOT NULL REFERENCES organizations(id)` and RLS enabled + forced (`ALTER TABLE ... FORCE ROW LEVEL SECURITY`).
3. **No Destructive Drops**: Never drop business data tables. Use soft-delete or archiving per `CLAUDE.md` rules.
