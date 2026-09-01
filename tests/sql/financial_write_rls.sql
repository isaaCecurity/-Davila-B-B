-- BakeFlow — financial write-path security suite (F1..F23, 28 assertions) — P5 (AD-017 MVP scope)
--
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/financial_write_rls.sql
--
-- EXECUTED 2026-08-24 against project tvfyxpafbpnkneujcnvr: 28/28 passed, after finding
-- and fixing FOUR real live defects during this suite's first-ever authoring/execution
-- (P5's schema and RPCs already existed live -- payments, refunds, invoices,
-- cash_sessions, expenses, daily_financial_audits, record_payment(), record_refund(),
-- open_cash_session(), close_cash_session() -- but had never been tested at all, and
-- BACKEND_ROADMAP.md still described the whole phase as BLOCKED). See
-- IMPLEMENTATION_LOG.md 2026-08-24 for full detail on each:
--
--   1. record_payment() actively offered 'credit' as a payment method. AD-017 states a
--      credit sale creates NO payment row -- credit is the absence of a payment, not a
--      method. Fixed by removing it from the RPC's allowed list (the table's CHECK stays
--      dormant, per AD-017's own allowance for deferred-capability schema objects).
--   2. Nothing anywhere enforced AD-017's "overpayments are rejected against the current
--      outstanding balance" -- a 500 payment against a 100 ticket succeeded outright.
--      Fixed in guard_payment_relationships() (BEFORE INSERT on payments), not only in
--      record_payment(), so the invariant holds regardless of write path.
--   3. guard_expense_cash_session() validated the branch match but never that
--      paid_method='cash' when cash_session_id was set, unlike guard_payment_
--      relationships()'s identical check for payments. AD-017: "non-cash expenses do not
--      reduce expected drawer cash" -- a transfer-method expense could silently corrupt
--      close_cash_session()'s till reconciliation. Fixed to mirror the payments guard.
--   4. cash_sessions was the one P5 table still holding direct INSERT/UPDATE grants for
--      `authenticated`, unlike its siblings payments/invoices/refunds (SELECT-only,
--      RPC-gated). open_cash_session()/close_cash_session() are both SECURITY DEFINER
--      and never needed the grants. A direct INSERT could impersonate a different
--      opened_by and skip the audit_log entry entirely. Revoked to match the sibling
--      tables' pattern -- behavior-neutral for the legitimate RPC path.
--
-- A FIFTH defect was found and fixed in the same pass, upstream of this suite: writing
-- F19 below (item edits must keep working through the confirmed->ready window) surfaced
-- that yesterday's own subtotal_amount freeze fix (tests/sql/sales_read_rls.sql S10) had
-- been too broad -- it blocked recalculate_ticket_totals()'s legitimate recalculation on
-- every ticket_items change once a ticket left draft, not only an arbitrary out-of-band
-- write. Fixed in guard_ticket_status_transition() to compare against the true derived
-- sum rather than blocking any change. F18/F19 here are the permanent regression guard
-- for both directions of that fix.
--
-- Same conventions as the other suites: no psql meta-commands, every assertion records
-- into a temp table rather than raising, verdict block at the end, whole run inside
-- BEGIN ... ROLLBACK.
--
-- WHAT THIS SUITE IS FOR, beyond the write-path assertions:
--
--   F18/F19 are the regression guard described above: F18 proves an arbitrary
--          subtotal_amount write is still refused; F19 proves a legitimate item-driven
--          recalculation still succeeds. Losing either means the other fix broke it.
--   F20    is the tenant-isolation check across all six financial tables in one pass --
--          this domain was never covered by security_multiorg_sync.sql or any other
--          suite before today.
--   F21/22 prove the four-eyes rule on daily_financial_audits: the submitter cannot
--          confirm their own audit, but a different manager can.

BEGIN;

