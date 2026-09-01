-- BakeFlow — inventory read-path security suite (I1..I11) — P4.2a
--
-- Proves the boundaries the inventory READ service depends on. Inventory differs from
-- catalog in the way that matters most: its SELECT policies carry a SECOND predicate.
--
--   tenant_id = current_tenant_id() AND has_branch_access(branch_id) AND deleted_at IS NULL
--
-- Organization isolation is therefore necessary but NOT sufficient, and a suite proving
-- only cross-organization isolation would pass while branch isolation was entirely
-- broken. I2 is the assertion that matters; I2b and I3 exist so it cannot pass vacuously.
--
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/inventory_read_rls.sql
--
-- Same conventions as tests/sql/catalog_read_rls.sql: no psql meta-commands, every
-- assertion records into a temp table rather than raising, verdict block at the end.
--
-- SAFETY: the whole suite runs in one transaction and ends in ROLLBACK. It creates
-- fixtures in live tables and must never be allowed to commit. Executed 2026-08-11
-- against project tvfyxpafbpnkneujcnvr: 15/15 passed, row counts 0 before and after.
--
-- has_branch_access(), verified live, is:
--   has_role(array['owner','admin'])
--   OR EXISTS (branch_assignments for auth.uid() + target branch + current_tenant_id())
-- Branch isolation therefore only binds NON-owner/admin users, which is why the branch
-- actor below is a branch_manager with exactly one assignment.
--
-- NEGATIVE STOCK. Fixtures cannot simply INSERT a negative level: apply_stock_movement()
-- is an AFTER trigger that maintains levels from the ledger and enforces the policy —
-- `sale`/`production_consume` may never go negative whatever the setting, while
-- `waste`/`adjustment` may only where organizations.allow_negative_stock is true. The
-- negative level in I8/I10 is therefore produced the legitimate way, by a waste movement
-- against an opted-in organization. I11 proves the unconditional half still holds.

BEGIN;

