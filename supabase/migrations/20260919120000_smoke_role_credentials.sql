-- Smoke Bakery A — one sign-in-capable account per role, for manual smoke testing on real
-- devices (owner asked "add credentials for every role in the smoketest bakery", 2026-09-19).
--
-- `smoke.owner@bakeflow.test` (aa..da01) already exists and holds `owner` in both Smoke Bakery A
-- (ab..da01) and Smoke Bakery B (ab..da02). SMOKE-TEST.md's walkthrough needs one account per
-- role to actually click through the app as that role (roles cannot be swapped mid-session
-- without signing out); until now the tester had to invite each one by hand. This creates the
-- other seven canonical roles (`roles.key`), all in Smoke Bakery A / branch Smoke A1, all with
-- the same password as the existing owner account.
--
-- Built the same way GoTrue itself would (not a shortcut): a real `auth.users` row with a bcrypt
-- password (`pgcrypto`, already installed), a matching `auth.identities` row for the `email`
-- provider, then the same `user_roles` + `branch_assignments` rows
-- `accept_organization_invite()` writes on a real acceptance (see
-- 20260914100000_invite_by_role_email_or_phone.sql). `handle_new_user()` (trigger on
-- `auth.users`) creates the bare `profiles` row automatically; this fills in the organization,
-- branch and name the same way invite acceptance does.
--
-- Owner and Admin are organization-wide (no branch_id), matching the existing owner account and
-- `docs/ROLES-AND-PERMISSIONS.md`'s hierarchy; every other role lives under a branch, so gets
-- Smoke A1. Accountant is included even though it is disabled in MVP 1 (CLAUDE.md: "architecturally
-- present... do not remove it from the role model") — the account exists for backend testing;
-- there is no app-side invite path to it yet. Supervisor needs no extra "enable" step: per
-- ROLES-AND-PERMISSIONS.md there is no separate feature-flag table, so holding the role is enough.
do $$
declare
  v_password  text := 'SmokeTest!2026';
  v_tenant_a  uuid := 'ab000000-0000-4000-8000-00000000da01';
  v_branch_a1 uuid := 'ac000000-0000-4000-8000-00000000da01';
  v_accounts  jsonb := '[
    {"id":"aa000000-0000-4000-8000-00000000da02","email":"smoke.admin@bakeflow.test",      "name":"Smoke Admin",      "role":"admin",          "branch":false},
    {"id":"aa000000-0000-4000-8000-00000000da03","email":"smoke.manager@bakeflow.test",    "name":"Smoke Manager",    "role":"branch_manager", "branch":true},
    {"id":"aa000000-0000-4000-8000-00000000da04","email":"smoke.cashier@bakeflow.test",    "name":"Smoke Cashier",    "role":"cashier",        "branch":true},
    {"id":"aa000000-0000-4000-8000-00000000da05","email":"smoke.baker@bakeflow.test",      "name":"Smoke Baker",      "role":"baker",          "branch":true},
    {"id":"aa000000-0000-4000-8000-00000000da06","email":"smoke.driver@bakeflow.test",     "name":"Smoke Driver",     "role":"driver",         "branch":true},
    {"id":"aa000000-0000-4000-8000-00000000da07","email":"smoke.supervisor@bakeflow.test", "name":"Smoke Supervisor", "role":"supervisor",     "branch":true},
    {"id":"aa000000-0000-4000-8000-00000000da08","email":"smoke.accountant@bakeflow.test", "name":"Smoke Accountant", "role":"accountant",     "branch":true}
  ]'::jsonb;
  v_acct      jsonb;
  v_uid       uuid;
  v_role_id   uuid;
  v_branch_id uuid;
begin
  for v_acct in select * from jsonb_array_elements(v_accounts) loop
    v_uid := (v_acct ->> 'id')::uuid;
    v_branch_id := case when (v_acct ->> 'branch')::boolean then v_branch_a1 else null end;

    select id into v_role_id from public.roles where key = v_acct ->> 'role';
    if v_role_id is null then
      raise exception 'unknown role key %', v_acct ->> 'role';
    end if;

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, raw_app_meta_data, raw_user_meta_data,
      is_super_admin, created_at, updated_at, is_sso_user, is_anonymous
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      v_acct ->> 'email', crypt(v_password, gen_salt('bf', 10)), now(),
      '', '', '', '', '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_acct ->> 'name'),
      false, now(), now(), false, false
    )
    on conflict (id) do nothing;

    insert into auth.identities (id, user_id, provider_id, provider, identity_data, created_at, updated_at)
    values (
      gen_random_uuid(), v_uid, v_uid::text, 'email',
      jsonb_build_object('sub', v_uid::text, 'email', v_acct ->> 'email', 'email_verified', true),
      now(), now()
    )
    on conflict do nothing;

    -- handle_new_user() already inserted a bare row (id, full_name, phone) when auth.users was
    -- written above; finish it exactly as accept_organization_invite() would on a first acceptance.
    update public.profiles
       set tenant_id         = v_tenant_a,
           active_tenant_id  = v_tenant_a,
           primary_branch_id = v_branch_id,
           full_name         = v_acct ->> 'name'
     where id = v_uid;

    insert into public.user_roles (tenant_id, profile_id, role_id, branch_id)
    values (v_tenant_a, v_uid, v_role_id, v_branch_id)
    on conflict do nothing;

    if v_branch_id is not null then
      insert into public.branch_assignments (tenant_id, profile_id, branch_id, is_default)
      values (v_tenant_a, v_uid, v_branch_id, true)
      on conflict (tenant_id, profile_id, branch_id) do nothing;
    end if;
  end loop;
end $$;
