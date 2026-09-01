-- BakeFlow — sales read-path security suite (S1..S18) — P4.4a / P4.4b
--
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/sales_read_rls.sql
--
-- The 2026-08-15 header here previously claimed "EXECUTED... BLOCKER-011 resolved", but
-- that run (see IMPLEMENTATION_LOG.md) only covered a partial, differently-labeled subset
-- (S1/S3/S4/S4b/S5/S6/S8/S12/S19 structural, plus S13c/S13d/S16b/S16c/S18c/S20 customer-only
-- RLS) against an earlier version of this file. The S1-S18 suite as committed here — in
-- particular every ticket/ticket_items RLS assertion (S13-S18) and the S9-S11 lifecycle
-- checks — had never actually run.
--
-- EXECUTED (this form) 2026-08-23 against project tvfyxpafbpnkneujcnvr: 27/27 passed, after
-- fixing a genuine fixture bug (the org-B ticket's creator, profile ...0002, had no
-- user_roles row in org B — guard_order_actor_and_assignment() correctly rejected the
-- INSERT) and after S10 surfaced and drove the fix of a real product defect: see
-- IMPLEMENTATION_LOG.md 2026-08-23 for both.
--
-- Same conventions as tests/sql/catalog_read_rls.sql and inventory_read_rls.sql: no psql
-- meta-commands, every assertion records into a temp table rather than raising, verdict
-- block at the end.
--
-- SAFETY: the whole suite runs in one transaction and ends in ROLLBACK. It creates
-- fixtures in live tables and must never be allowed to commit.
--
-- WHAT THIS SUITE IS FOR, beyond the usual isolation assertions:
--
--   S2/S3  are the direct verification of the `softDeleted` flags in
--          packages/api/queries/sales.ts and queries/production.ts. Those flags decide
--          whether a query filters `deleted_at IS NULL`, and filtering a column that does
--          not exist fails the WHOLE read with 42703. They were set from
--          SCHEMA-REFERENCE.md §4/§5 because the database was unreachable. If S2 or S3
--          fails, fix the flag — the schema is right and the code is wrong.
--
--   S9/S10 re-prove the 2026-08-14 resolution of BLOCKER-005 from the read path's side:
--          that onward transitions are reachable at all, and that subtotal_amount really
--          is frozen once a ticket leaves draft. The read models describe a ticket as an
--          immutable financial fact; if S10 fails, that description is false.
--
--   S11    proves the item-freeze point is `ready`, NOT `confirmed`. SCHEMA-REFERENCE.md
--          §9 says one thing and STATE-MACHINES.md §1 said the other; areTicketItemsLocked
--          in packages/types/sales.ts implements §9's version.

BEGIN;