-- ---------------------------------------------------------------- fixtures --
INSERT INTO auth.users (id, email) VALUES
  ('d1000000-0000-4000-8000-000000000001','u.mgr.inventory@bakeflow.test'),
  ('d1000000-0000-4000-8000-000000000002','u.owner.inventory@bakeflow.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id, name, slug) VALUES
  ('d0000000-0000-4000-8000-0000000000a1','Inventory Test Bakery A','inventory-test-a'),
  ('d0000000-0000-4000-8000-0000000000b1','Inventory Test Bakery B','inventory-test-b');

INSERT INTO public.branches (id, tenant_id, name, code) VALUES
  ('da000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a1','Inv Branch A1','IA1'),
  ('da000000-0000-4000-8000-0000000000a2','d0000000-0000-4000-8000-0000000000a1','Inv Branch A2','IA2'),
  ('db000000-0000-4000-8000-0000000000b1','d0000000-0000-4000-8000-0000000000b1','Inv Branch B1','IB1');

INSERT INTO public.profiles (id, full_name, status, tenant_id, active_tenant_id) VALUES
  ('d1000000-0000-4000-8000-000000000001','U Mgr Inventory','active','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a1'),
  ('d1000000-0000-4000-8000-000000000002','U Owner Inventory','active','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a1')
ON CONFLICT (id) DO UPDATE SET status='active', deleted_at=NULL,
  tenant_id=EXCLUDED.tenant_id, active_tenant_id=EXCLUDED.active_tenant_id;

-- Role ids looked up by key, not hardcoded -- seed.sql deliberately does not pin role ids
-- ("UUID primary keys are generated per environment... never reference a role or permission
-- by literal id"). The literal '00000000-...-0003'/'...-0001' values here previously worked
-- only because live's roles table happens to carry legacy pinned ids for most roles (an
-- artifact of an older seeding approach, not seed.sql's current gen_random_uuid()-based one) --
-- confirmed broken applying this file to a genuinely fresh database for the first time
-- (P11.1 throwaway-DB validation, 2026-09-01): "unknown role" from guard_user_role_integrity().
INSERT INTO public.user_roles (tenant_id, profile_id, role_id, branch_id) VALUES
  ('d0000000-0000-4000-8000-0000000000a1','d1000000-0000-4000-8000-000000000001',(select id from public.roles where key='branch_manager'),'da000000-0000-4000-8000-0000000000a1'),
  ('d0000000-0000-4000-8000-0000000000a1','d1000000-0000-4000-8000-000000000002',(select id from public.roles where key='owner'),NULL)
ON CONFLICT DO NOTHING;

-- THE fixture that makes I2 meaningful: assigned to A1, NOT to A2.
INSERT INTO public.branch_assignments (tenant_id, profile_id, branch_id, is_default) VALUES
  ('d0000000-0000-4000-8000-0000000000a1','d1000000-0000-4000-8000-000000000001','da000000-0000-4000-8000-0000000000a1',true)
ON CONFLICT DO NOTHING;

-- Catalog rows the inventory foreign keys require.
INSERT INTO public.product_categories (id, tenant_id, name, sort_order) VALUES
  ('d2000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a1','Inv Cat A',1),
  ('d2000000-0000-4000-8000-0000000000b1','d0000000-0000-4000-8000-0000000000b1','Inv Cat B',1);

INSERT INTO public.products (id, tenant_id, category_id, name, is_active) VALUES
  ('d3000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a1','d2000000-0000-4000-8000-0000000000a1','Inv Product A',true),
  ('d3000000-0000-4000-8000-0000000000b1','d0000000-0000-4000-8000-0000000000b1','d2000000-0000-4000-8000-0000000000b1','Inv Product B',true);

INSERT INTO public.product_variants (id, tenant_id, product_id, name, sku, unit_price, is_active) VALUES
  ('d4000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a1','d3000000-0000-4000-8000-0000000000a1','Inv Var A','INV-SKU-A',500.0000,true),
  ('d4000000-0000-4000-8000-0000000000b1','d0000000-0000-4000-8000-0000000000b1','d3000000-0000-4000-8000-0000000000b1','Inv Var B','INV-SKU-B',600.0000,true);

INSERT INTO public.ingredients (id, tenant_id, name, unit_of_measure, reorder_level, is_active) VALUES
  ('d5000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a1','Inv Flour A','kg',10.0000,true),
  ('d5000000-0000-4000-8000-0000000000a2','d0000000-0000-4000-8000-0000000000a1','Inv Sugar A','kg',1.0000,true),
  ('d5000000-0000-4000-8000-0000000000b1','d0000000-0000-4000-8000-0000000000b1','Inv Flour B','kg',10.0000,true);

INSERT INTO public.warehouses (id, tenant_id, branch_id, name, is_default) VALUES
  ('d6000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000a1','Store A1',true),
  ('d6000000-0000-4000-8000-0000000000a2','d0000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000a2','Store A2',true),
  ('d6000000-0000-4000-8000-0000000000b1','d0000000-0000-4000-8000-0000000000b1','db000000-0000-4000-8000-0000000000b1','Store B1',true),
  ('d6000000-0000-4000-8000-0000000000a9','d0000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000a1','Deleted Store A1',false);

-- Opt organization A in, so the waste movement below is permitted to go negative.
UPDATE public.organizations SET allow_negative_stock = true
 WHERE id = 'd0000000-0000-4000-8000-0000000000a1';

-- Levels are NOT inserted directly — apply_stock_movement() derives them from these.
-- The first two org-A movements deliberately share created_at to the second, which is
-- what I9 uses to justify the composite (created_at, id) keyset cursor.
INSERT INTO public.stock_movements
  (id, tenant_id, branch_id, warehouse_id, item_type, ingredient_id, product_variant_id,
   quantity_delta, reason, unit_cost, created_at) VALUES
  ('d7000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000a1','d6000000-0000-4000-8000-0000000000a1','ingredient','d5000000-0000-4000-8000-0000000000a1',NULL,12345678901234.5678,'purchase',184500.0000,'2026-08-11T09:00:00+00:00'),
  ('d7000000-0000-4000-8000-0000000000a2','d0000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000a1','d6000000-0000-4000-8000-0000000000a1','product',NULL,'d4000000-0000-4000-8000-0000000000a1',20.0000,'opening_balance',NULL,'2026-08-11T09:00:00+00:00'),
  ('d7000000-0000-4000-8000-0000000000a3','d0000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000a1','d6000000-0000-4000-8000-0000000000a1','product',NULL,'d4000000-0000-4000-8000-0000000000a1',-8.5000,'sale',NULL,'2026-08-11T09:30:00+00:00'),
  ('d7000000-0000-4000-8000-0000000000a4','d0000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000a1','d6000000-0000-4000-8000-0000000000a1','ingredient','d5000000-0000-4000-8000-0000000000a2',NULL,10.0000,'purchase',50.0000,'2026-08-11T09:40:00+00:00'),
  ('d7000000-0000-4000-8000-0000000000a5','d0000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000a1','d6000000-0000-4000-8000-0000000000a1','ingredient','d5000000-0000-4000-8000-0000000000a2',NULL,-52.5000,'waste',NULL,'2026-08-11T09:45:00+00:00'),
  ('d7000000-0000-4000-8000-0000000000a6','d0000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000a2','d6000000-0000-4000-8000-0000000000a2','ingredient','d5000000-0000-4000-8000-0000000000a1',NULL,5.0000,'purchase',100.0000,'2026-08-11T10:00:00+00:00'),
  ('d7000000-0000-4000-8000-0000000000a7','d0000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000a2','d6000000-0000-4000-8000-0000000000a2','product',NULL,'d4000000-0000-4000-8000-0000000000a1',9.0000,'opening_balance',NULL,'2026-08-11T10:05:00+00:00'),
  ('d7000000-0000-4000-8000-0000000000b1','d0000000-0000-4000-8000-0000000000b1','db000000-0000-4000-8000-0000000000b1','d6000000-0000-4000-8000-0000000000b1','ingredient','d5000000-0000-4000-8000-0000000000b1',NULL,7.0000,'purchase',200.0000,'2026-08-11T11:00:00+00:00'),
  ('d7000000-0000-4000-8000-0000000000b2','d0000000-0000-4000-8000-0000000000b1','db000000-0000-4000-8000-0000000000b1','d6000000-0000-4000-8000-0000000000b1','product',NULL,'d4000000-0000-4000-8000-0000000000b1',11.0000,'opening_balance',NULL,'2026-08-11T11:05:00+00:00');

UPDATE public.warehouses SET deleted_at = now() WHERE id = 'd6000000-0000-4000-8000-0000000000a9';

CREATE TEMP TABLE _results(test text, passed boolean, detail text);
GRANT ALL ON _results TO authenticated;

-- ------------------------------ I5, I6, I9, I10, I11: structural / ledger --
DO $structural$
DECLARE v_lvl numeric(18,4); v_raised text := 'no exception';
BEGIN
  INSERT INTO _results
  SELECT 'I5 RLS enabled and FORCED on all 4 inventory tables', count(*) = 4,
         'tables with rowsecurity AND forcerowsecurity = ' || count(*)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public'
    AND c.relname IN ('warehouses','stock_movements','ingredient_stock_levels','product_stock_levels')
    AND c.relrowsecurity AND c.relforcerowsecurity;

  -- I6a/b/c -- the TD-012 money-transport defect, reproduced on inventory's columns.
  INSERT INTO _results
  SELECT 'I6a quantity_delta as JSON number loses exact scale',
         (j -> 'quantity_delta')::text <> '"12345678901234.5678"',
         'json number form = ' || (j -> 'quantity_delta')::text
  FROM (SELECT row_to_json(t) AS j FROM (SELECT quantity_delta FROM public.stock_movements
        WHERE id='d7000000-0000-4000-8000-0000000000a1') t) s;

  INSERT INTO _results
  SELECT 'I6b quantity_delta::text survives exact (18,4) scale',
         j ->> 'quantity_delta' = '12345678901234.5678',
         'text form = ' || coalesce(j ->> 'quantity_delta','<null>')
  FROM (SELECT row_to_json(t) AS j FROM (SELECT quantity_delta::text AS quantity_delta
        FROM public.stock_movements WHERE id='d7000000-0000-4000-8000-0000000000a1') t) s;

  INSERT INTO _results
  SELECT 'I6c unit_cost::text preserves NUMERIC(19,4) money scale',
         j ->> 'unit_cost' = '184500.0000',
         'text form = ' || coalesce(j ->> 'unit_cost','<null>')
  FROM (SELECT row_to_json(t) AS j FROM (SELECT unit_cost::text AS unit_cost
        FROM public.stock_movements WHERE id='d7000000-0000-4000-8000-0000000000a1') t) s;

  -- I9 -- justifies the composite cursor: without the id tiebreak, paging past this
  -- instant would silently drop one of these two rows.
  INSERT INTO _results
  SELECT 'I9 created_at is NOT unique, so a lone created_at cursor would drop rows',
         count(*) > 1, 'movements sharing one created_at instant = ' || count(*)
  FROM public.stock_movements
  WHERE tenant_id='d0000000-0000-4000-8000-0000000000a1'
    AND created_at='2026-08-11T09:00:00+00:00';

  -- I10 -- levels are derived, never written: 10 + (-52.5) = -42.5.
  SELECT quantity_on_hand INTO v_lvl FROM public.ingredient_stock_levels
   WHERE warehouse_id='d6000000-0000-4000-8000-0000000000a1'
     AND ingredient_id='d5000000-0000-4000-8000-0000000000a2';
  INSERT INTO _results VALUES (
    'I10 levels are trigger-maintained from the ledger (10 + -52.5 = -42.5)',
    v_lvl = -42.5000, 'sugar level = ' || coalesce(v_lvl::text,'<no row>'));

  -- I11 -- the unconditional half of the policy: a sale is refused even though this
  -- organization has allow_negative_stock = true.
  BEGIN
    INSERT INTO public.stock_movements
      (tenant_id, branch_id, warehouse_id, item_type, product_variant_id, quantity_delta, reason)
    VALUES ('d0000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000a1',
            'd6000000-0000-4000-8000-0000000000a1','product',
            'd4000000-0000-4000-8000-0000000000a1',-9999.0000,'sale');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES (
    'I11 a sale may NEVER drive stock negative, even with allow_negative_stock',
    v_raised LIKE 'insufficient_stock%', 'raised: ' || left(v_raised, 80));
END
$structural$;

-- ------------------------------------------------ I1..I4, I7, I8: RLS --
-- MUST run as `authenticated`. postgres carries BYPASSRLS, so every assertion below
-- would pass vacuously under the default role.
SET LOCAL ROLE authenticated;

-- ---- U_MGR: branch_manager in org A, assigned to branch A1 ONLY ----
SELECT set_config('request.jwt.claims',
  json_build_object('sub','d1000000-0000-4000-8000-000000000001',
                    'tenant_id','d0000000-0000-4000-8000-0000000000a1',
                    'roles', json_build_array('branch_manager'))::text, true);

-- ingredient_stock_levels dropped from every UNION below (AD-022, 2026-09-01): authenticated
-- now holds NO grant on it at all, so a plain SELECT referencing it inside one of these
-- statements would raise an uncaught 42501 and abort the whole transaction before any later
-- assertion could run -- not fail cleanly into _results the way these suites are designed to.
-- I8 (below) replaces the old "negative level is readable" check with an explicit proof that
-- the table is unreachable outright, which is the more important fact now.
INSERT INTO _results
SELECT 'I1 org A sees zero rows belonging to org B (3 authenticated-readable tables)', sum(f)=0,
       'foreign rows visible = ' || sum(f)
FROM (SELECT count(*) AS f FROM public.warehouses             WHERE tenant_id='d0000000-0000-4000-8000-0000000000b1'
  UNION ALL SELECT count(*) FROM public.stock_movements        WHERE tenant_id='d0000000-0000-4000-8000-0000000000b1'
  UNION ALL SELECT count(*) FROM public.product_stock_levels    WHERE tenant_id='d0000000-0000-4000-8000-0000000000b1') s;

-- I2 -- the axis catalog does not have. Same organization, valid tenant claim, other branch.
INSERT INTO _results
SELECT 'I2 branch_manager assigned to A1 sees zero rows from branch A2 (same org)', sum(o)=0,
       'branch A2 rows visible = ' || sum(o)
FROM (SELECT count(*) AS o FROM public.warehouses             WHERE branch_id='da000000-0000-4000-8000-0000000000a2'
  UNION ALL SELECT count(*) FROM public.stock_movements        WHERE branch_id='da000000-0000-4000-8000-0000000000a2'
  UNION ALL SELECT count(*) FROM public.product_stock_levels    WHERE branch_id='da000000-0000-4000-8000-0000000000a2') s;

INSERT INTO _results
SELECT 'I2b the same user DOES see branch A1 (I2 is not vacuous)', sum(b)=2,
       'branch A1 rows visible = ' || sum(b)
FROM (SELECT count(*) AS b FROM public.warehouses             WHERE branch_id='da000000-0000-4000-8000-0000000000a1' AND deleted_at IS NULL
  UNION ALL SELECT count(*) FROM public.product_stock_levels    WHERE branch_id='da000000-0000-4000-8000-0000000000a1') s;

INSERT INTO _results
SELECT 'I4 soft-deleted warehouse in an accessible branch is invisible', count(*)=0,
       'soft-deleted rows visible = ' || count(*)
FROM public.warehouses WHERE id='d6000000-0000-4000-8000-0000000000a9';

-- I8 -- AD-022: ingredient_stock_levels is completely unreachable to `authenticated` now, not
-- just RLS-filtered. A bare SELECT must raise (42501, insufficient_privilege), caught here
-- because an uncaught error inside a plain top-level statement would abort the transaction.
DO $$
DECLARE v_n int; v_raised text := 'no exception';
BEGIN
  BEGIN
    SELECT count(*) INTO v_n FROM public.ingredient_stock_levels;
  EXCEPTION WHEN insufficient_privilege THEN v_raised := SQLSTATE;
  END;
  INSERT INTO _results VALUES (
    'I8 ingredient_stock_levels unreachable to authenticated (AD-022 deactivation)',
    v_raised = '42501', 'sqlstate: ' || v_raised);
END $$;

-- ---- U_OWNER: owner in org A, NO branch_assignments row at all ----
SELECT set_config('request.jwt.claims',
  json_build_object('sub','d1000000-0000-4000-8000-000000000002',
                    'tenant_id','d0000000-0000-4000-8000-0000000000a1',
                    'roles', json_build_array('owner'))::text, true);

-- I3 -- has_branch_access() short-circuits for owner/admin, proving I2's zero comes from
-- the branch predicate rather than from an empty fixture.
INSERT INTO _results
SELECT 'I3 owner with no branch_assignment still sees BOTH org-A branches', count(*)=2,
       'org A warehouses visible to owner = ' || count(*)
FROM public.warehouses
WHERE tenant_id='d0000000-0000-4000-8000-0000000000a1' AND deleted_at IS NULL;

-- I3b -- owner authority still never crosses an organization boundary (AD-008, read path).
INSERT INTO _results
SELECT 'I3b owner authority does not cross the organization boundary', count(*)=0,
       'org B warehouses visible to org A owner = ' || count(*)
FROM public.warehouses WHERE tenant_id='d0000000-0000-4000-8000-0000000000b1';

-- ---- No tenant claim (a revoked membership mints a null tenant_id) ----
SELECT set_config('request.jwt.claims',
  json_build_object('sub','d1000000-0000-4000-8000-000000000001',
                    'roles', json_build_array('branch_manager'))::text, true);

INSERT INTO _results
SELECT 'I7 no tenant claim yields zero inventory rows everywhere', sum(v)=0,
       'rows visible with no tenant claim = ' || sum(v)
FROM (SELECT count(*) AS v FROM public.warehouses
  UNION ALL SELECT count(*) FROM public.stock_movements
  UNION ALL SELECT count(*) FROM public.product_stock_levels) s;

RESET ROLE;

-- ------------------------------------------------------------------ verdict --
SELECT test, passed, left(detail, 100) AS detail FROM _results ORDER BY test;

DO $verdict$
DECLARE v_failed text;
BEGIN
  SELECT string_agg(test, ' | ') INTO v_failed
    FROM _results WHERE passed IS DISTINCT FROM true;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'BakeFlow inventory read suite FAILED: %', v_failed;
  END IF;
  RAISE NOTICE 'BakeFlow inventory read suite passed: % assertions',
    (SELECT count(*) FROM _results);
END
$verdict$;

ROLLBACK;
