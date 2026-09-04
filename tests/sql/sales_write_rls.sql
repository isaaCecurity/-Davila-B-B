-- BakeFlow — ticket (sales) write-path security suite (SW1..SW26) — P4.4
--
-- Companion to sales_read_rls.sql (the read path). Proves the five online ticket-write
-- RPCs (confirm_ticket/cancel_ticket/complete_ticket/archive_ticket/update_ticket) and
-- the guard_ticket_status_transition() trigger they all funnel through — role gates per
-- status hop, the money-freeze/invoice/refund invariants, branch-access scoping, and
-- tenant isolation. `authenticated` holds no UPDATE grant on `tickets` at all (verified
-- live, SW1) — every one of these lifecycle hops MUST go through an RPC, which is why
-- this suite calls the RPCs directly (as `authenticated`, via SET LOCAL ROLE + JWT
-- claims) rather than raw table writes.
--
-- SW22-SW26 are a different concern from SW1-SW21 above: `authenticated` DOES hold a
-- direct INSERT/UPDATE grant on `ticket_items` (unlike `tickets`), so those five prove
-- the real, live `ticket_items_insert`/`ticket_items_update` RLS policies directly via a
-- raw INSERT/UPDATE — something no RPC-based assertion in this file exercises, since
-- every RPC above is SECURITY DEFINER and bypasses RLS entirely. This closes a real
-- coverage gap: the 2026-09-03 cost/logic audit proved these same policies out ad hoc
-- while rewriting them to wrap auth.uid() for InitPlan caching, but never saved the
-- check into a permanent file until now — see
-- audit-findings/COST-AND-LOGIC-AUDIT-2026-09-03.md.
--
-- STATUS: EXECUTED live against project tvfyxpafbpnkneujcnvr (rolled-back transaction).
--
-- A REAL DEFECT WAS FOUND AND FIXED WHILE WRITING THIS SUITE, before any assertion was
-- written: complete_ticket() had no guard against being called twice on an
-- already-'completed' ticket. Its final status UPDATE is a same-status no-op (nothing
-- ever raises), but the stock-movement loop above it ran unconditionally every call —
-- verified live that two calls on one ticket sold the same stock twice, taking on-hand
-- from 50 to 44 instead of the correct 47. Fixed live (migration
-- fix_complete_ticket_idempotency) to reject outright if already completed; SW14 is the
-- permanent regression guard. See IMPLEMENTATION_LOG.md 2026-09-01 for the full repro.
--
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/sales_write_rls.sql
--
-- Deliberately contains no psql meta-commands. Same conventions as financial_write_rls.sql:
-- no data changes committed (BEGIN...ROLLBACK), every assertion records into a temp
-- table rather than raising, verdict block at the end.
--
-- Fixture note: has_branch_access() (used by update_ticket, and internally by
-- has_role()-adjacent checks elsewhere) bypasses only for owner/admin — every other
-- actor needs an explicit branch_assignments row, or a branch-scoped RPC call silently
-- matches zero rows rather than raising (the same defect class financial_write_rls.sql's
-- own header already documents for F22/F23). Cashier/baker/branch_manager here all get
-- one; branch_manager_noaccess deliberately does not, to prove the gate (SW20).

BEGIN;

