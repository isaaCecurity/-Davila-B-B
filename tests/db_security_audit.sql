-- =====================================================================================
-- BakeFlow — Database Security & Integrity Audit
-- =====================================================================================
--
-- A single read-only script that audits the live Postgres/Supabase database for
-- tenant leaks, privilege-escalation surface, broken invariants and operational risk.
-- It writes nothing: everything runs inside a transaction that ends in ROLLBACK.
--
-- RUN IT
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/db_security_audit.sql
--
--   Non-blocking (report only, always exit 0):
--     PGOPTIONS="-c bakeflow.fail_on=none" psql "$DATABASE_URL" -f tests/db_security_audit.sql
--
--   Fail threshold (default 'high'): 'critical' | 'high' | 'medium' | 'low' | 'none'
--     PGOPTIONS="-c bakeflow.fail_on=medium" psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ...
--
--   It can also be pasted whole into the Supabase SQL editor — the report is the
--   second-to-last result set; the exit-code gate is a no-op there.
--
-- WHO TO RUN IT AS
--
--   The database owner / service role. Sections A–F, H–K need catalog and cross-tenant
--   visibility. Section G deliberately drops to `anon` and `authenticated` inside the
--   transaction to prove isolation from the outside; if the connecting role cannot
--   SET ROLE, section G self-reports as SKIPPED rather than silently passing.
--
-- WHAT "PASS" MEANS
--
--   Zero rows at CRITICAL or HIGH. MEDIUM/LOW/INFO rows are a backlog, not a gate.
--   Every check carries a stable check_id — suppress a reviewed-and-accepted finding
--   by adding its id to _cfg_suppressed near the top, with a comment saying why.
--
-- Checks are grouped:
--   A  Tenancy model            (CLAUDE.md Core Rules 1, 2, 3, 10)
--   B  Row-Level Security       (Core Rule 4)
--   C  Grants & API exposure    (PostgREST attack surface)
--   D  Functions & RPC security (SECURITY DEFINER, search_path, JWT minting)
--   E  Immutability & audit     (Core Rules 7, 8, 9)
--   F  Types & money precision  (Core Rules 5, 6)
--   G  Live isolation probes    (actual queries as anon / as a foreign tenant)
--   H  Data-level leaks         (cross-tenant rows, ledger reconciliation)
--   I  Secrets & PII hygiene
--   J  Availability & DoS surface
--   K  Platform config drift
--
-- =====================================================================================

BEGIN;

SET LOCAL statement_timeout = '600s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '600s';

-- -------------------------------------------------------------------------------------
-- 0. Findings sink + configuration
-- -------------------------------------------------------------------------------------

CREATE TEMPORARY TABLE _findings (
  seq         serial primary key,
  severity    text not null check (severity in ('CRITICAL','HIGH','MEDIUM','LOW','INFO','SKIP')),
  section     text not null,
  check_id    text not null,
  object_name text,
  detail      text,
  remediation text
) ON COMMIT DROP;

-- Tables that are platform-owned, not tenant-owned. They legitimately have no tenant_id
-- and their policies legitimately do not filter by it.
CREATE TEMPORARY TABLE _cfg_platform_tables (t text primary key) ON COMMIT DROP;
INSERT INTO _cfg_platform_tables VALUES
  ('organizations'),        -- the tenant root: it IS the tenant
  ('roles'),                -- platform-defined, seeded by migration
  ('permissions'),          -- platform-defined
  ('role_permissions');     -- platform-defined role→permission map

-- Append-only ledgers. No UPDATE, no DELETE, ever — enforced by trigger AND by the
-- absence of UPDATE/DELETE policies and grants.
CREATE TEMPORARY TABLE _cfg_append_only (t text primary key) ON COMMIT DROP;
INSERT INTO _cfg_append_only VALUES
  ('stock_movements'), ('payments'), ('refunds'), ('audit_log');

-- Business-critical: never hard-deleted (Core Rule 8). DELETE grants/policies are a bug.
CREATE TEMPORARY TABLE _cfg_no_delete (t text primary key) ON COMMIT DROP;
INSERT INTO _cfg_no_delete VALUES
  ('stock_movements'), ('payments'), ('refunds'), ('audit_log'),
  ('cash_sessions'), ('daily_financial_audits'), ('tickets'), ('ticket_items'),
  ('invoices'), ('deliveries'), ('production_batches'), ('organizations'), ('branches');

-- Tables with a documented reason for missing created_at/updated_at.
CREATE TEMPORARY TABLE _cfg_no_timestamps (t text primary key) ON COMMIT DROP;
INSERT INTO _cfg_no_timestamps VALUES
  ('audit_log'),                      -- occurred_at is the event time; an immutable log has no update time
  ('sync_changes'),                   -- changed_at; append-only replication feed
  ('sync_operations'),                -- received_at / applied_at
  ('permanent_deletion_challenges'),  -- single-use challenge, created_at only
  ('role_permissions'),               -- static seed map
  ('roles');                          -- static seed table

-- The functions every RLS policy calls. If `authenticated` loses EXECUTE on these,
-- every policy raises 42501 and the whole app reads zero rows.
CREATE TEMPORARY TABLE _cfg_rls_helpers (f text primary key) ON COMMIT DROP;
INSERT INTO _cfg_rls_helpers VALUES
  ('public.current_tenant_id()'),
  ('public.has_role(text[])'),
  ('public.has_branch_access(uuid)');

-- Functions in the `private` schema that authenticated is *meant* to be able to call
-- (they are referenced from policy expressions, which requires EXECUTE).
CREATE TEMPORARY TABLE _cfg_private_callable (f text primary key) ON COMMIT DROP;
INSERT INTO _cfg_private_callable VALUES
  ('can_manage_target_role');

-- Tables carrying a branch_id that is an attribute rather than an access scope —
-- identity and device records, where the access control is "is it mine" or "am I an
-- admin", not "do I work at that branch". Exempt from the has_branch_access check.
CREATE TEMPORARY TABLE _cfg_branch_scope_exempt (t text primary key) ON COMMIT DROP;
INSERT INTO _cfg_branch_scope_exempt VALUES
  ('branch_assignments'),      -- branch_id is the subject of the row, not its scope
  ('user_roles'),
  ('organization_invites'),
  ('sync_devices'),
  ('sync_changes'),
  ('sync_operations');

-- Primary keys that are deliberately not UUIDs.
CREATE TEMPORARY TABLE _cfg_pk_exempt (t text primary key, reason text) ON COMMIT DROP;
INSERT INTO _cfg_pk_exempt VALUES
  ('profiles',     'id mirrors auth.users.id'),
  ('sync_changes', 'sequence_id is a monotonic replication cursor; clients page on it, so it must be ordered');

-- Roles the platform itself owns and which legitimately hold BYPASSRLS/SUPERUSER.
CREATE TEMPORARY TABLE _cfg_platform_roles (r text primary key) ON COMMIT DROP;
INSERT INTO _cfg_platform_roles VALUES
  ('postgres'), ('service_role'), ('supabase_admin'), ('supabase_auth_admin'),
  ('supabase_storage_admin'), ('supabase_replication_admin'), ('supabase_read_only_user'),
  ('supabase_etl_admin'), ('pgbouncer'), ('pg_read_all_data');

-- Reviewed-and-accepted findings. Add a check_id here to suppress it; say why.
CREATE TEMPORARY TABLE _cfg_suppressed (check_id text primary key, reason text) ON COMMIT DROP;
INSERT INTO _cfg_suppressed VALUES
  ('C7', 'the only column ACLs are the deliberate ones from 20260809200300: token_hash on '
      || 'organization_invites and confirmation_phrase_hash on permanent_deletion_challenges are '
      || 'withheld from authenticated. Re-check by hand if this list ever grows.');
-- INSERT INTO _cfg_suppressed VALUES ('A7', 'schema uses tickets/*; rename tracked in PROJECT-OVERVIEW §7');

-- Convenience view: every tenant-owned base table in public.
CREATE TEMPORARY VIEW _tenant_tables AS
  SELECT c.oid, c.relname AS t
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND c.relname NOT IN (SELECT t FROM _cfg_platform_tables);

-- Convenience view: table privileges held by client-facing roles, resolved from the ACL
-- (information_schema hides grants made by roles the caller cannot see).
CREATE TEMPORARY VIEW _client_grants AS
  SELECT c.relname AS t,
         CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
         a.privilege_type,
         c.relkind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r'::"char", c.relowner))) a
  WHERE n.nspname = 'public'
    AND (a.grantee = 0 OR a.grantee::regrole::text IN ('anon','authenticated'));


-- =====================================================================================
-- A. TENANCY MODEL — Core Rules 1, 2, 3, 10
-- =====================================================================================

-- A1: every tenant-owned table must carry tenant_id. Without it there is nothing for
-- RLS to filter on and no way to attribute a row to a bakery.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'CRITICAL', 'A. Tenancy', 'A1', tt.t,
       'table has no tenant_id column',
       'ADD COLUMN tenant_id uuid NOT NULL REFERENCES organizations(id), backfill, then add the RLS policy'
FROM _tenant_tables tt
WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema='public' AND c.table_name=tt.t AND c.column_name='tenant_id');

-- A2: a nullable tenant_id is a row that belongs to nobody and is filtered by nothing.
-- profiles is the documented exception: NULL until the user joins an organization.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'A. Tenancy', 'A2', c.table_name,
       'tenant_id is NULLABLE — NULL never equals current_tenant_id(), so such rows are invisible to RLS but visible to service-role reads',
       'backfill and SET NOT NULL, or document the exception'
FROM information_schema.columns c
WHERE c.table_schema='public' AND c.column_name='tenant_id' AND c.is_nullable='YES'
  AND c.table_name <> 'profiles';

