-- 20260809190200_fix_offline_sync_tenancy
--
-- Migration 20260809163758 (offline sync + audit architecture) introduced four tables
-- that do not follow the tenancy model the other 30 tables observe:
--
--   * they name the tenant column `organization_id`, which Core Rule 2 forbids;
--   * their policies scope by auth.uid() alone, with no tenant_id predicate at all,
--     so a signed-in user of Bakery A could write a daily_financial_audits row bearing
--     Bakery B's organization_id and branch_id;
--   * daily_financial_audits stores money as NUMERIC(14,2), which Core Rule 5 forbids;
--   * daily_financial_audits carries no triggers at all — the cashier who submits a
--     cash count can afterwards rewrite physical_cash and variance, set status to
--     CONFIRMED and name themselves in confirmed_by. That is the exact control failure
--     a daily cash audit exists to prevent.
--
-- Safe to run: all four tables are empty.

-- ---------------------------------------------------------------------------
-- 1. Canonical tenant column name (Core Rule 2).
-- ---------------------------------------------------------------------------
alter table public.daily_financial_audits rename column organization_id to tenant_id;
alter table public.sync_devices           rename column organization_id to tenant_id;
alter table public.sync_changes           rename column organization_id to tenant_id;
alter table public.sync_operations        rename column organization_id to tenant_id;

alter table public.daily_financial_audits
  rename constraint daily_financial_audits_organization_id_branch_id_audit_date_key
  to daily_financial_audits_tenant_id_branch_id_audit_date_key;

-- ---------------------------------------------------------------------------
-- 2. Money is NUMERIC(19,4) (Core Rule 5).
-- ---------------------------------------------------------------------------
alter table public.daily_financial_audits
  alter column opening_balance type numeric(19,4),
  alter column expected_cash   type numeric(19,4),
  alter column physical_cash   type numeric(19,4),
  alter column variance        type numeric(19,4);

-- variance is derived, not asserted: it must equal what was counted minus what was owed.
alter table public.daily_financial_audits
  add constraint daily_financial_audits_variance_consistent
  check (variance = physical_cash - expected_cash);

-- ---------------------------------------------------------------------------
-- 3. Tenant-scoped policies.
-- ---------------------------------------------------------------------------
drop policy if exists daily_financial_audits_select on public.daily_financial_audits;
drop policy if exists daily_financial_audits_insert on public.daily_financial_audits;
drop policy if exists daily_financial_audits_update on public.daily_financial_audits;

create policy daily_financial_audits_select on public.daily_financial_audits
  for select to authenticated
  using (
    tenant_id = current_tenant_id()
    and deleted_at is null
    and (
      submitted_by = auth.uid()
      or (has_branch_access(branch_id)
          and has_role(array['owner','admin','branch_manager','accountant']))
    )
  );

create policy daily_financial_audits_insert on public.daily_financial_audits
  for insert to authenticated
  with check (
    tenant_id = current_tenant_id()
    and has_branch_access(branch_id)
    and submitted_by = auth.uid()
    and has_role(array['owner','admin','branch_manager','cashier'])
  );

-- The submitter may correct their own count only while it is still open.
create policy daily_financial_audits_update_own_open on public.daily_financial_audits
  for update to authenticated
  using (
    tenant_id = current_tenant_id()
    and submitted_by = auth.uid()
    and status in ('DRAFT','PENDING_SYNC','REQUIRES_RECONCILIATION')
    and deleted_at is null
  )
  with check (tenant_id = current_tenant_id() and submitted_by = auth.uid());

-- A manager reviews it. The guard trigger below stops them reviewing their own.
create policy daily_financial_audits_update_review on public.daily_financial_audits
  for update to authenticated
  using (
    tenant_id = current_tenant_id()
    and has_branch_access(branch_id)
    and has_role(array['owner','admin','branch_manager'])
    and deleted_at is null
  )
  with check (tenant_id = current_tenant_id());

-- No DELETE policy: financial records are archived via deleted_at, never removed
-- (Core Rule 8).