-- ---------------------------------------------------------------- fixtures --
INSERT INTO auth.users (id, email) VALUES
  ('5a900000-0000-4000-8000-000000000001','sw.owner@bakeflow.test'),
  ('5a900000-0000-4000-8000-000000000002','sw.cashier@bakeflow.test'),
  ('5a900000-0000-4000-8000-000000000003','sw.baker@bakeflow.test'),
  ('5a900000-0000-4000-8000-000000000004','sw.manager@bakeflow.test'),
  ('5a900000-0000-4000-8000-000000000005','sw.manager2.noaccess@bakeflow.test'),
  ('5a900000-0000-4000-8000-000000000006','sw.driver@bakeflow.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id, name, slug) VALUES
  ('5a000000-0000-4000-8000-0000000000a1','Sales Write Test Bakery A','sales-write-test-a'),
  ('5a000000-0000-4000-8000-0000000000b1','Sales Write Test Bakery B','sales-write-test-b');

INSERT INTO public.branches (id, tenant_id, name, code) VALUES
  ('5a100000-0000-4000-8000-0000000000a1','5a000000-0000-4000-8000-0000000000a1','SW Branch A1','SWA1'),
  ('5a100000-0000-4000-8000-0000000000b1','5a000000-0000-4000-8000-0000000000b1','SW Branch B1','SWB1');

INSERT INTO public.warehouses (id, tenant_id, branch_id, name, is_default) VALUES
  ('5a150000-0000-4000-8000-0000000000a1','5a000000-0000-4000-8000-0000000000a1','5a100000-0000-4000-8000-0000000000a1','SW Store A1',true);

INSERT INTO public.profiles (id, full_name, status, tenant_id, active_tenant_id) VALUES
  ('5a900000-0000-4000-8000-000000000001','SW Owner','active','5a000000-0000-4000-8000-0000000000a1','5a000000-0000-4000-8000-0000000000a1'),
  ('5a900000-0000-4000-8000-000000000002','SW Cashier','active','5a000000-0000-4000-8000-0000000000a1','5a000000-0000-4000-8000-0000000000a1'),
  ('5a900000-0000-4000-8000-000000000003','SW Baker','active','5a000000-0000-4000-8000-0000000000a1','5a000000-0000-4000-8000-0000000000a1'),
  ('5a900000-0000-4000-8000-000000000004','SW Manager','active','5a000000-0000-4000-8000-0000000000a1','5a000000-0000-4000-8000-0000000000a1'),
  ('5a900000-0000-4000-8000-000000000005','SW Manager2 NoAccess','active','5a000000-0000-4000-8000-0000000000a1','5a000000-0000-4000-8000-0000000000a1'),
  ('5a900000-0000-4000-8000-000000000006','SW Driver','active','5a000000-0000-4000-8000-0000000000a1','5a000000-0000-4000-8000-0000000000a1')
ON CONFLICT (id) DO UPDATE SET status='active', deleted_at=NULL;

INSERT INTO public.user_roles (tenant_id, profile_id, role_id) VALUES
  ('5a000000-0000-4000-8000-0000000000a1','5a900000-0000-4000-8000-000000000001',(select id from public.roles where key='owner')),
  ('5a000000-0000-4000-8000-0000000000a1','5a900000-0000-4000-8000-000000000002',(select id from public.roles where key='cashier')),
  ('5a000000-0000-4000-8000-0000000000a1','5a900000-0000-4000-8000-000000000003',(select id from public.roles where key='baker')),
  ('5a000000-0000-4000-8000-0000000000a1','5a900000-0000-4000-8000-000000000004',(select id from public.roles where key='branch_manager')),
  ('5a000000-0000-4000-8000-0000000000a1','5a900000-0000-4000-8000-000000000005',(select id from public.roles where key='branch_manager')),
  ('5a000000-0000-4000-8000-0000000000a1','5a900000-0000-4000-8000-000000000006',(select id from public.roles where key='driver'))
ON CONFLICT DO NOTHING;

INSERT INTO public.branch_assignments (tenant_id, profile_id, branch_id, is_default) VALUES
  ('5a000000-0000-4000-8000-0000000000a1','5a900000-0000-4000-8000-000000000002','5a100000-0000-4000-8000-0000000000a1',true),
  ('5a000000-0000-4000-8000-0000000000a1','5a900000-0000-4000-8000-000000000003','5a100000-0000-4000-8000-0000000000a1',true),
  ('5a000000-0000-4000-8000-0000000000a1','5a900000-0000-4000-8000-000000000004','5a100000-0000-4000-8000-0000000000a1',true)
ON CONFLICT DO NOTHING;

INSERT INTO public.product_categories (id, tenant_id, name, sort_order) VALUES
  ('5a200000-0000-4000-8000-0000000000a1','5a000000-0000-4000-8000-0000000000a1','SW Cat A',1);
INSERT INTO public.products (id, tenant_id, category_id, name) VALUES
  ('5a300000-0000-4000-8000-0000000000a1','5a000000-0000-4000-8000-0000000000a1','5a200000-0000-4000-8000-0000000000a1','SW Prod A');
INSERT INTO public.product_variants (id, tenant_id, product_id, name, sku, unit_price) VALUES
  ('5a400000-0000-4000-8000-0000000000a1','5a000000-0000-4000-8000-0000000000a1','5a300000-0000-4000-8000-0000000000a1','SW Var A','SW-SKU-A',100.0000);

-- Opening stock for the lifecycle ticket's complete_ticket() call (SW13/SW14).
INSERT INTO public.stock_movements (tenant_id, branch_id, warehouse_id, item_type, product_variant_id, quantity_delta, reason, created_by)
VALUES ('5a000000-0000-4000-8000-0000000000a1','5a100000-0000-4000-8000-0000000000a1','5a150000-0000-4000-8000-0000000000a1','product','5a400000-0000-4000-8000-0000000000a1',50.0000,'opening_balance',NULL);

-- A cross-tenant fixture ticket for SW21.
INSERT INTO public.tickets (id, tenant_id, branch_id, fulfilment_type, status) VALUES
  ('5a600000-0000-4000-8000-0000000000b1','5a000000-0000-4000-8000-0000000000b1','5a100000-0000-4000-8000-0000000000b1','pickup','draft');

CREATE TEMP TABLE _results(test text, passed boolean, detail text);
GRANT ALL ON _results TO authenticated;

SET LOCAL ROLE authenticated;

-- ---- owner: structural check, needs no claim switch ----
SELECT set_config('request.jwt.claims',
  json_build_object('sub','5a900000-0000-4000-8000-000000000001',
                    'tenant_id','5a000000-0000-4000-8000-0000000000a1',
                    'roles', json_build_array('owner'))::text, true);

-- SW1 — authenticated has no UPDATE grant on tickets at all; every lifecycle hop must
-- go through one of these RPCs.
INSERT INTO _results
SELECT 'SW1 authenticated has no UPDATE grant on tickets',
       count(*) = 0,
       'UPDATE grants found = ' || count(*)
FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='tickets' AND grantee='authenticated' AND privilege_type='UPDATE';

-- ================================================== main lifecycle walk =====
DO $lifecycle$
DECLARE
  v_ticket  uuid := '5a600000-0000-4000-8000-0000000000a1';
  v_result  jsonb;
  v_raised  text;
  v_status  text;
  v_invoice_status text;
  v_subtotal numeric(19,4);
  v_onhand  numeric(18,4);
BEGIN
  INSERT INTO public.tickets (id, tenant_id, branch_id, fulfilment_type, status, created_by)
  VALUES (v_ticket, '5a000000-0000-4000-8000-0000000000a1', '5a100000-0000-4000-8000-0000000000a1', 'pickup', 'draft', '5a900000-0000-4000-8000-000000000001');
  INSERT INTO public.ticket_items (tenant_id, ticket_id, product_variant_id, quantity, unit_price)
  VALUES ('5a000000-0000-4000-8000-0000000000a1', v_ticket, '5a400000-0000-4000-8000-0000000000a1', 3.0000, 100.0000);

  -- SW3 — confirm_ticket() on a 'draft' ticket (not yet submitted) is illegal, even
  -- with items: confirm_ticket() does not check current status itself, it relies
  -- entirely on guard_ticket_status_transition()'s allowed-transitions table, and
  -- 'draft' does not permit a direct hop to 'confirmed'.
  v_raised := 'no exception';
  BEGIN
    v_result := public.confirm_ticket(v_ticket);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('SW3 confirm_ticket() refuses a draft ticket (must be submitted first)',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));

  -- SW2 — a fresh, itemless ticket cannot be confirmed even once submitted.
  DECLARE
    v_empty uuid := gen_random_uuid();
  BEGIN
    INSERT INTO public.tickets (id, tenant_id, branch_id, fulfilment_type, status, created_by)
    VALUES (v_empty, '5a000000-0000-4000-8000-0000000000a1', '5a100000-0000-4000-8000-0000000000a1', 'pickup', 'submitted', '5a900000-0000-4000-8000-000000000001');
    v_raised := 'no exception';
    BEGIN
      v_result := public.confirm_ticket(v_empty);
    EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
    END;
    INSERT INTO _results VALUES ('SW2 confirm_ticket() refuses a ticket with zero items',
      v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));
  END;

  -- ---- cashier: draft -> submitted ----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','5a900000-0000-4000-8000-000000000002',
                      'tenant_id','5a000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('cashier'))::text, true);
  v_raised := 'no exception';
  BEGIN
    v_result := public.update_ticket(p_order_id := v_ticket, p_status := 'submitted');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  SELECT status INTO v_status FROM public.tickets WHERE id = v_ticket;
  INSERT INTO _results VALUES ('SW4 cashier can advance draft -> submitted via update_ticket',
    v_raised = 'no exception' AND v_status = 'submitted',
    'raised: ' || left(v_raised,100) || ' | status=' || coalesce(v_status,'<null>'));

  -- SW6 — cashier may not set manager-only fields (discount_amount here), even
  -- alongside a legal status change.
  v_raised := 'no exception';
  BEGIN
    v_result := public.update_ticket(p_order_id := v_ticket, p_discount_amount := 10.0000);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('SW6 cashier cannot set discount_amount via update_ticket',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));

  -- ---- owner: confirm, then set discount_amount (manager-only, succeeds) ----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','5a900000-0000-4000-8000-000000000001',
                      'tenant_id','5a000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('owner'))::text, true);

  v_result := public.confirm_ticket(v_ticket);
  v_subtotal := (v_result->'ticket'->>'subtotal_amount')::numeric;
  v_invoice_status := v_result->'invoice'->>'status';
  INSERT INTO _results VALUES ('SW5 confirm_ticket() recomputes subtotal from items and issues an invoice',
    v_subtotal = 300.0000 AND v_invoice_status = 'issued',
    'subtotal=' || v_subtotal || ' invoice_status=' || coalesce(v_invoice_status,'<null>'));

  v_raised := 'no exception';
  BEGIN
    v_result := public.update_ticket(p_order_id := v_ticket, p_discount_amount := 10.0000);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('SW7 owner can set discount_amount via update_ticket',
    v_raised = 'no exception', 'raised: ' || left(v_raised, 150));

  -- SW8 — owner: confirmed -> scheduled.
  v_raised := 'no exception';
  BEGIN
    v_result := public.update_ticket(p_order_id := v_ticket, p_status := 'scheduled');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  SELECT status INTO v_status FROM public.tickets WHERE id = v_ticket;
  INSERT INTO _results VALUES ('SW8 owner can advance confirmed -> scheduled',
    v_raised = 'no exception' AND v_status = 'scheduled', 'status=' || coalesce(v_status,'<null>'));

  -- ---- baker: scheduled -> in_production ----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','5a900000-0000-4000-8000-000000000003',
                      'tenant_id','5a000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('baker'))::text, true);
  v_raised := 'no exception';
  BEGIN
    v_result := public.update_ticket(p_order_id := v_ticket, p_status := 'in_production');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  SELECT status INTO v_status FROM public.tickets WHERE id = v_ticket;
  INSERT INTO _results VALUES ('SW9 baker can advance scheduled -> in_production',
    v_raised = 'no exception' AND v_status = 'in_production', 'status=' || coalesce(v_status,'<null>'));

  -- SW10 — a baker may change status only, never customer/fulfilment/schedule fields,
  -- even in the same call.
  v_raised := 'no exception';
  BEGIN
    v_result := public.update_ticket(p_order_id := v_ticket, p_status := 'ready', p_due_at := now());
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('SW10 baker cannot set due_at alongside a status change',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));

  v_raised := 'no exception';
  BEGIN
    v_result := public.update_ticket(p_order_id := v_ticket, p_status := 'ready');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  SELECT status INTO v_status FROM public.tickets WHERE id = v_ticket;
  INSERT INTO _results VALUES ('SW11 baker can advance in_production -> ready (status only)',
    v_raised = 'no exception' AND v_status = 'ready', 'status=' || coalesce(v_status,'<null>'));

  -- ---- cashier: ready -> delivered ----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','5a900000-0000-4000-8000-000000000002',
                      'tenant_id','5a000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('cashier'))::text, true);
  v_raised := 'no exception';
  BEGIN
    v_result := public.update_ticket(p_order_id := v_ticket, p_status := 'delivered');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  SELECT status INTO v_status FROM public.tickets WHERE id = v_ticket;
  INSERT INTO _results VALUES ('SW12 cashier can advance ready -> delivered',
    v_raised = 'no exception' AND v_status = 'delivered', 'status=' || coalesce(v_status,'<null>'));

  -- ---- owner: complete_ticket() writes the sale movement ----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','5a900000-0000-4000-8000-000000000001',
                      'tenant_id','5a000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('owner'))::text, true);

  v_result := public.complete_ticket(v_ticket, '5a150000-0000-4000-8000-0000000000a1');
  SELECT quantity_on_hand INTO v_onhand FROM public.product_stock_levels
    WHERE product_variant_id = '5a400000-0000-4000-8000-0000000000a1' AND warehouse_id = '5a150000-0000-4000-8000-0000000000a1';
  INSERT INTO _results VALUES ('SW13 complete_ticket() writes a correctly-sized sale stock movement',
    v_onhand = 47.0000, 'on_hand after selling 3 of 50 = ' || v_onhand);

  -- SW14 — the idempotency regression guard: a second complete_ticket() call on the
  -- now-completed ticket must be refused, not silently re-sell the stock.
  v_raised := 'no exception';
  BEGIN
    v_result := public.complete_ticket(v_ticket, '5a150000-0000-4000-8000-0000000000a1');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  SELECT quantity_on_hand INTO v_onhand FROM public.product_stock_levels
    WHERE product_variant_id = '5a400000-0000-4000-8000-0000000000a1' AND warehouse_id = '5a150000-0000-4000-8000-0000000000a1';
  INSERT INTO _results VALUES ('SW14 complete_ticket() refuses a second call, stock not re-sold',
    v_raised <> 'no exception' AND v_onhand = 47.0000,
    'raised: ' || left(v_raised,100) || ' | on_hand=' || v_onhand);