-- A3: tenant_id must actually reference organizations, or it is a free-text label.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'A. Tenancy', 'A3', c.table_name,
       'tenant_id has no FOREIGN KEY to organizations(id)',
       'ADD CONSTRAINT ... FOREIGN KEY (tenant_id) REFERENCES organizations(id)'
FROM information_schema.columns c
WHERE c.table_schema='public' AND c.column_name='tenant_id'
  AND c.table_name IN (SELECT t FROM _tenant_tables)
  AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class ch  ON ch.oid = con.conrelid
    JOIN pg_class par ON par.oid = con.confrelid
    JOIN pg_attribute a ON a.attrelid = ch.oid AND a.attnum = ANY (con.conkey)
    WHERE con.contype='f' AND ch.relname=c.table_name
      AND par.relname='organizations' AND a.attname='tenant_id');

-- A4: canonical column name. Any alias fragments the tenant predicate across the schema.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'CRITICAL', 'A. Tenancy', 'A4', c.table_name || '.' || c.column_name,
       'non-canonical tenant column name — CLAUDE.md Core Rule 2 mandates tenant_id',
       'rename to tenant_id and update every policy, index and RPC that referenced it'
FROM information_schema.columns c
WHERE c.table_schema='public'
  AND c.column_name IN ('organization_id','bakery_id','company_id','org_id');

-- A5: Core Rule 3 — no JWT-derived DEFAULT on tenant_id. A default silently writes NULL
-- (or the wrong tenant) for service-role work, migrations and seeds.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'A. Tenancy', 'A5', c.table_name,
       'tenant_id has DEFAULT ' || c.column_default || ' — Core Rule 3 forbids a JWT-derived default',
       'DROP DEFAULT; set tenant_id explicitly on every insert'
FROM information_schema.columns c
WHERE c.table_schema='public' AND c.column_name='tenant_id' AND c.column_default IS NOT NULL;

-- A6: branch_id must reference branches, else branch scoping is decorative.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'A. Tenancy', 'A6', c.table_name,
       'branch_id has no FOREIGN KEY to branches(id)',
       'ADD CONSTRAINT ... FOREIGN KEY (branch_id) REFERENCES branches(id)'
FROM information_schema.columns c
WHERE c.table_schema='public' AND c.column_name='branch_id'
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class ch ON ch.oid=con.conrelid
    JOIN pg_class par ON par.oid=con.confrelid
    JOIN pg_attribute a ON a.attrelid=ch.oid AND a.attnum = ANY (con.conkey)
    WHERE con.contype='f' AND ch.relname=c.table_name
      AND par.relname='branches' AND a.attname='branch_id');

-- A7: naming. CLAUDE.md: "Ticket is not a BakeFlow entity" — the canonical noun is Order.
-- Informational: the live schema may legitimately be ahead of the docs, but the two must
-- be reconciled in one direction or the other rather than left to drift.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'INFO', 'A. Tenancy', 'A7', c.relname,
       'table name uses "ticket" — CLAUDE.md domain vocabulary says Order',
       'either rename to orders/order_items, or amend CLAUDE.md + PROJECT-OVERVIEW §7 to adopt Ticket'
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relname ~ 'ticket';

-- A8: lowercase plural snake_case (Core Rule 10).
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'LOW', 'A. Tenancy', 'A8', c.relname,
       'table name is not lowercase snake_case',
       'rename per Core Rule 10'
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relname !~ '^[a-z][a-z0-9_]*$';


-- =====================================================================================
-- B. ROW-LEVEL SECURITY — Core Rule 4
-- =====================================================================================

-- B1: RLS off on a table the API can reach means every authenticated user of every
-- bakery reads every row. This is the single highest-impact failure mode.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'CRITICAL', 'B. RLS', 'B1', c.relname,
       'ROW LEVEL SECURITY is DISABLED',
       'ALTER TABLE ' || c.relname || ' ENABLE ROW LEVEL SECURITY;'
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;

-- B2: FORCE RLS. Without it the table owner — and therefore every SECURITY DEFINER
-- function owned by that role — bypasses RLS. Severity depends on B2a below: if the
-- owner also holds BYPASSRLS then FORCE is inert and this is hygiene, not a hole.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT CASE WHEN r.rolbypassrls OR r.rolsuper THEN 'LOW' ELSE 'HIGH' END,
       'B. RLS', 'B2', c.relname,
       'RLS is enabled but NOT FORCED — owner ' || r.rolname ||
       CASE WHEN r.rolbypassrls OR r.rolsuper
            THEN ' already bypasses RLS unconditionally, so FORCE would be inert here; setting it is uniformity, not protection'
            ELSE ' and every SECURITY DEFINER function owned by it bypass all policies' END,
       'ALTER TABLE ' || c.relname || ' FORCE ROW LEVEL SECURITY;'
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_roles r ON r.oid = c.relowner
WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity;

-- B2a: the reason B2 is usually toothless on Supabase. A role with BYPASSRLS ignores
-- RLS entirely — FORCE included. Every SECURITY DEFINER function owned by such a role
-- runs with no policy enforcement at all, so its own body is the only tenant boundary.
-- That is a deliberate platform choice, not a defect; it is recorded here because it
-- determines how much weight the rest of section B can carry.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'INFO', 'B. RLS', 'B2a', r.rolname,
       'owns ' || count(*) || ' table(s) in public and holds ' ||
       CASE WHEN r.rolsuper THEN 'SUPERUSER' ELSE 'BYPASSRLS' END ||
       ' — RLS never applies to it, so SECURITY DEFINER functions it owns are bounded only by their own tenant checks (see D9)',
       'no action if this is the platform owner; it means policy review alone is not sufficient assurance — the RPC bodies must be reviewed too'
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_roles r ON r.oid=c.relowner
WHERE n.nspname='public' AND c.relkind='r' AND (r.rolbypassrls OR r.rolsuper)
GROUP BY r.rolname, r.rolsuper, r.rolbypassrls;

-- B3: a client-facing policy on a tenant table that never mentions tenant_id is a
-- cross-tenant read or write, by definition.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'CRITICAL', 'B. RLS', 'B3', p.tablename || '.' || p.policyname,
       cmd || ' policy does not constrain tenant_id',
       'add (tenant_id = current_tenant_id()) to USING and WITH CHECK'
FROM pg_policies p
WHERE p.schemaname='public'
  AND (p.roles && ARRAY['authenticated','anon','public']::name[])
  AND p.tablename IN (SELECT t FROM _tenant_tables)
  AND EXISTS (SELECT 1 FROM information_schema.columns c
              WHERE c.table_schema='public' AND c.table_name=p.tablename AND c.column_name='tenant_id')
  AND coalesce(p.qual,'') || coalesce(p.with_check,'') NOT LIKE '%tenant_id%';

-- B4: an unconditional USING (true) on a tenant table.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'CRITICAL', 'B. RLS', 'B4', p.tablename || '.' || p.policyname,
       'policy qualifier is unconditional (true) on a tenant-owned table',
       'replace with a tenant-scoped predicate'
FROM pg_policies p
WHERE p.schemaname='public'
  AND (p.roles && ARRAY['authenticated','anon','public']::name[])
  AND p.tablename IN (SELECT t FROM _tenant_tables)
  AND btrim(coalesce(p.qual,'')) = 'true';

-- B5: a policy granted to PUBLIC applies to anon as well as authenticated.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'B. RLS', 'B5', p.tablename || '.' || p.policyname,
       'policy is granted to role ' || array_to_string(p.roles, ',') ||
       ' — PUBLIC/anon includes unauthenticated callers',
       'restrict the policy TO authenticated'
FROM pg_policies p
WHERE p.schemaname='public' AND (p.roles && ARRAY['public','anon']::name[]);

-- B6: an UPDATE policy whose WITH CHECK omits tenant_id lets a row be *moved* into
-- another tenant even though the USING clause was tenant-scoped.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'B. RLS', 'B6', p.tablename || '.' || p.policyname,
       'UPDATE policy has a WITH CHECK that does not pin tenant_id — the new row version can be written into another tenant',
       'add (tenant_id = current_tenant_id()) to WITH CHECK'
FROM pg_policies p
WHERE p.schemaname='public' AND p.cmd='UPDATE'
  AND (p.roles && ARRAY['authenticated','anon','public']::name[])
  AND p.tablename IN (SELECT t FROM _tenant_tables)
  AND p.with_check IS NOT NULL
  AND p.with_check NOT LIKE '%tenant_id%';

-- B7: branch-scoped tables whose policies never call has_branch_access — a cashier at
-- branch A reads branch B. Tenant isolation holds; branch isolation does not.
-- Only applies where branch_id is mandatory (a real scope) and the policy is not
-- already narrowed to the calling user's own rows, which is stricter than branch scope.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'B. RLS', 'B7', p.tablename || '.' || p.policyname,
       p.cmd || ' policy on a branch-scoped table does not call has_branch_access()',
       'add has_branch_access(branch_id), or add the table to _cfg_branch_scope_exempt'
FROM pg_policies p
WHERE p.schemaname='public'
  AND (p.roles && ARRAY['authenticated']::name[])
  AND p.tablename NOT IN (SELECT t FROM _cfg_branch_scope_exempt)
  AND EXISTS (SELECT 1 FROM information_schema.columns c
              WHERE c.table_schema='public' AND c.table_name=p.tablename
                AND c.column_name='branch_id' AND c.is_nullable='NO')
  AND coalesce(p.qual,'') || coalesce(p.with_check,'') NOT LIKE '%has_branch_access%'
  AND coalesce(p.qual,'') || coalesce(p.with_check,'') NOT LIKE '%branch_id%'
  AND coalesce(p.qual,'') || coalesce(p.with_check,'') NOT LIKE '%auth.uid()%';

-- B8: soft-deleted rows leaking through a SELECT policy that forgot deleted_at.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'B. RLS', 'B8', p.tablename || '.' || p.policyname,
       'SELECT policy does not filter deleted_at — archived rows remain readable',
       'add (deleted_at IS NULL) to USING'