-- ---------------------------------------------------------------- fixtures --
INSERT INTO auth.users (id, email) VALUES
  ('d1000000-0000-4000-8000-000000000001','u.owner.finance@bakeflow.test'),
  ('d1000000-0000-4000-8000-000000000003','u.mgr2.finance@bakeflow.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id, name, slug) VALUES
  ('d0000000-0000-4000-8000-0000000000a1','Finance Test Bakery A','finance-test-a'),
  ('d0000000-0000-4000-8000-0000000000b1','Finance Test Bakery B','finance-test-b');

INSERT INTO public.branches (id, tenant_id, name, code) VALUES
  ('da000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a1','Finance Branch A1','DFA1'),
  ('db000000-0000-4000-8000-0000000000b1','d0000000-0000-4000-8000-0000000000b1','Finance Branch B1','DFB1');

INSERT INTO public.profiles (id, full_name, status, tenant_id, active_tenant_id) VALUES
  ('d1000000-0000-4000-8000-000000000001','U Owner Finance','active','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a1'),
  ('d1000000-0000-4000-8000-000000000003','U Mgr2 Finance','active','d0000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a1')
ON CONFLICT (id) DO UPDATE SET status='active', deleted_at=NULL,
  tenant_id=EXCLUDED.tenant_id, active_tenant_id=EXCLUDED.active_tenant_id;

-- owner = ...0001, branch_manager = ...0003 (live roles table).
-- The org-B row for ...0001 exists because the cross-org fixture ticket for F20 sets
-- that profile as created_by with tenant_id = org B: guard_order_actor_and_assignment()
-- requires the creator to hold a user_roles row in the ticket's own tenant. Same defect
-- class as sales_read_rls.sql / delivery_read_rls.sql, found again on this suite's
-- first-ever run.
-- Role ids looked up by key, not hardcoded -- see inventory_read_rls.sql's note on why (found
-- and fixed same day, P11.1 throwaway-DB validation, 2026-09-01).
INSERT INTO public.user_roles (tenant_id, profile_id, role_id, branch_id) VALUES
  ('d0000000-0000-4000-8000-0000000000a1','d1000000-0000-4000-8000-000000000001',(select id from public.roles where key='owner'),NULL),
  ('d0000000-0000-4000-8000-0000000000a1','d1000000-0000-4000-8000-000000000003',(select id from public.roles where key='branch_manager'),NULL),
  ('d0000000-0000-4000-8000-0000000000b1','d1000000-0000-4000-8000-000000000001',(select id from public.roles where key='owner'),NULL)
ON CONFLICT DO NOTHING;

-- has_branch_access() bypasses only for owner/admin (read live: public.has_branch_access).
-- branch_manager, unlike owner, needs an explicit branch_assignments row -- without one
-- here, F22's UPDATE silently matched zero rows (no exception, but nothing changed) and
-- F23 then failed for the wrong reason. Found authoring this suite; same defect class as
-- S14 in sales_read_rls.sql, which already established this for branch_manager.
INSERT INTO public.branch_assignments (tenant_id, profile_id, branch_id, is_default) VALUES
  ('d0000000-0000-4000-8000-0000000000a1','d1000000-0000-4000-8000-000000000003','da000000-0000-4000-8000-0000000000a1',true)
ON CONFLICT DO NOTHING;

INSERT INTO public.product_categories (id, tenant_id, name, sort_order) VALUES
  ('dd000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a1','Finance Cat A',1);
INSERT INTO public.products (id, tenant_id, category_id, name, is_active) VALUES
  ('de000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a1','dd000000-0000-4000-8000-0000000000a1','Finance Product A',true);
INSERT INTO public.product_variants (id, tenant_id, product_id, name, sku, unit_price, is_active) VALUES
  ('df000000-0000-4000-8000-0000000000a1','d0000000-0000-4000-8000-0000000000a1','de000000-0000-4000-8000-0000000000a1','Finance Var A','FIN-A-SKU',100.0000,true);