END
$lifecycle$;

-- ================================================== cancel / refund guard ===
DO $cancel$
DECLARE
  v_ticket  uuid := gen_random_uuid();
  v_result  jsonb;
  v_raised  text;
  v_invoice_status text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','5a900000-0000-4000-8000-000000000001',
                      'tenant_id','5a000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('owner'))::text, true);

  INSERT INTO public.tickets (id, tenant_id, branch_id, fulfilment_type, status, created_by)
  VALUES (v_ticket, '5a000000-0000-4000-8000-0000000000a1', '5a100000-0000-4000-8000-0000000000a1', 'pickup', 'submitted', '5a900000-0000-4000-8000-000000000001');
  INSERT INTO public.ticket_items (tenant_id, ticket_id, product_variant_id, quantity, unit_price)
  VALUES ('5a000000-0000-4000-8000-0000000000a1', v_ticket, '5a400000-0000-4000-8000-0000000000a1', 1.0000, 100.0000);

  v_result := public.confirm_ticket(v_ticket);

  -- SW15 — cancel_ticket() requires a non-empty reason.
  v_raised := 'no exception';
  BEGIN
    v_result := public.cancel_ticket(v_ticket, '   ');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('SW15 cancel_ticket() refuses a blank reason',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));

  -- SW16 — a legitimate cancel voids the (unpaid) invoice.
  v_raised := 'no exception';
  BEGIN
    v_result := public.cancel_ticket(v_ticket, 'customer changed their mind');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  SELECT status INTO v_invoice_status FROM public.invoices WHERE ticket_id = v_ticket;
  INSERT INTO _results VALUES ('SW16 cancel_ticket() voids the unpaid invoice',
    v_raised = 'no exception' AND v_invoice_status = 'void',
    'raised: ' || left(v_raised,100) || ' | invoice_status=' || coalesce(v_invoice_status,'<null>'));

  -- SW17 — a ticket with an unrefunded payment cannot be cancelled at all
  -- (guard_ticket_status_transition()'s refund_required check).
  DECLARE
    v_paid_ticket uuid := gen_random_uuid();
  BEGIN
    INSERT INTO public.tickets (id, tenant_id, branch_id, fulfilment_type, status, created_by)
    VALUES (v_paid_ticket, '5a000000-0000-4000-8000-0000000000a1', '5a100000-0000-4000-8000-0000000000a1', 'pickup', 'submitted', '5a900000-0000-4000-8000-000000000001');
    INSERT INTO public.ticket_items (tenant_id, ticket_id, product_variant_id, quantity, unit_price)
    VALUES ('5a000000-0000-4000-8000-0000000000a1', v_paid_ticket, '5a400000-0000-4000-8000-0000000000a1', 1.0000, 100.0000);
    v_result := public.confirm_ticket(v_paid_ticket);
    v_result := public.record_payment(v_paid_ticket, 100.0000, 'transfer', 'sw-full-pay', NULL);

    v_raised := 'no exception';
    BEGIN
      v_result := public.cancel_ticket(v_paid_ticket, 'trying to cancel a paid order');
    EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
    END;
    INSERT INTO _results VALUES ('SW17 cancel_ticket() refuses a ticket with an unrefunded payment',
      v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));
  END;