drop policy if exists sync_devices_select on public.sync_devices;
drop policy if exists sync_devices_insert on public.sync_devices;
drop policy if exists sync_devices_update on public.sync_devices;

create policy sync_devices_select on public.sync_devices
  for select to authenticated
  using (tenant_id = current_tenant_id() and user_id = auth.uid());

create policy sync_devices_insert on public.sync_devices
  for insert to authenticated
  with check (
    tenant_id = current_tenant_id()
    and user_id = auth.uid()
    and (branch_id is null or has_branch_access(branch_id))
  );

create policy sync_devices_update on public.sync_devices
  for update to authenticated
  using (tenant_id = current_tenant_id() and user_id = auth.uid())
  with check (tenant_id = current_tenant_id() and user_id = auth.uid());

drop policy if exists sync_changes_select on public.sync_changes;

create policy sync_changes_select on public.sync_changes
  for select to authenticated
  using (
    tenant_id = current_tenant_id()
    and exists (
      select 1 from public.sync_devices d
      where d.user_id = auth.uid()
        and d.tenant_id = sync_changes.tenant_id
        and (d.branch_id is null or d.branch_id = sync_changes.branch_id)
        and d.revoked_at is null
    )
  );

drop policy if exists sync_operations_select on public.sync_operations;

create policy sync_operations_select on public.sync_operations
  for select to authenticated
  using (tenant_id = current_tenant_id() and actor_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Make the audit behave like the other financial tables.
-- ---------------------------------------------------------------------------
create or replace function public.guard_daily_financial_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'daily_financial_audits rows are never deleted; set deleted_at instead'
      using errcode = '42501';
  end if;

  -- What the audit is about is fixed when it is created.
  if new.tenant_id    is distinct from old.tenant_id
  or new.branch_id    is distinct from old.branch_id
  or new.audit_date   is distinct from old.audit_date
  or new.submitted_by is distinct from old.submitted_by then
    raise exception 'tenant_id, branch_id, audit_date and submitted_by are immutable on daily_financial_audits'
      using errcode = '42501';
  end if;

  -- A reviewed audit is closed for good.
  if old.status in ('CONFIRMED','REJECTED') then
    raise exception 'daily financial audit % is already % and can no longer be modified',
      old.id, old.status using errcode = '42501';
  end if;

  if new.status in ('CONFIRMED','REJECTED') then
    if not has_role(array['owner','admin','branch_manager']) then
      raise exception 'only an owner, admin or branch manager may confirm or reject a daily financial audit'
        using errcode = '42501';
    end if;

    -- Segregation of duties: whoever counted the cash does not get to sign it off.
    if coalesce(new.confirmed_by, auth.uid()) = new.submitted_by then
      raise exception 'the submitter of a daily financial audit may not confirm or reject it'
        using errcode = '42501';
    end if;

    new.confirmed_by := coalesce(new.confirmed_by, auth.uid());
    new.confirmed_at := coalesce(new.confirmed_at, now());
  end if;

  return new;
end;
$$;

revoke all on function public.guard_daily_financial_audit_mutation() from public;
grant execute on function public.guard_daily_financial_audit_mutation() to service_role;

drop trigger if exists daily_financial_audits_guard_mutation on public.daily_financial_audits;
create trigger daily_financial_audits_guard_mutation
  before update or delete on public.daily_financial_audits
  for each row execute function public.guard_daily_financial_audit_mutation();

-- updated_at is NOT NULL but nothing was maintaining it.
drop trigger if exists daily_financial_audits_set_updated_at on public.daily_financial_audits;
create trigger daily_financial_audits_set_updated_at
  before update on public.daily_financial_audits
  for each row execute function public.set_updated_at();

drop trigger if exists sync_devices_set_updated_at on public.sync_devices;
create trigger sync_devices_set_updated_at
  before update on public.sync_devices
  for each row execute function public.set_updated_at();

comment on table public.daily_financial_audits is
  'End-of-day cash count per branch. The submitter may correct an open audit; only an '
  'owner, admin or branch manager other than the submitter may CONFIRM or REJECT it, '
  'after which the row is frozen.';
