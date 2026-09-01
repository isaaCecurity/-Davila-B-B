-- BakeFlow — catalog write-path security suite — P4.1b, resolves BLOCKER-010(c)
--
-- STATUS: EXECUTED live against project tvfyxpafbpnkneujcnvr (rolled-back transaction)
-- — 18/18 passed: W1,W2,W3,W5-W12,W15-W21. W4/W13/W14 are deliberately absent, not
-- missing — W13/W14 (role-split hard-DELETE cases) were retired mid-write-up once
-- testing showed the boundary isn't role-based at all (see finding 2 below); W4 was
-- never assigned. Numbering kept as originally drafted rather than renumbered, matching
-- this project's convention elsewhere (e.g. p3_7_production_sync.sql's stale-P11 note)
-- of correcting content in place over renumbering for its own sake. W17-W21 were added
-- after the same finding motivated building archive_catalog_entity()/
-- restore_catalog_entity() (migration 20260901200000) mid-pass.
--
-- Confirms PostgREST + RLS (not an RPC) as the catalog write mechanism, per
-- docs/API-CONTRACT.md §1 ("Single-row writes with no side effects | PostgREST
-- insert/update, protected by RLS"). Live-verified before writing this file, not assumed:
--
--   - products/product_variants/product_categories carry only a BEFORE UPDATE
--     set_updated_at() trigger each — no multi-step or cross-table side effects that
--     would require an RPC's transactional envelope.
--   - `authenticated` already holds direct INSERT/SELECT/UPDATE (no DELETE — see
--     finding 2 below) on all three tables, and role-gated INSERT/UPDATE policies
--     already exist (owner/admin/branch_manager) — this mechanism has been live since
--     the original schema, just never confirmed as the intended one or exercised by a
--     test suite.
--   - AD-017/AD-021's "effective-dated price history" requirement is satisfied by
--     `ticket_items.unit_price` being copied and frozen at ticket-creation time, not by
--     a separate price-history table (none exists — confirmed live, zero tables match
--     '%price%'). W16 proves this holds when unit_price is edited through this exact
--     write path, which is the one real risk BLOCKER-010(b) named.
--
-- TWO GENUINE LIMITS OF THE MECHANISM, FOUND WHILE WRITING THIS SUITE (not assumed,
-- reproduced live in rolled-back transactions):
--
-- 1. A direct PostgREST UPDATE can never set `deleted_at` on these tables, for ANY
--    role including owner. PostgreSQL requires a row's post-UPDATE image to still
--    satisfy the table's own SELECT policy (`deleted_at IS NULL`); setting `deleted_at`
--    to a real timestamp makes the new row fail that policy, so Postgres refuses the
--    UPDATE with 42501 regardless of the UPDATE policy's own WITH CHECK (confirmed by
--    temporarily replacing that WITH CHECK with `true` via ALTER POLICY — still
--    refused; only relaxing the SELECT policy itself let it through). W11 proves this
--    structurally rather than as a role gate.
-- 2. `authenticated` was never actually GRANTed DELETE on these three tables at all
--    (`information_schema.role_table_grants` shows INSERT/SELECT/UPDATE only,
--    confirmed live). The `products_delete`/`product_variants_delete`/
--    `product_categories_delete` RLS policies (owner/admin only) are therefore dead
--    code today — the same shape of gap TD-016 already recorded for tickets: a policy
--    that looks like the gate but isn't reachable because the GRANT layer, checked
--    first, already refuses everyone. W12 proves this for owner specifically (message
--    is the GRANT-layer "permission denied for table products", not the RLS one) to
--    rule out a role explanation.
--
-- Together: there is currently NO way to remove or soft-delete a catalog row through
-- PostgREST, for any role. This is exactly the same shape of problem
-- `docs/SOFT-DELETE-AND-RETENTION.md` §38 already identified for the RESTORE direction
-- (`restore_catalog_entity`, "does not exist yet — must be built as part of P4.1b") but
-- had not identified for the DELETE direction, since nothing had exercised it live
-- before. Catalog soft-delete needs its own SECURITY DEFINER RPC, symmetric to the
-- already-specified restore one — not built in this pass; see BLOCKERS.md
-- BLOCKER-010(c) for the resolution and the follow-up this created.
--
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/catalog_write_rls.sql
--
-- Deliberately contains no psql meta-commands. Companion to catalog_read_rls.sql, same
-- conventions. Table RLS (W1-W16) needs only JWT claims — has_role() reads
-- auth.jwt()->'roles' directly. archive_catalog_entity()/restore_catalog_entity()
-- (W17-W21) gate on has_permission() instead, which IS DB-backed (user_roles/roles/
-- role_permissions/permissions), so those need real profile/user_roles fixtures too —
-- added below, additively, without changing the JWT-only shape W1-W16 rely on.
--
-- SAFETY: one transaction, ends in ROLLBACK. Creates fixtures in live tables and must
-- never commit.