END
$cancel$;

-- ================================================== assignment / branch gate ===
DO $assign$
DECLARE
  v_ticket uuid := gen_random_uuid();
  v_result jsonb;
  v_raised text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','5a900000-0000-4000-8000-000000000001',
                      'tenant_id','5a000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('owner'))::text, true);

  INSERT INTO public.tickets (id, tenant_id, branch_id, fulfilment_type, status, created_by)
  VALUES (v_ticket, '5a000000-0000-4000-8000-0000000000a1', '5a100000-0000-4000-8000-0000000000a1', 'delivery', 'draft', '5a900000-0000-4000-8000-000000000001');

  -- SW18 — assigning a non-driver profile is refused.
  v_raised := 'no exception';
  BEGIN
    v_result := public.update_ticket(p_order_id := v_ticket, p_assigned_to := '5a900000-0000-4000-8000-000000000002');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('SW18 update_ticket refuses assigning a non-driver profile',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));

  -- SW19 — assigning a real driver in the same branch succeeds.
  v_raised := 'no exception';
  BEGIN
    v_result := public.update_ticket(p_order_id := v_ticket, p_assigned_to := '5a900000-0000-4000-8000-000000000006');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('SW19 update_ticket accepts assigning a real driver',
    v_raised = 'no exception', 'raised: ' || left(v_raised, 150));

  -- SW20 — a branch_manager with no branch_assignments row cannot touch this branch's
  -- ticket at all, even to just read it into the RPC (has_branch_access() denies).
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','5a900000-0000-4000-8000-000000000005',
                      'tenant_id','5a000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('branch_manager'))::text, true);
  v_raised := 'no exception';
  BEGIN
    v_result := public.update_ticket(p_order_id := v_ticket, p_due_at := now());
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('SW20 branch_manager with no branch_assignments row is refused (has_branch_access)',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));
END
$assign$;

