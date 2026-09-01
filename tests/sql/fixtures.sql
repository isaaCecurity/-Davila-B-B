-- BakeFlow — shared test-tenant fixture library (P11.2).
--
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/fixtures.sql
--
-- Run this ONCE, after supabase/migrations/20260809_live_schema.sql and supabase/seed.sql,
-- before running any tests/sql/*.sql suite. Idempotent (ON CONFLICT DO NOTHING throughout) —
-- safe to re-run against a database that already has these rows.
--
-- DRY-RUN VALIDATED 2026-09-01 against project tvfyxpafbpnkneujcnvr, inside BEGIN...ROLLBACK
-- (zero permanent changes): all INSERTs ran clean and the closing verification block passed.
-- One real bug was caught and fixed by this dry-run: the stock_movements INSERTs originally
-- left reference_id NULL while setting reference_type='manual', which violates the live
-- stock_movements_reference_consistent CHECK (reference_type IS NULL) = (reference_id IS NULL)
-- -- fixed by setting reference_id to the warehouse id, mirroring apply_inventory_adjust()'s
-- own pattern. Not yet validated end-to-end against a truly empty database (no committed
-- migrations + this file + nothing else) — that requires the throwaway-database environment
-- this file was written for in the first place, which was still being set up when this file
-- was finished.
--
-- WHY THIS FILE EXISTS. Every tests/sql/*.sql suite wraps itself in BEGIN...ROLLBACK and
-- creates its own operational rows (tickets, payments, stock_movements, sync_operations, etc.)
-- inline using literal UUIDs — but NONE of the 16 suite files ever INSERT into organizations,
-- branches, profiles, warehouses, recipes, ingredients, product_variants, products, or
-- product_categories (verified live 2026-09-01: `grep -L "insert into public.organizations"
-- *.sql` matches all 16 files). Every suite instead references a small, fixed set of
-- already-existing rows by literal id (e.g. tenant_id 'ab000000-0000-4000-8000-00000000da01')
-- — rows that exist in the live project (tvfyxpafbpnkneujcnvr) but were never captured in any
-- committed migration, seed file, or fixture script. That gap is real: a fresh database built
-- from this repo's own migrations + seed cannot run a single one of these test suites, because
-- the "world" they reference doesn't exist yet.
--
-- HOW THIS FILE WAS BUILT. Not by copying live data wholesale. The live database's warehouse
-- ('b0000000-0000-4000-8000-00000000da01') was found to hold 30+ ingredient_stock_levels and
-- 30+ product_stock_levels rows — the accumulated incidental debris of ad-hoc manual testing
-- across several weeks, referencing dozens of ingredient/product_variant ids that no test file
-- actually names. Mirroring that wholesale would be fragile (encodes accidental state, not
-- deliberate fixture design) and unbounded (it grows every time someone pokes at the live DB).
-- Instead: every literal UUID referenced across all 16 tests/sql/*.sql files was extracted
-- (`grep -ohE` for UUID literals), cross-referenced against organizations/branches/profiles/
-- warehouses/recipes/ingredients/product_variants/products/product_categories/customers on the
-- live database, and only the rows that are BOTH (a) live and (b) actually referenced by a test
-- file (or a direct dependency of one — see below) were kept. 11 rows matched directly; walking
-- their own foreign keys (recipe -> product_variant -> product -> category, product_variant ->
-- product) surfaced 6 more rows tests never name directly but structurally require. Opening
-- stock levels below are deliberately clean, round numbers chosen to give every test suite
-- headroom (not a byte-for-byte copy of the live, drifted quantities).
--
-- THE FIXTURE WORLD THIS FILE BUILDS:
--   organizations : A (...da01, member), B (...da02, member, a profile's active org),
--                   C (...da03, "not a member" — for cross-tenant rejection tests)
--   branches      : A1 under org A, B1 under org B
--   profiles      : one fixture actor, no roles granted here (each test suite grants its own
--                   roles per-test via `insert into public.user_roles ... on conflict do
--                   nothing` inside its own transaction, then rolls back)
--   warehouses    : one default warehouse under org A / branch A1
--   catalog       : one category, two products, two product variants (one plain, one linked
--                   to the recipe below) under org A
--   recipe        : one recipe (product_variant "Small"/AGE-S) using Flour + Sugar
--   stock         : opening levels for Flour/Sugar/Yeast and both product variants, enough
--                   headroom for adjust/waste/consume/receive-shaped tests without going negative

-- ============================================================================================
-- ORGANIZATIONS
-- ============================================================================================
INSERT INTO public.organizations (id, name, slug, country_code, currency_code, timezone, status, allow_negative_stock)
VALUES
  ('ab000000-0000-4000-8000-00000000da01', 'Smoke Bakery A', 'smoke-bakery-a', 'NG', 'NGN', 'Africa/Lagos', 'active', false),
  ('ab000000-0000-4000-8000-00000000da02', 'Smoke Bakery B', 'smoke-bakery-b', 'NG', 'NGN', 'Africa/Lagos', 'active', false),
  ('ab000000-0000-4000-8000-00000000da03', 'Smoke Bakery C (not a member)', 'smoke-bakery-c', 'NG', 'NGN', 'Africa/Lagos', 'active', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================================
-- BRANCHES
-- ============================================================================================
INSERT INTO public.branches (id, tenant_id, name, code, is_primary, status)
VALUES
  ('ac000000-0000-4000-8000-00000000da01', 'ab000000-0000-4000-8000-00000000da01', 'Smoke A1', 'SMA1', true, 'active'),
  ('ac000000-0000-4000-8000-00000000da02', 'ab000000-0000-4000-8000-00000000da02', 'Smoke B1', 'SMB1', true, 'active')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================================
-- PROFILES
-- ============================================================================================
-- No tenant_id/primary_branch_id set here deliberately -- matches live (both NULL on the
-- fixture profile; each test suite sets session JWT claims and role membership per-transaction
-- instead of relying on a profile-level default).
--
-- public.profiles.id has a foreign key to auth.users(id). On the live project this row already
-- exists (created by a real sign-up); a fresh throwaway database has no such row, so a minimal
-- stub is inserted first -- found live 2026-09-01 (profiles_id_fkey violation) applying this
-- file to a genuinely fresh database for the first time. auth.users.id is the only NOT NULL
-- column with no default, so nothing beyond it is needed for this to satisfy the FK.
INSERT INTO auth.users (id)
VALUES ('aa000000-0000-4000-8000-00000000da01')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, full_name, status, active_tenant_id)
VALUES
  ('aa000000-0000-4000-8000-00000000da01', '', 'active', 'ab000000-0000-4000-8000-00000000da02')
ON CONFLICT (id) DO NOTHING;

-- ============================================================================================
-- WAREHOUSES
-- ============================================================================================
INSERT INTO public.warehouses (id, tenant_id, branch_id, name, is_default)
VALUES
  ('b0000000-0000-4000-8000-00000000da01', 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01', 'Smoke Store A', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================================
-- CATALOG: category -> products -> product_variants
-- ============================================================================================
INSERT INTO public.product_categories (id, tenant_id, name, sort_order)
VALUES
  ('ad000000-0000-4000-8000-00000000da01', 'ab000000-0000-4000-8000-00000000da01', 'Breads A', 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.products (id, tenant_id, category_id, name, description, is_active)
VALUES
  ('ae000000-0000-4000-8000-00000000da01', 'ab000000-0000-4000-8000-00000000da01', 'ad000000-0000-4000-8000-00000000da01', 'Agege Bread', 'Soft white loaf.', true),
  ('f951fa04-511d-4a43-8e74-6c5b9ba6cd49', 'ab000000-0000-4000-8000-00000000da01', NULL, 'Smoke Batch Product', NULL, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.product_variants (id, tenant_id, product_id, name, sku, unit_price, is_active)
VALUES
  ('af000000-0000-4000-8000-00000000da01', 'ab000000-0000-4000-8000-00000000da01', 'ae000000-0000-4000-8000-00000000da01', 'Small', 'AGE-S', 850, true),
  ('82218a93-83fe-464a-819e-641987a8e3b1', 'ab000000-0000-4000-8000-00000000da01', 'f951fa04-511d-4a43-8e74-6c5b9ba6cd49', 'Smoke Batch Variant', 'SMOKE-BATCH-01', 1, true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================================
-- INGREDIENTS
-- ============================================================================================
INSERT INTO public.ingredients (id, tenant_id, name, unit_of_measure, reorder_level, is_active)
VALUES
  ('b1000000-0000-4000-8000-00000000da01', 'ab000000-0000-4000-8000-00000000da01', 'Smoke Flour', 'kg', 50, true),
  ('b1000000-0000-4000-8000-00000000da02', 'ab000000-0000-4000-8000-00000000da01', 'Smoke Sugar', 'kg', 25, true),
  ('b1000000-0000-4000-8000-00000000da03', 'ab000000-0000-4000-8000-00000000da01', 'Smoke Yeast', 'g', 10, true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================================
-- RECIPE
-- ============================================================================================
INSERT INTO public.recipes (id, tenant_id, product_variant_id, name, yield_quantity, version, is_active)
VALUES
  ('b2000000-0000-4000-8000-00000000da01', 'ab000000-0000-4000-8000-00000000da01', 'af000000-0000-4000-8000-00000000da01', 'Smoke Agege Recipe', 10, 1, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.recipe_ingredients (tenant_id, recipe_id, ingredient_id, quantity)
VALUES
  ('ab000000-0000-4000-8000-00000000da01', 'b2000000-0000-4000-8000-00000000da01', 'b1000000-0000-4000-8000-00000000da01', 2.5),
  ('ab000000-0000-4000-8000-00000000da01', 'b2000000-0000-4000-8000-00000000da01', 'b1000000-0000-4000-8000-00000000da02', 0.75)
ON CONFLICT DO NOTHING;

-- ============================================================================================
-- SCHEDULED PRODUCTION BATCH (shared fixture for p3_7_production_sync.sql's P1/P2)
-- ============================================================================================
-- Missed in this file's original transitive-closure walk (production_batches wasn't in the
-- table list checked) -- found live 2026-09-01 running p3_7_production_sync.sql against a
-- genuinely fresh database for the first time: P1 ("branch_manager production.start") got a
-- real REJECTED, not a pass, because this batch didn't exist to be started.
-- batch_number deliberately omitted, not hardcoded: assign_batch_number() only auto-assigns
-- via next_document_number() when batch_number is blank -- a hardcoded 'BATCH-000001' here
-- left the document_sequences counter unaware this number was taken, so the first
-- trigger-numbered batch a test file created also computed 'BATCH-000001' and collided
-- (production_batches_tenant_number_key) -- found live 2026-09-01 running
-- p3_7_production_sync.sql/p3_7_production_output_waste_sync.sql against a fresh database.
INSERT INTO public.production_batches (id, tenant_id, branch_id, recipe_id, planned_quantity, status)
VALUES
  ('b3000000-0000-4000-8000-00000000da01', 'ab000000-0000-4000-8000-00000000da01', 'ac000000-0000-4000-8000-00000000da01', 'b2000000-0000-4000-8000-00000000da01', 25, 'scheduled')
ON CONFLICT (id) DO NOTHING;

-- production_batches_copy_ingredients (AFTER INSERT trigger) should populate these
-- automatically from recipe_ingredients above; inserted explicitly too, ON CONFLICT DO NOTHING,
-- so this file doesn't depend on that trigger's exact behavior to be correct.
INSERT INTO public.production_batch_ingredients (tenant_id, batch_id, ingredient_id, planned_quantity)
VALUES
  ('ab000000-0000-4000-8000-00000000da01', 'b3000000-0000-4000-8000-00000000da01', 'b1000000-0000-4000-8000-00000000da01', 6.25),
  ('ab000000-0000-4000-8000-00000000da01', 'b3000000-0000-4000-8000-00000000da01', 'b1000000-0000-4000-8000-00000000da02', 1.875)
ON CONFLICT DO NOTHING;

-- ============================================================================================
-- OPENING STOCK
-- ============================================================================================
-- Via stock_movements (reason='opening_balance'), never a direct level-table write --
-- CLAUDE.md rule 7: stock levels are maintained only by the apply_stock_movement() trigger.
-- Deliberately clean, round numbers with headroom for consume/waste/adjust tests, not a copy
-- of the live warehouse's drifted current values.
-- reference_type/reference_id must both be NULL or both be set together
-- (stock_movements_reference_consistent CHECK, found live via this file's own dry-run) --
-- mirroring apply_inventory_adjust()'s own pattern of reference_type='manual',
-- reference_id=<warehouse_id>.
INSERT INTO public.stock_movements
  (tenant_id, branch_id, warehouse_id, item_type, ingredient_id, product_variant_id, quantity_delta, reason, reference_type, reference_id)
SELECT * FROM (VALUES
  ('ab000000-0000-4000-8000-00000000da01'::uuid, 'ac000000-0000-4000-8000-00000000da01'::uuid, 'b0000000-0000-4000-8000-00000000da01'::uuid, 'ingredient', 'b1000000-0000-4000-8000-00000000da01'::uuid, NULL::uuid, 120::numeric, 'opening_balance', 'manual', 'b0000000-0000-4000-8000-00000000da01'::uuid),
  ('ab000000-0000-4000-8000-00000000da01'::uuid, 'ac000000-0000-4000-8000-00000000da01'::uuid, 'b0000000-0000-4000-8000-00000000da01'::uuid, 'ingredient', 'b1000000-0000-4000-8000-00000000da02'::uuid, NULL::uuid, 25::numeric,  'opening_balance', 'manual', 'b0000000-0000-4000-8000-00000000da01'::uuid),
  ('ab000000-0000-4000-8000-00000000da01'::uuid, 'ac000000-0000-4000-8000-00000000da01'::uuid, 'b0000000-0000-4000-8000-00000000da01'::uuid, 'ingredient', 'b1000000-0000-4000-8000-00000000da03'::uuid, NULL::uuid, 500::numeric, 'opening_balance', 'manual', 'b0000000-0000-4000-8000-00000000da01'::uuid),
  ('ab000000-0000-4000-8000-00000000da01'::uuid, 'ac000000-0000-4000-8000-00000000da01'::uuid, 'b0000000-0000-4000-8000-00000000da01'::uuid, 'product', NULL::uuid, 'af000000-0000-4000-8000-00000000da01'::uuid, 50::numeric, 'opening_balance', 'manual', 'b0000000-0000-4000-8000-00000000da01'::uuid),
  ('ab000000-0000-4000-8000-00000000da01'::uuid, 'ac000000-0000-4000-8000-00000000da01'::uuid, 'b0000000-0000-4000-8000-00000000da01'::uuid, 'product', NULL::uuid, '82218a93-83fe-464a-819e-641987a8e3b1'::uuid, 50::numeric, 'opening_balance', 'manual', 'b0000000-0000-4000-8000-00000000da01'::uuid)
) AS v(tenant_id, branch_id, warehouse_id, item_type, ingredient_id, product_variant_id, quantity_delta, reason, reference_type, reference_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.stock_movements sm
  WHERE sm.warehouse_id = v.warehouse_id
    AND sm.reason = 'opening_balance'
    AND coalesce(sm.ingredient_id, sm.product_variant_id) = coalesce(v.ingredient_id, v.product_variant_id)
);

-- ============================================================================================
-- VERIFICATION: fail loudly if this file didn't actually build the world it claims to.
-- ============================================================================================
DO $verdict$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(check_name, ', ') INTO v_missing FROM (
    SELECT 'organizations(3)' AS check_name WHERE (SELECT count(*) FROM public.organizations WHERE id IN ('ab000000-0000-4000-8000-00000000da01','ab000000-0000-4000-8000-00000000da02','ab000000-0000-4000-8000-00000000da03')) <> 3
    UNION ALL SELECT 'branches(2)' WHERE (SELECT count(*) FROM public.branches WHERE id IN ('ac000000-0000-4000-8000-00000000da01','ac000000-0000-4000-8000-00000000da02')) <> 2
    UNION ALL SELECT 'profiles(1)' WHERE (SELECT count(*) FROM public.profiles WHERE id = 'aa000000-0000-4000-8000-00000000da01') <> 1
    UNION ALL SELECT 'warehouses(1)' WHERE (SELECT count(*) FROM public.warehouses WHERE id = 'b0000000-0000-4000-8000-00000000da01') <> 1
    UNION ALL SELECT 'recipe_ingredients(2)' WHERE (SELECT count(*) FROM public.recipe_ingredients WHERE recipe_id = 'b2000000-0000-4000-8000-00000000da01') <> 2
    -- Existence checks, not total counts: a database this file is layered onto (e.g. the live
    -- project, which accumulates other ad-hoc rows over time) may legitimately have MORE rows
    -- at this warehouse than just these fixtures -- that's not a failure of this file.
    UNION ALL SELECT 'ingredient_stock_levels(flour/sugar/yeast)' WHERE (
      SELECT count(*) FROM public.ingredient_stock_levels
      WHERE warehouse_id = 'b0000000-0000-4000-8000-00000000da01'
        AND ingredient_id IN ('b1000000-0000-4000-8000-00000000da01','b1000000-0000-4000-8000-00000000da02','b1000000-0000-4000-8000-00000000da03')
    ) <> 3
    UNION ALL SELECT 'product_stock_levels(af000000.../82218a93...)' WHERE (
      SELECT count(*) FROM public.product_stock_levels
      WHERE warehouse_id = 'b0000000-0000-4000-8000-00000000da01'
        AND product_variant_id IN ('af000000-0000-4000-8000-00000000da01','82218a93-83fe-464a-819e-641987a8e3b1')
    ) <> 2
  ) missing;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'fixtures.sql FAILED to build the expected world: %', v_missing;
  END IF;
END
$verdict$;

SELECT 'fixtures.sql: fixture world built and verified' AS result;