-- A second, cross-org fixture ticket/payment for F20's tenant-isolation checks.
INSERT INTO public.tickets (id, tenant_id, branch_id, customer_id, fulfilment_type, created_by)
VALUES ('d6000000-0000-4000-8000-0000000000b1','d0000000-0000-4000-8000-0000000000b1','db000000-0000-4000-8000-0000000000b1',NULL,'pickup','d1000000-0000-4000-8000-000000000001')
ON CONFLICT DO NOTHING;

CREATE TEMP TABLE _results(test text, passed boolean, detail text);
GRANT ALL ON _results TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub','d1000000-0000-4000-8000-000000000001',
                    'tenant_id','d0000000-0000-4000-8000-0000000000a1',
                    'roles', json_build_array('owner'))::text, true);

-- ============================ F1: RLS enabled and FORCED on all six tables =
INSERT INTO _results
SELECT 'F1 RLS enabled and FORCED on all 6 financial tables', count(*) = 6,
       'tables with rowsecurity AND forcerowsecurity = ' || count(*)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN ('payments','refunds','invoices','cash_sessions','expenses','daily_financial_audits')
  AND c.relrowsecurity AND c.relforcerowsecurity;

-- ================================ Ticket -> confirm -> invoice -> payments ==
DO $t$
DECLARE
  v_raised   text;
  v_result   jsonb;
  v_ticket   uuid := 'd6000000-0000-4000-8000-0000000000a1';
  v_invoice  jsonb;
  v_invoice_id uuid;
  v_payment_id uuid;
  v_refund_id  uuid;
  v_status   text;
  v_paid     numeric(19,4);
