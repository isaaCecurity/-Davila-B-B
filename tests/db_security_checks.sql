-- tests/db_security_checks.sql
--
-- Standing security assertions for the BakeFlow database. Every row this returns is a
-- failure; a clean run returns nothing. Read-only — safe against production.
--
--   supabase db query --file tests/db_security_checks.sql
--
-- Each check names the Core Rule (CLAUDE.md) or finding it defends.

-- 1. RLS helper functions must be executable by `authenticated`, or every policy that
--    calls them raises 42501 and all reads fail. (Finding C1)
select 'C1 rls-helper-execute' as check_id,
       'authenticated cannot EXECUTE ' || f as detail
from unnest(array[
       'public.current_tenant_id()',
       'public.has_role(text[])',
       'public.has_branch_access(uuid)'
     ]) f
where not has_function_privilege('authenticated', f, 'EXECUTE')

union all

-- 2. TRUNCATE / TRIGGER / REFERENCES bypass RLS and must not be held by a client role.
--    (Finding H1)
select 'H1 rls-bypassing-grant',
       r || ' holds ' || p || ' on ' || c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace,
     unnest(array['anon','authenticated']) r,
     unnest(array['TRUNCATE','TRIGGER','REFERENCES']) p
where n.nspname = 'public' and c.relkind = 'r'
  and has_table_privilege(r, c.oid, p)

union all

-- 3. anon is unauthenticated; it should hold nothing in public. (Finding H2)
select 'H2 anon-grant',
       'anon holds ' || privilege_type || ' on ' || table_name
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'anon'

union all

-- 4. Every RLS policy on a tenant-owned table must constrain tenant_id. (Core Rule 4,
--    Findings H3/M4)
select 'H3 policy-missing-tenant-predicate',
       tablename || '.' || policyname || ' (' || cmd || ')'
from pg_policies p
where schemaname = 'public'
  and 'authenticated' = any (p.roles)
  and tablename not in ('organizations', 'roles')
  and exists (select 1 from information_schema.columns col
              where col.table_schema = 'public'
                and col.table_name = p.tablename
                and col.column_name = 'tenant_id')
  and coalesce(qual, '') || coalesce(with_check, '') not like '%tenant_id%'

union all

-- 5. Canonical tenant column name. (Core Rule 2, Finding H5)
select 'H5 non-canonical-tenant-column',
       table_name || '.' || column_name
from information_schema.columns
where table_schema = 'public'
  and column_name in ('organization_id', 'bakery_id', 'company_id')

union all

-- 6. Every table outside the tenant root must carry tenant_id. (Core Rule 1)
select 'R1 missing-tenant-id', c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname not in ('organizations', 'roles')
  and not exists (select 1 from information_schema.columns col
                  where col.table_schema = 'public'
                    and col.table_name = c.relname
                    and col.column_name = 'tenant_id')

union all

-- 7. RLS on every table. (Core Rule 4)
select 'R4 rls-disabled', c.relname
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity

union all

-- 8. Money is NUMERIC(19,4). (Core Rule 5, Finding M2)
select 'R5 money-type',
       table_name || '.' || column_name || ' is numeric(' ||
       coalesce(numeric_precision::text, '?') || ',' || coalesce(numeric_scale::text, '?') || ')'
from information_schema.columns
where table_schema = 'public'
  and column_name ~ '(amount|price|cost|total|balance|paid|subtotal|discount|tax|variance|expected_cash|physical_cash|opening_balance|opening_float)'
  and data_type in ('numeric','double precision','real','money')
  and not (numeric_precision = 19 and numeric_scale = 4)

union all

-- 9. The immutable ledgers must keep their guard triggers. (Core Rules 7, 8, 9)
select 'R7 missing-immutability-trigger', t
from unnest(array['stock_movements','payments','refunds','audit_log','daily_financial_audits']) t
where not exists (
  select 1 from pg_trigger tg
  join pg_class c on c.oid = tg.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = t
    and not tg.tgisinternal
    and tg.tgname ~* '(immutable|guard)'
)

union all

-- 10. SECURITY DEFINER functions must pin search_path. (Finding L2)
select 'L2 unpinned-search-path', p.proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','private') and p.prosecdef and p.proconfig is null

order by 1, 2;