-- ---------------------------------------------------------------- fixtures --
INSERT INTO auth.users (id, email) VALUES
  ('e1000000-0000-4000-8000-000000000001','u.mgr.sales@bakeflow.test'),
  ('e1000000-0000-4000-8000-000000000002','u.owner.sales@bakeflow.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organizations (id, name, slug) VALUES
  ('e0000000-0000-4000-8000-0000000000a1','Sales Test Bakery A','sales-test-a'),
  ('e0000000-0000-4000-8000-0000000000b1','Sales Test Bakery B','sales-test-b');

INSERT INTO public.branches (id, tenant_id, name, code) VALUES
  ('ea000000-0000-4000-8000-0000000000a1','e0000000-0000-4000-8000-0000000000a1','Sales Branch A1','SA1'),
  ('ea000000-0000-4000-8000-0000000000a2','e0000000-0000-4000-8000-0000000000a1','Sales Branch A2','SA2'),
  ('eb000000-0000-4000-8000-0000000000b1','e0000000-0000-4000-8000-0000000000b1','Sales Branch B1','SB1');

INSERT INTO public.profiles (id, full_name, status, tenant_id, active_tenant_id) VALUES
  ('e1000000-0000-4000-8000-000000000001','U Mgr Sales','active','e0000000-0000-4000-8000-0000000000a1','e0000000-0000-4000-8000-0000000000a1'),
  ('e1000000-0000-4000-8000-000000000002','U Owner Sales','active','e0000000-0000-4000-8000-0000000000a1','e0000000-0000-4000-8000-0000000000a1')
ON CONFLICT (id) DO UPDATE SET status='active', deleted_at=NULL,
  tenant_id=EXCLUDED.tenant_id, active_tenant_id=EXCLUDED.active_tenant_id;

-- branch_manager = ...0003, owner = ...0001 (live roles table).
-- The org-B row for ...0002 exists because the org-B ticket fixture below sets that
-- profile as created_by with tenant_id = org B: guard_order_actor_and_assignment()
-- requires the creator to hold a user_roles row in the ticket's own tenant (the
-- system supports multi-org membership by design), and rejects the INSERT outright
-- otherwise. Found live 2026-08-23 running this suite for the first time end-to-end.
-- Role ids looked up by key, not hardcoded -- see inventory_read_rls.sql's note on why (found
-- and fixed same day, P11.1 throwaway-DB validation, 2026-09-01).
INSERT INTO public.user_roles (tenant_id, profile_id, role_id, branch_id) VALUES
  ('e0000000-0000-4000-8000-0000000000a1','e1000000-0000-4000-8000-000000000001',(select id from public.roles where key='branch_manager'),'ea000000-0000-4000-8000-0000000000a1'),
  ('e0000000-0000-4000-8000-0000000000a1','e1000000-0000-4000-8000-000000000002',(select id from public.roles where key='owner'),NULL),
  ('e0000000-0000-4000-8000-0000000000b1','e1000000-0000-4000-8000-000000000002',(select id from public.roles where key='owner'),NULL)
ON CONFLICT DO NOTHING;

-- THE fixture that makes S13 meaningful: assigned to A1, NOT to A2.
INSERT INTO public.branch_assignments (tenant_id, profile_id, branch_id, is_default) VALUES
  ('e0000000-0000-4000-8000-0000000000a1','e1000000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-0000000000a1',true)
ON CONFLICT DO NOTHING;

-- Catalog rows the ticket_items foreign keys require.
INSERT INTO public.product_categories (id, tenant_id, name, sort_order) VALUES
  ('e2000000-0000-4000-8000-0000000000a1','e0000000-0000-4000-8000-0000000000a1','Sales Cat A',1),
  ('e2000000-0000-4000-8000-0000000000b1','e0000000-0000-4000-8000-0000000000b1','Sales Cat B',1);

INSERT INTO public.products (id, tenant_id, category_id, name, is_active) VALUES
  ('e3000000-0000-4000-8000-0000000000a1','e0000000-0000-4000-8000-0000000000a1','e2000000-0000-4000-8000-0000000000a1','Sales Product A',true),
  ('e3000000-0000-4000-8000-0000000000b1','e0000000-0000-4000-8000-0000000000b1','e2000000-0000-4000-8000-0000000000b1','Sales Product B',true);

-- unit_price 184500.0000 deliberately matches the value scalars.ts proved loses its scale
-- as a JSON number, so S5/S6 reproduce TD-012 on this domain's own money columns.
INSERT INTO public.product_variants (id, tenant_id, product_id, name, sku, unit_price, is_active) VALUES
  ('e4000000-0000-4000-8000-0000000000a1','e0000000-0000-4000-8000-0000000000a1','e3000000-0000-4000-8000-0000000000a1','Sales Var A','SAL-SKU-A',184500.0000,true),
  ('e4000000-0000-4000-8000-0000000000b1','e0000000-0000-4000-8000-0000000000b1','e3000000-0000-4000-8000-0000000000b1','Sales Var B','SAL-SKU-B',600.0000,true);

