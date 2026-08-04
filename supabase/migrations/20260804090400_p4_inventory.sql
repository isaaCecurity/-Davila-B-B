-- =============================================================================
-- BakeFlow — Phase 4: Warehouses, Stock Ledger, Derived Stock Levels
-- =============================================================================
-- Creates: warehouses, stock_movements, ingredient_stock_levels,
--          product_stock_levels
-- Plus:    apply_stock_movement(), prevent_stock_movement_mutation(),
--          adjust_stock() RPC, verify_stock_reconciliation()
--
-- Conforms to: docs/SCHEMA-REFERENCE.md §3 §9, docs/RLS-POLICY-PATTERNS.md
--              §4 §5 §6, docs/API-CONTRACT.md §2, docs/TESTING-STRATEGY.md §5.
--
-- CLAUDE.md rule 7: stock levels are never updated directly. Every change is an
-- insert into the immutable stock_movements ledger; the level tables are a
-- cache maintained by trigger and must be reconstructible from the ledger alone.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. warehouses
-- -----------------------------------------------------------------------------
create table public.warehouses (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.organizations(id) on delete restrict,
  branch_id  uuid not null,
  name       text not null check (length(btrim(name)) > 0),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,

  constraint warehouses_tenant_branch_name_key unique (tenant_id, branch_id, name),
  constraint warehouses_tenant_id_key          unique (tenant_id, id),
  -- Lets children assert "this warehouse is in this branch" structurally.
  constraint warehouses_tenant_branch_id_key   unique (tenant_id, branch_id, id),
  constraint warehouses_branch_fkey
    foreign key (tenant_id, branch_id)
    references public.branches(tenant_id, id) on delete restrict
);

create unique index warehouses_one_default_per_branch
  on public.warehouses (tenant_id, branch_id) where is_default;

create index idx_warehouses_tenant on public.warehouses (tenant_id);
create index idx_warehouses_branch on public.warehouses (branch_id);
create index idx_warehouses_created_by on public.warehouses (created_by);


-- -----------------------------------------------------------------------------
-- 2. stock_movements — the source of truth for all stock. Append-only.
-- -----------------------------------------------------------------------------
create table public.stock_movements (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.organizations(id) on delete restrict,
  branch_id          uuid not null,
  warehouse_id       uuid not null,
  item_type          text not null check (item_type in ('ingredient', 'product')),
  ingredient_id      uuid,
  product_variant_id uuid,
  quantity_delta     numeric(18,4) not null check (quantity_delta <> 0),
  reason             text not null check (reason in (
                       'purchase', 'production_consume', 'production_output',
                       'sale', 'waste', 'adjustment', 'transfer_in',
                       'transfer_out', 'opening_balance')),
  reference_type     text check (reference_type in ('order', 'production_batch',
                                                    'purchase', 'delivery', 'manual')),
  reference_id       uuid,
  unit_cost          numeric(19,4) check (unit_cost >= 0),
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.profiles(id) on delete set null,

  -- Exactly one of ingredient_id / product_variant_id, matching item_type.
  constraint stock_movements_item_consistent check (
    (item_type = 'ingredient'
       and ingredient_id is not null and product_variant_id is null)
    or
    (item_type = 'product'
       and product_variant_id is not null and ingredient_id is null)
  ),

  -- The sign of a movement is a property of its reason, not the caller's
  -- choice. Only 'adjustment' may go either way.
  constraint stock_movements_sign_matches_reason check (
    case reason
      when 'purchase'           then quantity_delta > 0
      when 'production_output'  then quantity_delta > 0
      when 'transfer_in'        then quantity_delta > 0
      when 'opening_balance'    then quantity_delta > 0
      when 'production_consume' then quantity_delta < 0
      when 'sale'               then quantity_delta < 0
      when 'waste'              then quantity_delta < 0
      when 'transfer_out'       then quantity_delta < 0
      else true  -- adjustment
    end
  ),

  constraint stock_movements_reference_consistent check (
    (reference_type is null) = (reference_id is null)
  ),

  -- Composite FKs: the warehouse must be in the stated branch of the stated
  -- tenant, and the item must belong to the same tenant.
  constraint stock_movements_warehouse_fkey
    foreign key (tenant_id, branch_id, warehouse_id)
    references public.warehouses(tenant_id, branch_id, id) on delete restrict,
  constraint stock_movements_ingredient_fkey
    foreign key (tenant_id, ingredient_id)
    references public.ingredients(tenant_id, id) on delete restrict,
  constraint stock_movements_variant_fkey
    foreign key (tenant_id, product_variant_id)
    references public.product_variants(tenant_id, id) on delete restrict
);

