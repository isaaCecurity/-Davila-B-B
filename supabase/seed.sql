-- BakeFlow — platform reference data
--
-- Run automatically by `supabase db reset` (see [db.seed] in config.toml).
-- Captured from the live project tvfyxpafbpnkneujcnvr on 2026-08-09.
--
-- This file seeds PLATFORM data only — rows that are not tenant-scoped and are
-- identical for every bakery: the role catalog, the permission catalog, and the
-- grants between them. It contains no tenant, branch, or business data.
--
-- Everything here is idempotent: re-running it updates existing rows rather than
-- failing or duplicating. `key` is the natural key in both catalogs; the UUID
-- primary keys are generated per environment and are deliberately NOT pinned,
-- so never reference a role or permission by literal id.

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
-- `rank` orders privilege, lower = more privileged. It backs "at least manager"
-- style checks and private.can_manage_target_role(). Ranks 5-7 are intentionally
-- unused so a role can be inserted between supervisor and accountant without
-- renumbering anything.

insert into public.roles (key, name, rank) values
  ('owner',          'Owner',      1),
  ('admin',          'Admin',      2),
  ('branch_manager', 'Manager',    3),
  ('supervisor',     'Supervisor', 4),
  ('accountant',     'Accountant', 8),
  ('baker',          'Baker',      9),
  ('cashier',        'Cashier',   10),
  ('driver',         'Driver',    11)
on conflict (key) do update
  set name = excluded.name,
      rank = excluded.rank;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------
-- Read by has_permission(required_permission text, target_branch_id uuid).
-- Keys are dot-namespaced by domain. See docs/ROLES-AND-PERMISSIONS.md section 4.

insert into public.permissions (key, name, description) values
  ('branch.manage',            'Manage branch configuration',                      'Modify branch configuration'),
  ('branch.view',              'View branch configuration',                        'View branch configuration'),
  ('customers.create',         'Create customers',                                 'Create registered customer records'),
  ('customers.update',         'Update customers',                                 'Edit registered customer records'),
  ('customers.delete',         'Soft-delete customers',                            'Soft-delete customer records'),
  ('financial.audit.confirm',  'Confirm daily financial audit',                    'Confirm/reconcile a daily financial audit'),
  ('financial.audit.submit',   'Submit daily financial audit',                     'Submit an end-of-day financial audit'),
  ('financial.expense.create', 'Create expenses',                                  'Record branch expenses'),
  ('financial.expense.update', 'Update expenses',                                  'Modify expenses where policy permits'),
  ('financial.expense.delete', 'Soft-delete expenses',                             'Soft-delete expense records'),
  ('financial.view',           'View financial data',                              'View financial records and reports'),
  ('pricing.manage',           'Manage pricing',                                   'Create/update approved pricing'),
  ('products.manage',          'Manage products',                                  'Create/update product catalog data'),
  ('records.permanent_delete', 'Permanently delete eligible non-financial records', 'Irreversibly delete records only after destructive confirmation and authorization'),
  ('reports.view',             'View reports',                                     'View operational and financial reports'),
  ('staff.manage',             'Manage staff',                                     'Create/update/deactivate staff assignments and roles'),
  ('staff.view',               'View staff',                                       'View branch staff and assignments'),
  ('sync.submit',              'Submit offline sync operations',                   'Submit offline mutations for server validation'),
  ('sync.view',                'View synchronization status',                      'View own/device synchronization status'),
  ('tickets.archive',          'Archive tickets',                                  'Hide a submitted ticket from normal operational views without deleting its history'),
  ('tickets.cancel',           'Cancel tickets',                                   'Cancel tickets where policy permits'),
  ('tickets.correct',          'Create ticket corrections',                        'Create a correction referencing an existing ticket'),
  ('tickets.create',           'Create tickets',                                   'Create new tickets through permitted channels'),
  ('tickets.update',           'Update tickets',                                   'Modify tickets after creation where policy permits'),
  ('tickets.view',             'View tickets',                                     'View tickets within permitted branch scope')
on conflict (key) do update
  set name        = excluded.name,
      description = excluded.description;

