# BakeFlow — RLS Policy Patterns

**Status:** canonical. Every table's Row-Level Security policies derive from the patterns here. Getting these wrong is a security defect, not a style issue — one missing policy leaks another bakery's revenue.

---

## 1. Ground rules

1. **RLS is enabled on every table in `public`.** No exceptions. A table without RLS is readable by every authenticated user of every organization.
2. **`FORCE ROW LEVEL SECURITY`** on every table, so the table owner is not exempt.
3. **Deny by default.** With RLS enabled and no policy, nothing is visible. Policies grant, never restrict.
4. **Separate policies per command.** Write distinct `SELECT`, `INSERT`, `UPDATE`, `DELETE` policies. Never use `FOR ALL` — it hides which commands are actually intended, and it silently grants DELETE on tables that should never permit one.
5. **Omitting a policy is how you forbid a command.** Append-only tables (`stock_movements`, `payments`, `audit_log`, `refunds`) get `SELECT` and `INSERT` policies and nothing else.
6. **RLS is the enforcement layer, not the value source.** The application sets `tenant_id` explicitly on insert; the `WITH CHECK` clause verifies it matches the caller. Never rely on a JWT-derived column default.

---

## 2. Helper functions

Define these once. They keep policies readable and make claim-shape changes a one-file edit.

```sql
create or replace function public.current_tenant_id()
returns uuid
language sql stable
as $$
  select nullif(auth.jwt() ->> 'tenant_id', '')::uuid
$$;

create or replace function public.has_role(role_keys text[])
returns boolean
language sql stable
as $$
  select coalesce(
    (auth.jwt() -> 'roles') ?| role_keys,
    false
  )
$$;

create or replace function public.has_branch_access(target_branch_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select
    public.has_role(array['owner','admin'])
    or exists (
      select 1 from branch_assignments ba
      where ba.profile_id = auth.uid()
        and ba.branch_id  = target_branch_id
        and ba.tenant_id  = public.current_tenant_id()
    )
$$;
```

`public.has_branch_access` is `SECURITY DEFINER` deliberately — it reads `branch_assignments`, and a policy on that table would otherwise recurse. Owners and admins bypass branch scoping by design; every other role sees only assigned branches.

> **Schema qualification matters.** These helpers live in **`public`**, not `auth`. An earlier revision of this document wrote them as `auth.current_tenant_id()` etc. throughout; a policy copied from that text fails at creation with *"function auth.current_tenant_id() does not exist"*. Always write `public.`.

There is a fourth deployed helper this document previously omitted:

```sql
-- public.has_permission(required_permission text, target_branch_id uuid) returns boolean
-- Joins user_roles -> role_permissions -> permissions, honours branch_assignments,
-- and bypasses for owner/admin. Prefer it over hard-coded role arrays where a
-- permission key exists (see ROLES-AND-PERMISSIONS.md section 4).
```

**Stability requirement:** all four functions are `STABLE`, so Postgres evaluates them once per statement rather than per row. Marking them `VOLATILE` will make large list queries slow enough to notice.

---

## 3. Pattern A — tenant-scoped table

The default. Applies to `product_categories`, `products`, `product_variants`, `ingredients`, `recipes`, `recipe_ingredients`, `customers`.

```sql
alter table products enable row level security;
alter table products force row level security;

create policy products_select on products
  for select using (tenant_id = public.current_tenant_id());

create policy products_insert on products
  for insert with check (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['owner','admin','branch_manager'])
  );

create policy products_update on products
  for update
  using (tenant_id = public.current_tenant_id()
         and public.has_role(array['owner','admin','branch_manager']))
  with check (tenant_id = public.current_tenant_id());

create policy products_delete on products
  for delete using (
    tenant_id = public.current_tenant_id()
    and public.has_role(array['owner','admin'])
  );
```

Note the `UPDATE` policy carries both `USING` and `WITH CHECK`. `USING` decides which rows may be updated; `WITH CHECK` validates the *new* values. Without `WITH CHECK`, a user could update a row and reassign its `tenant_id` to another organization — moving data out of their own tenant. This is the single most common RLS mistake; every `UPDATE` policy in this codebase must have both.