-- ================================================== cross-tenant denial =====
DO $tenant$
DECLARE v_result jsonb; v_raised text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','5a900000-0000-4000-8000-000000000001',
                      'tenant_id','5a000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('owner'))::text, true);

  v_raised := 'no exception';
  BEGIN
    v_result := public.update_ticket(p_order_id := '5a600000-0000-4000-8000-0000000000b1', p_due_at := now());
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('SW21 an org A owner cannot reach an org B ticket via update_ticket',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));
END
$tenant$;

-- ================================================== direct ticket_items write path (RLS) ===
DO $direct_items$
DECLARE
  v_ticket  uuid := gen_random_uuid();
  v_item_id uuid;
  v_raised  text;
BEGIN
  -- fresh draft ticket in branch A1
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','5a900000-0000-4000-8000-000000000001',
                      'tenant_id','5a000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('owner'))::text, true);
  INSERT INTO public.tickets (id, tenant_id, branch_id, fulfilment_type, status, created_by)
  VALUES (v_ticket, '5a000000-0000-4000-8000-0000000000a1', '5a100000-0000-4000-8000-0000000000a1', 'pickup', 'draft', '5a900000-0000-4000-8000-000000000001');

  -- ---- cashier (has a branch_assignments row for branch A1) ----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','5a900000-0000-4000-8000-000000000002',
                      'tenant_id','5a000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('cashier'))::text, true);

  -- SW22 — a direct INSERT into ticket_items, as authenticated, for an in-branch ticket
  -- succeeds under ticket_items_insert's real live policy.
  v_raised := 'no exception';
  BEGIN
    INSERT INTO public.ticket_items (id, tenant_id, ticket_id, product_variant_id, quantity, unit_price)
    VALUES (gen_random_uuid(), '5a000000-0000-4000-8000-0000000000a1', v_ticket, '5a400000-0000-4000-8000-0000000000a1', 2.0000, 100.0000)
    RETURNING id INTO v_item_id;
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('SW22 cashier can directly INSERT a ticket_item into an in-branch ticket',
    v_raised = 'no exception' AND v_item_id IS NOT NULL, 'raised: ' || left(v_raised, 150));

  -- SW23 — a direct UPDATE (quantity) on that row, as the same cashier, succeeds.
  v_raised := 'no exception';
  BEGIN
    UPDATE public.ticket_items SET quantity = 3.0000 WHERE id = v_item_id;
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('SW23 cashier can directly UPDATE quantity on their branch''s ticket_item',
    v_raised = 'no exception', 'raised: ' || left(v_raised, 150));

  -- SW24 — line_total is GENERATED ALWAYS (confirmed live) — a direct write attempting
  -- to set it is refused by Postgres itself, before RLS is even consulted.
  v_raised := 'no exception';
  BEGIN
    UPDATE public.ticket_items SET line_total = 999.0000 WHERE id = v_item_id;
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('SW24 a direct write to the generated column line_total is refused',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));

  -- ---- branch_manager with no branch_assignments row (SW20's fixture actor) ----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','5a900000-0000-4000-8000-000000000005',
                      'tenant_id','5a000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('branch_manager'))::text, true);

  -- SW25 — has_branch_access() denies a direct INSERT into the same branch's ticket for
  -- an actor with no branch_assignments row (an RLS WITH CHECK failure, not a grant issue).
  v_raised := 'no exception';
  BEGIN
    INSERT INTO public.ticket_items (id, tenant_id, ticket_id, product_variant_id, quantity, unit_price)
    VALUES (gen_random_uuid(), '5a000000-0000-4000-8000-0000000000a1', v_ticket, '5a400000-0000-4000-8000-0000000000a1', 1.0000, 100.0000);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('SW25 a branch_manager with no branch_assignments row is refused (has_branch_access)',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));

  -- ---- owner (org A) attempting to reach org B's fixture ticket ----
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub','5a900000-0000-4000-8000-000000000001',
                      'tenant_id','5a000000-0000-4000-8000-0000000000a1',
                      'roles', json_build_array('owner'))::text, true);

  -- SW26 — a direct INSERT referencing org B's ticket (the SW21 cross-tenant fixture) is
  -- refused: WITH CHECK requires tenant_id=current_tenant_id() (org A) AND a matching
  -- ticket row whose own tenant_id equals that same value — org B's ticket never
  -- satisfies that join under an org A session, regardless of role.
  v_raised := 'no exception';
  BEGIN
    INSERT INTO public.ticket_items (id, tenant_id, ticket_id, product_variant_id, quantity, unit_price)
    VALUES (gen_random_uuid(), '5a000000-0000-4000-8000-0000000000a1', '5a600000-0000-4000-8000-0000000000b1', '5a400000-0000-4000-8000-0000000000a1', 1.0000, 100.0000);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('SW26 an org A actor cannot directly INSERT a ticket_item against an org B ticket',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));
END
$direct_items$;

RESET ROLE;

-- ------------------------------------------------------------------ verdict --
SELECT test, passed, left(detail, 130) AS detail FROM _results ORDER BY test;

DO $verdict$
DECLARE v_failed text;
BEGIN
  SELECT string_agg(test, ' | ') INTO v_failed
    FROM _results WHERE passed IS DISTINCT FROM true;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'BakeFlow sales write suite FAILED: %', v_failed;
  END IF;
  RAISE NOTICE 'BakeFlow sales write suite passed: % assertions',
    (SELECT count(*) FROM _results);
END
$verdict$;

ROLLBACK;