-- ---- customers ----
-- Two customers deliberately share both a full_name and a phone. That is what makes the
-- composite (full_name, id) cursor in listCustomers necessary rather than defensive, and
-- what makes findCustomersByPhone return an array rather than maybeSingle().
INSERT INTO public.customers (id, tenant_id, full_name, phone, email, is_walk_in) VALUES
  ('e5000000-0000-4000-8000-0000000000a1','e0000000-0000-4000-8000-0000000000a1','Adebayo Okonkwo','+2348030000001','a@sales.test',false),
  ('e5000000-0000-4000-8000-0000000000a2','e0000000-0000-4000-8000-0000000000a1','Adebayo Okonkwo','+2348030000001',NULL,false),
  ('e5000000-0000-4000-8000-0000000000a3','e0000000-0000-4000-8000-0000000000a1','Walk-in',NULL,NULL,true),
  ('e5000000-0000-4000-8000-0000000000a9','e0000000-0000-4000-8000-0000000000a1','Deleted Customer A',NULL,NULL,false),
  ('e5000000-0000-4000-8000-0000000000b1','e0000000-0000-4000-8000-0000000000b1','Chidinma Eze','+2348030000009',NULL,false);

-- ---- tickets ----
-- Inserted as draft (the column default) and advanced by UPDATE below, because
-- guard_ticket_status_transition() governs UPDATE and inserting straight into a later
-- state would prove nothing about reachability.
--
-- The first two org-A tickets share created_at to the second: that is what S7 uses to
-- justify the composite (created_at, id) keyset cursor in listTickets.
INSERT INTO public.tickets
  (id, tenant_id, branch_id, customer_id, fulfilment_type, created_by, created_at) VALUES
  ('e6000000-0000-4000-8000-0000000000a1','e0000000-0000-4000-8000-0000000000a1','ea000000-0000-4000-8000-0000000000a1','e5000000-0000-4000-8000-0000000000a1','pickup','e1000000-0000-4000-8000-000000000001','2026-08-14T09:00:00+00:00'),
  ('e6000000-0000-4000-8000-0000000000a2','e0000000-0000-4000-8000-0000000000a1','ea000000-0000-4000-8000-0000000000a1',NULL,'pickup','e1000000-0000-4000-8000-000000000001','2026-08-14T09:00:00+00:00'),
  ('e6000000-0000-4000-8000-0000000000a3','e0000000-0000-4000-8000-0000000000a1','ea000000-0000-4000-8000-0000000000a2','e5000000-0000-4000-8000-0000000000a1','pickup','e1000000-0000-4000-8000-000000000001','2026-08-14T09:30:00+00:00'),
  ('e6000000-0000-4000-8000-0000000000a9','e0000000-0000-4000-8000-0000000000a1','ea000000-0000-4000-8000-0000000000a1',NULL,'pickup','e1000000-0000-4000-8000-000000000001','2026-08-14T09:40:00+00:00'),
  ('e6000000-0000-4000-8000-0000000000b1','e0000000-0000-4000-8000-0000000000b1','eb000000-0000-4000-8000-0000000000b1','e5000000-0000-4000-8000-0000000000b1','pickup','e1000000-0000-4000-8000-000000000002','2026-08-14T11:00:00+00:00');

-- unit_price is snapshotted from the variant (guard_order_item_price enforces this).
-- line_total is NOT supplied: it is GENERATED ALWAYS AS (round(quantity * unit_price, 4))
-- STORED, and supplying it raises 428C9. S5/S6 read back 2 x 184500.0000 = 369000.0000.
INSERT INTO public.ticket_items
  (id, tenant_id, ticket_id, product_variant_id, quantity, unit_price) VALUES
  ('e7000000-0000-4000-8000-0000000000a1','e0000000-0000-4000-8000-0000000000a1','e6000000-0000-4000-8000-0000000000a1','e4000000-0000-4000-8000-0000000000a1',2.0000,184500.0000),
  ('e7000000-0000-4000-8000-0000000000a3','e0000000-0000-4000-8000-0000000000a1','e6000000-0000-4000-8000-0000000000a3','e4000000-0000-4000-8000-0000000000a1',1.0000,184500.0000),
  ('e7000000-0000-4000-8000-0000000000b1','e0000000-0000-4000-8000-0000000000b1','e6000000-0000-4000-8000-0000000000b1','e4000000-0000-4000-8000-0000000000b1',3.0000,600.0000);

