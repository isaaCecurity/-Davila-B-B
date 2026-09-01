-- BakeFlow — catalog read-path security suite (C1..C9) — P4.1a
--
-- Proves the boundaries the catalog READ service depends on: an organization cannot
-- read another organization's catalog, a soft-deleted row is invisible, cross-tenant
-- references are refused by the schema itself, and exact decimal money survives
-- transport only when it is cast to text.
--
-- Companion to tests/sql/security_multiorg_sync.sql, same conventions.
--
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/catalog_read_rls.sql
--
-- Deliberately contains **no psql meta-commands**, so the identical text can also be
-- executed as a single statement batch through a SQL tool. Pass ON_ERROR_STOP on the
-- command line rather than with \set.
--
-- SAFETY: the whole suite runs in one transaction and ends in ROLLBACK. It creates
-- fixtures in live tables and must never be allowed to commit. Every assertion records
-- into a temp table rather than raising, so one failure does not hide the rest; the
-- verdict block at the end raises with the names of everything that failed.
--
-- WHAT THIS SUITE CANNOT PROVE, and why it is asserted structurally instead:
-- FORCE ROW LEVEL SECURITY makes a table's OWNER subject to its own policies. The
-- catalog tables are owned by `postgres`, and `postgres` carries the BYPASSRLS role
-- attribute, which supersedes FORCE. So owner-side FORCE cannot be demonstrated
-- behaviourally from this connection. C5 therefore asserts the configuration
-- (relrowsecurity AND relforcerowsecurity) and C1/C2/C4 prove the behaviour under
-- `authenticated`, which does NOT carry BYPASSRLS and is the role the application
-- actually uses.

BEGIN;

-- ---------------------------------------------------------------- fixtures --
-- Two organizations, each with a complete catalog: category -> product -> variant,
-- ingredient, recipe -> recipe_ingredient. Organization A additionally carries a
-- soft-deleted row in all six tables.
--
-- No profiles, user_roles or branches are needed. The catalog SELECT policies read
-- `current_tenant_id()` and `has_role()`, both of which resolve from the JWT claims
-- (`auth.jwt()`), not from database membership rows. Setting `request.jwt.claims` is
-- therefore sufficient, and keeping the fixture minimal keeps the blast radius small.

INSERT INTO public.organizations (id, name, slug) VALUES
  ('c0000000-0000-4000-8000-0000000000a1','Catalog Test Bakery A','catalog-test-a'),
  ('c0000000-0000-4000-8000-0000000000b1','Catalog Test Bakery B','catalog-test-b');

INSERT INTO public.product_categories (id, tenant_id, name, sort_order) VALUES
  ('c1000000-0000-4000-8000-0000000000a1','c0000000-0000-4000-8000-0000000000a1','Breads A',1),
  ('c1000000-0000-4000-8000-0000000000b1','c0000000-0000-4000-8000-0000000000b1','Breads B',1),
  ('c1000000-0000-4000-8000-0000000000a9','c0000000-0000-4000-8000-0000000000a1','Deleted Category A',9);

INSERT INTO public.products (id, tenant_id, category_id, name, is_active) VALUES
  ('c2000000-0000-4000-8000-0000000000a1','c0000000-0000-4000-8000-0000000000a1','c1000000-0000-4000-8000-0000000000a1','Agege Bread A',true),
  ('c2000000-0000-4000-8000-0000000000b1','c0000000-0000-4000-8000-0000000000b1','c1000000-0000-4000-8000-0000000000b1','Agege Bread B',true),
  ('c2000000-0000-4000-8000-0000000000a9','c0000000-0000-4000-8000-0000000000a1',NULL,'Deleted Product A',true);

INSERT INTO public.product_variants (id, tenant_id, product_id, name, sku, unit_price, is_active) VALUES
  ('c3000000-0000-4000-8000-0000000000a1','c0000000-0000-4000-8000-0000000000a1','c2000000-0000-4000-8000-0000000000a1','Large A','SKU-A-1',184500.0000,true),
  ('c3000000-0000-4000-8000-0000000000b1','c0000000-0000-4000-8000-0000000000b1','c2000000-0000-4000-8000-0000000000b1','Large B','SKU-B-1',999.5000,true),
  ('c3000000-0000-4000-8000-0000000000a9','c0000000-0000-4000-8000-0000000000a1','c2000000-0000-4000-8000-0000000000a1','Deleted Variant A','SKU-A-9',1.0000,true);