BEGIN;

-- ---------------------------------------------------------------- fixtures --
INSERT INTO auth.users (id, email) VALUES
  ('cd900000-0000-4000-8000-000000000001','cw.owner@bakeflow.test'),
  ('cd900000-0000-4000-8000-000000000002','cw.cashier@bakeflow.test'),
  ('cd900000-0000-4000-8000-000000000003','cw.manager@bakeflow.test'),
  ('cd900000-0000-4000-8000-000000000004','cw.driver@bakeflow.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id, name, slug) VALUES
  ('cd000000-0000-4000-8000-0000000000a1','Catalog Write Test Bakery A','catalog-write-test-a'),
  ('cd000000-0000-4000-8000-0000000000b1','Catalog Write Test Bakery B','catalog-write-test-b');

INSERT INTO public.branches (id, tenant_id, name, code) VALUES
  ('cd600000-0000-4000-8000-0000000000a1','cd000000-0000-4000-8000-0000000000a1','CW A1','CWA1');

INSERT INTO public.product_categories (id, tenant_id, name, sort_order) VALUES
  ('cd100000-0000-4000-8000-0000000000a1','cd000000-0000-4000-8000-0000000000a1','CW Cat A',1),
  ('cd100000-0000-4000-8000-0000000000b1','cd000000-0000-4000-8000-0000000000b1','CW Cat B',1);

INSERT INTO public.products (id, tenant_id, category_id, name, is_active) VALUES
  ('cd200000-0000-4000-8000-0000000000a1','cd000000-0000-4000-8000-0000000000a1','cd100000-0000-4000-8000-0000000000a1','CW Prod A',true),
  ('cd200000-0000-4000-8000-0000000000a2','cd000000-0000-4000-8000-0000000000a1','cd100000-0000-4000-8000-0000000000a1','CW Prod A2 (for soft-delete/reuse)',true),
  ('cd200000-0000-4000-8000-0000000000b1','cd000000-0000-4000-8000-0000000000b1','cd100000-0000-4000-8000-0000000000b1','CW Prod B',true);

INSERT INTO public.product_variants (id, tenant_id, product_id, name, sku, unit_price, is_active) VALUES
  ('cd300000-0000-4000-8000-0000000000a1','cd000000-0000-4000-8000-0000000000a1','cd200000-0000-4000-8000-0000000000a1','CW Var A','CW-SKU-A',500.0000,true),
  ('cd300000-0000-4000-8000-0000000000a2','cd000000-0000-4000-8000-0000000000a1','cd200000-0000-4000-8000-0000000000a2','CW Var A2 (soft-delete/reuse)','CW-SKU-REUSE',10.0000,true);

-- One draft ticket + item referencing Var A, for W16's frozen-price proof.
INSERT INTO public.tickets (id, tenant_id, branch_id, fulfilment_type, status) VALUES
  ('cd700000-0000-4000-8000-0000000000a1','cd000000-0000-4000-8000-0000000000a1','cd600000-0000-4000-8000-0000000000a1','pickup','draft');
INSERT INTO public.ticket_items (id, tenant_id, ticket_id, product_variant_id, quantity, unit_price) VALUES
  ('cd800000-0000-4000-8000-0000000000a1','cd000000-0000-4000-8000-0000000000a1','cd700000-0000-4000-8000-0000000000a1','cd300000-0000-4000-8000-0000000000a1',1.0000,500.0000);

-- profiles + user_roles: only for W17-W21 (the RPCs' has_permission() check is
-- DB-backed, unlike W1-W16's pure-JWT policies).
INSERT INTO public.profiles (id, full_name, status, tenant_id, active_tenant_id) VALUES
  ('cd900000-0000-4000-8000-000000000001','CW Owner','active','cd000000-0000-4000-8000-0000000000a1','cd000000-0000-4000-8000-0000000000a1'),
  ('cd900000-0000-4000-8000-000000000002','CW Cashier','active','cd000000-0000-4000-8000-0000000000a1','cd000000-0000-4000-8000-0000000000a1'),
  ('cd900000-0000-4000-8000-000000000003','CW Manager','active','cd000000-0000-4000-8000-0000000000a1','cd000000-0000-4000-8000-0000000000a1'),
  ('cd900000-0000-4000-8000-000000000004','CW Driver','active','cd000000-0000-4000-8000-0000000000a1','cd000000-0000-4000-8000-0000000000a1')
ON CONFLICT (id) DO UPDATE SET status='active', deleted_at=NULL;

INSERT INTO public.user_roles (tenant_id, profile_id, role_id) VALUES
  ('cd000000-0000-4000-8000-0000000000a1','cd900000-0000-4000-8000-000000000001',(SELECT id FROM public.roles WHERE key='owner')),
  ('cd000000-0000-4000-8000-0000000000a1','cd900000-0000-4000-8000-000000000002',(SELECT id FROM public.roles WHERE key='cashier')),
  ('cd000000-0000-4000-8000-0000000000a1','cd900000-0000-4000-8000-000000000003',(SELECT id FROM public.roles WHERE key='branch_manager')),
  ('cd000000-0000-4000-8000-0000000000a1','cd900000-0000-4000-8000-000000000004',(SELECT id FROM public.roles WHERE key='driver'))
ON CONFLICT DO NOTHING;

-- Pre-soft-delete "A2 (soft-delete/reuse)" as the elevated fixture role, not through
-- `authenticated` — W11 below proves a direct `authenticated` UPDATE can never perform
-- this transition at all (see the file header), so the fixture has to reach this state
-- another way, same as catalog_read_rls.sql's own fixture convention.
UPDATE public.products         SET deleted_at = now() WHERE id = 'cd200000-0000-4000-8000-0000000000a2';
UPDATE public.product_variants SET deleted_at = now() WHERE id = 'cd300000-0000-4000-8000-0000000000a2';

CREATE TEMP TABLE _results(test text, passed boolean, detail text);
GRANT ALL ON _results TO authenticated;

SET LOCAL ROLE authenticated;

-- ================================================================ INSERT gates --

-- ---- owner (org A) ----
SELECT set_config('request.jwt.claims',
  json_build_object('sub','cd900000-0000-4000-8000-000000000001',
                    'tenant_id','cd000000-0000-4000-8000-0000000000a1',
                    'roles', json_build_array('owner'))::text, true);

DO $$
BEGIN
  INSERT INTO public.product_categories (id, tenant_id, name, sort_order)
  VALUES ('cd100000-0000-4000-8000-000000000091','cd000000-0000-4000-8000-0000000000a1','CW Cat A2',2);
  INSERT INTO _results VALUES ('W1 owner can insert a category', true, 'inserted');
EXCEPTION WHEN insufficient_privilege OR others THEN
  INSERT INTO _results VALUES ('W1 owner can insert a category', false, SQLERRM);
END $$;

-- ---- cashier (org A) ----
SELECT set_config('request.jwt.claims',
  json_build_object('sub','cd900000-0000-4000-8000-000000000002',
                    'tenant_id','cd000000-0000-4000-8000-0000000000a1',
                    'roles', json_build_array('cashier'))::text, true);

DO $$
BEGIN
  INSERT INTO public.product_categories (id, tenant_id, name, sort_order)
  VALUES (gen_random_uuid(),'cd000000-0000-4000-8000-0000000000a1','CW Cat by cashier',3);
  INSERT INTO _results VALUES ('W2 cashier cannot insert a category', false, 'ACCEPTED - MUST NOT HAPPEN');
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO _results VALUES ('W2 cashier cannot insert a category', true, SQLERRM);
END $$;

-- ---- branch_manager (org A) ----
SELECT set_config('request.jwt.claims',
  json_build_object('sub','cd900000-0000-4000-8000-000000000003',
                    'tenant_id','cd000000-0000-4000-8000-0000000000a1',
                    'roles', json_build_array('branch_manager'))::text, true);

DO $$
BEGIN
  INSERT INTO public.products (id, tenant_id, category_id, name, is_active)
  VALUES ('cd200000-0000-4000-8000-000000000091','cd000000-0000-4000-8000-0000000000a1','cd100000-0000-4000-8000-0000000000a1','CW Prod by manager',true);
  INSERT INTO _results VALUES ('W3 branch_manager can insert a product', true, 'inserted');
EXCEPTION WHEN insufficient_privilege OR others THEN
  INSERT INTO _results VALUES ('W3 branch_manager can insert a product', false, SQLERRM);
END $$;

DO $$
BEGIN
  INSERT INTO public.product_variants (id, tenant_id, product_id, name, sku, unit_price, is_active)
  VALUES ('cd300000-0000-4000-8000-000000000091','cd000000-0000-4000-8000-0000000000a1','cd200000-0000-4000-8000-000000000091','CW Var by manager','CW-SKU-MGR',1500.0000,true);
  INSERT INTO _results VALUES ('W5 branch_manager can insert a product_variant', true, 'inserted');
EXCEPTION WHEN insufficient_privilege OR others THEN
  INSERT INTO _results VALUES ('W5 branch_manager can insert a product_variant', false, SQLERRM);
END $$;

-- cross-tenant insert: an org A actor cannot plant a row under org B's tenant_id.
DO $$
BEGIN
  INSERT INTO public.products (id, tenant_id, category_id, name)
  VALUES (gen_random_uuid(),'cd000000-0000-4000-8000-0000000000b1',NULL,'Cross-tenant product via A actor');
  INSERT INTO _results VALUES ('W9 cross-tenant insert (WITH CHECK) refused', false, 'ACCEPTED - MUST NOT HAPPEN');
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO _results VALUES ('W9 cross-tenant insert (WITH CHECK) refused', true, SQLERRM);
END $$;

-- ---- driver (org A) ----
SELECT set_config('request.jwt.claims',
  json_build_object('sub','cd900000-0000-4000-8000-000000000004',
                    'tenant_id','cd000000-0000-4000-8000-0000000000a1',
                    'roles', json_build_array('driver'))::text, true);

DO $$
BEGIN
  INSERT INTO public.product_variants (id, tenant_id, product_id, name, sku, unit_price, is_active)
  VALUES (gen_random_uuid(),'cd000000-0000-4000-8000-0000000000a1','cd200000-0000-4000-8000-0000000000a1','CW Var by driver','CW-SKU-DRV',1.0000,true);
  INSERT INTO _results VALUES ('W6 driver cannot insert a product_variant', false, 'ACCEPTED - MUST NOT HAPPEN');
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO _results VALUES ('W6 driver cannot insert a product_variant', true, SQLERRM);
END $$;

-- ================================================================ UPDATE gates --

-- ---- owner (org A): the headline case — direct price edit through PostgREST+RLS. ----
SELECT set_config('request.jwt.claims',
  json_build_object('sub','cd900000-0000-4000-8000-000000000001',
                    'tenant_id','cd000000-0000-4000-8000-0000000000a1',
                    'roles', json_build_array('owner'))::text, true);

DO $$
BEGIN
  UPDATE public.product_variants SET unit_price = 550.0000
   WHERE id = 'cd300000-0000-4000-8000-0000000000a1';
  INSERT INTO _results VALUES ('W7 owner can update product_variants.unit_price directly',
    (SELECT unit_price FROM public.product_variants WHERE id = 'cd300000-0000-4000-8000-0000000000a1') = 550.0000,
    'unit_price now ' || (SELECT unit_price::text FROM public.product_variants WHERE id = 'cd300000-0000-4000-8000-0000000000a1'));
EXCEPTION WHEN insufficient_privilege OR others THEN
  INSERT INTO _results VALUES ('W7 owner can update product_variants.unit_price directly', false, SQLERRM);
END $$;

-- W16 — the price change above must not have touched the already-frozen ticket item.
INSERT INTO _results
SELECT 'W16 historical ticket_items.unit_price stays frozen after a later catalog price edit',
       unit_price = 500.0000,
       'ticket_items.unit_price = ' || unit_price::text || ' (catalog now 550.0000)'
FROM public.ticket_items WHERE id = 'cd800000-0000-4000-8000-0000000000a1';

-- ---- cashier (org A) ----
SELECT set_config('request.jwt.claims',
  json_build_object('sub','cd900000-0000-4000-8000-000000000002',
                    'tenant_id','cd000000-0000-4000-8000-0000000000a1',
                    'roles', json_build_array('cashier'))::text, true);

DO $$
DECLARE v_n int;
BEGIN
  UPDATE public.product_variants SET unit_price = 1.0000
   WHERE id = 'cd300000-0000-4000-8000-0000000000a1';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _results VALUES ('W8 cashier cannot update product_variants.unit_price',
    v_n = 0, 'rows updated = ' || v_n);
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO _results VALUES ('W8 cashier cannot update product_variants.unit_price', true, SQLERRM);
END $$;

-- cross-tenant update: an org A actor's UPDATE naming an org B row's id affects zero
-- rows (the USING clause filters it out) rather than raising — RLS on UPDATE behaves
-- like SELECT for row visibility, not like INSERT's WITH CHECK.
DO $$
DECLARE v_n int;
BEGIN
  UPDATE public.products SET name = 'Hijacked from org A'
   WHERE id = 'cd200000-0000-4000-8000-0000000000b1';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  INSERT INTO _results VALUES ('W10 cross-tenant update affects zero rows, does not raise',
    v_n = 0, 'rows updated = ' || v_n);
END $$;

-- ---- owner (org A): the structural finding — nobody can soft-delete via UPDATE ----
-- Not a role-gate test: owner already holds products_update's role check. This proves
-- the block is PostgreSQL's own RLS mechanics (new row must still satisfy the SELECT
-- policy), independent of who is asking. See the file header for how this was verified
-- (an ALTER POLICY probe ruled out the UPDATE policy's own WITH CHECK as the cause).
SELECT set_config('request.jwt.claims',
  json_build_object('sub','cd900000-0000-4000-8000-000000000001',
                    'tenant_id','cd000000-0000-4000-8000-0000000000a1',
                    'roles', json_build_array('owner'))::text, true);

DO $$
BEGIN
  UPDATE public.products SET deleted_at = now() WHERE id = 'cd200000-0000-4000-8000-0000000000a1';
  INSERT INTO _results VALUES ('W11 not even owner can soft-delete via direct UPDATE (structural, not a role gap)',
    false, 'ACCEPTED - MUST NOT HAPPEN (soft-delete needs its own RPC, see BLOCKER-010c)');
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO _results VALUES ('W11 not even owner can soft-delete via direct UPDATE (structural, not a role gap)',
    true, SQLERRM);
END $$;

-- ---- owner (org A): the second structural finding — hard DELETE is ungranted, not
-- just role-gated. Still under the owner claims set for W11 above.
DO $$
BEGIN
  DELETE FROM public.products WHERE id = 'cd200000-0000-4000-8000-000000000091';
  INSERT INTO _results VALUES ('W12 not even owner can hard-DELETE (no DELETE grant on products at all)',
    false, 'ACCEPTED - MUST NOT HAPPEN');
EXCEPTION WHEN insufficient_privilege THEN
  INSERT INTO _results VALUES ('W12 not even owner can hard-DELETE (no DELETE grant on products at all)',
    true, SQLERRM);
END $$;

-- W15 — BLOCKER-010(a)'s partial-unique-index fix holds through this exact write path:
-- a soft-deleted variant's SKU (pre-deleted in the fixture block above) is free to
-- reuse by a plain PostgREST-shaped insert.
DO $$
BEGIN
  INSERT INTO public.product_variants (id, tenant_id, product_id, name, sku, unit_price, is_active)
  VALUES (gen_random_uuid(),'cd000000-0000-4000-8000-0000000000a1','cd200000-0000-4000-8000-0000000000a2','CW Var A2 reissued','CW-SKU-REUSE',12.0000,true);
  INSERT INTO _results VALUES ('W15 soft-deleted SKU is reusable through the write path', true,
    'reinsert succeeded - confirms BLOCKER-010a holds for this mechanism');
EXCEPTION WHEN unique_violation THEN
  INSERT INTO _results VALUES ('W15 soft-deleted SKU is reusable through the write path', false,
    'still 23505 on reuse: ' || SQLERRM);
END $$;

-- ================================================================ archive/restore RPCs --
-- W11/W12 proved PostgREST+RLS has no path to delete/restore a catalog row at all.
-- archive_catalog_entity()/restore_catalog_entity() (added in the same migration this
-- test file's findings motivated) are that path — proven here.

-- ---- owner (org A): archive succeeds where the raw UPDATE (W11) could not ----
DO $$
DECLARE v_res jsonb;
BEGIN
  SELECT public.archive_catalog_entity('product','cd200000-0000-4000-8000-0000000000a1') INTO v_res;
  INSERT INTO _results VALUES ('W17 owner can archive a product via archive_catalog_entity',
    (v_res->>'deleted_at') IS NOT NULL, v_res::text);
EXCEPTION WHEN others THEN
  INSERT INTO _results VALUES ('W17 owner can archive a product via archive_catalog_entity', false, SQLERRM);
END $$;

-- ---- cashier (org A): has_role() would deny this on the RLS tables; has_permission()
-- (DB-backed) must deny it here too, on a still-live product. ----
SELECT set_config('request.jwt.claims',
  json_build_object('sub','cd900000-0000-4000-8000-000000000002',
                    'tenant_id','cd000000-0000-4000-8000-0000000000a1',
                    'roles', json_build_array('cashier'))::text, true);

DO $$
DECLARE v_res jsonb;
BEGIN
  SELECT public.archive_catalog_entity('product','cd200000-0000-4000-8000-000000000091') INTO v_res;
  INSERT INTO _results VALUES ('W18 cashier cannot archive via archive_catalog_entity',
    false, 'ACCEPTED - MUST NOT HAPPEN');
EXCEPTION WHEN others THEN
  INSERT INTO _results VALUES ('W18 cashier cannot archive via archive_catalog_entity', true, SQLERRM);
END $$;

-- ---- owner (org A): restore round-trips the entity W17 archived ----
SELECT set_config('request.jwt.claims',
  json_build_object('sub','cd900000-0000-4000-8000-000000000001',
                    'tenant_id','cd000000-0000-4000-8000-0000000000a1',
                    'roles', json_build_array('owner'))::text, true);

DO $$
DECLARE v_res jsonb;
BEGIN
  SELECT public.restore_catalog_entity('product','cd200000-0000-4000-8000-0000000000a1') INTO v_res;
  INSERT INTO _results VALUES ('W19 owner can restore via restore_catalog_entity',
    (v_res->>'deleted_at') IS NULL, v_res::text);
EXCEPTION WHEN others THEN
  INSERT INTO _results VALUES ('W19 owner can restore via restore_catalog_entity', false, SQLERRM);
END $$;

-- W20 — 'ingredient' stays out of scope, matching AD-022 (see the file header).
DO $$
DECLARE v_res jsonb;
BEGIN
  SELECT public.archive_catalog_entity('ingredient','cd200000-0000-4000-8000-0000000000a1') INTO v_res;
  INSERT INTO _results VALUES ('W20 archive_catalog_entity rejects entity_type=ingredient (AD-022 scope)',
    false, 'ACCEPTED - MUST NOT HAPPEN');
EXCEPTION WHEN others THEN
  INSERT INTO _results VALUES ('W20 archive_catalog_entity rejects entity_type=ingredient (AD-022 scope)',
    true, SQLERRM);
END $$;

-- W21 — tenant_id is resolved server-side from the row, never trusted from the
-- caller: an org A owner naming an org B product id gets the same "not found" as a
-- nonexistent id, not a cross-tenant leak or a different error shape.
DO $$
DECLARE v_res jsonb;
BEGIN
  SELECT public.archive_catalog_entity('product','cd200000-0000-4000-8000-0000000000b1') INTO v_res;
  INSERT INTO _results VALUES ('W21 cross-tenant archive attempt refused as not-found',
    false, 'ACCEPTED - MUST NOT HAPPEN');
EXCEPTION WHEN others THEN
  INSERT INTO _results VALUES ('W21 cross-tenant archive attempt refused as not-found',
    SQLERRM LIKE '%not found%', SQLERRM);
END $$;

RESET ROLE;

-- ------------------------------------------------------------------ verdict --
SELECT test, passed, left(detail, 110) AS detail FROM _results ORDER BY test;

DO $verdict$
DECLARE v_failed text;
BEGIN
  SELECT string_agg(test, ' | ') INTO v_failed
    FROM _results WHERE passed IS DISTINCT FROM true;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'BakeFlow catalog write suite FAILED: %', v_failed;
  END IF;
  RAISE NOTICE 'BakeFlow catalog write suite passed: % assertions',
    (SELECT count(*) FROM _results);
END
$verdict$;

ROLLBACK;
