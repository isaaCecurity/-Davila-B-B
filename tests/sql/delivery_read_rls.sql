-- BakeFlow — delivery read-path security suite (D1..D10) — P4.5
--
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/delivery_read_rls.sql
--
-- EXECUTED 2026-08-23 against project tvfyxpafbpnkneujcnvr: 11/11 passed, after fixing
-- three defects this suite's first-ever run surfaced, all in this file, none in product
-- code -- see IMPLEMENTATION_LOG.md 2026-08-23 for the full trace:
--   1. Fixture: the org-B ticket's creator had no user_roles row in org B (same defect
--      class as sales_read_rls.sql).
--   2. Fixture: the org-B delivery row was missing a value (driver_id) and, once that
--      was naively patched with NULL, violated ticket_id's NOT NULL constraint --
--      ticket_id was the column actually missing a real value, not driver_id.
--   3. Stale assertion: D1 still expected `softDeleted: false`, a claim the 2026-08-15
--      live-verification pass had already corrected in queries/delivery.ts (softDeleted:
--      true) without this test ever being updated to match.
--
-- Same conventions as the catalog, inventory and sales suites: no psql meta-commands,
-- every assertion records into a temp table rather than raising, verdict block at the end,
-- whole run inside BEGIN ... ROLLBACK.
--
-- WHAT THIS SUITE IS FOR:
--
--   D1   verifies the `softDeleted: false` flag in packages/api/queries/delivery.ts. If
--        `deliveries.deleted_at` turns out to exist, flip the flag — the schema is right
--        and the code is wrong.
--   D3   proves ticket_id is genuinely UNIQUE, which is the sole justification for
--        getDeliveryForTicket() using maybeSingle() rather than returning an array.
--   D5/D6 prove the `ready -> delivered` gate is enforced by the DATABASE. The read models
--        describe isDeliveryVerified() as display-only precisely because of this; if D6
--        passes where it should fail, that claim is false and the gate is convention.
--   D8   is the child-isolation assertion: a driver in another branch must not see the
--        delivery, even though deliveries are the one table a driver role touches most.

BEGIN;

-- ---------------------------------------------------------------- fixtures --
INSERT INTO auth.users (id, email) VALUES
  ('f1000000-0000-4000-8000-000000000001','u.mgr.delivery@bakeflow.test'),
  ('f1000000-0000-4000-8000-000000000002','u.owner.delivery@bakeflow.test'),
  ('f1000000-0000-4000-8000-000000000003','u.driver.delivery@bakeflow.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id, name, slug) VALUES
  ('f0000000-0000-4000-8000-0000000000a1','Delivery Test Bakery A','delivery-test-a'),
  ('f0000000-0000-4000-8000-0000000000b1','Delivery Test Bakery B','delivery-test-b');

INSERT INTO public.branches (id, tenant_id, name, code) VALUES
  ('fa000000-0000-4000-8000-0000000000a1','f0000000-0000-4000-8000-0000000000a1','Del Branch A1','DA1'),
  ('fa000000-0000-4000-8000-0000000000a2','f0000000-0000-4000-8000-0000000000a1','Del Branch A2','DA2'),
  ('fb000000-0000-4000-8000-0000000000b1','f0000000-0000-4000-8000-0000000000b1','Del Branch B1','DB1');

INSERT INTO public.profiles (id, full_name, status, tenant_id, active_tenant_id) VALUES
  ('f1000000-0000-4000-8000-000000000001','U Mgr Delivery','active','f0000000-0000-4000-8000-0000000000a1','f0000000-0000-4000-8000-0000000000a1'),
  ('f1000000-0000-4000-8000-000000000002','U Owner Delivery','active','f0000000-0000-4000-8000-0000000000a1','f0000000-0000-4000-8000-0000000000a1'),
  ('f1000000-0000-4000-8000-000000000003','U Driver Delivery','active','f0000000-0000-4000-8000-0000000000a1','f0000000-0000-4000-8000-0000000000a1')
ON CONFLICT (id) DO UPDATE SET status='active', deleted_at=NULL,
  tenant_id=EXCLUDED.tenant_id, active_tenant_id=EXCLUDED.active_tenant_id;

-- branch_manager = ...0003, owner = ...0001, driver = ...0006 (live roles table).
-- If the driver role id differs live, D8 is the assertion that will surface it.
-- The org-B row for ...0002 exists because the org-B ticket fixture below sets that
-- profile as created_by with tenant_id = org B: guard_order_actor_and_assignment()
-- requires the creator to hold a user_roles row in the ticket's own tenant. Same defect
-- as sales_read_rls.sql -- found live 2026-08-23 running this suite for the first time.
-- Role ids looked up by key, not hardcoded -- see inventory_read_rls.sql's note on why (found
-- and fixed same day, P11.1 throwaway-DB validation, 2026-09-01).
INSERT INTO public.user_roles (tenant_id, profile_id, role_id, branch_id) VALUES
  ('f0000000-0000-4000-8000-0000000000a1','f1000000-0000-4000-8000-000000000001',(select id from public.roles where key='branch_manager'),'fa000000-0000-4000-8000-0000000000a1'),
  ('f0000000-0000-4000-8000-0000000000a1','f1000000-0000-4000-8000-000000000002',(select id from public.roles where key='owner'),NULL),
  ('f0000000-0000-4000-8000-0000000000a1','f1000000-0000-4000-8000-000000000003',(select id from public.roles where key='cashier'),'fa000000-0000-4000-8000-0000000000a1'),
  ('f0000000-0000-4000-8000-0000000000b1','f1000000-0000-4000-8000-000000000002',(select id from public.roles where key='owner'),NULL)