create index idx_stock_movements_tenant     on public.stock_movements (tenant_id);
create index idx_stock_movements_branch     on public.stock_movements (branch_id);
create index idx_stock_movements_warehouse  on public.stock_movements (warehouse_id);
create index idx_stock_movements_ingredient on public.stock_movements (ingredient_id);
create index idx_stock_movements_variant    on public.stock_movements (product_variant_id);
create index idx_stock_movements_created_by on public.stock_movements (created_by);
create index idx_stock_movements_reference  on public.stock_movements (reference_type, reference_id);
-- Ledger reads are almost always "this warehouse, most recent first".
create index idx_stock_movements_ledger
  on public.stock_movements (tenant_id, warehouse_id, created_at desc);

comment on table public.stock_movements is
  'Immutable append-only ledger. No UPDATE or DELETE is ever permitted. Corrections are new movements with reason = ''adjustment''.';


-- -----------------------------------------------------------------------------
-- 3. Derived level tables — written ONLY by apply_stock_movement()
-- -----------------------------------------------------------------------------
create table public.ingredient_stock_levels (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.organizations(id) on delete restrict,
  branch_id        uuid not null,
  warehouse_id     uuid not null,
  ingredient_id    uuid not null,
  quantity_on_hand numeric(18,4) not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint ingredient_stock_levels_warehouse_item_key unique (warehouse_id, ingredient_id),
  constraint ingredient_stock_levels_warehouse_fkey
    foreign key (tenant_id, branch_id, warehouse_id)
    references public.warehouses(tenant_id, branch_id, id) on delete restrict,
  constraint ingredient_stock_levels_ingredient_fkey
    foreign key (tenant_id, ingredient_id)
    references public.ingredients(tenant_id, id) on delete restrict
);

create index idx_ingredient_stock_levels_tenant on public.ingredient_stock_levels (tenant_id);
create index idx_ingredient_stock_levels_branch on public.ingredient_stock_levels (branch_id);
create index idx_ingredient_stock_levels_ingredient on public.ingredient_stock_levels (ingredient_id);
create index idx_ingredient_stock_levels_warehouse on public.ingredient_stock_levels (warehouse_id);

create table public.product_stock_levels (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.organizations(id) on delete restrict,
  branch_id          uuid not null,
  warehouse_id       uuid not null,
  product_variant_id uuid not null,
  quantity_on_hand   numeric(18,4) not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint product_stock_levels_warehouse_item_key unique (warehouse_id, product_variant_id),
  constraint product_stock_levels_warehouse_fkey
    foreign key (tenant_id, branch_id, warehouse_id)
    references public.warehouses(tenant_id, branch_id, id) on delete restrict,
  constraint product_stock_levels_variant_fkey
    foreign key (tenant_id, product_variant_id)
    references public.product_variants(tenant_id, id) on delete restrict
);

create index idx_product_stock_levels_tenant on public.product_stock_levels (tenant_id);
create index idx_product_stock_levels_branch on public.product_stock_levels (branch_id);
create index idx_product_stock_levels_variant on public.product_stock_levels (product_variant_id);
create index idx_product_stock_levels_warehouse on public.product_stock_levels (warehouse_id);

comment on table public.ingredient_stock_levels is
  'Derived cache of stock_movements. Reconstructible from the ledger alone — see verify_stock_reconciliation().';


-- -----------------------------------------------------------------------------
-- 4. apply_stock_movement — the only writer of the level tables
-- -----------------------------------------------------------------------------
create or replace function public.apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_qty      numeric(18,4);
  v_allow_neg    boolean;
  v_item_name    text;
  v_unit         text;
