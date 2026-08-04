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
create or replace function auth.current_tenant_id()
returns uuid
language sql stable
as $$
  select nullif(auth.jwt() ->> 'tenant_id', '')::uuid
$$;

create or replace function auth.has_role(role_keys text[])
returns boolean
language sql stable
as $$
  select coalesce(
    (auth.jwt() -> 'roles') ?| role_keys,
    false
  )
$$;

create or replace function auth.has_branch_access(target_branch_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select
    auth.has_role(array['owner','admin'])
    or exists (
      select 1 from branch_assignments ba
      where ba.profile_id = auth.uid()
        and ba.branch_id  = target_branch_id
        and ba.tenant_id  = auth.current_tenant_id()
    )
$$;
```

`auth.has_branch_access` is `SECURITY DEFINER` deliberately — it reads `branch_assignments`, and a policy on that table would otherwise recurse. Owners and admins bypass branch scoping by design; every other role sees only assigned branches.

**Stability requirement:** all three functions are `STABLE`, so Postgres evaluates them once per statement rather than per row. Marking them `VOLATILE` will make large list queries slow enough to notice.

---

## 3. Pattern A — tenant-scoped table

The default. Applies to `product_categories`, `products`, `product_variants`, `ingredients`, `recipes`, `recipe_ingredients`, `customers`.

```sql
alter table products enable row level security;
alter table products force row level security;

create policy products_select on products
  for select using (tenant_id = auth.current_tenant_id());

create policy products_insert on products
  for insert with check (
    tenant_id = auth.current_tenant_id()
    and auth.has_role(array['owner','admin','branch_manager'])
  );

create policy products_update on products
  for update
  using (tenant_id = auth.current_tenant_id()
         and auth.has_role(array['owner','admin','branch_manager']))
  with check (tenant_id = auth.current_tenant_id());

create policy products_delete on products
  for delete using (
    tenant_id = auth.current_tenant_id()
    and auth.has_role(array['owner','admin'])
  );
```

Note the `UPDATE` policy carries both `USING` and `WITH CHECK`. `USING` decides which rows may be updated; `WITH CHECK` validates the *new* values. Without `WITH CHECK`, a user could update a row and reassign its `tenant_id` to another organization — moving data out of their own tenant. This is the single most common RLS mistake; every `UPDATE` policy in this codebase must have both.

---

## 4. Pattern B — branch-scoped table

Adds branch access on top of tenant isolation. Applies to `orders`, `order_items`, `warehouses`, `stock_movements`, `production_batches`, `deliveries`, `cash_sessions`, `expenses`, `invoices`, `payments`.

```sql
create policy orders_select on orders
  for select using (
    tenant_id = auth.current_tenant_id()
    and auth.has_branch_access(branch_id)
  );

create policy orders_insert on orders
  for insert with check (
    tenant_id = auth.current_tenant_id()
    and auth.has_branch_access(branch_id)
    and auth.has_role(array['owner','admin','branch_manager','cashier'])
  );

create policy orders_update on orders
  for update
  using (tenant_id = auth.current_tenant_id()
         and auth.has_branch_access(branch_id))
  with check (tenant_id = auth.current_tenant_id()
              and auth.has_branch_access(branch_id));
```

No `DELETE` policy — orders are cancelled, never deleted.

For child tables like `order_items` where `branch_id` is not a column, scope through the parent:

```sql
create policy order_items_select on order_items
  for select using (
    tenant_id = auth.current_tenant_id()
    and exists (
      select 1 from orders o
      where o.id = order_items.order_id
        and auth.has_branch_access(o.branch_id)
    )
  );
```

---

## 5. Pattern C — append-only table

`stock_movements`, `payments`, `refunds`, `audit_log`. `SELECT` and `INSERT` only. The absence of `UPDATE` and `DELETE` policies *is* the immutability guarantee at the RLS layer; a trigger enforces it again for service-role callers that bypass RLS.

```sql
create policy stock_movements_select on stock_movements
  for select using (
    tenant_id = auth.current_tenant_id()
    and auth.has_branch_access(branch_id)
  );

create policy stock_movements_insert on stock_movements
  for insert with check (
    tenant_id = auth.current_tenant_id()
    and auth.has_branch_access(branch_id)
    and auth.has_role(array['owner','admin','branch_manager','baker','cashier'])
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
    tenant_id = auth.current_tenant_id()
    and auth.has_branch_access(branch_id)
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
    or (tenant_id = auth.current_tenant_id()
        and auth.has_role(array['owner','admin','branch_manager']))
  );

create policy profiles_update on profiles
  for update
  using (id = auth.uid())
  with check (id = auth.uid() and tenant_id = auth.current_tenant_id());
```

The `WITH CHECK` prevents a user editing their own profile from moving themselves into another tenant. Role assignment is never self-service — `user_roles` has no policy permitting a user to insert their own row; that path runs through an invite accepted via a `SECURITY DEFINER` RPC.

---

## 8. Special cases

**`organizations`** is not tenant-scoped — it *is* the tenant. Select where `id = auth.current_tenant_id()`. Insert is permitted for any authenticated user whose `profiles.tenant_id` is still null (creating their first organization), then the RPC sets their tenant and owner role atomically.

**`roles`** is platform reference data. `SELECT` for all authenticated users; no write policies at all — seeded by migration.

**`organization_invites`** needs a lookup by token for an unauthenticated recipient. Do not solve this with a permissive policy. The accept path is a `SECURITY DEFINER` RPC taking the raw token, hashing it, and matching on `token_hash`. The table itself is readable only by owners and admins of the issuing tenant.

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