FROM pg_policies p
WHERE p.schemaname='public' AND p.cmd IN ('SELECT','ALL')
  AND (p.roles && ARRAY['authenticated']::name[])
  AND EXISTS (SELECT 1 FROM information_schema.columns c
              WHERE c.table_schema='public' AND c.table_name=p.tablename AND c.column_name='deleted_at')
  AND coalesce(p.qual,'') NOT LIKE '%deleted_at%';

-- B9: RLS on, but no policy at all for authenticated — the table is a black hole.
-- Not a leak, but it silently breaks features and hides real access bugs.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'B. RLS', 'B9', c.relname,
       'RLS enabled but no policy exists for authenticated — all client reads return zero rows',
       'add a policy, or drop the client GRANTs so the intent is explicit'
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
  AND NOT EXISTS (SELECT 1 FROM pg_policies p
                  WHERE p.schemaname='public' AND p.tablename=c.relname
                    AND p.roles && ARRAY['authenticated']::name[]);

-- B10: RESTRICTIVE vs PERMISSIVE. Multiple permissive policies OR together — a common
-- way to accidentally widen access when a second policy is added later.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'LOW', 'B. RLS', 'B10', p.tablename || ' (' || p.cmd || ')',
       count(*) || ' PERMISSIVE policies for the same command are OR-ed together — widest one wins',
       'confirm the union is intended; consider a RESTRICTIVE tenant policy as a floor'
FROM pg_policies p
WHERE p.schemaname='public' AND p.permissive='PERMISSIVE'
  AND p.roles && ARRAY['authenticated']::name[]
GROUP BY p.tablename, p.cmd
HAVING count(*) > 1;


-- =====================================================================================
-- C. GRANTS & API EXPOSURE
-- =====================================================================================

-- C1: anon is an unauthenticated internet caller. It should hold nothing in public.
-- RLS is a second line of defence, not the first.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'CRITICAL', 'C. Grants', 'C1', g.t,
       'anon holds ' || string_agg(DISTINCT g.privilege_type, ',') || ' — reachable unauthenticated via PostgREST',
       'REVOKE ALL ON ' || g.t || ' FROM anon;'
FROM _client_grants g
WHERE g.grantee='anon' AND g.relkind='r'
GROUP BY g.t;

-- C2: grants to PUBLIC reach every role including anon.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'CRITICAL', 'C. Grants', 'C2', g.t,
       'PUBLIC holds ' || string_agg(DISTINCT g.privilege_type, ','),
       'REVOKE ALL ON ' || g.t || ' FROM PUBLIC;'
FROM _client_grants g
WHERE g.grantee='PUBLIC' AND g.relkind='r'
GROUP BY g.t;

-- C3: TRUNCATE, TRIGGER and REFERENCES are not row-filtered. TRUNCATE erases a table
-- past RLS and past every immutability trigger; TRIGGER lets a client attach code that
-- runs as the table owner.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'C. Grants', 'C3', g.t,
       g.grantee || ' holds ' || g.privilege_type || ' — this privilege is not subject to RLS',
       'REVOKE ' || g.privilege_type || ' ON ' || g.t || ' FROM ' || g.grantee || ';'
FROM _client_grants g
WHERE g.privilege_type IN ('TRUNCATE','TRIGGER','REFERENCES') AND g.relkind='r';

-- C4: DELETE on an append-only ledger or a business-critical record (Core Rule 8).
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'C. Grants', 'C4', g.t,
       g.grantee || ' holds DELETE on a table that must never be hard-deleted',
       'REVOKE DELETE ON ' || g.t || ' FROM ' || g.grantee || '; use deleted_at instead'
FROM _client_grants g
WHERE g.privilege_type='DELETE' AND g.relkind='r'
  AND g.t IN (SELECT t FROM _cfg_no_delete);

-- C5: a grant with no matching policy. Harmless today because RLS denies by default —
-- but the day someone adds a policy for that command, the grant silently goes live.
-- This is how "stock levels are never written directly" quietly stops being true.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'C. Grants', 'C5', g.t,
       'authenticated holds ' || g.privilege_type || ' but no ' || g.privilege_type ||
       ' policy exists — the grant is dormant and will activate the moment a policy is added',
       'REVOKE ' || g.privilege_type || ' ON ' || g.t || ' FROM authenticated;'
FROM _client_grants g
WHERE g.grantee='authenticated' AND g.relkind='r'
  AND g.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname='public' AND p.tablename=g.t
      AND p.roles && ARRAY['authenticated']::name[]
      AND p.cmd IN (g.privilege_type, 'ALL'));

-- C6: the converse — a policy with no grant behind it. The policy is dead code that
-- reads as protection during review but enforces nothing, and the feature it was
-- written for is silently broken.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'LOW', 'C. Grants', 'C6', p.tablename || '.' || p.policyname,
       p.cmd || ' policy exists but authenticated holds no ' || p.cmd || ' grant — the policy never fires',
       'usually benign: the operation goes through a SECURITY DEFINER RPC, which bypasses both the grant and the policy. ' ||
       'Confirm that is the case, then either drop the dead policy or note it — a reviewer will otherwise read it as enforcement it is not providing'
FROM pg_policies p
WHERE p.schemaname='public' AND p.cmd IN ('SELECT','INSERT','UPDATE','DELETE')
  AND p.roles && ARRAY['authenticated']::name[]
  AND NOT EXISTS (
    SELECT 1 FROM _client_grants g
    WHERE g.grantee='authenticated' AND g.t=p.tablename AND g.privilege_type=p.cmd);

-- C7: column-level ACLs are invisible in most reviews and override nothing about RLS.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'C. Grants', 'C7', c.relname || '.' || a.attname,
       'column-level ACL present: ' || a.attacl::text,
       'confirm intent; column grants are easy to miss when auditing table grants'
FROM pg_attribute a
JOIN pg_class c ON c.oid=a.attrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND a.attacl IS NOT NULL AND a.attnum > 0;

-- C8: sequence privileges let a client call setval and collide document numbering.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'C. Grants', 'C8', g.t,
       g.grantee || ' holds ' || g.privilege_type || ' on a sequence',
       'REVOKE on sequences; allocate numbers through next_document_number() only'
FROM _client_grants g
WHERE g.relkind='S' AND g.privilege_type <> 'SELECT';

-- C9: CREATE on schema public granted to PUBLIC lets any role plant objects that
-- shadow function calls resolved through search_path.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'C. Grants', 'C9', 'schema public',
       'CREATE on schema public is granted to ' || grantee,
       'REVOKE CREATE ON SCHEMA public FROM PUBLIC;'
FROM (
  SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
         a.privilege_type
  FROM pg_namespace n
  CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n'::"char", n.nspowner))) a
  WHERE n.nspname='public'
) s
WHERE privilege_type='CREATE' AND grantee IN ('PUBLIC','anon','authenticated');

-- C10: schema USAGE beyond what the API needs.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'LOW', 'C. Grants', 'C10', n.nspname,
       'anon has USAGE on schema ' || n.nspname,
       'REVOKE USAGE ON SCHEMA ' || n.nspname || ' FROM anon if nothing there is meant to be public'
FROM pg_namespace n
WHERE n.nspname NOT LIKE 'pg_%'
  AND n.nspname NOT IN ('information_schema','public','extensions','graphql_public','storage','realtime','auth')
  AND has_schema_privilege('anon', n.oid, 'USAGE');


-- =====================================================================================
-- D. FUNCTIONS & RPC SECURITY
-- =====================================================================================