begin
  if new.item_type = 'ingredient' then
    -- ON CONFLICT takes a row lock, so concurrent movements for the same key
    -- serialise and the final level equals the sum of deltas.
    insert into public.ingredient_stock_levels
      (tenant_id, branch_id, warehouse_id, ingredient_id, quantity_on_hand)
    values
      (new.tenant_id, new.branch_id, new.warehouse_id, new.ingredient_id, new.quantity_delta)
    on conflict (warehouse_id, ingredient_id) do update
      set quantity_on_hand = public.ingredient_stock_levels.quantity_on_hand + excluded.quantity_on_hand,
          updated_at       = now()
    returning quantity_on_hand into v_new_qty;
  else
    insert into public.product_stock_levels
      (tenant_id, branch_id, warehouse_id, product_variant_id, quantity_on_hand)
    values
      (new.tenant_id, new.branch_id, new.warehouse_id, new.product_variant_id, new.quantity_delta)
    on conflict (warehouse_id, product_variant_id) do update
      set quantity_on_hand = public.product_stock_levels.quantity_on_hand + excluded.quantity_on_hand,
          updated_at       = now()
    returning quantity_on_hand into v_new_qty;
  end if;

  if v_new_qty < 0 then
    -- Consumption and sales may NEVER drive stock negative, whatever the
    -- tenant setting. STATE-MACHINES.md §2: do not "allow it and reconcile
    -- later" — that breaks Core Principle 3.
    if new.reason in ('production_consume', 'sale') then
      if new.item_type = 'ingredient' then
        select i.name, i.unit_of_measure into v_item_name, v_unit
        from public.ingredients i where i.id = new.ingredient_id;
      else
        select v.name, 'unit' into v_item_name, v_unit
        from public.product_variants v where v.id = new.product_variant_id;
      end if;

      raise exception 'insufficient_stock: % short by % %',
        v_item_name, abs(v_new_qty), v_unit
        using errcode = 'P0001',
              detail  = json_build_object(
                'code',        'insufficient_stock',
                'item_type',   new.item_type,
                'item_id',     coalesce(new.ingredient_id, new.product_variant_id),
                'item_name',   v_item_name,
                'unit',        v_unit,
                'shortfall',   abs(v_new_qty)
              )::text;
    end if;

    -- Waste and adjustments may go negative only where the tenant has opted in.
    select o.allow_negative_stock into v_allow_neg
    from public.organizations o where o.id = new.tenant_id;

    if not coalesce(v_allow_neg, false) then
      raise exception 'insufficient_stock: movement would leave % on hand', v_new_qty
        using errcode = 'P0001',
              detail  = json_build_object(
                'code',      'insufficient_stock',
                'item_type', new.item_type,
                'item_id',   coalesce(new.ingredient_id, new.product_variant_id),
                'shortfall', abs(v_new_qty)
              )::text;
    end if;
  end if;

  -- Keep ingredient costing current from purchases.
  if new.reason = 'purchase' and new.unit_cost is not null and new.item_type = 'ingredient' then
    update public.ingredients
       set last_unit_cost = new.unit_cost
     where id = new.ingredient_id;
  end if;

  return null;  -- AFTER trigger; return value is ignored.
end $$;

comment on function public.apply_stock_movement() is
  'AFTER INSERT on stock_movements. The only writer of the stock level tables. Raises insufficient_stock rather than allowing a negative level.';

create trigger stock_movements_apply
  after insert on public.stock_movements
  for each row execute function public.apply_stock_movement();


-- -----------------------------------------------------------------------------
-- 5. Immutability — RLS-POLICY-PATTERNS.md §5
-- -----------------------------------------------------------------------------
-- RLS forbids UPDATE/DELETE by omitting the policies; this trigger enforces it
-- again for service-role callers, which bypass RLS entirely.
create or replace function public.prevent_stock_movement_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'stock_movements is append-only; record a correcting adjustment instead'
    using errcode = 'P0001',
          detail = json_build_object('code', 'immutable_table', 'table', 'stock_movements')::text;
end $$;

create trigger stock_movements_immutable
  before update or delete on public.stock_movements
  for each row execute function public.prevent_stock_movement_mutation();


-- -----------------------------------------------------------------------------
-- 6. updated_at triggers
-- -----------------------------------------------------------------------------
create trigger warehouses_set_updated_at
  before update on public.warehouses
  for each row execute function public.set_updated_at();

