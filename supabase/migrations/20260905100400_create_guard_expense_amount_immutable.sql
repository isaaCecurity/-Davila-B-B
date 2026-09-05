-- BLOCKER-028 resolution: narrows the existing expenses direct-edit path so `amount` can
-- no longer be changed in place -- the exact contradiction with AD-021's append-only-plus-
-- reversal model this blocker flagged (expenses_update permits unrestricted direct edits,
-- including amount, with no audit-visible reason and no cap). Every other field
-- (description, category, receipt_url, etc.) stays editable exactly as before; amount
-- corrections must now go through record_expense_reversal()/apply_expense_reverse().

CREATE OR REPLACE FUNCTION public.guard_expense_amount_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.amount IS DISTINCT FROM OLD.amount THEN
    RAISE EXCEPTION 'expense amount cannot be changed directly once recorded -- use record_expense_reversal() instead'
      USING ERRCODE = 'P0001',
            DETAIL = json_build_object('code', 'invalid_request', 'reason', 'amount_immutable')::text;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_expense_amount_immutable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_expense_amount_immutable() TO service_role;

CREATE TRIGGER expenses_guard_amount_immutable
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.guard_expense_amount_immutable();
