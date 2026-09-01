-- BakeFlow — inventory write-path security suite (A0..A13) — P4.2b
--
-- STATUS: EXECUTED 2026-08-15 against project tvfyxpafbpnkneujcnvr — 17/17 passed.
-- The first run failed A11 for a test reason, not a product one; see the note at A11.
--
-- UPDATED 2026-09-01 (AD-022, ingredient/raw-material tracking deactivated for MVP):
-- adjust_stock() now rejects item_type='ingredient' outright. A1/A2/A7/A8/A10/A6/A5/A4a-d
-- were always testing adjust_stock()'s generic RPC mechanics (absolute-target semantics,
-- idempotency, role gating, negative-target/invalid-reason rejection, branch/warehouse
-- checks) rather than anything ingredient-specific, so all switched to item_type='product'
-- against the already-fixtured variant e4000000-...-a1 (A3/A4c/A4d already used it). A13
-- added to prove the deactivation itself. A0 (direct table-insert denial) is unaffected --
-- it tests a GRANT, not adjust_stock()'s item_type branch.
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/inventory_write_rls.sql
--
-- WHAT IT PROVES, and why the write path is an RPC rather than an insert.
--
-- `authenticated` holds SELECT **only** on `stock_movements` (verified live 2026-08-11).
-- GRANTs are checked before RLS, so a direct insert is impossible for every application
-- role — A0 asserts exactly that. Writes therefore go through the SECURITY DEFINER
-- `adjust_stock()`, which is EXECUTE-able by `authenticated` and owns three things a
-- client must not: `created_by` from `auth.uid()` (A10), `branch_id` derived from the
-- warehouse, and an `audit_log` entry in the same transaction (A11).
--
-- `adjust_stock` takes an ABSOLUTE TARGET, not a delta. That is what makes A2 possible:
-- replaying the same call is a no-op rather than a double count.
--
-- SAFETY: one transaction, ends in ROLLBACK. Creates fixtures in live tables and must
-- never commit.

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('e1000000-0000-4000-8000-000000000001','w.mgr@bakeflow.test'),
  ('e1000000-0000-4000-8000-000000000002','w.cashier@bakeflow.test'),
  ('e1000000-0000-4000-8000-000000000003','w.baker@bakeflow.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id, name, slug, allow_negative_stock) VALUES
  ('e0000000-0000-4000-8000-0000000000a1','W Bakery A','w-test-a',false),
  ('e0000000-0000-4000-8000-0000000000b1','W Bakery B','w-test-b',false);

INSERT INTO public.branches (id, tenant_id, name, code) VALUES
  ('ea000000-0000-4000-8000-0000000000a1','e0000000-0000-4000-8000-0000000000a1','W A1','WA1'),
  ('ea000000-0000-4000-8000-0000000000a2','e0000000-0000-4000-8000-0000000000a1','W A2','WA2'),
  ('eb000000-0000-4000-8000-0000000000b1','e0000000-0000-4000-8000-0000000000b1','W B1','WB1');

INSERT INTO public.profiles (id, full_name, status, tenant_id, active_tenant_id) VALUES
  ('e1000000-0000-4000-8000-000000000001','W Mgr','active','e0000000-0000-4000-8000-0000000000a1','e0000000-0000-4000-8000-0000000000a1'),
  ('e1000000-0000-4000-8000-000000000002','W Cashier','active','e0000000-0000-4000-8000-0000000000a1','e0000000-0000-4000-8000-0000000000a1'),
  ('e1000000-0000-4000-8000-000000000003','W Baker','active','e0000000-0000-4000-8000-0000000000a1','e0000000-0000-4000-8000-0000000000a1')
ON CONFLICT (id) DO UPDATE SET status='active', deleted_at=NULL;

-- Only branch A1 is assigned to any of them; A2 exists so A6 has somewhere to be refused.
INSERT INTO public.branch_assignments (tenant_id, profile_id, branch_id, is_default) VALUES
  ('e0000000-0000-4000-8000-0000000000a1','e1000000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-0000000000a1',true),
  ('e0000000-0000-4000-8000-0000000000a1','e1000000-0000-4000-8000-000000000002','ea000000-0000-4000-8000-0000000000a1',true),
  ('e0000000-0000-4000-8000-0000000000a1','e1000000-0000-4000-8000-000000000003','ea000000-0000-4000-8000-0000000000a1',true)
ON CONFLICT DO NOTHING;

INSERT INTO public.product_categories (id, tenant_id, name, sort_order) VALUES
  ('e2000000-0000-4000-8000-0000000000a1','e0000000-0000-4000-8000-0000000000a1','W Cat A',1);
INSERT INTO public.products (id, tenant_id, category_id, name, is_active) VALUES
  ('e3000000-0000-4000-8000-0000000000a1','e0000000-0000-4000-8000-0000000000a1','e2000000-0000-4000-8000-0000000000a1','W Prod A',true);
INSERT INTO public.product_variants (id, tenant_id, product_id, name, sku, unit_price, is_active) VALUES
  ('e4000000-0000-4000-8000-0000000000a1','e0000000-0000-4000-8000-0000000000a1','e3000000-0000-4000-8000-0000000000a1','W Var A','W-SKU-A',500.0000,true);
INSERT INTO public.ingredients (id, tenant_id, name, unit_of_measure, reorder_level, is_active) VALUES
  ('e5000000-0000-4000-8000-0000000000a1','e0000000-0000-4000-8000-0000000000a1','W Flour A','kg',1.0000,true);

INSERT INTO public.warehouses (id, tenant_id, branch_id, name, is_default) VALUES
  ('e6000000-0000-4000-8000-0000000000a1','e0000000-0000-4000-8000-0000000000a1','ea000000-0000-4000-8000-0000000000a1','W Store A1',true),
  ('e6000000-0000-4000-8000-0000000000a2','e0000000-0000-4000-8000-0000000000a1','ea000000-0000-4000-8000-0000000000a2','W Store A2',true),
  ('e6000000-0000-4000-8000-0000000000b1','e0000000-0000-4000-8000-0000000000b1','eb000000-0000-4000-8000-0000000000b1','W Store B1',true);

CREATE TEMP TABLE _r(test text, passed boolean, detail text);
GRANT ALL ON _r TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','e1000000-0000-4000-8000-000000000001',
                    'tenant_id','e0000000-0000-4000-8000-0000000000a1',
                    'roles',json_build_array('branch_manager'))::text, true);