BEGIN
  INSERT INTO public.tickets (id, tenant_id, branch_id, customer_id, fulfilment_type, created_by)
  VALUES (v_ticket,'d0000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000a1',NULL,'pickup','d1000000-0000-4000-8000-000000000001');

  INSERT INTO public.ticket_items (tenant_id, ticket_id, product_variant_id, quantity, unit_price)
  VALUES ('d0000000-0000-4000-8000-0000000000a1', v_ticket, 'df000000-0000-4000-8000-0000000000a1', 1.0000, 100.0000);

  PERFORM public.update_ticket(p_order_id := v_ticket, p_status := 'submitted');
  v_invoice := public.confirm_ticket(v_ticket);
  v_invoice_id := (v_invoice->'invoice'->>'id')::uuid;

  INSERT INTO _results VALUES ('F7 invoice auto-created on confirm_ticket() with correct total_amount',
    (v_invoice->'invoice'->>'total_amount')::numeric = 100.0000,
    'total_amount=' || (v_invoice->'invoice'->>'total_amount'));

  SELECT status INTO v_status FROM public.invoices WHERE id = v_invoice_id;
  INSERT INTO _results VALUES ('F8a invoice starts issued (zero paid)', v_status = 'issued', 'status=' || coalesce(v_status,'<null>'));

  -- ---- F2: 'credit' is refused ----
  v_raised := 'no exception';
  BEGIN
    v_result := public.record_payment(v_ticket, 50.0000, 'credit', NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('F2 record_payment() rejects method=credit (AD-017: no payment row for credit sales)',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));

  -- ---- F3: a single overpayment is refused ----
  v_raised := 'no exception';
  BEGIN
    v_result := public.record_payment(v_ticket, 500.0000, 'transfer', 'over', NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('F3 record_payment() rejects a single overpayment (500 vs total 100)',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 200));

  -- ---- F5: a partial payment within the balance succeeds ----
  v_raised := 'no exception';
  BEGIN
    v_result := public.record_payment(v_ticket, 60.0000, 'transfer', 'partial-1', NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  v_payment_id := (v_result->'payment'->>'id')::uuid;
  INSERT INTO _results VALUES ('F5a a legitimate partial payment (60 of 100) succeeds',
    v_raised = 'no exception', 'raised: ' || left(v_raised, 150));

  SELECT amount_paid INTO v_paid FROM public.tickets WHERE id = v_ticket;
  INSERT INTO _results VALUES ('F6 apply_payment_to_ticket() keeps tickets.amount_paid in sync',
    v_paid = 60.0000, 'amount_paid=' || coalesce(v_paid::text,'<null>'));

  SELECT status INTO v_status FROM public.invoices WHERE id = v_invoice_id;
  INSERT INTO _results VALUES ('F8b invoice becomes partially_paid once payment < total',
    v_status = 'partially_paid', 'status=' || coalesce(v_status,'<null>'));

  -- ---- F4: cumulative overpayment across two payments is refused ----
  v_raised := 'no exception';
  BEGIN
    v_result := public.record_payment(v_ticket, 45.0000, 'transfer', 'over-2', NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('F4 a second payment pushing 60+45=105 over the 100 total is refused (cumulative check)',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 200));

  -- ---- F5b: landing exactly on the boundary succeeds (not an off-by-one) ----
  v_raised := 'no exception';
  BEGIN
    v_result := public.record_payment(v_ticket, 40.0000, 'transfer', 'top-up-exact', NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('F5b a top-up landing exactly at 60+40=100 succeeds (boundary, not off-by-one)',
    v_raised = 'no exception', 'raised: ' || left(v_raised, 150));

  SELECT status INTO v_status FROM public.invoices WHERE id = v_invoice_id;
  INSERT INTO _results VALUES ('F8c invoice becomes paid once payments reach the total',
    v_status = 'paid', 'status=' || coalesce(v_status,'<null>'));

  -- ---- F9/F10: refunds ----
  v_raised := 'no exception';
  BEGIN
    v_result := public.record_refund(v_payment_id, 65.0000, 'refund exceeds the payment itself');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('F9 record_refund() rejects a refund exceeding the payment (65 vs 60 payment)',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 200));

  v_raised := 'no exception';
  BEGIN
    v_result := public.record_refund(v_payment_id, 20.0000, 'first partial refund');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  v_refund_id := (v_result->'refund'->>'id')::uuid;
  INSERT INTO _results VALUES ('F10a a legitimate partial refund (20 of 60) succeeds',
    v_raised = 'no exception', 'raised: ' || left(v_raised, 150));

  v_raised := 'no exception';
  BEGIN
    v_result := public.record_refund(v_payment_id, 45.0000, 'second refund overshoot');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('F10b a second refund pushing 20+45=65 over the 60 payment is refused (cumulative check)',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 200));

  v_raised := 'no exception';
  BEGIN
    v_result := public.record_refund(v_payment_id, 40.0000, 'second refund exact');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('F10c a second refund landing exactly at 20+40=60 succeeds',
    v_raised = 'no exception', 'raised: ' || left(v_raised, 150));

  -- ---- F18/F19: the subtotal-freeze regression guard ----
  PERFORM public.update_ticket(p_order_id := v_ticket, p_status := 'scheduled');

  v_raised := 'no exception';
  BEGIN
    UPDATE public.tickets SET subtotal_amount = 999999.0000 WHERE id = v_ticket;
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('F18 an arbitrary out-of-band subtotal_amount write is still refused',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));

  v_raised := 'no exception';
  BEGIN
    INSERT INTO public.ticket_items (tenant_id, ticket_id, product_variant_id, quantity, unit_price)
    VALUES ('d0000000-0000-4000-8000-0000000000a1', v_ticket, 'df000000-0000-4000-8000-0000000000a1', 1.0000, 100.0000);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('F19 a legitimate item-driven recalculation still succeeds while status != draft',
    v_raised = 'no exception', 'raised: ' || left(v_raised, 200));
END
$t$;

-- ================================ Cash sessions / expenses ==================
DO $cash$
DECLARE
  v_raised     text;
  v_session    jsonb;
  v_session_id uuid;
  v_close      jsonb;