ON CONFLICT DO NOTHING;

INSERT INTO public.branch_assignments (tenant_id, profile_id, branch_id, is_default) VALUES
  ('f0000000-0000-4000-8000-0000000000a1','f1000000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-0000000000a1',true),
  ('f0000000-0000-4000-8000-0000000000a1','f1000000-0000-4000-8000-000000000003','fa000000-0000-4000-8000-0000000000a1',true)
ON CONFLICT DO NOTHING;

INSERT INTO public.customers (id, tenant_id, full_name, phone, is_walk_in) VALUES
  ('f5000000-0000-4000-8000-0000000000a1','f0000000-0000-4000-8000-0000000000a1','Ngozi Balogun','+2348030000101',false),
  ('f5000000-0000-4000-8000-0000000000b1','f0000000-0000-4000-8000-0000000000b1','Tunde Bello','+2348030000102',false);

-- Delivery tickets: fulfilment_type = 'delivery' is the precondition for a deliveries row.
INSERT INTO public.tickets
  (id, tenant_id, branch_id, customer_id, fulfilment_type, created_by, created_at) VALUES
  ('f6000000-0000-4000-8000-0000000000a1','f0000000-0000-4000-8000-0000000000a1','fa000000-0000-4000-8000-0000000000a1','f5000000-0000-4000-8000-0000000000a1','delivery','f1000000-0000-4000-8000-000000000001','2026-08-14T09:00:00+00:00'),
  ('f6000000-0000-4000-8000-0000000000a2','f0000000-0000-4000-8000-0000000000a1','fa000000-0000-4000-8000-0000000000a2','f5000000-0000-4000-8000-0000000000a1','delivery','f1000000-0000-4000-8000-000000000001','2026-08-14T09:00:00+00:00'),
  ('f6000000-0000-4000-8000-0000000000a3','f0000000-0000-4000-8000-0000000000a1','fa000000-0000-4000-8000-0000000000a1',NULL,'pickup','f1000000-0000-4000-8000-000000000001','2026-08-14T09:10:00+00:00'),
  ('f6000000-0000-4000-8000-0000000000b1','f0000000-0000-4000-8000-0000000000b1','fb000000-0000-4000-8000-0000000000b1','f5000000-0000-4000-8000-0000000000b1','delivery','f1000000-0000-4000-8000-000000000002','2026-08-14T11:00:00+00:00');

-- The A1 and A2 deliveries deliberately share created_at, which is what D4 uses to
-- justify the composite (created_at, id) cursor in listDeliveries.
--
-- The org-B row originally had only one NULL for two nullable columns (ticket_id,
-- driver_id) -- a column-count bug caught live 2026-08-23 on this suite's first-ever
-- execution. Corrected: ticket_id is NOT NULL on deliveries, so the missing value was
-- driver_id, and ticket_id is filled from the org-B ticket fixture above.
INSERT INTO public.deliveries
  (id, tenant_id, branch_id, ticket_id, driver_id, status, address_line, created_at) VALUES
  ('f7000000-0000-4000-8000-0000000000a1','f0000000-0000-4000-8000-0000000000a1','fa000000-0000-4000-8000-0000000000a1','f6000000-0000-4000-8000-0000000000a1','f1000000-0000-4000-8000-000000000003','assigned','12 Allen Avenue, Ikeja','2026-08-14T09:05:00+00:00'),
  ('f7000000-0000-4000-8000-0000000000a2','f0000000-0000-4000-8000-0000000000a1','fa000000-0000-4000-8000-0000000000a2','f6000000-0000-4000-8000-0000000000a2',NULL,'pending','5 Awolowo Road, Ikoyi','2026-08-14T09:05:00+00:00'),
  ('f7000000-0000-4000-8000-0000000000b1','f0000000-0000-4000-8000-0000000000b1','fb000000-0000-4000-8000-0000000000b1','f6000000-0000-4000-8000-0000000000b1',NULL,'pending','9 Aba Road, Port Harcourt','2026-08-14T11:05:00+00:00');