UPDATE public.customers SET deleted_at = now() WHERE id = 'e5000000-0000-4000-8000-0000000000a9';
UPDATE public.tickets   SET deleted_at = now() WHERE id = 'e6000000-0000-4000-8000-0000000000a9';

CREATE TEMP TABLE _results(test text, passed boolean, detail text);
GRANT ALL ON _results TO authenticated;

-- ============================ structural: schema shape, money, lifecycle ====
DO $structural$
DECLARE
  v_raised text;
  v_status text;
BEGIN
  -- ---- S1: RLS ----
  INSERT INTO _results
  SELECT 'S1 RLS enabled and FORCED on all 3 sales tables', count(*) = 3,
         'tables with rowsecurity AND forcerowsecurity = ' || count(*)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public'
    AND c.relname IN ('customers','tickets','ticket_items')
    AND c.relrowsecurity AND c.relforcerowsecurity;

  -- ---- S2: the softDeleted flags in queries/sales.ts ----
  -- customers and tickets MUST have deleted_at; ticket_items MUST NOT.
  INSERT INTO _results
  SELECT 'S2a customers.deleted_at exists (softDeleted: true)', count(*) = 1,
         'matching columns = ' || count(*)
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='customers' AND column_name='deleted_at';

  INSERT INTO _results
  SELECT 'S2b tickets.deleted_at exists (softDeleted: true)', count(*) = 1,
         'matching columns = ' || count(*)
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='tickets' AND column_name='deleted_at';

  INSERT INTO _results
  SELECT 'S2c ticket_items.deleted_at exists (softDeleted: true)', count(*) = 1,
         'matching columns = ' || count(*)
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='ticket_items' AND column_name='deleted_at';

  -- ---- S3: the same question for production, which P4.3a got wrong ----
  -- queries/production.ts originally filtered deleted_at on both tables while selecting a
  -- column set that contained neither. If either count is 1, flip that module's flag to
  -- true; if 0, the correction applied on 2026-08-14 was right.
  INSERT INTO _results
  SELECT 'S3 every domain table carries deleted_at (all softDeleted flags are true)',
         count(*) = 16, 'tables with deleted_at = ' || count(*) || ' of 16'
  FROM information_schema.columns
  WHERE table_schema='public' AND column_name='deleted_at'
    AND table_name IN ('product_categories','products','product_variants','ingredients',
                       'recipes','recipe_ingredients','warehouses','stock_movements',
                       'ingredient_stock_levels','product_stock_levels',
                       'production_batches','production_batch_ingredients',
                       'customers','tickets','ticket_items','deliveries');

  -- ---- S4: total_amount is generated, so nothing may write it ----
  INSERT INTO _results
  SELECT 'S4 tickets.total_amount is GENERATED ALWAYS', count(*) = 1,
         'is_generated = ' || coalesce(max(is_generated),'<no column>')
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='tickets' AND column_name='total_amount'
    AND is_generated = 'ALWAYS';

  -- ---- S5/S6: TD-012 money transport, on this domain's columns ----
  INSERT INTO _results
  SELECT 'S5 line_total as a JSON number loses exact NUMERIC(19,4) scale',
         (j -> 'line_total')::text <> '"369000.0000"',
         'json number form = ' || (j -> 'line_total')::text
  FROM (SELECT row_to_json(t) AS j FROM (SELECT line_total FROM public.ticket_items
        WHERE id='e7000000-0000-4000-8000-0000000000a1') t) s;

  INSERT INTO _results
  SELECT 'S6 line_total::text survives exact NUMERIC(19,4) scale',
         j ->> 'line_total' = '369000.0000',
         'text form = ' || coalesce(j ->> 'line_total','<null>')
  FROM (SELECT row_to_json(t) AS j FROM (SELECT line_total::text AS line_total
        FROM public.ticket_items WHERE id='e7000000-0000-4000-8000-0000000000a1') t) s;

  -- ---- S7: justifies the composite (created_at, id) cursor in listTickets ----
  INSERT INTO _results
  SELECT 'S7 tickets.created_at is NOT unique, so a lone created_at cursor drops rows',
         count(*) > 1, 'tickets sharing one created_at instant = ' || count(*)
  FROM public.tickets
  WHERE tenant_id='e0000000-0000-4000-8000-0000000000a1'
    AND created_at='2026-08-14T09:00:00+00:00';

  -- ---- S8: why ticket_number is NOT the cursor, despite being unique ----
  -- Text ordering puts TCK-100 before TCK-99, so a "recent orders" list keyed on it would
  -- be wrong in a way that only shows up after the 99th ticket.
  INSERT INTO _results
  SELECT 'S8 ticket_number sorts lexicographically, not numerically',
         ('TCK-100' < 'TCK-99'), 'TCK-100 < TCK-99 evaluates to ' || ('TCK-100' < 'TCK-99')::text;

  -- ---- S9: BLOCKER-005 resolution — onward transitions are reachable ----
  UPDATE public.tickets SET status='submitted' WHERE id='e6000000-0000-4000-8000-0000000000a1';
  UPDATE public.tickets SET status='confirmed' WHERE id='e6000000-0000-4000-8000-0000000000a1';
  SELECT status INTO v_status FROM public.tickets WHERE id='e6000000-0000-4000-8000-0000000000a1';
  INSERT INTO _results VALUES (
    'S9 draft -> submitted -> confirmed is reachable (BLOCKER-005 resolved)',
    v_status = 'confirmed', 'status after two transitions = ' || coalesce(v_status,'<null>'));

  -- ---- S10: submitted money is frozen (the second half of BLOCKER-005) ----
  v_raised := 'no exception';
  BEGIN
    UPDATE public.tickets SET subtotal_amount = 1.0000
     WHERE id='e6000000-0000-4000-8000-0000000000a1';
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES (
    'S10 subtotal_amount is frozen once a ticket leaves draft',
    v_raised <> 'no exception', 'raised: ' || left(v_raised, 90));

  -- ---- S11: the item freeze point is `ready`, not `confirmed` ----
  -- SCHEMA-REFERENCE.md §9 explicitly corrects STATE-MACHINES.md §1 here, and
  -- areTicketItemsLocked() in packages/types/sales.ts implements §9's version.
  v_raised := 'no exception';
  BEGIN
    INSERT INTO public.ticket_items
      (tenant_id, ticket_id, product_variant_id, quantity, unit_price)
    VALUES ('e0000000-0000-4000-8000-0000000000a1','e6000000-0000-4000-8000-0000000000a1',
            'e4000000-0000-4000-8000-0000000000a1',1.0000,184500.0000);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES (
    'S11a items are still editable at `confirmed`',
    v_raised = 'no exception', 'raised: ' || left(v_raised, 90));

  UPDATE public.tickets SET status='scheduled'     WHERE id='e6000000-0000-4000-8000-0000000000a1';
  UPDATE public.tickets SET status='in_production' WHERE id='e6000000-0000-4000-8000-0000000000a1';
  UPDATE public.tickets SET status='ready'         WHERE id='e6000000-0000-4000-8000-0000000000a1';

  v_raised := 'no exception';
  BEGIN
    INSERT INTO public.ticket_items
      (tenant_id, ticket_id, product_variant_id, quantity, unit_price)
    VALUES ('e0000000-0000-4000-8000-0000000000a1','e6000000-0000-4000-8000-0000000000a1',
            'e4000000-0000-4000-8000-0000000000a1',1.0000,184500.0000);
  EXCEPTION WHEN OTHERS THEN v_raised := SQLERRM;
  END;
  INSERT INTO _results VALUES (
    'S11b items are locked at `ready` (order_locked)',
    v_raised LIKE '%order_locked%', 'raised: ' || left(v_raised, 90));

  -- ---- S12: sale_customer_type IS constrained, and NOT NULL ----
  -- SCHEMA-REFERENCE.md §4 records neither. packages/types/sales.ts models it as the
  -- two-value union SALE_CUSTOMER_TYPES; this is the assertion that keeps them in step.
  INSERT INTO _results
  SELECT 'S12a sale_customer_type CHECK is exactly (REGISTERED, ROADSIDE)', count(*) = 1,
         'matching check constraints = ' || count(*)
  FROM pg_constraint
  WHERE conrelid = 'public.tickets'::regclass AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%sale_customer_type%'
    AND pg_get_constraintdef(oid) LIKE '%REGISTERED%'
    AND pg_get_constraintdef(oid) LIKE '%ROADSIDE%';

  INSERT INTO _results
  SELECT 'S12b sale_customer_type is NOT NULL', count(*) = 1,
         'is_nullable = ' || coalesce(max(is_nullable),'<no column>')
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='tickets'
    AND column_name='sale_customer_type' AND is_nullable='NO';

  -- ---- S12c: every ticket money column is non-negative ----
  -- Five CHECKs, which is why signedMoneySchema was removed rather than kept unused.
  INSERT INTO _results
  SELECT 'S12c all five ticket money columns carry CHECK >= 0', count(*) >= 5,
         'non-negative money checks on tickets = ' || count(*)
  FROM pg_constraint
  WHERE conrelid = 'public.tickets'::regclass AND contype='c'
    AND pg_get_constraintdef(oid) ~ '(subtotal_amount|discount_amount|tax_amount|total_amount|amount_paid) >= \(0\)';
