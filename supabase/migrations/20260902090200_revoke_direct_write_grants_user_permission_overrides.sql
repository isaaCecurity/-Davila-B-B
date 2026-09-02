-- Supabase's default privileges on the public schema auto-grant full CRUD to
-- `authenticated` on every new table unless explicitly revoked (the same class of gap
-- BLOCKER-010c found on products/product_variants/product_categories). This table's
-- writes are meant to go ONLY through set_supervisor_permission_override() -- a direct
-- PostgREST write would bypass every guard the RPC enforces (Branch-Manager-only caller,
-- target-must-be-supervisor, the permission-key allowlist). Caught live by
-- tests/sql/supervisor_permission_overrides.sql PO1 before this ever shipped.
REVOKE INSERT, UPDATE, DELETE ON public.user_permission_overrides FROM authenticated;