INSERT INTO public.ingredients (id, tenant_id, name, unit_of_measure, reorder_level, last_unit_cost, is_active) VALUES
  ('c4000000-0000-4000-8000-0000000000a1','c0000000-0000-4000-8000-0000000000a1','Flour A','kg',10.0000,1200.0000,true),
  ('c4000000-0000-4000-8000-0000000000b1','c0000000-0000-4000-8000-0000000000b1','Flour B','kg',5.0000,NULL,true),
  ('c4000000-0000-4000-8000-0000000000a9','c0000000-0000-4000-8000-0000000000a1','Deleted Flour A','g',0.0000,NULL,true);

-- Note: `recipes_one_active_per_variant` is UNIQUE (tenant_id, product_variant_id)
-- WHERE (is_active AND deleted_at IS NULL) — already partial on deleted_at, so this one
-- was never part of the BLOCKER-010(a) natural-key gap C9a/C9b cover below. The
-- soft-deleted recipe here is still set is_active = false anyway, to also prove C9c's
-- "at most one ACTIVE recipe" guarantee holds independent of soft-delete state.
INSERT INTO public.recipes (id, tenant_id, product_variant_id, name, yield_quantity, version, is_active) VALUES
  ('c5000000-0000-4000-8000-0000000000a1','c0000000-0000-4000-8000-0000000000a1','c3000000-0000-4000-8000-0000000000a1','Recipe A',12.0000,1,true),
  ('c5000000-0000-4000-8000-0000000000b1','c0000000-0000-4000-8000-0000000000b1','c3000000-0000-4000-8000-0000000000b1','Recipe B',24.0000,1,true),
  ('c5000000-0000-4000-8000-0000000000a9','c0000000-0000-4000-8000-0000000000a1','c3000000-0000-4000-8000-0000000000a1','Deleted Recipe A',6.0000,2,false);

INSERT INTO public.recipe_ingredients (id, tenant_id, recipe_id, ingredient_id, quantity) VALUES
  ('c6000000-0000-4000-8000-0000000000a1','c0000000-0000-4000-8000-0000000000a1','c5000000-0000-4000-8000-0000000000a1','c4000000-0000-4000-8000-0000000000a1',2.5000),
  ('c6000000-0000-4000-8000-0000000000b1','c0000000-0000-4000-8000-0000000000b1','c5000000-0000-4000-8000-0000000000b1','c4000000-0000-4000-8000-0000000000b1',3.0000),
  ('c6000000-0000-4000-8000-0000000000a9','c0000000-0000-4000-8000-0000000000a1','c5000000-0000-4000-8000-0000000000a9','c4000000-0000-4000-8000-0000000000a1',1.0000);

-- Soft-delete the "…a9" row in each of the six tables (AD-012: deleted_at/deleted_by).
UPDATE public.product_categories SET deleted_at = now() WHERE id = 'c1000000-0000-4000-8000-0000000000a9';
UPDATE public.products           SET deleted_at = now() WHERE id = 'c2000000-0000-4000-8000-0000000000a9';
UPDATE public.product_variants   SET deleted_at = now() WHERE id = 'c3000000-0000-4000-8000-0000000000a9';
UPDATE public.ingredients        SET deleted_at = now() WHERE id = 'c4000000-0000-4000-8000-0000000000a9';
UPDATE public.recipes            SET deleted_at = now() WHERE id = 'c5000000-0000-4000-8000-0000000000a9';
UPDATE public.recipe_ingredients SET deleted_at = now() WHERE id = 'c6000000-0000-4000-8000-0000000000a9';

CREATE TEMP TABLE _results(test text, passed boolean, detail text);
GRANT ALL ON _results TO authenticated;

-- ------------------------------------- C5..C9: structural / owner-side checks --
DO $structural$
DECLARE
  ORG_A uuid := 'c0000000-0000-4000-8000-0000000000a1';
  ORG_B uuid := 'c0000000-0000-4000-8000-0000000000b1';
  VAR_A uuid := 'c3000000-0000-4000-8000-0000000000a1';
  CAT_A uuid := 'c1000000-0000-4000-8000-0000000000a1';
  PRD_A uuid := 'c2000000-0000-4000-8000-0000000000a1';
  ING_A uuid := 'c4000000-0000-4000-8000-0000000000a1';
  RCP_B uuid := 'c5000000-0000-4000-8000-0000000000b1';
  v_money   numeric(19,4) := 12345678901234.5678;
  v_n       int;
