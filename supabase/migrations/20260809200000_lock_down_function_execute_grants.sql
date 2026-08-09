-- Findings D2, D3, D5 — function EXECUTE surface.
--
-- PostgreSQL grants EXECUTE to PUBLIC by default. Every function in the exposed
-- public schema was therefore published at /rest/v1/rpc/<name> for anon and
-- authenticated, including trigger guard functions and internal helpers:
--
--   anon:          archive_ticket, has_permission, process_sync_batch, sync_validate_device
--   anon + authed: bump_cash_session_revision, guard_daily_financial_audit_mutation,
--                  prevent_submitted_ticket_update  (all return trigger)
--
-- None of these are currently exploitable unauthenticated — archive_ticket,
-- process_sync_batch and sync_validate_device each raise 28000 when auth.uid() is
-- NULL, and has_permission returns false. This closes the surface so that a future
-- edit which drops one of those guards is not silently exploitable.
--
-- Strategy: default-deny across the schema, then re-grant only the intended client
-- RPCs. Grants held by postgres, service_role and supabase_auth_admin are not
-- touched by the revoke, so custom_access_token_hook keeps its explicit
-- supabase_auth_admin grant and the login path is unaffected.
--
-- Trigger functions do not need EXECUTE for their triggers to fire: PostgreSQL
-- checks that privilege at CREATE TRIGGER time, not at fire time.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;

-- RLS helpers. Every policy calls these; without EXECUTE they raise 42501 and all
-- client reads fail (audit check D4 guards against exactly this).
GRANT EXECUTE ON FUNCTION public.current_tenant_id()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(text[])           TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_branch_access(uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(text, uuid) TO authenticated;

-- Client-facing RPCs.
GRANT EXECUTE ON FUNCTION public.accept_organization_invite(text)                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_stock(uuid, text, uuid, numeric, text, text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_ticket(uuid, text)                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_ticket(uuid, text)                             TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_cash_session(uuid, numeric, text)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_production_batch(uuid, numeric, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_ticket(uuid, uuid)                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_ticket(uuid)                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization_invite(text, text, uuid, integer)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization_with_owner(text, text, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION public.fail_production_batch(uuid, text, jsonb, uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.open_cash_session(uuid, numeric)                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_sync_batch(uuid, jsonb)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment(uuid, numeric, text, text, uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_refund(uuid, numeric, text)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_validate_device(uuid)                            TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_delivery(uuid, text, text, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_delivery_details(uuid, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_invoice_due_at(uuid, timestamptz)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_ticket(
  uuid, uuid, text, timestamptz, numeric, numeric, uuid, text, text)                   TO authenticated;

-- GoTrue must keep calling the access-token hook.
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