---

## 4. Pattern B — branch-scoped table

Adds branch access on top of tenant isolation. Applies to `tickets`, `ticket_items`, `warehouses`, `stock_movements`, `production_batches`, `production_batch_ingredients`, `deliveries`, `cash_sessions`, `expenses`, `invoices`, `payments`, `refunds`, `daily_financial_audits`, `sync_devices`, `sync_changes`, `sync_operations`.

Child tables that carry no `branch_id` of their own (`ticket_items`, `production_batch_ingredients`) scope through their parent with an `EXISTS` subquery against the parent's `branch_id`, rather than repeating the column.

```sql
create policy tickets_select on tickets
  for select using (
    tenant_id = public.current_tenant_id()
    and public.has_branch_access(branch_id)
  );

create policy tickets_insert on tickets
  for insert with check (
    tenant_id = public.current_tenant_id()
    and public.has_branch_access(branch_id)
    and public.has_permission('tickets.create', branch_id)
  );

create policy tickets_update on tickets
  for update
  using (tenant_id = public.current_tenant_id()
         and public.has_branch_access(branch_id))
  with check (tenant_id = public.current_tenant_id()
              and public.has_branch_access(branch_id));
```

No `DELETE` policy — tickets are cancelled or archived, never deleted.

**Prefer `has_permission(key, branch_id)` over `has_role(array[...])`** where a matching permission key exists. The permission catalog is live (`ROLES-AND-PERMISSIONS.md` §4), and a hard-coded role array silently diverges from it. Keep `has_role()` for checks with no corresponding key — currently anything production-, inventory-, or delivery-related.

For child tables like `ticket_items` where `branch_id` is not a column, scope through the parent:

```sql
create policy ticket_items_select on ticket_items
  for select using (
    tenant_id = public.current_tenant_id()
    and exists (
      select 1 from tickets t
      where t.id = ticket_items.ticket_id
        and public.has_branch_access(t.branch_id)
    )
  );
```

`production_batch_ingredients` takes the same shape against `production_batches`.

---

## 5. Pattern C — append-only table

`stock_movements`, `payments`, `refunds`, `audit_log`. `SELECT` and `INSERT` only. The absence of `UPDATE` and `DELETE` policies *is* the immutability guarantee at the RLS layer; a trigger enforces it again for service-role callers that bypass RLS.

```sql
create policy stock_movements_select on stock_movements
  for select using (
    tenant_id = public.current_tenant_id()
    and public.has_branch_access(branch_id)
  );

create policy stock_movements_insert on stock_movements
  for insert with check (
    tenant_id = public.current_tenant_id()
    and public.has_branch_access(branch_id)
    and public.has_role(array['owner','admin','branch_manager','baker','cashier'])
  );

create or replace function prevent_stock_movement_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'stock_movements is append-only; record a correcting adjustment instead';
end $$;

create trigger stock_movements_immutable
  before update or delete on stock_movements
  for each row execute function prevent_stock_movement_mutation();
```

---

## 6. Pattern D — derived tables

`ingredient_stock_levels` and `product_stock_levels` are caches written only by `apply_stock_movement()`. Users get `SELECT` only; the trigger function is `SECURITY DEFINER` and writes past RLS.

```sql
create policy ingredient_stock_levels_select on ingredient_stock_levels
  for select using (
    tenant_id = public.current_tenant_id()
    and public.has_branch_access(branch_id)
  );
```

No insert, update, or delete policy for anyone. If a screen needs to change stock, it inserts a movement.

---

## 7. Pattern E — self-scoped rows

`profiles`, `user_roles`, `branch_assignments`. A user reads their own row plus, if privileged, their organization's.

```sql
create policy profiles_select on profiles
  for select using (
    id = auth.uid()
    or (tenant_id = public.current_tenant_id()
        and public.has_role(array['owner','admin','branch_manager']))
  );

create policy profiles_update on profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid() and tenant_id = public.current_tenant_id());
```

The `WITH CHECK` prevents a user editing their own profile from moving themselves into another tenant. Role assignment is never self-service — `user_roles` has no policy permitting a user to insert their own row; that path runs through an invite accepted via a `SECURITY DEFINER` RPC.