BEGIN
  -- C5 -- RLS enabled AND forced on all six catalog tables.
  SELECT count(*) INTO v_n
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('product_categories','products','product_variants',
                       'ingredients','recipes','recipe_ingredients')
     AND c.relrowsecurity AND c.relforcerowsecurity;
  INSERT INTO _results VALUES ('C5a RLS enabled and FORCED on all 6 catalog tables',
    v_n = 6, 'tables with rls+force = ' || v_n);

  -- C5b -- 24 policies, and every SELECT policy has the exact shape the read service
  -- assumes. If someone loosens one, the service's assumptions silently stop holding.
  SELECT count(*) INTO v_n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('product_categories','products','product_variants',
                       'ingredients','recipes','recipe_ingredients');
  INSERT INTO _results VALUES ('C5b 24 policies across the 6 catalog tables',
    v_n = 24, 'policy count = ' || v_n);

  SELECT count(*) INTO v_n
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('product_categories','products','product_variants',
                       'ingredients','recipes','recipe_ingredients')
     AND p.polcmd = 'r'
     AND pg_get_expr(p.polqual, p.polrelid)
         = '((tenant_id = current_tenant_id()) AND (deleted_at IS NULL))';
  INSERT INTO _results VALUES ('C5c every SELECT policy is tenant_id + deleted_at IS NULL',
    v_n = 6, 'matching select policies = ' || v_n);

  -- C5d -- no catalog table has branch_id. The roadmap specified "tenant/branch
  -- scoping"; the schema is tenant-scoped only, and the read service must not invent
  -- a branch filter that would match nothing.
  SELECT count(*) INTO v_n
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name IN ('product_categories','products','product_variants',
                        'ingredients','recipes','recipe_ingredients')
     AND column_name = 'branch_id';
  INSERT INTO _results VALUES ('C5d catalog is tenant-scoped only (no branch_id column)',
    v_n = 0, 'branch_id columns found = ' || v_n);

  -- C6 -- cross-tenant referential integrity is STRUCTURAL, not conventional.
  -- Every child FK is composite on (tenant_id, parent_id). These run as a BYPASSRLS
  -- role on purpose: they prove the foreign key refuses the row even with RLS out of
  -- the picture entirely.
  BEGIN
    INSERT INTO public.products (id, tenant_id, category_id, name)
    VALUES (gen_random_uuid(), ORG_B, CAT_A, 'Cross-tenant category');
    INSERT INTO _results VALUES ('C6a product cannot use another org''s category', false,
      'ACCEPTED - MUST NOT HAPPEN');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO _results VALUES ('C6a product cannot use another org''s category', true, SQLERRM);
  END;

  BEGIN
    INSERT INTO public.product_variants (id, tenant_id, product_id, name, sku, unit_price)
    VALUES (gen_random_uuid(), ORG_B, PRD_A, 'Cross-tenant variant', 'SKU-X-1', 1.0000);
    INSERT INTO _results VALUES ('C6b variant cannot use another org''s product', false,
      'ACCEPTED - MUST NOT HAPPEN');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO _results VALUES ('C6b variant cannot use another org''s product', true, SQLERRM);
  END;

  -- The headline case: a recipe in B must not be able to reference a variant in A.
  BEGIN
    INSERT INTO public.recipes (id, tenant_id, product_variant_id, name, yield_quantity)
    VALUES (gen_random_uuid(), ORG_B, VAR_A, 'Cross-tenant recipe', 1.0000);
    INSERT INTO _results VALUES ('C6c recipe cannot reference another org''s variant', false,
      'ACCEPTED - MUST NOT HAPPEN');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO _results VALUES ('C6c recipe cannot reference another org''s variant', true, SQLERRM);
  END;

  BEGIN
    INSERT INTO public.recipe_ingredients (id, tenant_id, recipe_id, ingredient_id, quantity)
    VALUES (gen_random_uuid(), ORG_B, RCP_B, ING_A, 1.0000);
    INSERT INTO _results VALUES ('C6d recipe line cannot use another org''s ingredient', false,
      'ACCEPTED - MUST NOT HAPPEN');
  EXCEPTION WHEN foreign_key_violation THEN
    INSERT INTO _results VALUES ('C6d recipe line cannot use another org''s ingredient', true, SQLERRM);
  END;

  -- C7 -- money transport. This is why every NUMERIC column in the read service is
  -- selected with a ::text cast.
  INSERT INTO _results VALUES ('C7a ::text preserves NUMERIC(19,4) scale exactly',
    (184500.0000::numeric(19,4))::text = '184500.0000',
    'got ' || (184500.0000::numeric(19,4))::text);

  -- A double is what JSON.parse() produces for an unquoted JSON number. Round-tripping
  -- a large exact value through one corrupts it; the ::text form does not.
  INSERT INTO _results VALUES ('C7b float round-trip corrupts money, ::text does not',
    v_money::text = '12345678901234.5678'
      AND v_money::double precision::text <> '12345678901234.5678',
    'text=' || v_money::text || ' via_double=' || v_money::double precision::text);

  INSERT INTO _results VALUES ('C7c stored unit_price round-trips exactly as text',
    (SELECT unit_price::text FROM public.product_variants WHERE id = VAR_A) = '184500.0000',
    'got ' || (SELECT unit_price::text FROM public.product_variants WHERE id = VAR_A));

  -- C9 -- BLOCKER-010(a): natural-key uniques are now partial on deleted_at (fixed live
  -- 2026-08-14; verified directly against pg_index below rather than assumed). Was
  -- previously recorded here as a defect ("NOT partial", v_n = 0) — that assertion went
  -- stale the moment the fix shipped and asserted the opposite of current reality.
  SELECT count(*) INTO v_n
    FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
   WHERE ic.relname IN ('products_tenant_name_key','ingredients_tenant_name_key',
                        'product_categories_tenant_name_key','product_variants_tenant_sku_key')
     AND i.indpred IS NOT NULL;
  INSERT INTO _results VALUES ('C9a natural-key uniques are partial on deleted_at',
    v_n = 4, 'partial indexes among the 4 natural-key uniques = ' || v_n
             || ' (4 confirms the BLOCKER-010a fix)');

  -- Behavioural proof of the same fix: a soft-deleted product's name is free to reuse.
  -- A bakery that deletes "Deleted Product A" can now create it again.
  BEGIN
    INSERT INTO public.products (id, tenant_id, name)
    VALUES (gen_random_uuid(), ORG_A, 'Deleted Product A');
    INSERT INTO _results VALUES ('C9b soft-deleted name is reusable', true,
      'name was reusable - confirms the BLOCKER-010a fix');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO _results VALUES ('C9b soft-deleted name is reusable', false,
      'still 23505 on reuse - fix regressed: ' || SQLERRM);
  END;

  -- C9c -- one active recipe per variant is a database guarantee, which is what makes
  -- getActiveRecipeForVariant()'s single-row expectation safe.
  BEGIN
    INSERT INTO public.recipes (id, tenant_id, product_variant_id, name, yield_quantity, version, is_active)
    VALUES (gen_random_uuid(), ORG_A, VAR_A, 'Second active recipe', 1.0000, 3, true);
    INSERT INTO _results VALUES ('C9c at most one ACTIVE recipe per variant', false,
      'a second active recipe was accepted - MUST NOT HAPPEN');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO _results VALUES ('C9c at most one ACTIVE recipe per variant', true, SQLERRM);
  END;
