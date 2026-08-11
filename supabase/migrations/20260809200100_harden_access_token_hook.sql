-- Findings D6, D7 — the access-token hook is the root of every RLS decision.
--
-- The previous version aggregated user_roles with no deleted_at filter and never
-- consulted profiles.status. Two consequences:
--
--   D6  Revoking a role writes deleted_at, but the next token minted still carried
--       that role key. has_role() reads the JWT, not the table, so a revoked Owner
--       stayed an Owner for the life of every subsequently issued token.
--   D7  Suspending an employee (profiles.status = 'suspended') did not stop tokens
--       being minted with their full tenant_id and role set.
--
-- A soft-deleted role definition (roles.deleted_at) was likewise still honoured.
--
-- This version denies by omission: a profile that is missing, soft-deleted, or not
-- 'active' receives a NULL tenant_id and an empty roles array. current_tenant_id()
-- then returns NULL, `tenant_id = NULL` is NULL, and every policy denies —
-- which is the behaviour audit probe G4 verifies.
--
-- Existing tokens are unaffected until they expire; this only governs newly minted
-- ones. Revocation is not immediate — that remains a property of JWT lifetime.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  claims    jsonb := event -> 'claims';
  v_user    uuid  := (event ->> 'user_id')::uuid;
  v_tenant  uuid;
  v_status  text;
  v_deleted timestamptz;
  v_roles   text[] := '{}';
begin
  select p.tenant_id, p.status, p.deleted_at
    into v_tenant, v_status, v_deleted
  from public.profiles p
  where p.id = v_user;

  -- No profile, archived profile, or any status other than 'active' mints an
  -- unprivileged token rather than a privileged one.
  if v_status is distinct from 'active' or v_deleted is not null then
    v_tenant := null;
    v_roles  := '{}';
  else
    select coalesce(array_agg(r.key), '{}')
    into v_roles
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.profile_id = v_user
      and ur.tenant_id is not distinct from v_tenant
      and ur.deleted_at is null
      and r.deleted_at is null;
  end if;

  claims := jsonb_set(claims, '{tenant_id}', to_jsonb(v_tenant));
  claims := jsonb_set(claims, '{roles}',     to_jsonb(v_roles));

  return jsonb_set(event, '{claims}', claims);
end
$function$;

REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;