-- Deliberately none on stock_movements: it can never be updated.
-- Deliberately none on the level tables: apply_stock_movement() sets updated_at
-- itself, and nothing else may write them.


-- -----------------------------------------------------------------------------
-- 7. Row-Level Security
-- -----------------------------------------------------------------------------
alter table public.warehouses              enable row level security;
alter table public.warehouses              force  row level security;
alter table public.stock_movements         enable row level security;
alter table public.stock_movements         force  row level security;
alter table public.ingredient_stock_levels enable row level security;
alter table public.ingredient_stock_levels force  row level security;
alter table public.product_stock_levels    enable row level security;
alter table public.product_stock_levels    force  row level security;

-- --- warehouses (Pattern B — branch-scoped) ----------------------------------
create policy warehouses_select on public.warehouses
  for select to authenticated
  using (tenant_id = public.current_tenant_id()
         and public.has_branch_access(branch_id));

create policy warehouses_insert on public.warehouses
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id()
              and public.has_branch_access(branch_id)
              and public.has_role(array['owner', 'admin', 'branch_manager']));

create policy warehouses_update on public.warehouses
  for update to authenticated
  using (tenant_id = public.current_tenant_id()
         and public.has_branch_access(branch_id)
         and public.has_role(array['owner', 'admin', 'branch_manager']))
  with check (tenant_id = public.current_tenant_id()
              and public.has_branch_access(branch_id));

-- No DELETE policy: a warehouse holding ledger history is never removed.

-- --- stock_movements (Pattern C — append-only) -------------------------------
create policy stock_movements_select on public.stock_movements
  for select to authenticated
  using (tenant_id = public.current_tenant_id()
         and public.has_branch_access(branch_id));

create policy stock_movements_insert on public.stock_movements
  for insert to authenticated
  with check (tenant_id = public.current_tenant_id()
              and public.has_branch_access(branch_id)
              and public.has_role(array['owner', 'admin', 'branch_manager',
                                        'baker', 'cashier']));

-- No UPDATE or DELETE policy. The absence IS the immutability guarantee.

-- --- level tables (Pattern D — derived) --------------------------------------
create policy ingredient_stock_levels_select on public.ingredient_stock_levels
  for select to authenticated
  using (tenant_id = public.current_tenant_id()
         and public.has_branch_access(branch_id));

create policy product_stock_levels_select on public.product_stock_levels
  for select to authenticated
  using (tenant_id = public.current_tenant_id()
         and public.has_branch_access(branch_id));

-- No insert, update or delete policy for anyone. If a screen needs to change
-- stock, it inserts a movement.