END
$structural$;

-- --------------------------------------------- C1..C4: RLS visibility --
-- These MUST run as `authenticated`. As a BYPASSRLS role no policy applies and every
-- assertion below would pass vacuously.
SET LOCAL ROLE authenticated;

-- ---- Acting as Organization A ----
SELECT set_config('request.jwt.claims',
  json_build_object('sub','c9000000-0000-4000-8000-000000000001',
                    'tenant_id','c0000000-0000-4000-8000-0000000000a1',
                    'roles', json_build_array('owner'))::text, true);

-- C1 -- organization isolation across all six tables, in one pass.
-- Counted rather than expected to raise: RLS filters SELECT, it does not error. A
-- denied read is an empty set. Any test that expected an exception here would pass
-- for the wrong reason.
INSERT INTO _results
SELECT 'C1 org A sees zero rows belonging to org B (all 6 tables)',
       sum(foreign_rows) = 0,
       'foreign rows visible = ' || sum(foreign_rows)
FROM (
  SELECT count(*) FILTER (WHERE tenant_id <> 'c0000000-0000-4000-8000-0000000000a1') AS foreign_rows FROM public.product_categories
  UNION ALL SELECT count(*) FILTER (WHERE tenant_id <> 'c0000000-0000-4000-8000-0000000000a1') FROM public.products
  UNION ALL SELECT count(*) FILTER (WHERE tenant_id <> 'c0000000-0000-4000-8000-0000000000a1') FROM public.product_variants
  UNION ALL SELECT count(*) FILTER (WHERE tenant_id <> 'c0000000-0000-4000-8000-0000000000a1') FROM public.ingredients
  UNION ALL SELECT count(*) FILTER (WHERE tenant_id <> 'c0000000-0000-4000-8000-0000000000a1') FROM public.recipes
  UNION ALL SELECT count(*) FILTER (WHERE tenant_id <> 'c0000000-0000-4000-8000-0000000000a1') FROM public.recipe_ingredients
) s;