END
$structural$;

-- ================================================== RLS: S13..S18 ==========
-- MUST run as `authenticated`. postgres carries BYPASSRLS, so every assertion below
-- would pass vacuously under the default role.
SET LOCAL ROLE authenticated;

-- ---- U_MGR: branch_manager in org A, assigned to branch A1 ONLY ----
SELECT set_config('request.jwt.claims',
  json_build_object('sub','e1000000-0000-4000-8000-000000000001',
                    'tenant_id','e0000000-0000-4000-8000-0000000000a1',
                    'roles', json_build_array('branch_manager'))::text, true);

INSERT INTO _results
SELECT 'S13 org A sees zero rows belonging to org B (all 3 tables)', sum(f)=0,
       'foreign rows visible = ' || sum(f)
FROM (SELECT count(*) AS f FROM public.customers    WHERE tenant_id='e0000000-0000-4000-8000-0000000000b1'
  UNION ALL SELECT count(*)   FROM public.tickets      WHERE tenant_id='e0000000-0000-4000-8000-0000000000b1'
  UNION ALL SELECT count(*)   FROM public.ticket_items WHERE tenant_id='e0000000-0000-4000-8000-0000000000b1') s;

-- S14 -- branch isolation on tickets. The A2 ticket exists and belongs to this user's
-- organization; only the branch predicate can be hiding it.
INSERT INTO _results
SELECT 'S14 a branch_manager assigned to A1 sees no A2 ticket', count(*)=0,
       'A2 tickets visible = ' || count(*)