-- -----------------------------------------------------------------------------
-- 8. RPC — adjust_stock (API-CONTRACT.md §2)
-- -----------------------------------------------------------------------------
-- Takes a TARGET quantity, never a delta: the client showing "42.5 kg" and the
-- user typing "40" means the delta is computed server-side from current truth.
-- A client-computed delta races against concurrent movements.
create or replace function public.adjust_stock(
  p_warehouse_id uuid,
  p_item_type    text,
  p_item_id      uuid,
  p_new_quantity numeric,
  p_reason       text default 'adjustment',
  p_note         text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant   uuid := public.current_tenant_id();
  v_wh       public.warehouses;
  v_current  numeric(18,4);
  v_delta    numeric(18,4);
  v_movement public.stock_movements;
begin
  if v_tenant is null then
    raise exception 'authentication required'
      using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  if p_item_type not in ('ingredient', 'product') then
    raise exception 'invalid item_type: %', p_item_type
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  if p_reason not in ('adjustment', 'waste', 'opening_balance') then
    raise exception 'adjust_stock only writes adjustment, waste or opening_balance movements'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  if p_new_quantity < 0 then
    raise exception 'target quantity cannot be negative'
      using errcode = 'P0001', detail = json_build_object('code', 'insufficient_stock')::text;
  end if;

  select * into v_wh
  from public.warehouses
  where id = p_warehouse_id and tenant_id = v_tenant;

  if v_wh.id is null then
    raise exception 'warehouse not found in this organization'
      using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  if not public.has_branch_access(v_wh.branch_id)
     or not public.has_role(array['owner', 'admin', 'branch_manager', 'baker', 'cashier']) then
    raise exception 'not permitted to adjust stock in this branch'
      using errcode = 'P0001', detail = json_build_object('code', 'insufficient_role')::text;
  end if;

  -- Lock the level row so the delta is computed against a value that cannot
  -- change under us before the movement lands.
  if p_item_type = 'ingredient' then
    select quantity_on_hand into v_current
    from public.ingredient_stock_levels
    where warehouse_id = p_warehouse_id and ingredient_id = p_item_id
    for update;
  else
    select quantity_on_hand into v_current
    from public.product_stock_levels
    where warehouse_id = p_warehouse_id and product_variant_id = p_item_id
    for update;
  end if;

  v_current := coalesce(v_current, 0);
  v_delta   := p_new_quantity - v_current;

  if v_delta = 0 then
    return jsonb_build_object('movement', null, 'quantity_on_hand', v_current, 'unchanged', true);
  end if;

  -- 'waste' is negative-only by constraint; an increase cannot be waste.
  if p_reason = 'waste' and v_delta > 0 then
    raise exception 'an increase cannot be recorded as waste'
      using errcode = 'P0001', detail = json_build_object('code', 'invalid_transition')::text;
  end if;

  insert into public.stock_movements (
    tenant_id, branch_id, warehouse_id, item_type,
    ingredient_id, product_variant_id, quantity_delta,
    reason, reference_type, reference_id, note, created_by
  ) values (
    v_tenant, v_wh.branch_id, p_warehouse_id, p_item_type,
    case when p_item_type = 'ingredient' then p_item_id end,
    case when p_item_type = 'product'    then p_item_id end,
    v_delta, p_reason, 'manual', p_warehouse_id, p_note, auth.uid()
  )
  returning * into v_movement;

  perform public.log_audit_event(
    v_tenant, 'stock_movement', v_movement.id, 'insert', null,
    jsonb_build_object('reason', p_reason, 'delta', v_delta,
                       'from', v_current, 'to', p_new_quantity));

  return jsonb_build_object(
    'movement',         to_jsonb(v_movement),
    'quantity_on_hand', p_new_quantity,
    'previous',         v_current
  );
end $$;

revoke execute on function public.adjust_stock(uuid, text, uuid, numeric, text, text) from public, anon;
grant  execute on function public.adjust_stock(uuid, text, uuid, numeric, text, text) to authenticated;


-- -----------------------------------------------------------------------------
-- 9. verify_stock_reconciliation — TESTING-STRATEGY.md §5
-- -----------------------------------------------------------------------------
-- "Zero rows, always. Run it after every stock-touching test and as a
-- production health check."
create or replace function public.verify_stock_reconciliation()
returns table (
  item_type        text,
  warehouse_id     uuid,
  item_id          uuid,
  quantity_on_hand numeric,
  ledger_total     numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select 'ingredient'::text, l.warehouse_id, l.ingredient_id,
         l.quantity_on_hand, coalesce(m.total, 0)
  from public.ingredient_stock_levels l
  left join (
    select warehouse_id, ingredient_id, sum(quantity_delta) as total
    from public.stock_movements
    where item_type = 'ingredient'
    group by 1, 2
  ) m on m.warehouse_id = l.warehouse_id and m.ingredient_id = l.ingredient_id
  where l.quantity_on_hand <> coalesce(m.total, 0)

  union all

  select 'product'::text, l.warehouse_id, l.product_variant_id,
         l.quantity_on_hand, coalesce(m.total, 0)
  from public.product_stock_levels l
  left join (
    select warehouse_id, product_variant_id, sum(quantity_delta) as total
    from public.stock_movements
    where item_type = 'product'
    group by 1, 2
  ) m on m.warehouse_id = l.warehouse_id and m.product_variant_id = l.product_variant_id
  where l.quantity_on_hand <> coalesce(m.total, 0);
$$;

comment on function public.verify_stock_reconciliation() is
  'Returns every stock level that disagrees with the sum of its ledger movements. Must always return zero rows; if it does not, the level cache has diverged and apply_stock_movement() has a bug.';

grant execute on function public.verify_stock_reconciliation() to authenticated;


-- -----------------------------------------------------------------------------
-- 10. Grants
-- -----------------------------------------------------------------------------
grant select, insert, update on public.warehouses              to authenticated;
grant select, insert         on public.stock_movements         to authenticated;
grant select                 on public.ingredient_stock_levels to authenticated;
grant select                 on public.product_stock_levels    to authenticated;

revoke all on public.warehouses              from anon;
revoke all on public.stock_movements         from anon;
revoke all on public.ingredient_stock_levels from anon;
revoke all on public.product_stock_levels    from anon;


-- -----------------------------------------------------------------------------
-- 11. Phase gate + ledger smoke test
-- -----------------------------------------------------------------------------
-- The assertions below run inside a plpgsql subtransaction and are rolled back
-- by a sentinel exception, so they prove the triggers work end to end without
-- leaving any test data behind.
do $$
declare
  v_org   uuid;
  v_br    uuid;
  v_wh    uuid;
  v_ing   uuid;
  v_qty   numeric;
  v_bad   int;
  v_raised boolean := false;
begin
  begin
    insert into public.organizations (name, slug)
      values ('Smoke Test Bakery', 'smoke-test-bakery')
      returning id into v_org;
    insert into public.branches (tenant_id, name, code) values (v_org, 'B', 'B1')
      returning id into v_br;
    insert into public.warehouses (tenant_id, branch_id, name) values (v_org, v_br, 'W')
      returning id into v_wh;
    insert into public.ingredients (tenant_id, name, unit_of_measure)
      values (v_org, 'Flour', 'kg') returning id into v_ing;

    -- 1. A movement creates the level row with exactly the delta.
    insert into public.stock_movements
      (tenant_id, branch_id, warehouse_id, item_type, ingredient_id, quantity_delta, reason)
      values (v_org, v_br, v_wh, 'ingredient', v_ing, 25.5000, 'opening_balance');

    select quantity_on_hand into v_qty from public.ingredient_stock_levels
      where warehouse_id = v_wh and ingredient_id = v_ing;
    if v_qty is distinct from 25.5000 then
      raise exception 'smoke: expected 25.5 on hand, got %', v_qty;
    end if;

    -- 2. A second movement accumulates rather than replacing.
    insert into public.stock_movements
      (tenant_id, branch_id, warehouse_id, item_type, ingredient_id, quantity_delta, reason)
      values (v_org, v_br, v_wh, 'ingredient', v_ing, -5.2500, 'production_consume');

    select quantity_on_hand into v_qty from public.ingredient_stock_levels
      where warehouse_id = v_wh and ingredient_id = v_ing;
    if v_qty is distinct from 20.2500 then
      raise exception 'smoke: expected 20.25 on hand, got %', v_qty;
    end if;

    -- 3. Consumption below zero is refused.
    begin
      insert into public.stock_movements
        (tenant_id, branch_id, warehouse_id, item_type, ingredient_id, quantity_delta, reason)
        values (v_org, v_br, v_wh, 'ingredient', v_ing, -1000, 'production_consume');
    exception when others then
      if position('insufficient_stock' in sqlerrm) = 0 then raise; end if;
      v_raised := true;
    end;
    if not v_raised then
      raise exception 'smoke: negative production_consume was NOT refused';
    end if;

    -- 4. The ledger and the level cache agree.
    select count(*) into v_bad from public.verify_stock_reconciliation();
    if v_bad <> 0 then
      raise exception 'smoke: % reconciliation mismatches', v_bad;
    end if;

    -- 5. The ledger is immutable.
    v_raised := false;
    begin
      update public.stock_movements set note = 'tampered' where tenant_id = v_org;
    exception when others then
      if position('append-only' in sqlerrm) = 0 then raise; end if;
      v_raised := true;
    end;
    if not v_raised then
      raise exception 'smoke: stock_movements accepted an UPDATE';
    end if;

    raise exception 'bakeflow_smoke_rollback';
  exception when others then
    if sqlerrm <> 'bakeflow_smoke_rollback' then
      raise exception 'phase 4 smoke test failed: %', sqlerrm;
    end if;
  end;

  perform public.assert_schema_invariants();
  raise notice 'BakeFlow phase 4: schema invariants OK, ledger smoke test passed';
end $$;