-- C1b -- the positive half: org A does see its own live rows. Without this, C1 would
-- also pass if RLS were denying everything for the wrong reason.
--
-- 7, not 6: C9b (above) now successfully inserts a second live product named
-- "Deleted Product A" into public.products for ORG_A, proving the BLOCKER-010a fix
-- lets a soft-deleted name be reused -- that insert persists in this same transaction,
-- so products carries 2 live rows by the time this count runs, not 1. Found the same
-- pass C9a/C9b were corrected (2026-09-01, first real GitHub Actions run): C1b's
-- expected count went stale the moment C9b started actually succeeding instead of
-- catching a unique_violation.
INSERT INTO _results
SELECT 'C1b org A sees exactly its own 7 live rows',
       sum(own_rows) = 7,
       'own live rows visible = ' || sum(own_rows)
FROM (
  SELECT count(*) AS own_rows FROM public.product_categories
  UNION ALL SELECT count(*) FROM public.products
  UNION ALL SELECT count(*) FROM public.product_variants
  UNION ALL SELECT count(*) FROM public.ingredients
  UNION ALL SELECT count(*) FROM public.recipes
  UNION ALL SELECT count(*) FROM public.recipe_ingredients
) s;

-- C2 -- soft-deleted rows are invisible in all six tables.
INSERT INTO _results
SELECT 'C2 soft-deleted rows invisible in all 6 tables',
       count(*) = 0,
       'soft-deleted rows visible = ' || count(*)
FROM (
  SELECT id FROM public.product_categories WHERE id = 'c1000000-0000-4000-8000-0000000000a9'
  UNION ALL SELECT id FROM public.products           WHERE id = 'c2000000-0000-4000-8000-0000000000a9'
  UNION ALL SELECT id FROM public.product_variants   WHERE id = 'c3000000-0000-4000-8000-0000000000a9'
  UNION ALL SELECT id FROM public.ingredients        WHERE id = 'c4000000-0000-4000-8000-0000000000a9'
  UNION ALL SELECT id FROM public.recipes            WHERE id = 'c5000000-0000-4000-8000-0000000000a9'
  UNION ALL SELECT id FROM public.recipe_ingredients WHERE id = 'c6000000-0000-4000-8000-0000000000a9'
) s;

-- C2b -- the read service adds `.is('deleted_at', null)` on every query even though
-- RLS already enforces it (API-CONTRACT.md §4). Confirm the explicit filter is
-- consistent with the policy rather than fighting it: same rows either way.
INSERT INTO _results
SELECT 'C2b explicit deleted_at filter agrees with the policy',
       (SELECT count(*) FROM public.products) = (SELECT count(*) FROM public.products WHERE deleted_at IS NULL),
       'policy-only=' || (SELECT count(*) FROM public.products)
         || ' explicit=' || (SELECT count(*) FROM public.products WHERE deleted_at IS NULL);