DO $a$
DECLARE s text; r jsonb; v text; n int; cb uuid;
BEGIN
  -- A0 -- the premise of the whole module: no direct ledger insert from the client.
  BEGIN
    INSERT INTO public.stock_movements (tenant_id,branch_id,warehouse_id,item_type,ingredient_id,quantity_delta,reason)
    VALUES ('e0000000-0000-4000-8000-0000000000a1','ea000000-0000-4000-8000-0000000000a1','e6000000-0000-4000-8000-0000000000a1','ingredient','e5000000-0000-4000-8000-0000000000a1',1.0,'purchase');
    s := 'no error';
  EXCEPTION WHEN OTHERS THEN s := SQLSTATE; END;
  INSERT INTO _r VALUES ('A0 direct INSERT into stock_movements is denied to authenticated', s='42501', 'sqlstate = '||s);

  -- A1 -- absolute target, exact to 4dp.
  BEGIN
    r := public.adjust_stock('e6000000-0000-4000-8000-0000000000a1','product','e4000000-0000-4000-8000-0000000000a1',12345678901234.5678,'adjustment','count');
    s := 'ok';
  EXCEPTION WHEN OTHERS THEN s := SQLSTATE||' '||SQLERRM; END;
  SELECT quantity_on_hand::text INTO v FROM public.product_stock_levels
   WHERE warehouse_id='e6000000-0000-4000-8000-0000000000a1' AND product_variant_id='e4000000-0000-4000-8000-0000000000a1';
  INSERT INTO _r VALUES ('A1 branch_manager adjustment sets the absolute target exactly',
    s='ok' AND v='12345678901234.5678', 'result='||s||' level='||coalesce(v,'<none>'));

  -- A2 -- absolute-target semantics give idempotency for free.
  r := public.adjust_stock('e6000000-0000-4000-8000-0000000000a1','product','e4000000-0000-4000-8000-0000000000a1',12345678901234.5678,'adjustment','count again');
  SELECT count(*) INTO n FROM public.stock_movements WHERE product_variant_id='e4000000-0000-4000-8000-0000000000a1';
  INSERT INTO _r VALUES ('A2 replaying the same target is a no-op, not a second movement',
    (r->>'unchanged')='true' AND n=1, 'unchanged='||coalesce(r->>'unchanged','<none>')||' movements='||n);

  -- A10 -- the actor is stamped by the server, not supplied by the caller.
  SELECT created_by INTO cb FROM public.stock_movements WHERE product_variant_id='e4000000-0000-4000-8000-0000000000a1' LIMIT 1;
  INSERT INTO _r VALUES ('A10 created_by is stamped from auth.uid() by the RPC',
    cb='e1000000-0000-4000-8000-000000000001', 'created_by = '||coalesce(cb::text,'<null>'));

  -- A11 -- audit is part of the same transaction, not a client responsibility.
  --
  -- Counted with RLS bypassed, and that is the whole subtlety. The first run of this
  -- suite (2026-08-15) failed here with 'audit rows = 0' while the row existed: the
  -- assertion was evaluated as `authenticated` holding branch_manager, and audit_log's
  -- SELECT policy is
  --     tenant_id = current_tenant_id() AND has_role('owner','admin','accountant')
  --                                     AND deleted_at IS NULL
  -- so a branch_manager cannot see the audit trail they just caused to be written.
  -- Measuring an invariant through a policy that hides it tests the policy, not the
  -- invariant. A11b below asserts the policy separately, on purpose.
  SELECT count(*) INTO n FROM public.audit_log WHERE entity_type='stock_movement';
  INSERT INTO _r VALUES ('A11 an audit_log entry is written for the movement (RLS bypassed)',
    n>=1, 'audit rows = '||n);

  -- A11c -- the audit trail is not readable by the role that writes to it. Deliberate:
  -- audit_log is for owner/admin/accountant, and a branch_manager seeing every action in
  -- their organization would be a privilege they are not granted elsewhere either.
  SELECT count(*) INTO n FROM public.audit_log;
  INSERT INTO _r VALUES ('A11c a branch_manager cannot read audit_log at all', n=0,
    'audit rows visible to branch_manager = '||n);

  BEGIN
    r := public.adjust_stock('e6000000-0000-4000-8000-0000000000a1','product','e4000000-0000-4000-8000-0000000000a1',-1.0,'adjustment',NULL);
    s := 'no error';
  EXCEPTION WHEN OTHERS THEN s := SQLERRM; END;
  INSERT INTO _r VALUES ('A7 a negative target quantity is refused', s LIKE '%cannot be negative%', 'msg = '||left(s,60));

  BEGIN
    r := public.adjust_stock('e6000000-0000-4000-8000-0000000000a1','product','e4000000-0000-4000-8000-0000000000a1',5.0,'sale',NULL);
    s := 'no error';
  EXCEPTION WHEN OTHERS THEN s := SQLERRM; END;
  INSERT INTO _r VALUES ('A12 reason=sale is refused by adjust_stock', s LIKE '%invalid stock adjustment reason%', 'msg = '||left(s,60));

  BEGIN
    r := public.adjust_stock('e6000000-0000-4000-8000-0000000000a1','product','e4000000-0000-4000-8000-0000000000a1',99999999999999.0,'waste',NULL);
    s := 'no error';
  EXCEPTION WHEN OTHERS THEN s := SQLERRM; END;
  INSERT INTO _r VALUES ('A8 an increase cannot be recorded as waste', s LIKE '%cannot be recorded as waste%', 'msg = '||left(s,60));

  -- A6 -- branch isolation on the WRITE path.
  BEGIN
    r := public.adjust_stock('e6000000-0000-4000-8000-0000000000a2','product','e4000000-0000-4000-8000-0000000000a1',5.0,'adjustment',NULL);
    s := 'no error';
  EXCEPTION WHEN OTHERS THEN s := SQLERRM; END;
  INSERT INTO _r VALUES ('A6 branch isolation holds on WRITE (unassigned branch refused)', s LIKE '%branch access denied%', 'msg = '||left(s,60));

  -- A5 -- a foreign warehouse is refused with the same message as a missing one, so the
  -- caller cannot probe which ids exist elsewhere.
  BEGIN
    r := public.adjust_stock('e6000000-0000-4000-8000-0000000000b1','product','e4000000-0000-4000-8000-0000000000a1',5.0,'adjustment',NULL);
    s := 'no error';
  EXCEPTION WHEN OTHERS THEN s := SQLERRM; END;
  INSERT INTO _r VALUES ('A5 cross-organization warehouse is refused (no existence leak)', s LIKE '%not found or branch access denied%', 'msg = '||left(s,60));

  BEGIN
    r := public.adjust_stock('e6000000-0000-4000-8000-0000000000a1','product','e4000000-0000-4000-8000-0000000000a1',10.0,'opening_balance',NULL);
    s := 'ok';
  EXCEPTION WHEN OTHERS THEN s := SQLERRM; END;
  INSERT INTO _r VALUES ('A3 opening_balance establishes a level', s='ok', 'result = '||left(s,60));

  -- A13 -- AD-022: ingredient tracking is deactivated for MVP; adjust_stock() must refuse
  -- item_type='ingredient' outright, on an item that legitimately exists in this tenant.
  BEGIN
    r := public.adjust_stock('e6000000-0000-4000-8000-0000000000a1','ingredient','e5000000-0000-4000-8000-0000000000a1',5.0,'adjustment',NULL);
    s := 'no error';
  EXCEPTION WHEN OTHERS THEN s := SQLERRM; END;
  INSERT INTO _r VALUES ('A13 item_type=ingredient is refused (AD-022 deactivation)',
    s LIKE '%ingredient tracking is not available%', 'msg = '||left(s,70));