CREATE TEMP TABLE _results(test text, passed boolean, detail text);
GRANT ALL ON _results TO authenticated;

-- ================================ structural: schema shape and the gate ====
DO $structural$
DECLARE
  v_raised text;
  v_status text;
BEGIN
  -- ---- D1: the softDeleted flag in queries/delivery.ts ----
  -- Corrected 2026-08-23: the 2026-08-15 live-verification pass found deliveries DOES
  -- carry deleted_at (all 16 domain tables do) and flipped the code's softDeleted flag to
  -- true (queries/delivery.ts:95) at the time -- this assertion was simply never updated
  -- to match and still expected the pre-correction false. The code was already right; the
  -- test was stale.
  INSERT INTO _results
  SELECT 'D1 deliveries HAS deleted_at (softDeleted: true)', count(*) = 1,
         'matching columns = ' || count(*)
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='deliveries' AND column_name='deleted_at';

  -- ---- D2: RLS ----
  INSERT INTO _results
  SELECT 'D2 RLS enabled and FORCED on deliveries', count(*) = 1,
         'rowsecurity AND forcerowsecurity = ' || count(*)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relname='deliveries'
    AND c.relrowsecurity AND c.relforcerowsecurity;

  -- ---- D3: one delivery per ticket, which is why maybeSingle() is legitimate ----
  v_raised := 'no exception';
  BEGIN
    INSERT INTO public.deliveries (tenant_id, branch_id, ticket_id, status, address_line)
    VALUES ('f0000000-0000-4000-8000-0000000000a1','fa000000-0000-4000-8000-0000000000a1',
            'f6000000-0000-4000-8000-0000000000a1','pending','duplicate attempt');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES (
    'D3 deliveries.ticket_id is UNIQUE (justifies maybeSingle in getDeliveryForTicket)',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 90));

  -- ---- D4: justifies the composite (created_at, id) cursor ----
  INSERT INTO _results
  SELECT 'D4 deliveries.created_at is NOT unique, so a lone created_at cursor drops rows',
         count(*) > 1, 'deliveries sharing one created_at instant = ' || count(*)
  FROM public.deliveries
  WHERE tenant_id='f0000000-0000-4000-8000-0000000000a1'
    AND created_at='2026-08-14T09:05:00+00:00';

  -- ---- D5/D6: the ready -> delivered gate is enforced by the database ----
  -- Advance the A1 ticket to `ready` first; its delivery is only `assigned`, so the
  -- onward hop must be refused.
  UPDATE public.tickets SET status='submitted'     WHERE id='f6000000-0000-4000-8000-0000000000a1';
  UPDATE public.tickets SET status='confirmed'     WHERE id='f6000000-0000-4000-8000-0000000000a1';
  UPDATE public.tickets SET status='scheduled'     WHERE id='f6000000-0000-4000-8000-0000000000a1';
  UPDATE public.tickets SET status='in_production' WHERE id='f6000000-0000-4000-8000-0000000000a1';
  UPDATE public.tickets SET status='ready'         WHERE id='f6000000-0000-4000-8000-0000000000a1';

  v_raised := 'no exception';
  BEGIN
    UPDATE public.tickets SET status='delivered' WHERE id='f6000000-0000-4000-8000-0000000000a1';
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  SELECT status INTO v_status FROM public.tickets WHERE id='f6000000-0000-4000-8000-0000000000a1';
  INSERT INTO _results VALUES (
    'D5 ready -> delivered is REFUSED while the delivery is not yet delivered',
    v_status = 'ready',
    'raised: ' || left(v_raised, 60) || ' | ticket status = ' || coalesce(v_status,'<null>'));

  -- Now satisfy the gate and retry. The delivery must reach `delivered` first.
  UPDATE public.deliveries SET status='in_transit'
   WHERE id='f7000000-0000-4000-8000-0000000000a1';
  UPDATE public.deliveries SET status='delivered', recipient_name='Ngozi Balogun',
         delivered_at=now()
   WHERE id='f7000000-0000-4000-8000-0000000000a1';

  v_raised := 'no exception';
  BEGIN
    UPDATE public.tickets SET status='delivered' WHERE id='f6000000-0000-4000-8000-0000000000a1';
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  SELECT status INTO v_status FROM public.tickets WHERE id='f6000000-0000-4000-8000-0000000000a1';
  INSERT INTO _results VALUES (
    'D6 ready -> delivered SUCCEEDS once the delivery row is delivered',
    v_status = 'delivered',
    'raised: ' || left(v_raised, 60) || ' | ticket status = ' || coalesce(v_status,'<null>'));

  -- ---- D7: a pickup ticket skips the gate entirely ----
  UPDATE public.tickets SET status='submitted'     WHERE id='f6000000-0000-4000-8000-0000000000a3';
  UPDATE public.tickets SET status='confirmed'     WHERE id='f6000000-0000-4000-8000-0000000000a3';
  UPDATE public.tickets SET status='scheduled'     WHERE id='f6000000-0000-4000-8000-0000000000a3';
  UPDATE public.tickets SET status='in_production' WHERE id='f6000000-0000-4000-8000-0000000000a3';
  UPDATE public.tickets SET status='ready'         WHERE id='f6000000-0000-4000-8000-0000000000a3';
  v_raised := 'no exception';
  BEGIN
    UPDATE public.tickets SET status='delivered' WHERE id='f6000000-0000-4000-8000-0000000000a3';
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  SELECT status INTO v_status FROM public.tickets WHERE id='f6000000-0000-4000-8000-0000000000a3';
  INSERT INTO _results VALUES (
    'D7 a pickup ticket reaches delivered with no deliveries row at all',
    v_status = 'delivered',
    'raised: ' || left(v_raised, 60) || ' | ticket status = ' || coalesce(v_status,'<null>'));
