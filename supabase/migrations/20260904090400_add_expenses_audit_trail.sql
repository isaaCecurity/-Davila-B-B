-- expenses had NO audit trail at all: apply_expense_create() (the P3.7 sync path) inserts
-- into expenses and sync_changes but never calls log_audit_event, and the live
-- expenses_insert/expenses_update/expenses_delete RLS policies separately permit DIRECT
-- PostgREST writes by owner/admin/branch_manager/accountant with zero trigger observing
-- them either. This contradicts AD-021's "append-only + explicit reversal" design intent
-- for financial entities and CLAUDE.md's audit rule (every significant business event
-- auditable). Scope is deliberately narrow: this closes the AUDITABILITY gap only -- it
-- does not make expenses immutable and does not build expense.reverse (BLOCKER-028,
-- still open, unchanged; a reversal mechanism needs its own product decision between two
-- incompatible designs, and narrowing the live direct-edit path without that decision
-- would be exactly the business-rule guess CLAUDE.md's blocker rule prohibits).
--
-- A hand-written, per-table AFTER trigger (not a generic reusable audit-trigger
-- abstraction) matching this codebase's existing convention (guard_cash_session_transition,
-- guard_delivery_transition, etc. are all hand-written and several already call
-- log_audit_event() inline). expenses is the first table getting this treatment; a config-
-- driven generic mechanism for a pattern with one real instance would itself be the
-- premature abstraction CLAUDE.md warns against -- revisit if/when a second and third
-- table need the same treatment (rule of three).
--
-- AFTER, not BEFORE like the guard_* triggers: this trigger only observes, never
-- validates or blocks, so AFTER is correct and cannot interfere with the write path.
-- A table-level trigger (rather than adding log_audit_event() only inside
-- apply_expense_create()) is required specifically because it fires regardless of which
-- path wrote the row -- the RPC-only approach would miss the more concerning gap: direct
-- client edits via expenses_update with zero trail.
--
-- Verified live 2026-09-04: financial_write_rls.sql F25-F27 (direct INSERT/UPDATE/DELETE)
-- and p3_7_financial_sync.sql E1b (the sync/RPC path) all pass.
CREATE OR REPLACE FUNCTION public.log_expense_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit_event(NEW.tenant_id, 'expense', NEW.id, 'insert', NULL, to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.log_audit_event(NEW.tenant_id, 'expense', NEW.id, 'update', to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSE
    PERFORM public.log_audit_event(OLD.tenant_id, 'expense', OLD.id, 'delete', to_jsonb(OLD), NULL);
    RETURN OLD;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.log_expense_mutation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_expense_mutation() TO service_role;

CREATE TRIGGER expenses_audit_trail
  AFTER INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.log_expense_mutation();