END
$a$;

-- A4a/A4b -- a cashier may read stock but may not change it, by either reason.
SELECT set_config('request.jwt.claims',
  json_build_object('sub','e1000000-0000-4000-8000-000000000002',
                    'tenant_id','e0000000-0000-4000-8000-0000000000a1',
                    'roles',json_build_array('cashier'))::text, true);
DO $a4$
DECLARE s text; r jsonb;
BEGIN
  BEGIN
    r := public.adjust_stock('e6000000-0000-4000-8000-0000000000a1','product','e4000000-0000-4000-8000-0000000000a1',1.0,'adjustment',NULL);
    s := 'no error';
  EXCEPTION WHEN OTHERS THEN s := SQLERRM; END;
  INSERT INTO _r VALUES ('A4a cashier cannot record an adjustment', s LIKE '%insufficient_role%', 'msg = '||left(s,55));
  BEGIN
    r := public.adjust_stock('e6000000-0000-4000-8000-0000000000a1','product','e4000000-0000-4000-8000-0000000000a1',1.0,'waste',NULL);
    s := 'no error';
  EXCEPTION WHEN OTHERS THEN s := SQLERRM; END;
  INSERT INTO _r VALUES ('A4b cashier cannot record waste either', s LIKE '%insufficient_role%', 'msg = '||left(s,55));
