-- Findings C5, C8, I4, B2 — grants that RLS is currently the only thing holding back.

-- C5: dormant write grants. RLS denies these today only because no INSERT/UPDATE
-- policy exists. The moment anyone adds one, the grant goes live — which is how
-- Core Rule 7 ("stock levels are never updated directly") quietly stops being true.
-- Stock levels are maintained solely by apply_stock_movement(), and document numbers
-- solely by next_document_number(); both are SECURITY DEFINER and run as postgres,
-- so they do not need these grants.
REVOKE INSERT, UPDATE ON public.ingredient_stock_levels FROM authenticated;
REVOKE INSERT, UPDATE ON public.product_stock_levels    FROM authenticated;
REVOKE INSERT, UPDATE ON public.document_sequences      FROM authenticated;

-- profiles rows are created by the handle_new_user() trigger (SECURITY DEFINER),
-- never by the client.
REVOKE INSERT ON public.profiles FROM authenticated;

-- C8: anon and authenticated held UPDATE and USAGE on the sync cursor sequence,
-- which permits setval() — a client could rewind or jump the replication cursor and
-- desynchronise every device on the tenant. The sequence is only ever advanced from
-- SECURITY DEFINER sync functions.
REVOKE ALL ON SEQUENCE public.sync_change_seq FROM PUBLIC, anon, authenticated;

-- I4: pg_stat_statements exposes normalised query text for every tenant on the
-- instance to any client role that can read it.
DO $$
BEGIN
  IF to_regclass('extensions.pg_stat_statements') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON extensions.pg_stat_statements FROM PUBLIC, anon, authenticated';
  END IF;
  IF to_regclass('extensions.pg_stat_statements_info') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON extensions.pg_stat_statements_info FROM PUBLIC, anon, authenticated';
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'could not revoke on pg_stat_statements — not the owner; revoke via the dashboard';
END $$;

-- B2: FORCE ROW LEVEL SECURITY on the seven tables that lacked it, so all 37 are
-- uniform.
--
-- Read this honestly: `postgres` holds BYPASSRLS on this instance, and BYPASSRLS
-- overrides FORCE. So this does NOT currently stop SECURITY DEFINER functions owned
-- by postgres from bypassing policies — the real control on those functions remains
-- the tenant checks inside their own bodies. This is defence in depth: it makes the
-- posture uniform and correct if BYPASSRLS is ever dropped from postgres.
--
-- It is safe to apply for the same reason: BYPASSRLS means nothing breaks today.
ALTER TABLE public.daily_financial_audits        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.permanent_deletion_challenges FORCE ROW LEVEL SECURITY;
ALTER TABLE public.permissions                   FORCE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions              FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sync_changes                  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sync_devices                  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sync_operations               FORCE ROW LEVEL SECURITY;
