-- BakeFlow — P3.7 PRODUCTION vertical slice: production.record_output / production.record_waste
--
--   psql "$BAKEFLOW_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/p3_7_production_output_waste_sync.sql
--
-- REWRITTEN 2026-09-01 (AD-022, ingredient/raw-material tracking deactivated for MVP):
-- production.record_output/.record_waste were removed from the domain_operation allowlist
-- entirely, alongside production.start/.cancel (see p3_7_production_sync.sql's own header
-- for the full reasoning -- production batches are 100% recipe/ingredient machinery with no
-- product-only path to fall back to, unlike inventory.adjust/.waste).
--
-- The original, detailed 586-line suite (O1-O6, W1-W7, S1-S6; 12/12 passed 2026-08-31) is
-- preserved in git history (this same path, commits before 2026-09-01) for whenever v2
-- re-adds these two values to the allowlist. This replacement proves only that the
-- deactivation itself is real and stays real.
--
-- One assertion here is a genuine flip, not just a removal: the original S5/S6 asserted
-- complete_production_batch(uuid,numeric,jsonb,uuid)/fail_production_batch(uuid,text,jsonb,uuid)
-- (the 4-arg, online-flow overloads) WERE executable by `authenticated` -- true at the time,
-- since P9.5's production-batch screen called them directly. AD-022's backend migration
-- (20260901160000_deactivate_ingredient_tracking_for_mvp.sql) explicitly REVOKEd that EXECUTE
-- grant too (production_batches can't even be created anymore, so the RPC was already
-- unreachable in practice; the revoke closes the direct-call path for defense in depth). S5/S6
-- below now assert the opposite of what they used to, on purpose.
--
-- Covers:
--   O0a production.record_output -> REJECTED by sync_operations_domain_operation_check (23514)
--   O0b production.record_waste -> REJECTED by sync_operations_domain_operation_check (23514)
--   S1  apply_production_record_output not directly executable by anon/authenticated
--   S2  apply_production_record_waste not directly executable by anon/authenticated
--   S3  complete_production_batch/5 (the p_tenant_id overload) not directly executable
--   S4  fail_production_batch/5 (the p_tenant_id overload) not directly executable
--   S5  complete_production_batch/4 (the online-flow RPC) is now ALSO not directly
--       executable -- flipped by AD-022, see note above
--   S6  fail_production_batch/4 (the online-flow RPC) is now ALSO not directly executable

BEGIN;

CREATE TEMP TABLE _results (test text, passed boolean, detail text);
GRANT ALL ON _results TO authenticated;

DO $$
DECLARE v_sqlstate text;
BEGIN
  -- O0a
  BEGIN
    INSERT INTO public.sync_operations
      (operation_id, device_id, tenant_id, branch_id, actor_id, entity_id, entity_type,
       operation_type, domain_operation, device_created_at, payload)
    VALUES
      (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
       gen_random_uuid(), 'production_batches', 'EVENT', 'production.record_output', now(), '{}'::jsonb);
    v_sqlstate := 'no error';
  EXCEPTION WHEN OTHERS THEN v_sqlstate := SQLSTATE;
  END;
  INSERT INTO _results VALUES ('O0a production.record_output rejected by domain_operation CHECK (AD-022)',
    v_sqlstate = '23514', 'sqlstate = ' || v_sqlstate);

  -- O0b
  BEGIN
    INSERT INTO public.sync_operations
      (operation_id, device_id, tenant_id, branch_id, actor_id, entity_id, entity_type,
       operation_type, domain_operation, device_created_at, payload)
    VALUES
      (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
       gen_random_uuid(), 'production_batches', 'EVENT', 'production.record_waste', now(), '{}'::jsonb);
    v_sqlstate := 'no error';
  EXCEPTION WHEN OTHERS THEN v_sqlstate := SQLSTATE;
  END;
  INSERT INTO _results VALUES ('O0b production.record_waste rejected by domain_operation CHECK (AD-022)',
    v_sqlstate = '23514', 'sqlstate = ' || v_sqlstate);

  INSERT INTO _results VALUES ('S1 apply_production_record_output not directly executable by anon/authenticated',
    not has_function_privilege('authenticated', 'public.apply_production_record_output(public.sync_operations)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.apply_production_record_output(public.sync_operations)', 'EXECUTE'), '');
  INSERT INTO _results VALUES ('S2 apply_production_record_waste not directly executable by anon/authenticated',
    not has_function_privilege('authenticated', 'public.apply_production_record_waste(public.sync_operations)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.apply_production_record_waste(public.sync_operations)', 'EXECUTE'), '');

  INSERT INTO _results VALUES ('S3 complete_production_batch/5 (p_tenant_id overload) not directly executable',
    not has_function_privilege('authenticated', 'public.complete_production_batch(uuid, numeric, jsonb, uuid, uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.complete_production_batch(uuid, numeric, jsonb, uuid, uuid)', 'EXECUTE'), '');
  INSERT INTO _results VALUES ('S4 fail_production_batch/5 (p_tenant_id overload) not directly executable',
    not has_function_privilege('authenticated', 'public.fail_production_batch(uuid, text, jsonb, uuid, uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.fail_production_batch(uuid, text, jsonb, uuid, uuid)', 'EXECUTE'), '');

  -- S5/S6 -- flipped by AD-022 (see header): the 4-arg online-flow overloads lost their
  -- authenticated EXECUTE grant too, now that production_batches can't be created at all.
  INSERT INTO _results VALUES ('S5 complete_production_batch/4 (online-flow RPC) now also not directly executable',
    not has_function_privilege('authenticated', 'public.complete_production_batch(uuid, numeric, jsonb, uuid)', 'EXECUTE'), '');
  INSERT INTO _results VALUES ('S6 fail_production_batch/4 (online-flow RPC) now also not directly executable',
    not has_function_privilege('authenticated', 'public.fail_production_batch(uuid, text, jsonb, uuid)', 'EXECUTE'), '');
END $$;

SELECT * FROM _results ORDER BY test;

DO $verdict$
BEGIN
  IF EXISTS (SELECT 1 FROM _results WHERE NOT passed) THEN
    RAISE EXCEPTION 'p3_7_production_output_waste_sync.sql: % of % assertions FAILED -- see rows above',
      (SELECT count(*) FROM _results WHERE NOT passed), (SELECT count(*) FROM _results);
  END IF;
  RAISE NOTICE 'p3_7_production_output_waste_sync.sql: all % assertions passed', (SELECT count(*) FROM _results);
END
$verdict$;

ROLLBACK;