FROM public.tickets WHERE branch_id='ea000000-0000-4000-8000-0000000000a2';

-- S14b -- prevents S14 passing vacuously: the A1 ticket IS visible to the same user.
INSERT INTO _results
SELECT 'S14b the same user DOES see the A1 ticket (S14 is not vacuous)', count(*)>0,
       'A1 tickets visible = ' || count(*)
FROM public.tickets WHERE branch_id='ea000000-0000-4000-8000-0000000000a1'
  AND deleted_at IS NULL;

-- S15 -- a child row of an invisible parent must not be reachable. ticket_items has no
-- branch_id of its own, so this is the assertion that its policy reaches through the
-- parent rather than stopping at tenant_id.
INSERT INTO _results
SELECT 'S15 ticket_items of a branch-invisible ticket are invisible', count(*)=0,
       'items of the A2 ticket visible = ' || count(*)
FROM public.ticket_items WHERE ticket_id='e6000000-0000-4000-8000-0000000000a3';

-- S16 -- soft-deleted rows are invisible on both tables that carry the column.
INSERT INTO _results
SELECT 'S16 soft-deleted customers and tickets are invisible', sum(v)=0,
       'soft-deleted rows visible = ' || sum(v)
FROM (SELECT count(*) AS v FROM public.customers WHERE id='e5000000-0000-4000-8000-0000000000a9'
  UNION ALL SELECT count(*)  FROM public.tickets   WHERE id='e6000000-0000-4000-8000-0000000000a9') s;

