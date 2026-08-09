-- 20260809190000_fix_rls_helper_execute_grants
--
-- CRITICAL. Every RLS policy in this database calls current_tenant_id(), has_role()
-- or has_branch_access(), but EXECUTE on those functions was revoked from PUBLIC and
-- never re-granted to `authenticated`. Policy expressions are evaluated with the
-- querying role's privileges, so every authenticated read fails outright with
--
--     ERROR: 42501: permission denied for function current_tenant_id
--
-- The database fails closed, so this is an availability defect rather than a leak,
-- but no client can read any tenant-scoped table until it is fixed.
--
-- private.can_manage_target_role() already carries the grant, which is what makes
-- this an oversight on the public helpers rather than a deliberate design.

grant execute on function public.current_tenant_id()            to authenticated;
grant execute on function public.has_role(text[])               to authenticated;
grant execute on function public.has_branch_access(uuid)        to authenticated;

-- service_role bypasses RLS but still evaluates these in SECURITY INVOKER RPC paths.
grant execute on function public.current_tenant_id()            to service_role;
grant execute on function public.has_role(text[])               to service_role;
grant execute on function public.has_branch_access(uuid)        to service_role;
