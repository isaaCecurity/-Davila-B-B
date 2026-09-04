-- Found live by the new tests/sql/table_privilege_audit.sql (Item B of the 2026-09-04
-- weak-link remediation pass): authenticated held INSERT/UPDATE grants on three tables
-- with zero matching RLS policy for those commands. All three tables have RLS enabled AND
-- forced (confirmed live), so these were never exploitable -- a forced table with no
-- policy for a command denies it outright regardless of the grant. Still, unnecessary
-- attack surface: each table's real write path is a SECURITY DEFINER trigger (which
-- executes as the function owner and is unaffected by these grants), not a direct client
-- write, and no client code references these tables for anything but SELECT (confirmed by
-- grep across bakeflow-frontend/packages/api before this migration).
--
--   document_sequences -- written only by next_document_number()/assign_order_number()
--     (SECURITY DEFINER trigger context).
--   product_stock_levels -- written only by apply_stock_movement() (SECURITY DEFINER
--     trigger on stock_movements).
--   profiles -- inserted only by the auth.users signup trigger (service-role context).

REVOKE INSERT, UPDATE ON public.document_sequences FROM authenticated;
REVOKE INSERT, UPDATE ON public.product_stock_levels FROM authenticated;
REVOKE INSERT ON public.profiles FROM authenticated;