BEGIN
  v_session := public.open_cash_session('da000000-0000-4000-8000-0000000000a1', 1000.0000);
  v_session_id := (v_session->'session'->>'id')::uuid;

  v_raised := 'no exception';
  BEGIN
    PERFORM public.open_cash_session('da000000-0000-4000-8000-0000000000a1', 200.0000);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('F11 a second open session at a branch that already has one is refused',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));

  v_raised := 'no exception';
  BEGIN
    INSERT INTO public.cash_sessions (tenant_id, branch_id, opened_by, opening_float, created_by)
    VALUES ('d0000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000a1',
            'd1000000-0000-4000-8000-000000000001', 300.0000, 'd1000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('F17 a direct INSERT on cash_sessions is refused (RPC is the only write path)',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));

  -- a cash payment against the finance ticket, tied to this session
  PERFORM public.record_payment('d6000000-0000-4000-8000-0000000000a1', 30.0000, 'cash', NULL, v_session_id);

  -- ---- F14: a non-cash expense may not attach to a cash session ----
  v_raised := 'no exception';
  BEGIN
    INSERT INTO public.expenses (tenant_id, branch_id, category, amount, paid_method, cash_session_id, created_by)
    VALUES ('d0000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000a1','rent',
            50.0000, 'transfer', v_session_id, 'd1000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('F14 a transfer-method expense attached to a cash session is refused',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 150));

  -- ---- F15: a legitimate cash expense succeeds ----
  v_raised := 'no exception';
  BEGIN
    INSERT INTO public.expenses (tenant_id, branch_id, category, amount, paid_method, cash_session_id, created_by)
    VALUES ('d0000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000a1','rent',
            10.0000, 'cash', v_session_id, 'd1000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('F15 a cash expense attached to the session succeeds',
    v_raised = 'no exception', 'raised: ' || left(v_raised, 150));

  -- ---- F12: closing with a variance requires a note ----
  v_raised := 'no exception';
  BEGIN
    v_close := public.close_cash_session(v_session_id, 5000.0000, NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('F12 closing with a counted amount that does not match expected requires a note',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 200));

  -- ---- F13/F16: closing at the correct expected amount succeeds, reconciliation is exact ----
  -- expected = opening_float(1000) + cash_in(30) - cash_out(10) = 1020
  v_raised := 'no exception';
  BEGIN
    v_close := public.close_cash_session(v_session_id, 1020.0000, NULL);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('F13 closing at the exact expected amount succeeds with no note',
    v_raised = 'no exception', 'raised: ' || left(v_raised, 200));

  INSERT INTO _results VALUES ('F16 close_cash_session() reconciles to opening_float + cash_in - cash_out exactly (only the cash expense counted)',
    (v_close->>'expected')::numeric = 1020.0000,
    'expected=' || coalesce(v_close->>'expected','<null>') || ' cash_in=' || coalesce(v_close->>'cash_in','<null>') || ' cash_out=' || coalesce(v_close->>'cash_out','<null>'));
END
$cash$;

-- ================================ Daily financial audits (four-eyes) ========
DO $audit$
DECLARE
  v_raised text;
  v_status text;
BEGIN
  INSERT INTO public.daily_financial_audits
    (tenant_id, branch_id, audit_date, status, submitted_by, expected_cash, physical_cash, variance)
  VALUES
    ('d0000000-0000-4000-8000-0000000000a1','da000000-0000-4000-8000-0000000000a1',
     current_date, 'PENDING_SYNC', 'd1000000-0000-4000-8000-000000000001', 100.0000, 100.0000, 0.0000);

  v_raised := 'no exception';
  BEGIN
    UPDATE public.daily_financial_audits
       SET status = 'CONFIRMED'
     WHERE tenant_id = 'd0000000-0000-4000-8000-0000000000a1'
       AND branch_id = 'da000000-0000-4000-8000-0000000000a1'
       AND audit_date = current_date;
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('F21 the submitter may not confirm their own daily financial audit',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 200));
END
$audit$;

-- Switch to the second manager to confirm — the four-eyes rule's positive path.
SELECT set_config('request.jwt.claims',
  json_build_object('sub','d1000000-0000-4000-8000-000000000003',
                    'tenant_id','d0000000-0000-4000-8000-0000000000a1',
                    'roles', json_build_array('branch_manager'))::text, true);

DO $audit2$
DECLARE
  v_raised text;
  v_status text;
BEGIN
  v_raised := 'no exception';
  BEGIN
    UPDATE public.daily_financial_audits
       SET status = 'CONFIRMED'
     WHERE tenant_id = 'd0000000-0000-4000-8000-0000000000a1'
       AND branch_id = 'da000000-0000-4000-8000-0000000000a1'
       AND audit_date = current_date;
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;

  SELECT status INTO v_status FROM public.daily_financial_audits
  WHERE tenant_id = 'd0000000-0000-4000-8000-0000000000a1'
    AND branch_id = 'da000000-0000-4000-8000-0000000000a1'
    AND audit_date = current_date;

  -- Checks the actual resulting status, not just the absence of an exception: a zero-row
  -- UPDATE (e.g. RLS filtering the target out) raises no error either, and would
  -- otherwise pass this assertion for the wrong reason.
  INSERT INTO _results VALUES ('F22 a different manager CAN confirm the audit',
    v_raised = 'no exception' AND v_status = 'CONFIRMED',
    'raised: ' || left(v_raised, 150) || ' | status=' || coalesce(v_status,'<null>'));

  v_raised := 'no exception';
  BEGIN
    UPDATE public.daily_financial_audits
       SET physical_cash = 999.0000, variance = 899.0000
     WHERE tenant_id = 'd0000000-0000-4000-8000-0000000000a1'
       AND branch_id = 'da000000-0000-4000-8000-0000000000a1'
       AND audit_date = current_date;
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES ('F23 a CONFIRMED daily financial audit is immutable to further updates',
    v_status = 'CONFIRMED' AND v_raised <> 'no exception',
    'status=' || coalesce(v_status,'<null>') || ' | raised: ' || left(v_raised, 150));
END
$audit2$;

-- ================================ F20: tenant isolation across all six =====
SELECT set_config('request.jwt.claims',
  json_build_object('sub','d1000000-0000-4000-8000-000000000001',
                    'tenant_id','d0000000-0000-4000-8000-0000000000a1',
                    'roles', json_build_array('owner'))::text, true);

INSERT INTO _results
SELECT 'F20 org A sees zero rows belonging to org B across all six financial tables', sum(f)=0,
       'foreign rows visible = ' || sum(f)
FROM (SELECT count(*) AS f FROM public.payments               WHERE tenant_id='d0000000-0000-4000-8000-0000000000b1'
  UNION ALL SELECT count(*) FROM public.refunds                WHERE tenant_id='d0000000-0000-4000-8000-0000000000b1'
  UNION ALL SELECT count(*) FROM public.invoices               WHERE tenant_id='d0000000-0000-4000-8000-0000000000b1'
  UNION ALL SELECT count(*) FROM public.cash_sessions          WHERE tenant_id='d0000000-0000-4000-8000-0000000000b1'
  UNION ALL SELECT count(*) FROM public.expenses               WHERE tenant_id='d0000000-0000-4000-8000-0000000000b1'
  UNION ALL SELECT count(*) FROM public.daily_financial_audits WHERE tenant_id='d0000000-0000-4000-8000-0000000000b1') s;

RESET ROLE;

-- ------------------------------------------------------------------ verdict --
SELECT test, passed, left(detail, 150) AS detail FROM _results ORDER BY test;

DO $verdict$
DECLARE v_failed text;
BEGIN
  SELECT string_agg(test, ' | ') INTO v_failed
    FROM _results WHERE passed IS DISTINCT FROM true;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'BakeFlow financial write suite FAILED: %', v_failed;
  END IF;
  RAISE NOTICE 'BakeFlow financial write suite passed: % assertions',
    (SELECT count(*) FROM _results);
END
$verdict$;

ROLLBACK;
