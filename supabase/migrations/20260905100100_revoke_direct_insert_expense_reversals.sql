-- Part of the BLOCKER-028 resolution batch (see 20260905100000_create_expense_reversals_table.sql).
-- Supabase's default privileges auto-granted `authenticated` INSERT on the new table at
-- creation time. The live analog `refunds` grants `authenticated` SELECT only -- all
-- refund creation goes through record_refund()'s SECURITY DEFINER escalation, never a
-- direct client INSERT, confirmed live before this fix. Revoking to match exactly: the
-- expense_reversals_insert RLS policy stays in place for structural parity with
-- refunds_insert, but is now unreachable via direct client grant, same "policy present,
-- grant absent" pattern already documented elsewhere in this project (e.g. TD-016).

REVOKE INSERT ON public.expense_reversals FROM authenticated;