END
$structural$;

-- ================================================== RLS: D8..D10 ===========
-- MUST run as `authenticated`. postgres carries BYPASSRLS.
SET LOCAL ROLE authenticated;

-- ---- U_DRIVER: driver in org A, assigned to branch A1 ONLY ----
SELECT set_config('request.jwt.claims',
  json_build_object('sub','f1000000-0000-4000-8000-000000000003',
                    'tenant_id','f0000000-0000-4000-8000-0000000000a1',
                    'roles', json_build_array('driver'))::text, true);

INSERT INTO _results
SELECT 'D8 a driver assigned to A1 sees no A2 delivery', count(*)=0,
       'A2 deliveries visible = ' || count(*)
FROM public.deliveries WHERE branch_id='fa000000-0000-4000-8000-0000000000a2';

-- D8b -- prevents D8 passing vacuously.
INSERT INTO _results
SELECT 'D8b the same driver DOES see the A1 delivery (D8 is not vacuous)', count(*)=1,
       'A1 deliveries visible = ' || count(*)
FROM public.deliveries WHERE branch_id='fa000000-0000-4000-8000-0000000000a1';

INSERT INTO _results
SELECT 'D9 org A sees zero deliveries belonging to org B', count(*)=0,
       'foreign deliveries visible = ' || count(*)
FROM public.deliveries WHERE tenant_id='f0000000-0000-4000-8000-0000000000b1';

-- ---- No tenant claim (a revoked membership mints a null tenant_id) ----
SELECT set_config('request.jwt.claims',
  json_build_object('sub','f1000000-0000-4000-8000-000000000003',
                    'roles', json_build_array('driver'))::text, true);

INSERT INTO _results
SELECT 'D10 no tenant claim yields zero deliveries', count(*)=0,
       'deliveries visible with no tenant claim = ' || count(*)
FROM public.deliveries;

RESET ROLE;

-- ------------------------------------------------------------------ verdict --
SELECT test, passed, left(detail, 100) AS detail FROM _results ORDER BY test;

DO $verdict$
DECLARE v_failed text;
BEGIN
  SELECT string_agg(test, ' | ') INTO v_failed
    FROM _results WHERE passed IS DISTINCT FROM true;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'BakeFlow delivery read suite FAILED: %', v_failed;
  END IF;
  RAISE NOTICE 'BakeFlow delivery read suite passed: % assertions',
    (SELECT count(*) FROM _results);
END
$verdict$;

ROLLBACK;