-- C2c -- a cross-organization read by primary key returns nothing rather than raising.
-- This is exactly what getProductById() relies on to return null for "not mine".
INSERT INTO _results
SELECT 'C2c cross-org read by id returns empty, does not raise',
       count(*) = 0,
       'rows returned for org B product = ' || count(*)
FROM public.products WHERE id = 'c2000000-0000-4000-8000-0000000000b1';

-- ---- Acting as Organization B: isolation must hold symmetrically ----
SELECT set_config('request.jwt.claims',
  json_build_object('sub','c9000000-0000-4000-8000-000000000002',
                    'tenant_id','c0000000-0000-4000-8000-0000000000b1',
                    'roles', json_build_array('owner'))::text, true);

INSERT INTO _results
SELECT 'C3 org B sees zero rows belonging to org A (all 6 tables)',
       sum(foreign_rows) = 0,
       'foreign rows visible = ' || sum(foreign_rows)
FROM (
  SELECT count(*) FILTER (WHERE tenant_id <> 'c0000000-0000-4000-8000-0000000000b1') AS foreign_rows FROM public.product_categories
  UNION ALL SELECT count(*) FILTER (WHERE tenant_id <> 'c0000000-0000-4000-8000-0000000000b1') FROM public.products
  UNION ALL SELECT count(*) FILTER (WHERE tenant_id <> 'c0000000-0000-4000-8000-0000000000b1') FROM public.product_variants
  UNION ALL SELECT count(*) FILTER (WHERE tenant_id <> 'c0000000-0000-4000-8000-0000000000b1') FROM public.ingredients
  UNION ALL SELECT count(*) FILTER (WHERE tenant_id <> 'c0000000-0000-4000-8000-0000000000b1') FROM public.recipes
  UNION ALL SELECT count(*) FILTER (WHERE tenant_id <> 'c0000000-0000-4000-8000-0000000000b1') FROM public.recipe_ingredients
) s;

-- C3b -- org B cannot reach org A's recipe through the variant relation either. The
-- read service walks variant -> recipe -> lines, so the join path needs proving, not
-- just the base tables.
INSERT INTO _results
SELECT 'C3b org B cannot traverse variant->recipe->lines into org A',
       count(*) = 0,
       'rows reachable through the join = ' || count(*)
FROM public.product_variants v
JOIN public.recipes r ON r.product_variant_id = v.id
JOIN public.recipe_ingredients ri ON ri.recipe_id = r.id
WHERE v.tenant_id = 'c0000000-0000-4000-8000-0000000000a1'
   OR r.tenant_id = 'c0000000-0000-4000-8000-0000000000a1'
   OR ri.tenant_id = 'c0000000-0000-4000-8000-0000000000a1';

-- ---- C4: deny by default when the JWT carries no organization ----
-- A revoked membership mints a null tenant_id (AD-003, test S5d). `NULL = anything`
-- is NULL, so every catalog policy must deny. This is the state P8.1 has to render as
-- "no organization selected" rather than as an empty catalog.
SELECT set_config('request.jwt.claims',
  json_build_object('sub','c9000000-0000-4000-8000-000000000003',
                    'roles', json_build_array())::text, true);

INSERT INTO _results
SELECT 'C4 null tenant claim sees nothing in any catalog table',
       sum(visible) = 0,
       'rows visible with no tenant claim = ' || sum(visible)
FROM (
  SELECT count(*) AS visible FROM public.product_categories
  UNION ALL SELECT count(*) FROM public.products
  UNION ALL SELECT count(*) FROM public.product_variants
  UNION ALL SELECT count(*) FROM public.ingredients
  UNION ALL SELECT count(*) FROM public.recipes
  UNION ALL SELECT count(*) FROM public.recipe_ingredients
) s;

RESET ROLE;

-- ------------------------------------------------------------------ verdict --
SELECT test, passed, left(detail, 110) AS detail FROM _results ORDER BY test;

DO $verdict$
DECLARE v_failed text;
BEGIN
  SELECT string_agg(test, ' | ') INTO v_failed
    FROM _results WHERE passed IS DISTINCT FROM true;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'BakeFlow catalog read suite FAILED: %', v_failed;
  END IF;
  RAISE NOTICE 'BakeFlow catalog read suite passed: % assertions',
    (SELECT count(*) FROM _results);
END
$verdict$;

ROLLBACK;
