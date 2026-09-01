-- BakeFlow — P3.7 PRODUCTION vertical slice: production.start / production.cancel
--
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/p3_7_production_sync.sql
--
-- REWRITTEN 2026-09-01 (AD-022, ingredient/raw-material tracking deactivated for MVP):
-- production.start/.cancel/.record_output/.record_waste were removed from the
-- domain_operation allowlist entirely -- production batches are 100% recipe/ingredient
-- machinery (complete_production_batch() always looks up the batch's recipe and always
-- deducts ingredient stock; there is no product-only path the way inventory.adjust/.waste
-- had). Unlike p3_7_inventory_sync.sql, there is nothing left here to re-point at products:
-- every P1-P11/S1-S2 assertion this file used to run (13/13 passed 2026-08-30, re-verified
-- 12/12 2026-08-31) tested a call path that no longer exists at all.
--
-- The original, detailed 432-line suite -- including the real tenant-scoping defect it
-- found and fixed in guard_production_batch_transition() -- is preserved in git history
-- (this same path, commits before 2026-09-01) for whenever v2 re-adds production.start/
-- .cancel to the allowlist; resurrect it then rather than guessing at what still applies.
-- This replacement proves only that the deactivation itself is real and stays real: the
-- allowlist rejects both values, and the handler functions remain unreachable directly.
--
-- Covers:
--   P0a production.start -> REJECTED by sync_operations_domain_operation_check (23514)
--   P0b production.cancel -> REJECTED by sync_operations_domain_operation_check (23514)
--   S1  apply_production_start is not directly executable by anon or authenticated via PostgREST
--   S2  apply_production_cancel is not directly executable by anon or authenticated via PostgREST

BEGIN;

CREATE TEMP TABLE _results (test text, passed boolean, detail text);
GRANT ALL ON _results TO authenticated;

DO $$
DECLARE v_sqlstate text;
BEGIN
  -- P0a
  BEGIN
    INSERT INTO public.sync_operations
      (operation_id, device_id, tenant_id, branch_id, actor_id, entity_id, entity_type,
       operation_type, domain_operation, device_created_at, payload)
    VALUES
      (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
       gen_random_uuid(), 'production_batches', 'EVENT', 'production.start', now(), '{}'::jsonb);
    v_sqlstate := 'no error';
  EXCEPTION WHEN OTHERS THEN v_sqlstate := SQLSTATE;
  END;
  INSERT INTO _results VALUES ('P0a production.start rejected by domain_operation CHECK (AD-022)',
    v_sqlstate = '23514', 'sqlstate = ' || v_sqlstate);

  -- P0b
  BEGIN
    INSERT INTO public.sync_operations
      (operation_id, device_id, tenant_id, branch_id, actor_id, entity_id, entity_type,
       operation_type, domain_operation, device_created_at, payload)
    VALUES
      (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
       gen_random_uuid(), 'production_batches', 'EVENT', 'production.cancel', now(), '{}'::jsonb);
    v_sqlstate := 'no error';
  EXCEPTION WHEN OTHERS THEN v_sqlstate := SQLSTATE;
  END;
  INSERT INTO _results VALUES ('P0b production.cancel rejected by domain_operation CHECK (AD-022)',
    v_sqlstate = '23514', 'sqlstate = ' || v_sqlstate);

  -- S1/S2 -- unchanged fact, still worth asserting: these handlers were never directly
  -- executable by a client even before the deactivation (reachable only through
  -- process_sync_batch()'s dispatcher), and remain so now.
  INSERT INTO _results VALUES ('S1 apply_production_start not directly executable by anon/authenticated',
    not has_function_privilege('authenticated', 'public.apply_production_start(public.sync_operations)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.apply_production_start(public.sync_operations)', 'EXECUTE'), '');
  INSERT INTO _results VALUES ('S2 apply_production_cancel not directly executable by anon/authenticated',
    not has_function_privilege('authenticated', 'public.apply_production_cancel(public.sync_operations)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.apply_production_cancel(public.sync_operations)', 'EXECUTE'), '');
END $$;

SELECT * FROM _results ORDER BY test;

DO $verdict$
BEGIN
  IF EXISTS (SELECT 1 FROM _results WHERE NOT passed) THEN
    RAISE EXCEPTION 'p3_7_production_sync.sql: % of % assertions FAILED -- see rows above',
      (SELECT count(*) FROM _results WHERE NOT passed), (SELECT count(*) FROM _results);
  END IF;
  RAISE NOTICE 'p3_7_production_sync.sql: all % assertions passed', (SELECT count(*) FROM _results);
END
$verdict$;

ROLLBACK;