END
$a4$;

-- A4c/A4d -- the role split is real: a baker may record waste but not an adjustment.
SELECT set_config('request.jwt.claims',
  json_build_object('sub','e1000000-0000-4000-8000-000000000003',
                    'tenant_id','e0000000-0000-4000-8000-0000000000a1',
                    'roles',json_build_array('baker'))::text, true);
DO $a5$
DECLARE s text; r jsonb;
BEGIN
  BEGIN
    r := public.adjust_stock('e6000000-0000-4000-8000-0000000000a1','product','e4000000-0000-4000-8000-0000000000a1',4.0,'waste','spoiled');
    s := 'ok';
  EXCEPTION WHEN OTHERS THEN s := SQLERRM; END;
  INSERT INTO _r VALUES ('A4c baker MAY record waste', s='ok', 'result = '||left(s,55));
  BEGIN
    r := public.adjust_stock('e6000000-0000-4000-8000-0000000000a1','product','e4000000-0000-4000-8000-0000000000a1',9.0,'adjustment',NULL);
    s := 'no error';
  EXCEPTION WHEN OTHERS THEN s := SQLERRM; END;
  INSERT INTO _r VALUES ('A4d baker may NOT record an adjustment', s LIKE '%insufficient_role%', 'msg = '||left(s,55));
END
$a5$;

RESET ROLE;

-- A11 is re-measured here, outside the authenticated role, for the reason recorded above.
DO $a11$
DECLARE n int; m int;
BEGIN
  SELECT count(*) INTO n FROM public.audit_log WHERE entity_type='stock_movement';
  UPDATE _r SET passed = (n>=1), detail = 'audit rows (RLS bypassed) = '||n
   WHERE test LIKE 'A11 an audit_log entry%';
  SELECT count(*) INTO m FROM public.stock_movements
   WHERE product_variant_id='e4000000-0000-4000-8000-0000000000a1';
  INSERT INTO _r VALUES ('A11b one audit row per ledger movement', n>=m, 'audit='||n||' movements='||m);
END
$a11$;

SELECT test, passed, left(detail,90) AS detail FROM _r ORDER BY test;

DO $v$
DECLARE f text;
BEGIN
  SELECT string_agg(test,' | ') INTO f FROM _r WHERE passed IS DISTINCT FROM true;
  IF f IS NOT NULL THEN RAISE EXCEPTION 'inventory WRITE suite FAILED: %', f; END IF;
  RAISE NOTICE 'BakeFlow inventory write suite passed: % assertions', (SELECT count(*) FROM _r);
END $v$;

ROLLBACK;