---

## 8. Special cases

**`organizations`** is not tenant-scoped — it *is* the tenant. Select where `id = public.current_tenant_id()`. Insert is permitted for any authenticated user whose `profiles.tenant_id` is still null (creating their first organization), then the RPC sets their tenant and owner role atomically.

**`branches`** is tenant-scoped but cannot use Pattern B, because it is the table `has_branch_access()` arbitrates over — scoping it by `has_branch_access(id)` would hide from a user the very branches they are assigned to, and risks recursion. Use Pattern A on `tenant_id` alone for `SELECT`, so every member of the organization can see the branch list, and gate writes on the `branch.manage` permission. Read paths that must respect assignment filter in the query, not the policy.

**`roles`**, **`permissions`**, **`role_permissions`** are platform reference data. `SELECT` for all authenticated users (filtered `deleted_at IS NULL`); no write policies at all — seeded by migration. `authenticated` must not hold INSERT/UPDATE/DELETE grants on them either, since a missing policy alone would not stop a table-level grant.

**`organization_invites`** needs a lookup by token for an unauthenticated recipient. Do not solve this with a permissive policy. The accept path is a `SECURITY DEFINER` RPC taking the raw token, hashing it, and matching on `token_hash`. The table itself is readable only by owners and admins of the issuing tenant — and **`token_hash` must be withheld at the column level**, since a table-level `SELECT` grant otherwise exposes the hash to any tenant member who can read the row.

**`permanent_deletion_challenges`** follows the same rule for `confirmation_phrase_hash`. See `SCHEMA-REFERENCE.md` §11.

**`document_sequences`** is written only by `next_document_number()`. Clients get no INSERT or UPDATE grant; a client able to move a sequence backwards would produce duplicate ticket and invoice numbers.

---

## 9. JWT custom claims

Policies depend on `tenant_id` and `roles` being present in the access token. Populate them with a Supabase custom access token hook:

```sql
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable
security definer set search_path = public
as $$
declare
  claims    jsonb := event -> 'claims';
  v_tenant  uuid;
  v_roles   text[];
begin
  select p.tenant_id into v_tenant
  from profiles p where p.id = (event ->> 'user_id')::uuid;

  select coalesce(array_agg(r.key), '{}')
  into v_roles
  from user_roles ur join roles r on r.id = ur.role_id
  where ur.profile_id = (event ->> 'user_id')::uuid
    and ur.tenant_id = v_tenant;

  claims := jsonb_set(claims, '{tenant_id}', to_jsonb(v_tenant));
  claims := jsonb_set(claims, '{roles}',     to_jsonb(v_roles));

  return jsonb_set(event, '{claims}', claims);
end $$;
```

**Claims are stale until the token refreshes.** A newly granted role does not take effect until the access token is reissued. Any RPC that changes roles or tenancy must return a signal that makes the client refresh its session immediately. Do not treat the JWT as live authorization state.

---

## 10. Service role

The service role bypasses RLS entirely. Therefore:

- The service key never reaches the mobile app. It lives only in server-side Edge Functions and migrations.
- Any Edge Function using it re-implements tenant scoping in application code. RLS is not protecting you there.
- Seed and migration scripts run as service role, which is precisely why `tenant_id` must never default from a JWT — there is no JWT in that context.

---

## 11. Verification

Every phase ships with an isolation test before it is considered complete. The shape:

1. Create tenant A with user A, tenant B with user B.
2. Insert rows into every new table for both tenants.
3. As user A, `SELECT` each table — assert only tenant A rows return.
4. As user A, attempt `UPDATE` of a tenant B row — assert zero rows affected.
5. As user A, attempt `INSERT` with `tenant_id` set to B — assert the `WITH CHECK` rejects it.
6. As user A, attempt `UPDATE` of their own row setting `tenant_id` to B — assert rejection. (This catches the missing-`WITH CHECK` bug specifically.)
7. For branch-scoped tables, add a user assigned to branch 1 only and assert branch 2 rows are invisible.
8. For append-only tables, attempt `UPDATE` and `DELETE` — assert both fail.

A phase that has not passed all eight is not done, regardless of whether the screens work.