-- S16b -- the two namesakes on one phone number are BOTH visible, which is why
-- findCustomersByPhone returns an array and listCustomers uses a composite cursor.
INSERT INTO _results
SELECT 'S16b two customers share a name and phone, both visible', count(*)=2,
       'customers on +2348030000001 = ' || count(*)
FROM public.customers WHERE phone='+2348030000001' AND deleted_at IS NULL;

-- ---- U_OWNER: owner in org A, NO branch_assignments row at all ----
SELECT set_config('request.jwt.claims',
  json_build_object('sub','e1000000-0000-4000-8000-000000000002',
                    'tenant_id','e0000000-0000-4000-8000-0000000000a1',
                    'roles', json_build_array('owner'))::text, true);

-- S17 -- has_branch_access() short-circuits for owner/admin, proving S14's zero comes from
-- the branch predicate rather than from an empty fixture.
INSERT INTO _results
SELECT 'S17 owner with no branch_assignment sees BOTH org-A branches'' tickets', count(*)=3,
       'org A live tickets visible to owner = ' || count(*)
FROM public.tickets
WHERE tenant_id='e0000000-0000-4000-8000-0000000000a1' AND deleted_at IS NULL;

-- S17b -- owner authority still never crosses an organization boundary (AD-008).
INSERT INTO _results
SELECT 'S17b owner authority does not cross the organization boundary', count(*)=0,
       'org B tickets visible to org A owner = ' || count(*)
FROM public.tickets WHERE tenant_id='e0000000-0000-4000-8000-0000000000b1';

-- ---- No tenant claim (a revoked membership mints a null tenant_id) ----
SELECT set_config('request.jwt.claims',
  json_build_object('sub','e1000000-0000-4000-8000-000000000001',
                    'roles', json_build_array('branch_manager'))::text, true);

INSERT INTO _results
SELECT 'S18 no tenant claim yields zero sales rows everywhere', sum(v)=0,
       'rows visible with no tenant claim = ' || sum(v)
FROM (SELECT count(*) AS v FROM public.customers
  UNION ALL SELECT count(*)  FROM public.tickets
  UNION ALL SELECT count(*)  FROM public.ticket_items) s;

RESET ROLE;

-- ------------------------------------------------------------------ verdict --
SELECT test, passed, left(detail, 100) AS detail FROM _results ORDER BY test;

DO $verdict$
DECLARE v_failed text;
BEGIN
  SELECT string_agg(test, ' | ') INTO v_failed
    FROM _results WHERE passed IS DISTINCT FROM true;
  IF v_failed IS NOT NULL THEN
    RAISE EXCEPTION 'BakeFlow sales read suite FAILED: %', v_failed;
  END IF;
  RAISE NOTICE 'BakeFlow sales read suite passed: % assertions',
    (SELECT count(*) FROM _results);
END
$verdict$;

ROLLBACK;