-- ---------------------------------------------------------------------------
-- Role -> permission grants
-- ---------------------------------------------------------------------------
-- Resolved by key so this file never hard-codes a UUID.
--
-- Three properties of this matrix are surprising and are reproduced faithfully
-- rather than "corrected" here, because production is the source of truth.
-- If any is a bug, fix it in a migration and update this file in the same commit:
--
--   1. owner does NOT get records.permanent_delete or tickets.archive; admin and
--      branch_manager do. Owner is rank 1 but is not a superset.
--   2. admin and branch_manager have identical permission sets. They differ only
--      through branch scoping in has_branch_access(), not through permissions.
--   3. driver holds tickets.create and tickets.correct (walk-in ticket capture).
--
-- Four permissions are granted to NO role: tickets.update, tickets.cancel,
-- sync.submit, sync.view. has_permission() therefore denies these to everyone.
-- This is carried over from production as-is and is flagged as an open question
-- in docs/PROJECT-OVERVIEW.md section 7.

with grants (role_key, permission_key) as (
  select r.role_key, p.permission_key
  from (values
    -- owner (19)
    ('owner', array[
      'branch.manage','branch.view',
      'customers.create','customers.update','customers.delete',
      'financial.audit.confirm','financial.audit.submit',
      'financial.expense.create','financial.expense.update','financial.expense.delete',
      'financial.view','pricing.manage','products.manage','reports.view',
      'staff.manage','staff.view',
      'tickets.correct','tickets.create','tickets.view']),

    -- admin (21) = owner + records.permanent_delete + tickets.archive
    ('admin', array[
      'branch.manage','branch.view',
      'customers.create','customers.update','customers.delete',
      'financial.audit.confirm','financial.audit.submit',
      'financial.expense.create','financial.expense.update','financial.expense.delete',
      'financial.view','pricing.manage','products.manage',
      'records.permanent_delete','reports.view',
      'staff.manage','staff.view',
      'tickets.archive','tickets.correct','tickets.create','tickets.view']),

    -- branch_manager (21) — identical to admin
    ('branch_manager', array[
      'branch.manage','branch.view',
      'customers.create','customers.update','customers.delete',
      'financial.audit.confirm','financial.audit.submit',
      'financial.expense.create','financial.expense.update','financial.expense.delete',
      'financial.view','pricing.manage','products.manage',
      'records.permanent_delete','reports.view',
      'staff.manage','staff.view',
      'tickets.archive','tickets.correct','tickets.create','tickets.view']),

    -- supervisor (12)
    ('supervisor', array[
      'branch.view',
      'customers.create','customers.update',
      'financial.audit.submit',
      'financial.expense.create','financial.expense.update',
      'financial.view','reports.view','staff.view',
      'tickets.correct','tickets.create','tickets.view']),

    -- accountant (7) — role exists architecturally, disabled for MVP 1
    ('accountant', array[
      'financial.audit.confirm','financial.audit.submit',
      'financial.expense.create','financial.expense.update','financial.expense.delete',
      'financial.view','reports.view']),

    -- cashier (7)
    ('cashier', array[
      'customers.create','customers.update',
      'financial.audit.submit','financial.view','reports.view',
      'tickets.create','tickets.view']),

    -- baker (1)
    ('baker', array['tickets.view']),

    -- driver (5)
    ('driver', array[
      'customers.create','customers.update',
      'tickets.correct','tickets.create','tickets.view'])
  ) as r(role_key, permission_keys)
  cross join lateral unnest(r.permission_keys) as p(permission_key)
)
insert into public.role_permissions (role_id, permission_id)
select ro.id, pe.id
from grants g
join public.roles ro       on ro.key = g.role_key
join public.permissions pe on pe.key = g.permission_key
on conflict (role_id, permission_id) do nothing;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- Expected: 8 roles, 25 permissions, 93 grants.

do $$
declare
  v_roles int;
  v_perms int;
  v_grants int;
begin
  select count(*) into v_roles  from public.roles;
  select count(*) into v_perms  from public.permissions;
  select count(*) into v_grants from public.role_permissions;

  if v_roles <> 8 or v_perms <> 25 or v_grants <> 93 then
    raise warning 'Seed counts differ from production: roles=% (expected 8), permissions=% (expected 25), grants=% (expected 93)',
      v_roles, v_perms, v_grants;
  else
    raise notice 'Seed OK: 8 roles, 25 permissions, 93 grants.';
  end if;
end $$;