-- D1: a SECURITY DEFINER function without a pinned search_path can be hijacked by any
-- role that can create objects in a schema earlier in the caller's search_path. The
-- function then runs attacker code as the owner.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'CRITICAL', 'D. Functions', 'D1', n.nspname || '.' || p.proname,
       'SECURITY DEFINER with no pinned search_path',
       'ALTER FUNCTION ... SET search_path = '''';  -- then schema-qualify every reference'
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','private') AND p.prosecdef
  AND (p.proconfig IS NULL OR NOT (p.proconfig::text LIKE '%search_path%'));

-- D2: trigger functions exposed as RPC. A function returning `trigger` has no business
-- being callable over HTTP; PostgREST publishes everything in the public schema that a
-- client role can EXECUTE. Beyond the noise, a SECURITY DEFINER trigger body invoked
-- outside a trigger context is unvalidated code running as the owner.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT CASE WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'HIGH' ELSE 'MEDIUM' END,
       'D. Functions', 'D2', 'public.' || p.proname || '()',
       'trigger function is EXECUTE-able by ' ||
       concat_ws(' and ',
         CASE WHEN has_function_privilege('anon', p.oid,'EXECUTE') THEN 'anon' END,
         CASE WHEN has_function_privilege('authenticated', p.oid,'EXECUTE') THEN 'authenticated' END) ||
       ' — published at /rest/v1/rpc/' || p.proname,
       'REVOKE EXECUTE ON FUNCTION public.' || p.proname || '() FROM anon, authenticated, PUBLIC;'
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prorettype='pg_catalog.trigger'::regtype
  AND (has_function_privilege('anon', p.oid,'EXECUTE') OR has_function_privilege('authenticated', p.oid,'EXECUTE'));

-- D3: any SECURITY DEFINER function callable by anon runs owner-privileged code for an
-- unauthenticated caller. If it writes, that is an unauthenticated write path.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'CRITICAL', 'D. Functions', 'D3',
       'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       'SECURITY DEFINER function is EXECUTE-able by anon (unauthenticated) — /rest/v1/rpc/' || p.proname ||
       CASE WHEN p.provolatile='v' THEN ' [VOLATILE: may write]' ELSE '' END,
       'REVOKE EXECUTE ... FROM anon; grant only to authenticated'
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prosecdef
  AND p.prorettype <> 'pg_catalog.trigger'::regtype
  AND has_function_privilege('anon', p.oid, 'EXECUTE');

-- D4: the inverse failure. Losing EXECUTE on an RLS helper does not fail open, it fails
-- closed and totally — every policy that calls it raises 42501 and the app reads nothing.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'D. Functions', 'D4', f,
       'authenticated cannot EXECUTE this RLS helper — every policy calling it raises 42501',
       'GRANT EXECUTE ON FUNCTION ' || f || ' TO authenticated;'
FROM _cfg_rls_helpers
WHERE NOT has_function_privilege('authenticated', f, 'EXECUTE');

-- D5: internal helpers (trigger guards, sequence allocators, audit writers) that clients
-- can call directly, bypassing the RPC that was supposed to validate the operation.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'D. Functions', 'D5',
       'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       'internal helper is directly callable by authenticated — bypasses the RPC wrapper''s validation',
       'REVOKE EXECUTE FROM authenticated, or move the function to the private schema'
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prosecdef
  AND p.prorettype <> 'pg_catalog.trigger'::regtype
  AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  AND p.proname ~ '^(log_|next_|assign_|apply_|recalculate_|copy_|handle_|process_sync_batch_)';

-- D6: the JWT minting hook is the root of every RLS decision. If it reads role
-- assignments without excluding soft-deleted rows, a revoked Owner keeps Owner claims;
-- if it ignores profile status, a suspended employee keeps working.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'D. Functions', 'D6', 'public.custom_access_token_hook(jsonb)',
       'the access-token hook selects from user_roles without a deleted_at IS NULL filter — revoked role assignments are still minted into the JWT, and has_role() trusts the JWT',
       'add "and ur.deleted_at is null" (and a roles r.deleted_at filter) to the role aggregation'
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='custom_access_token_hook'
  AND pg_get_functiondef(p.oid) LIKE '%user_roles%'
  AND pg_get_functiondef(p.oid) NOT LIKE '%deleted_at%';

-- D7: same hook, profile lifecycle.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'D. Functions', 'D7', 'public.custom_access_token_hook(jsonb)',
       'the access-token hook does not consult profiles.status — a suspended or archived profile still receives a fully privileged token until it expires',
       'refuse to mint tenant_id/roles when the profile is not active'
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='custom_access_token_hook'
  AND pg_get_functiondef(p.oid) NOT LIKE '%status%';

-- D8: functions in `private` that authenticated can call beyond the allowlist. The
-- private schema is the escape hatch for RLS-sensitive logic; every callable function
-- there is a deliberate hole and should be enumerated.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'D. Functions', 'D8',
       'private.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       'authenticated can EXECUTE a private-schema function that is not on the reviewed allowlist',
       'REVOKE EXECUTE FROM authenticated, or add it to _cfg_private_callable with a justification'
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='private'
  AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  AND p.proname NOT IN (SELECT f FROM _cfg_private_callable);

-- D9: inventory of the write-capable RPC surface, for manual review. Not a defect —
-- but this list is exactly what an attacker enumerates first, so it should be small,
-- known, and each entry should re-derive tenant_id from the JWT rather than trust a
-- caller-supplied parameter.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'INFO', 'D. Functions', 'D9',
       'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       'VOLATILE SECURITY DEFINER RPC callable by authenticated' ||
       CASE WHEN pg_get_functiondef(p.oid) NOT LIKE '%current_tenant_id%'
            THEN ' — body never calls current_tenant_id(); confirm it does not trust a caller-supplied tenant' ELSE '' END,
       'review: tenant must come from the JWT, never from a parameter'
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prosecdef AND p.provolatile='v'
  AND p.prorettype <> 'pg_catalog.trigger'::regtype
  AND has_function_privilege('authenticated', p.oid, 'EXECUTE');


-- =====================================================================================
-- E. IMMUTABILITY, AUDIT & SOFT DELETE — Core Rules 7, 8, 9
-- =====================================================================================

-- E1: an append-only ledger without a BEFORE UPDATE OR DELETE guard. RLS alone does not
-- protect it: service-role code, RPCs and migrations all bypass policies.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'E. Immutability', 'E1', t,
       'append-only ledger has no BEFORE UPDATE OR DELETE guard trigger',
       'CREATE TRIGGER ' || t || '_immutable BEFORE UPDATE OR DELETE ON ' || t ||
       ' FOR EACH ROW EXECUTE FUNCTION prevent_financial_mutation();'
FROM _cfg_append_only c
WHERE to_regclass('public.' || c.t) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM pg_trigger tg
    JOIN pg_class cl ON cl.oid=tg.tgrelid
    JOIN pg_namespace n ON n.oid=cl.relnamespace
    WHERE n.nspname='public' AND cl.relname=c.t AND NOT tg.tgisinternal
      AND pg_get_triggerdef(tg.oid) ~* 'BEFORE (UPDATE OR DELETE|DELETE OR UPDATE)');

-- E2: an UPDATE or DELETE policy on an append-only ledger contradicts the ledger model.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'E. Immutability', 'E2', p.tablename || '.' || p.policyname,
       p.cmd || ' policy exists on an append-only ledger',
       'drop the policy; corrections are new rows (adjustment movements, refund rows)'
FROM pg_policies p
WHERE p.schemaname='public' AND p.tablename IN (SELECT t FROM _cfg_append_only)
  AND p.cmd IN ('UPDATE','DELETE','ALL')
  AND p.roles && ARRAY['authenticated','anon','public']::name[];

-- E3: Core Rule 9 — every table carries created_at/updated_at.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'E. Immutability', 'E3', c.relname,
       'missing ' || concat_ws(' and ',
         CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns col
              WHERE col.table_schema='public' AND col.table_name=c.relname AND col.column_name='created_at')
              THEN 'created_at' END,
         CASE WHEN NOT EXISTS (SELECT 1 FROM information_schema.columns col
              WHERE col.table_schema='public' AND col.table_name=c.relname AND col.column_name='updated_at')
              THEN 'updated_at' END),
       'ADD COLUMN ... timestamptz NOT NULL DEFAULT now()'
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
  AND c.relname NOT IN (SELECT t FROM _cfg_no_timestamps)
  AND NOT (EXISTS (SELECT 1 FROM information_schema.columns col
                   WHERE col.table_schema='public' AND col.table_name=c.relname AND col.column_name='created_at')
       AND EXISTS (SELECT 1 FROM information_schema.columns col
                   WHERE col.table_schema='public' AND col.table_name=c.relname AND col.column_name='updated_at'));

-- E4: an updated_at column with no trigger to maintain it is worse than no column —
-- it reads as an audit trail while recording whatever the client chose to send.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'E. Immutability', 'E4', col.table_name,
       'has updated_at but no BEFORE UPDATE trigger maintaining it — the value is whatever the writer supplies',
       'CREATE TRIGGER ' || col.table_name || '_set_updated_at BEFORE UPDATE ON ' || col.table_name ||
       ' FOR EACH ROW EXECUTE FUNCTION set_updated_at();'
FROM information_schema.columns col
WHERE col.table_schema='public' AND col.column_name='updated_at'
  AND col.table_name NOT IN (SELECT t FROM _cfg_append_only)  -- ledgers are never updated
  AND NOT EXISTS (
    SELECT 1 FROM pg_trigger tg
    JOIN pg_class cl ON cl.oid=tg.tgrelid
    JOIN pg_namespace n ON n.oid=cl.relnamespace
    JOIN pg_proc pr ON pr.oid=tg.tgfoid
    WHERE n.nspname='public' AND cl.relname=col.table_name AND NOT tg.tgisinternal
      AND pr.proname='set_updated_at');

-- E5: soft delete without attribution — Core Rule 9 wants who, not just when.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'LOW', 'E. Immutability', 'E5', col.table_name,
       'has deleted_at but no deleted_by — archival is not attributable',
       'ADD COLUMN deleted_by uuid REFERENCES profiles(id)'
FROM information_schema.columns col
WHERE col.table_schema='public' AND col.column_name='deleted_at'
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns c2
                  WHERE c2.table_schema='public' AND c2.table_name=col.table_name AND c2.column_name='deleted_by');

-- E6: the audit log must be append-only in the strongest sense.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'E. Immutability', 'E6', 'audit_log',
       'audit_log is writable by a client role — an attacker who can insert can forge history, and one who can update can erase it',
       'audit rows should be written only by SECURITY DEFINER functions (log_audit_event); revoke direct INSERT'
FROM _client_grants g
WHERE g.t='audit_log' AND g.privilege_type IN ('INSERT','UPDATE','DELETE');


-- =====================================================================================
-- F. TYPES, MONEY & PRECISION — Core Rules 5, 6
-- =====================================================================================

-- F1: money must be NUMERIC(19,4). Float loses cents; NUMERIC(18,2) loses the
-- sub-kobo precision the finance model rounds from.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT CASE WHEN c.data_type IN ('double precision','real','money') THEN 'CRITICAL' ELSE 'HIGH' END,
       'F. Types', 'F1', c.table_name || '.' || c.column_name,
       'money column is ' || c.data_type ||
       coalesce('(' || c.numeric_precision || ',' || c.numeric_scale || ')','') ||
       ' — Core Rule 5 requires numeric(19,4)',
       'ALTER TABLE ' || c.table_name || ' ALTER COLUMN ' || c.column_name || ' TYPE numeric(19,4);'
FROM information_schema.columns c
WHERE c.table_schema='public'
  AND c.column_name ~ '(amount|price|cost|total|balance|paid|subtotal|discount|tax|variance|float|cash)'
  AND c.column_name !~ '(quantity|qty|count|_days|_at$)'
  AND (c.data_type IN ('double precision','real','money')
       OR (c.data_type='numeric' AND NOT (c.numeric_precision=19 AND c.numeric_scale=4)));

-- F2: physical quantities are NUMERIC(18,4).
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'F. Types', 'F2', c.table_name || '.' || c.column_name,
       'quantity column is ' || c.data_type ||
       coalesce('(' || c.numeric_precision || ',' || c.numeric_scale || ')','') ||
       ' — Core Rule 5 requires numeric(18,4)',
       'ALTER TABLE ' || c.table_name || ' ALTER COLUMN ' || c.column_name || ' TYPE numeric(18,4);'
FROM information_schema.columns c
WHERE c.table_schema='public'
  AND c.column_name ~ '(quantity|qty|yield|weight|volume|reorder_level)'
  AND (c.data_type IN ('double precision','real','money')
       OR (c.data_type='numeric' AND NOT (c.numeric_precision=18 AND c.numeric_scale=4)));

-- F3: percentages are NUMERIC(5,2).
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'F. Types', 'F3', c.table_name || '.' || c.column_name,
       'percentage column is numeric(' || c.numeric_precision || ',' || c.numeric_scale || ') — Core Rule 5 requires numeric(5,2)',
       'ALTER COLUMN ... TYPE numeric(5,2)'
FROM information_schema.columns c
WHERE c.table_schema='public' AND c.data_type='numeric'
  AND c.column_name ~ '(percent|pct|_rate$)'
  AND NOT (c.numeric_precision=5 AND c.numeric_scale=2);

-- F4: primary keys are uuid DEFAULT gen_random_uuid() (Core Rule 6). A sequential PK
-- leaks business volume and makes enumeration attacks trivial when RLS has a hole.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'F. Types', 'F4', c.relname || '.' || a.attname,
       'primary key is ' || format_type(a.atttypid, a.atttypmod) ||
       coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), ' with no default') ||
       ' — Core Rule 6 requires uuid DEFAULT gen_random_uuid()',
       'migrate to uuid, or record the exception'
FROM pg_index i
JOIN pg_class c ON c.oid=i.indrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum = ANY (i.indkey)
LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
WHERE n.nspname='public' AND i.indisprimary AND c.relkind='r'
  AND array_length(i.indkey::int[], 1) = 1
  AND (a.atttypid <> 'uuid'::regtype
       OR coalesce(pg_get_expr(d.adbin, d.adrelid),'') NOT LIKE '%gen_random_uuid%')
  AND c.relname NOT IN (SELECT t FROM _cfg_pk_exempt);

-- F5: timestamps must be timestamptz. A naive timestamp silently reinterprets under a
-- different server timezone, which for a cash-session close is a financial defect.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'F. Types', 'F5', c.table_name || '.' || c.column_name,
       'time column is ' || c.data_type || ' — must be timestamptz',
       'ALTER COLUMN ... TYPE timestamptz'
FROM information_schema.columns c
WHERE c.table_schema='public'
  AND c.data_type IN ('timestamp without time zone','time without time zone');

-- F6: money columns with no non-negativity constraint. Nothing stops a negative payment
-- from being used as a refund that bypasses the refunds ledger.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'F. Types', 'F6', c.table_name || '.' || c.column_name,
       'money column has no CHECK constraint bounding it — a negative amount can be inserted',
       'ADD CONSTRAINT ' || c.table_name || '_' || c.column_name || '_nonneg CHECK (' || c.column_name || ' >= 0)'
FROM information_schema.columns c
WHERE c.table_schema='public' AND c.data_type='numeric'
  AND c.table_name IN ('payments','refunds','expenses','invoices','ticket_items')
  AND c.column_name IN ('amount','total_amount','unit_price','line_total')
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class cl ON cl.oid=con.conrelid
    WHERE cl.relname=c.table_name AND con.contype='c'
      AND pg_get_constraintdef(con.oid) LIKE '%' || c.column_name || '%');

-- F7: status columns without a CHECK or enum accept any string, defeating the state
-- machines in docs/STATE-MACHINES.md.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'F. Types', 'F7', c.table_name || '.' || c.column_name,
       'status column is unconstrained text — any value is accepted, so the state machine is enforced only by triggers',
       'ADD a CHECK (status IN (...)) matching docs/STATE-MACHINES.md'
FROM information_schema.columns c
WHERE c.table_schema='public' AND c.column_name IN ('status','state') AND c.data_type='text'
  AND NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class cl ON cl.oid=con.conrelid
    JOIN pg_namespace n ON n.oid=cl.relnamespace
    WHERE n.nspname='public' AND cl.relname=c.table_name AND con.contype='c'
      AND pg_get_constraintdef(con.oid) LIKE '%' || c.column_name || '%');


-- =====================================================================================
-- G. LIVE ISOLATION PROBES
--
-- Everything above reads the catalog. This section actually issues queries as `anon`
-- and as `authenticated` carrying a forged JWT, and reports what comes back. A schema
-- can look perfect in the catalog and still leak; this is the part that proves it.
-- =====================================================================================

DO $probe$
DECLARE
  r            record;
  n_rows       bigint;
  victim       uuid;
  attacker     uuid;
  claims       text;
  results      text[] := '{}';
  sev          text;
  can_setrole  boolean := true;
BEGIN
  -- Can we impersonate at all? If not, say so loudly rather than pass silently.
  BEGIN
    EXECUTE 'SET LOCAL ROLE anon';
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    can_setrole := false;
  END;

  IF NOT can_setrole THEN
    INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
    VALUES ('SKIP','G. Live probes','G0','(all)',
            'the connecting role cannot SET ROLE anon/authenticated, so live isolation was NOT verified — catalog checks alone passed',
            'rerun as the database owner or service role');
    RETURN;
  END IF;

  -- ---------------------------------------------------------------------------------
  -- G1: as anon (no JWT at all), can anything in public be read?
  -- ---------------------------------------------------------------------------------
  FOR r IN SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1
  LOOP
    BEGIN
      EXECUTE 'SET LOCAL ROLE anon';
      EXECUTE format('SELECT count(*) FROM public.%I', r.relname) INTO n_rows;
      RESET ROLE;
      -- Reaching here means the SELECT was permitted. Rows returned is a live leak;
      -- zero rows still means the grant exists and only RLS is holding the line.
      results := results || (r.relname || '|' || n_rows::text);
    EXCEPTION WHEN insufficient_privilege THEN
      RESET ROLE;   -- correct behaviour: anon holds no grant
    WHEN OTHERS THEN
      RESET ROLE;
    END;
  END LOOP;
  RESET ROLE;

  FOREACH claims IN ARRAY results LOOP
    n_rows := split_part(claims,'|',2)::bigint;
    sev := CASE WHEN n_rows > 0 THEN 'CRITICAL' ELSE 'HIGH' END;
    INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
    VALUES (sev, 'G. Live probes', 'G1', split_part(claims,'|',1),
            CASE WHEN n_rows > 0
                 THEN 'UNAUTHENTICATED READ: anon SELECT returned ' || n_rows || ' row(s)'
                 ELSE 'anon SELECT is permitted (0 rows today) — only RLS prevents disclosure; the grant should not exist' END,
            'REVOKE ALL ON public.' || split_part(claims,'|',1) || ' FROM anon;');
  END LOOP;

  -- ---------------------------------------------------------------------------------
  -- G2: as authenticated carrying a JWT for a tenant that does not exist, and claiming
  -- the most privileged roles. Anything visible is visible to every bakery.
  -- ---------------------------------------------------------------------------------
  attacker := gen_random_uuid();
  claims := json_build_object(
              'sub',       gen_random_uuid(),
              'role',      'authenticated',
              'tenant_id', attacker,
              'roles',     json_build_array('owner','admin'),
              'aud',       'authenticated'
            )::text;

  results := '{}';
  FOR r IN SELECT t FROM _tenant_tables ORDER BY 1 LOOP
    BEGIN
      PERFORM set_config('request.jwt.claims', claims, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id <> %L', r.t, attacker) INTO n_rows;
      RESET ROLE;
      IF n_rows > 0 THEN
        results := results || (r.t || '|' || n_rows::text);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
    END;
  END LOOP;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  FOREACH claims IN ARRAY results LOOP
    INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
    VALUES ('CRITICAL','G. Live probes','G2', split_part(claims,'|',1),
            'CROSS-TENANT READ: a JWT for a non-existent tenant (claiming owner+admin) returned ' ||
            split_part(claims,'|',2) || ' row(s) belonging to other tenants',
            'the SELECT policy on this table does not pin tenant_id = current_tenant_id()');
  END LOOP;

  -- ---------------------------------------------------------------------------------
  -- G3: real tenant vs real tenant. Only meaningful once two organizations exist —
  -- the strongest possible statement of isolation, using live data.
  -- ---------------------------------------------------------------------------------
  SELECT id INTO attacker FROM public.organizations ORDER BY created_at LIMIT 1;
  SELECT id INTO victim   FROM public.organizations WHERE id <> attacker ORDER BY created_at LIMIT 1;

  IF attacker IS NULL OR victim IS NULL THEN
    INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
    VALUES ('SKIP','G. Live probes','G3','organizations',
            'fewer than two organizations exist, so tenant-vs-tenant isolation could not be exercised against real data (G2 still ran with a synthetic tenant)',
            'seed a second organization in staging and rerun before go-live');
  ELSE
    claims := json_build_object(
                'sub',       coalesce((SELECT id::text FROM public.profiles WHERE tenant_id=attacker LIMIT 1), gen_random_uuid()::text),
                'role',      'authenticated',
                'tenant_id', attacker,
                'roles',     json_build_array('owner','admin'),
                'aud',       'authenticated'
              )::text;

    results := '{}';
    FOR r IN SELECT t FROM _tenant_tables ORDER BY 1 LOOP
      BEGIN
        PERFORM set_config('request.jwt.claims', claims, true);
        EXECUTE 'SET LOCAL ROLE authenticated';
        EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id = %L', r.t, victim) INTO n_rows;
        RESET ROLE;
        IF n_rows > 0 THEN
          results := results || (r.t || '|' || n_rows::text);
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
      END;
    END LOOP;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', NULL, true);

    FOREACH claims IN ARRAY results LOOP
      INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
      VALUES ('CRITICAL','G. Live probes','G3', split_part(claims,'|',1),
              'CROSS-TENANT READ against live data: an owner of organization ' || attacker ||
              ' read ' || split_part(claims,'|',2) || ' row(s) belonging to organization ' || victim,
              'fix the SELECT policy on this table immediately and treat as a disclosure incident');
    END LOOP;
  END IF;

  -- ---------------------------------------------------------------------------------
  -- G4: a signed-in user with no tenant yet (profiles.tenant_id IS NULL — the state
  -- between sign-up and joining an organization). current_tenant_id() returns NULL and
  -- `tenant_id = NULL` is NULL, so policies should deny. Verify rather than assume.
  -- ---------------------------------------------------------------------------------
  claims := json_build_object(
              'sub',  gen_random_uuid(),
              'role', 'authenticated',
              'roles', json_build_array('owner','admin'),
              'aud',  'authenticated'
            )::text;   -- deliberately no tenant_id claim

  results := '{}';
  FOR r IN SELECT t FROM _tenant_tables ORDER BY 1 LOOP
    BEGIN
      PERFORM set_config('request.jwt.claims', claims, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      EXECUTE format('SELECT count(*) FROM public.%I', r.t) INTO n_rows;
      RESET ROLE;
      IF n_rows > 0 THEN
        results := results || (r.t || '|' || n_rows::text);
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
    END;
  END LOOP;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  FOREACH claims IN ARRAY results LOOP
    INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
    VALUES ('CRITICAL','G. Live probes','G4', split_part(claims,'|',1),
            'a JWT with NO tenant_id claim read ' || split_part(claims,'|',2) ||
            ' row(s) — any signed-up user who has not joined an organization can read this table',
            'ensure the policy compares against current_tenant_id() and does not fall back to a permissive branch');
  END LOOP;

  -- ---------------------------------------------------------------------------------
  -- G5: write probe — can a foreign tenant insert into another tenant's table?
  -- Runs inside a savepoint that is always rolled back; nothing is persisted.
  -- ---------------------------------------------------------------------------------
  IF victim IS NOT NULL THEN
    BEGIN
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', gen_random_uuid(), 'role','authenticated',
                          'tenant_id', attacker, 'roles', json_build_array('owner','admin'),
                          'aud','authenticated')::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
      EXECUTE format(
        'INSERT INTO public.customers (tenant_id, name) VALUES (%L, %L)',
        victim, '__audit_probe__');
      RESET ROLE;
      INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
      VALUES ('CRITICAL','G. Live probes','G5','customers',
              'CROSS-TENANT WRITE: an owner of tenant ' || attacker ||
              ' inserted a row stamped with tenant ' || victim || ' (rolled back)',
              'the INSERT policy WITH CHECK must pin tenant_id = current_tenant_id()');
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;   -- rejection is the expected outcome
    END;
    PERFORM set_config('request.jwt.claims', NULL, true);
  END IF;

  RESET ROLE;
END
$probe$;

-- Belt and braces: never leave the session impersonating anything.
RESET ROLE;
SELECT set_config('request.jwt.claims', NULL, true);


-- =====================================================================================
-- H. DATA-LEVEL LEAKS & LEDGER INTEGRITY
--
-- Structural checks prove the walls exist. These prove nothing has already crossed them.
-- Run as a role that bypasses RLS, so this sees all tenants at once.
-- =====================================================================================

-- H1: every foreign key between two tenant-owned tables must stay inside one tenant.
-- A child row pointing at a parent in another organization is a leak that has already
-- happened — usually via a SECURITY DEFINER RPC that trusted a caller-supplied id.
DO $fk$
DECLARE
  r record;
  n bigint;
BEGIN
  FOR r IN
    SELECT con.conname,
           ch.relname  AS child,
           par.relname AS parent,
           a.attname   AS child_col,
           af.attname  AS parent_col
    FROM pg_constraint con
    JOIN pg_class ch     ON ch.oid = con.conrelid
    JOIN pg_class par    ON par.oid = con.confrelid
    JOIN pg_namespace n1 ON n1.oid = ch.relnamespace
    JOIN pg_attribute a  ON a.attrelid = ch.oid  AND a.attnum  = con.conkey[1]
    JOIN pg_attribute af ON af.attrelid = par.oid AND af.attnum = con.confkey[1]
    WHERE con.contype = 'f'
      AND n1.nspname = 'public'
      AND array_length(con.conkey,1) = 1
      AND a.attname <> 'tenant_id'
      AND ch.relname  IN (SELECT t FROM _tenant_tables)
      AND par.relname IN (SELECT t FROM _tenant_tables)
      AND EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema='public' AND c.table_name=ch.relname  AND c.column_name='tenant_id')
      AND EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema='public' AND c.table_name=par.relname AND c.column_name='tenant_id')
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I ch JOIN public.%I par ON par.%I = ch.%I
        WHERE par.tenant_id IS DISTINCT FROM ch.tenant_id',
      r.child, r.parent, r.parent_col, r.child_col) INTO n;

    IF n > 0 THEN
      INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
      VALUES ('CRITICAL','H. Data integrity','H1', r.child || '.' || r.child_col,
              n || ' row(s) reference ' || r.parent || ' in a DIFFERENT tenant — cross-tenant data already exists',
              'investigate as a possible breach; then add a composite FK on (tenant_id, ' || r.parent_col ||
              ') so the database makes this unrepresentable');
    END IF;
  END LOOP;
END
$fk$;

-- H2: the same idea for branch scoping — a row filed under a branch owned by another
-- organization. Composite foreign keys are the durable fix.
DO $br$
DECLARE
  r record;
  n bigint;
BEGIN
  FOR r IN
    SELECT c.table_name AS t
    FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.column_name='branch_id'
      AND EXISTS (SELECT 1 FROM information_schema.columns c2
                  WHERE c2.table_schema='public' AND c2.table_name=c.table_name AND c2.column_name='tenant_id')
      AND to_regclass('public.' || c.table_name) IS NOT NULL
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I x JOIN public.branches b ON b.id = x.branch_id
        WHERE b.tenant_id IS DISTINCT FROM x.tenant_id', r.t) INTO n;
    IF n > 0 THEN
      INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
      VALUES ('CRITICAL','H. Data integrity','H2', r.t,
              n || ' row(s) point at a branch owned by a different organization',
              'add FOREIGN KEY (tenant_id, branch_id) REFERENCES branches(tenant_id, id)');
    END IF;
  END LOOP;
END
$br$;

-- H3: rows whose tenant_id names an organization that does not exist (or is archived).
DO $orphan$
DECLARE
  r record;
  n bigint;
BEGIN
  FOR r IN SELECT tt.t FROM _tenant_tables tt
           WHERE EXISTS (SELECT 1 FROM information_schema.columns c
                         WHERE c.table_schema='public' AND c.table_name=tt.t AND c.column_name='tenant_id')
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I x WHERE x.tenant_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = x.tenant_id)', r.t) INTO n;
    IF n > 0 THEN
      INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
      VALUES ('HIGH','H. Data integrity','H3', r.t,
              n || ' orphan row(s): tenant_id does not match any organization — invisible to RLS, visible to service-role reads and exports',
              'add the missing FK, then reassign or purge the orphans');
    END IF;
  END LOOP;
END
$orphan$;

-- H4: the derived stock cache must be reconstructible from the ledger alone (Core Rule 7).
-- Any divergence means something wrote a stock level directly.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'H. Data integrity', 'H4',
       'ingredient_stock_levels ' || l.warehouse_id || '/' || l.ingredient_id,
       'cached quantity_on_hand ' || l.quantity_on_hand || ' <> ledger sum ' || coalesce(m.delta, 0) ||
       ' — the stock cache has diverged from stock_movements',
       'rebuild from the ledger; find the write path that bypassed apply_stock_movement()'
FROM public.ingredient_stock_levels l
LEFT JOIN (
  SELECT tenant_id, warehouse_id, ingredient_id, sum(quantity_delta) AS delta
  FROM public.stock_movements
  WHERE ingredient_id IS NOT NULL AND deleted_at IS NULL
  GROUP BY 1,2,3
) m ON m.tenant_id=l.tenant_id AND m.warehouse_id=l.warehouse_id AND m.ingredient_id=l.ingredient_id
WHERE l.deleted_at IS NULL AND l.quantity_on_hand IS DISTINCT FROM coalesce(m.delta, 0);

INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'H. Data integrity', 'H5',
       'product_stock_levels ' || l.warehouse_id || '/' || l.product_variant_id,
       'cached quantity_on_hand ' || l.quantity_on_hand || ' <> ledger sum ' || coalesce(m.delta, 0),
       'rebuild from the ledger; find the write path that bypassed apply_stock_movement()'
FROM public.product_stock_levels l
LEFT JOIN (
  SELECT tenant_id, warehouse_id, product_variant_id, sum(quantity_delta) AS delta
  FROM public.stock_movements
  WHERE product_variant_id IS NOT NULL AND deleted_at IS NULL
  GROUP BY 1,2,3
) m ON m.tenant_id=l.tenant_id AND m.warehouse_id=l.warehouse_id AND m.product_variant_id=l.product_variant_id
WHERE l.deleted_at IS NULL AND l.quantity_on_hand IS DISTINCT FROM coalesce(m.delta, 0);

-- H6: negative stock. Either the ledger is wrong or product left the building unrecorded.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'H. Data integrity', 'H6', 'ingredient_stock_levels',
       count(*) || ' ingredient stock row(s) are negative', 'investigate the movements behind them'
FROM public.ingredient_stock_levels WHERE quantity_on_hand < 0 HAVING count(*) > 0;

INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'H. Data integrity', 'H6', 'product_stock_levels',
       count(*) || ' product stock row(s) are negative', 'investigate the movements behind them'
FROM public.product_stock_levels WHERE quantity_on_hand < 0 HAVING count(*) > 0;

-- H7: money moved must equal money recorded. tickets.amount_paid is a cached rollup;
-- payments and refunds are the ledger. A divergence is either a bug or a skim.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'H. Data integrity', 'H7', 'tickets ' || t.id,
       'amount_paid = ' || t.amount_paid || ' but payments-minus-refunds = ' || (coalesce(p.paid,0) - coalesce(rf.refunded,0)),
       'reconcile; amount_paid must be maintained only by apply_payment_to_ticket()'
FROM public.tickets t
LEFT JOIN (SELECT ticket_id, sum(amount) paid FROM public.payments WHERE deleted_at IS NULL GROUP BY 1) p
       ON p.ticket_id = t.id
LEFT JOIN (SELECT pm.ticket_id, sum(r.amount) refunded
           FROM public.refunds r JOIN public.payments pm ON pm.id = r.payment_id
           WHERE r.deleted_at IS NULL GROUP BY 1) rf
       ON rf.ticket_id = t.id
WHERE t.deleted_at IS NULL
  AND t.amount_paid IS DISTINCT FROM (coalesce(p.paid,0) - coalesce(rf.refunded,0));

-- H8: a ticket total that does not equal its own components.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'H. Data integrity', 'H8', 'tickets ' || id,
       'total_amount ' || total_amount || ' <> subtotal ' || subtotal_amount ||
       ' - discount ' || discount_amount || ' + tax ' || tax_amount,
       'recalculate via recalculate_ticket_totals(); find the writer that set it directly'
FROM public.tickets
WHERE deleted_at IS NULL
  AND total_amount IS DISTINCT FROM (subtotal_amount - discount_amount + tax_amount);

-- H9: a line total that does not equal quantity x unit price.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'H. Data integrity', 'H9', 'ticket_items ' || id,
       'line_total ' || line_total || ' <> quantity ' || quantity || ' x unit_price ' || unit_price,
       'recalculate; line_total should be generated or trigger-maintained, not client-supplied'
FROM public.ticket_items
WHERE deleted_at IS NULL
  AND round(line_total, 4) IS DISTINCT FROM round(quantity * unit_price, 4);

-- H10: refunds exceeding the payment they refund.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'H. Data integrity', 'H10', 'payments ' || p.id,
       'refunds total ' || sum(r.amount) || ' exceed the original payment of ' || p.amount,
       'guard_refund_total() should make this impossible — check whether it was bypassed by a SECURITY DEFINER path'
FROM public.payments p
JOIN public.refunds r ON r.payment_id = p.id AND r.deleted_at IS NULL
WHERE p.deleted_at IS NULL
GROUP BY p.id, p.amount
HAVING sum(r.amount) > p.amount;

-- H11: a user holding a role in an organization their profile does not belong to.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'CRITICAL', 'H. Data integrity', 'H11', 'user_roles ' || ur.id,
       'profile ' || ur.profile_id || ' holds a role in tenant ' || ur.tenant_id ||
       ' but its profile belongs to tenant ' || coalesce(pr.tenant_id::text,'NULL'),
       'this grants a foreign tenant''s privileges; revoke and audit how it was created'
FROM public.user_roles ur
JOIN public.profiles pr ON pr.id = ur.profile_id
WHERE ur.deleted_at IS NULL AND pr.tenant_id IS DISTINCT FROM ur.tenant_id;

-- H12: branch assignments across tenant boundaries — the same escalation via has_branch_access().
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'CRITICAL', 'H. Data integrity', 'H12', 'branch_assignments ' || ba.id,
       'profile ' || ba.profile_id || ' is assigned to a branch in tenant ' || ba.tenant_id ||
       ' but belongs to tenant ' || coalesce(pr.tenant_id::text,'NULL'),
       'revoke; has_branch_access() trusts this table'
FROM public.branch_assignments ba
JOIN public.profiles pr ON pr.id = ba.profile_id
WHERE ba.deleted_at IS NULL AND pr.tenant_id IS DISTINCT FROM ba.tenant_id;

-- H13: duplicate document numbers within a tenant break invoicing and audit trails.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'H. Data integrity', 'H13', 'tickets.ticket_number',
       'tenant ' || tenant_id || ' has ' || count(*) || ' tickets sharing number ' || ticket_number,
       'next_document_number() must be the only allocator; add a UNIQUE (tenant_id, ticket_number)'
FROM public.tickets WHERE ticket_number IS NOT NULL
GROUP BY tenant_id, ticket_number HAVING count(*) > 1;

INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'H. Data integrity', 'H13', 'invoices.invoice_number',
       'tenant ' || tenant_id || ' has ' || count(*) || ' invoices sharing number ' || invoice_number,
       'add a UNIQUE (tenant_id, invoice_number)'
FROM public.invoices WHERE invoice_number IS NOT NULL
GROUP BY tenant_id, invoice_number HAVING count(*) > 1;

-- H14: expired but unconsumed invites are a standing way into a tenant.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'H. Data integrity', 'H14', 'organization_invites',
       count(*) || ' invite(s) are past expires_at but still in a pending status',
       'expire them on a schedule; accept_organization_invite() must reject on expiry'
FROM public.organization_invites
WHERE expires_at < now() AND status NOT IN ('accepted','revoked','expired') AND deleted_at IS NULL
HAVING count(*) > 0;

-- H15: sync devices that were never revoked and have not been seen in a long time —
-- an offline-capable device holding cached tenant data is a physical-loss risk.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'LOW', 'H. Data integrity', 'H15', 'sync_devices',
       count(*) || ' device(s) active but not seen for over 90 days',
       'revoke stale devices; they hold an offline copy of tenant data'
FROM public.sync_devices
WHERE revoked_at IS NULL AND coalesce(last_seen_at, created_at) < now() - interval '90 days'
HAVING count(*) > 0;


-- =====================================================================================
-- I. SECRETS & PII HYGIENE
-- =====================================================================================

-- I1: a column whose name promises a secret but whose type suggests it is stored raw.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'CRITICAL', 'I. Secrets', 'I1', c.table_name || '.' || c.column_name,
       'column name suggests a credential or token stored in plaintext',
       'store only a hash (pgcrypto digest / crypt), never the raw value'
FROM information_schema.columns c
WHERE c.table_schema='public'
  AND c.column_name ~ '(password|secret|api_key|access_token|refresh_token|private_key)'
  AND c.column_name !~ '(_hash$|_digest$|_hashed$)';

-- I2: invite tokens and deletion challenges are hashed (good) but the hash itself is a
-- verifier — anyone who can read it can attempt offline brute force against a short
-- confirmation phrase.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'I. Secrets', 'I2', p.tablename || '.' || p.policyname,
       'a client-readable SELECT policy exposes every column of a table holding a token/phrase hash',
       'expose the table through a view that omits the hash column, or REVOKE SELECT on that column'
FROM pg_policies p
WHERE p.schemaname='public' AND p.cmd IN ('SELECT','ALL')
  AND p.roles && ARRAY['authenticated']::name[]
  AND EXISTS (SELECT 1 FROM information_schema.columns c
              WHERE c.table_schema='public' AND c.table_name=p.tablename
                AND c.column_name ~ '(token_hash|phrase_hash|_hash$)');

-- I3: PII inventory. Not a defect — a register of what a single RLS mistake would expose,
-- and what a data-subject deletion request has to reach.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'INFO', 'I. Secrets', 'I3', c.table_name,
       'holds personal data: ' || string_agg(c.column_name, ', ' ORDER BY c.column_name),
       'covered by the tenant RLS policy; confirm it is also covered by retention and erasure procedures'
FROM information_schema.columns c
WHERE c.table_schema='public'
  AND c.column_name ~ '(email|phone|address|full_name|recipient_name|contact)'
GROUP BY c.table_name;

-- I4: pg_stat_statements exposes the text of every query on the instance, across tenants,
-- including literal values captured in some configurations.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'I. Secrets', 'I4', 'extensions.pg_stat_statements',
       'a client role can read pg_stat_statements — query text from every tenant is visible',
       'REVOKE SELECT ON pg_stat_statements FROM anon, authenticated;'
WHERE to_regclass('extensions.pg_stat_statements') IS NOT NULL
  AND (has_table_privilege('authenticated','extensions.pg_stat_statements','SELECT')
    OR has_table_privilege('anon','extensions.pg_stat_statements','SELECT'));

-- I5: public storage buckets. Delivery proof photos and receipts are tenant data; a
-- public bucket serves them to anyone with the URL, with no RLS involved at all.
DO $buckets$
DECLARE r record;
BEGIN
  IF to_regclass('storage.buckets') IS NULL THEN RETURN; END IF;
  FOR r IN EXECUTE 'SELECT id, public FROM storage.buckets WHERE public' LOOP
    INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
    VALUES ('HIGH','I. Secrets','I5','storage bucket ' || r.id,
            'bucket is PUBLIC — objects are served to anyone with the URL, bypassing RLS entirely',
            'make the bucket private and serve via signed URLs');
  END LOOP;
END
$buckets$;

-- I6: storage objects are tenant data too, and need their own RLS policies.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'I. Secrets', 'I6', 'storage.objects',
       'no RLS policy on storage.objects mentions tenant scoping — uploaded receipts and delivery proofs are not tenant-isolated',
       'add storage policies keyed on the tenant path prefix'
WHERE to_regclass('storage.objects') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname='storage' AND p.tablename='objects'
      AND coalesce(p.qual,'') || coalesce(p.with_check,'') LIKE '%tenant%');

-- I7: a view over auth.users (or any auth table) in an API-exposed schema republishes
-- credentials metadata that Supabase deliberately keeps out of the API.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'CRITICAL', 'I. Secrets', 'I7', 'public.' || c.relname,
       'view in the exposed schema selects from auth.* — auth internals become API-readable',
       'drop the view or move it out of public'
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('v','m')
  AND pg_get_viewdef(c.oid) ~* '\mauth\.';

-- I8: views bypass RLS unless declared security_invoker — a view owned by postgres
-- reads with the owner's rights and hands the rows to whoever can select from it.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'CRITICAL', 'I. Secrets', 'I8', 'public.' || c.relname,
       'view is not security_invoker — it executes with the owner''s privileges and bypasses every RLS policy on its base tables',
       'ALTER VIEW ' || c.relname || ' SET (security_invoker = true);'
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='v'
  AND coalesce(array_to_string(c.reloptions,','),'') NOT LIKE '%security_invoker=true%';

-- I9: materialized views never enforce RLS, full stop.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'CRITICAL', 'I. Secrets', 'I9', 'public.' || c.relname,
       'materialized view in the exposed schema — RLS is never applied to a matview, so every tenant''s rows are readable',
       'move it out of public and expose a tenant-filtered function instead'
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='m';


-- =====================================================================================
-- J. AVAILABILITY & DoS SURFACE
-- =====================================================================================

-- J1: every RLS predicate filters on tenant_id. Without an index, each policy evaluation
-- is a sequential scan, and one large tenant degrades every other tenant on the instance.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'J. Availability', 'J1', tt.t,
       'no index leads with tenant_id, yet every RLS policy filters on it',
       'CREATE INDEX ON ' || tt.t || ' (tenant_id);'
FROM _tenant_tables tt
WHERE EXISTS (SELECT 1 FROM information_schema.columns c
              WHERE c.table_schema='public' AND c.table_name=tt.t AND c.column_name='tenant_id')
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0]
    WHERE i.indrelid=tt.oid AND a.attname='tenant_id');

-- J2: an unindexed foreign key turns every parent delete or update into a full scan of
-- the child, and makes join-heavy screens quadratic as a tenant grows.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'LOW', 'J. Availability', 'J2', ch.relname || '.' || a.attname,
       'foreign key column has no covering index',
       'CREATE INDEX ON ' || ch.relname || ' (' || a.attname || ');'
FROM pg_constraint con
JOIN pg_class ch ON ch.oid=con.conrelid
JOIN pg_namespace n ON n.oid=ch.relnamespace
JOIN pg_attribute a ON a.attrelid=ch.oid AND a.attnum=con.conkey[1]
WHERE con.contype='f' AND n.nspname='public' AND array_length(con.conkey,1)=1
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid=ch.oid AND i.indkey[0]=a.attnum);

-- J3: a policy that calls a STABLE function unwrapped re-evaluates it per row. Wrapping
-- it as (SELECT f()) lets the planner hoist it to an InitPlan — on a large table this is
-- the difference between a fast scan and a timeout.
-- Aggregated per table: this pattern is usually schema-wide, and one row per policy
-- would bury everything else in the report.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'LOW', 'J. Availability', 'J3', p.tablename,
       count(*) || ' policy/policies call current_tenant_id() without a (SELECT ...) wrapper — re-evaluated once per row: ' ||
       string_agg(p.policyname, ', ' ORDER BY p.policyname),
       'rewrite as tenant_id = (SELECT current_tenant_id()) so the planner hoists it to an InitPlan'
FROM pg_policies p
WHERE p.schemaname='public'
  AND p.roles && ARRAY['authenticated']::name[]
  AND coalesce(p.qual,'') ~ '[^(]current_tenant_id\(\)'
GROUP BY p.tablename;

-- J4: no statement timeout on the client roles means one pathological request can pin a
-- connection indefinitely — the cheapest denial of service there is against PostgREST.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'J. Availability', 'J4', r.rolname,
       'role has no statement_timeout — a single expensive query can hold a connection open indefinitely',
       'ALTER ROLE ' || r.rolname || ' SET statement_timeout = ''8s'';'
FROM pg_roles r
WHERE r.rolname IN ('anon','authenticated')
  AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(r.rolconfig,'{}')) cfg WHERE cfg LIKE 'statement_timeout%');

-- J5: tables without a primary key cannot be replicated, deduplicated, or safely synced —
-- and the offline sync layer depends on stable row identity.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'J. Availability', 'J5', c.relname,
       'table has no PRIMARY KEY',
       'add one; logical replication and the sync layer both require stable row identity'
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r'
  AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=c.oid AND i.indisprimary);

-- J6: bloat and stale statistics on the hot ledger tables.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'LOW', 'J. Availability', 'J6', relname,
       'dead tuples ' || n_dead_tup || ' vs live ' || n_live_tup ||
       coalesce(', last analyze ' || to_char(greatest(last_analyze, last_autoanalyze), 'YYYY-MM-DD'), ', never analyzed'),
       'VACUUM ANALYZE, and review autovacuum settings for this table'
FROM pg_stat_user_tables
WHERE schemaname='public' AND n_dead_tup > 1000 AND n_dead_tup > n_live_tup * 0.2;


-- =====================================================================================
-- K. PLATFORM CONFIG DRIFT
-- =====================================================================================

-- K1: an extension installed into public puts its functions on the default search_path,
-- where they can shadow calls made from unqualified SECURITY DEFINER bodies.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'K. Config', 'K1', e.extname,
       'extension is installed in the API-exposed public schema',
       'ALTER EXTENSION ' || e.extname || ' SET SCHEMA extensions;'
FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace
WHERE n.nspname='public';

-- K2: realtime republishes row changes over websockets. Anything in the publication is
-- only as private as the realtime authorization layer — worth an explicit decision per table.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'K. Config', 'K2', pt.tablename,
       'table is in the supabase_realtime publication — row changes are broadcast to subscribers',
       'confirm realtime RLS applies, and that no sensitive column is in the payload'
FROM pg_publication_tables pt
WHERE pt.pubname='supabase_realtime' AND pt.schemaname='public';

-- K3: REPLICA IDENTITY FULL puts every column of the old row into the WAL, including
-- columns a subscriber was never meant to see.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'K. Config', 'K3', c.relname,
       'REPLICA IDENTITY FULL — the complete previous row version is written to the WAL and shipped to subscribers',
       'use the default (primary key) identity unless a subscriber genuinely needs full rows'
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relreplident='f';

-- K4: superuser or bypassrls roles beyond the platform's own.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'HIGH', 'K. Config', 'K4', rolname,
       CASE WHEN rolsuper THEN 'role is SUPERUSER' ELSE 'role has BYPASSRLS' END,
       'remove the attribute unless this is a platform-managed role'
FROM pg_roles
WHERE (rolsuper OR rolbypassrls)
  AND rolname NOT IN (SELECT r FROM _cfg_platform_roles);

-- K5: roles that can log in and are not part of the managed platform set.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'MEDIUM', 'K. Config', 'K5', rolname,
       'non-platform login role exists' ||
       coalesce(' (valid until ' || rolvaliduntil::date || ')', ' with no expiry'),
       'confirm it is intended, scoped, and rotated'
FROM pg_roles
WHERE rolcanlogin
  AND rolname NOT LIKE 'supabase%' AND rolname NOT LIKE 'pg_%'
  AND rolname NOT IN ('postgres','authenticator','pgbouncer','anon','authenticated','service_role','dashboard_user');

-- K6: migration provenance. The committed migrations in supabase/migrations/ are known
-- to lag production (see docs/PROJECT-OVERVIEW.md §migration-sync); this prints what the
-- database actually believes so the two can be compared by a human.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'INFO', 'K. Config', 'K6', 'supabase_migrations.schema_migrations',
       count(*) || ' migration(s) applied; latest is ' || coalesce(max(version), '(none)'),
       'compare against supabase/migrations/ — a mismatch means the repo cannot rebuild production'
FROM supabase_migrations.schema_migrations;

-- K7: objects created outside the migration system leave no reviewable history.
INSERT INTO _findings (severity, section, check_id, object_name, detail, remediation)
SELECT 'INFO', 'K. Config', 'K7', 'public',
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind='r')::text || ' tables, ' ||
       (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public')::text || ' functions, ' ||
       (SELECT count(*) FROM pg_policies WHERE schemaname='public')::text || ' policies',
       'inventory snapshot for drift comparison between runs';


-- =====================================================================================
-- REPORT
-- =====================================================================================

DELETE FROM _findings f USING _cfg_suppressed s WHERE f.check_id = s.check_id;

-- Summary first, so it is on screen even when the detail scrolls.
SELECT severity,
       count(*) AS findings,
       string_agg(DISTINCT check_id, ', ' ORDER BY check_id) AS checks
FROM _findings
GROUP BY severity
ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3
                       WHEN 'LOW' THEN 4 WHEN 'INFO' THEN 5 ELSE 6 END;

-- Full detail.
SELECT severity, section, check_id, object_name, detail, remediation
FROM _findings
ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3
                       WHEN 'LOW' THEN 4 WHEN 'INFO' THEN 5 ELSE 6 END,
         section, check_id, object_name;

-- Exit gate for CI. Default threshold is 'high'; override with
--   PGOPTIONS="-c bakeflow.fail_on=none"  (or critical | medium | low)
DO $gate$
DECLARE
  threshold text := lower(coalesce(current_setting('bakeflow.fail_on', true), 'high'));
  cutoff    int;
  n         int;
BEGIN
  IF threshold = 'none' THEN RETURN; END IF;
  cutoff := CASE threshold WHEN 'critical' THEN 1 WHEN 'high' THEN 2
                           WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 2 END;

  SELECT count(*) INTO n FROM _findings
  WHERE CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3
                      WHEN 'LOW' THEN 4 ELSE 9 END <= cutoff;

  IF n > 0 THEN
    RAISE EXCEPTION 'BakeFlow security audit FAILED: % finding(s) at or above %',
      n, upper(threshold)
      USING HINT = 'see the report above; suppress reviewed findings via _cfg_suppressed';
  END IF;
  RAISE NOTICE 'BakeFlow security audit PASSED at threshold %', upper(threshold);
END
$gate$;

ROLLBACK;
