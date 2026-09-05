-- Part of the BLOCKER-028 resolution batch (see 20260905100000_create_expense_reversals_table.sql).
-- tests/sql/table_privilege_audit.sql CHECK 1 caught this immediately: Supabase's default
-- privileges auto-granted `authenticated` UPDATE and DELETE on the new table at creation
-- time, with no matching RLS policy for either command (expense_reversals has only SELECT
-- and INSERT policies) -- exactly the recurring bug class that test exists to catch.
-- Revoking both; INSERT is handled separately (see the next migration in this batch).

REVOKE UPDATE, DELETE ON public.expense_reversals FROM authenticated;
