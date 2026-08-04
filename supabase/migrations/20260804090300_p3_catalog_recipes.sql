-- =============================================================================
-- BakeFlow — Phase 3: Catalog, Ingredients, Recipes
-- =============================================================================
-- Creates: product_categories, products, product_variants, ingredients,
--          recipes, recipe_ingredients
--
-- Conforms to: docs/SCHEMA-REFERENCE.md §2, docs/RLS-POLICY-PATTERNS.md §3.
--
-- All six are tenant-scoped but NOT branch-scoped: a bakery's catalog and
-- recipes are shared across its branches. Only the physical stock of them
-- (phase 4) is per-branch.
--
-- NOTE ON ROLES: AI-BUILD-GUIDE.md phase 3 names "Production Manager" as a
-- catalog-writing role. No such role exists in the canonical list (CLAUDE.md
-- "Domain vocabulary"); the equivalent is branch_manager, which is what these
-- policies use, matching Pattern A in RLS-POLICY-PATTERNS.md §3.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. product_categories
-- -----------------------------------------------------------------------------
create table public.product_categories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.organizations(id) on delete restrict,
  name       text not null check (length(btrim(name)) > 0),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,

  constraint product_categories_tenant_name_key unique (tenant_id, name),
  constraint product_categories_tenant_id_key   unique (tenant_id, id)
);

create index idx_product_categories_tenant on public.product_categories (tenant_id);
create index idx_product_categories_created_by on public.product_categories (created_by);


-- -----------------------------------------------------------------------------
-- 2. products
-- -----------------------------------------------------------------------------
create table public.products (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.organizations(id) on delete restrict,
  category_id uuid,
  name        text not null check (length(btrim(name)) > 0),
  description text,
  image_url   text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id) on delete set null,

  constraint products_tenant_name_key unique (tenant_id, name),
  constraint products_tenant_id_key   unique (tenant_id, id),
  -- Composite FK: a product can never be filed under another tenant's category.
  -- A plain FK to product_categories(id) would permit exactly that, because
  -- foreign key checks run as the system and are not filtered by RLS.
  constraint products_category_fkey
    foreign key (tenant_id, category_id)
    references public.product_categories(tenant_id, id) on delete restrict
);

create index idx_products_tenant     on public.products (tenant_id);
create index idx_products_category    on public.products (category_id);
create index idx_products_created_by  on public.products (created_by);
create index idx_products_tenant_active on public.products (tenant_id) where is_active;


-- -----------------------------------------------------------------------------
-- 3. product_variants — the sellable SKU
-- -----------------------------------------------------------------------------
-- Price lives here, not on products.
create table public.product_variants (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.organizations(id) on delete restrict,
  product_id uuid not null,
  name       text not null check (length(btrim(name)) > 0),
  sku        text not null check (length(btrim(sku)) > 0),
  unit_price numeric(19,4) not null check (unit_price >= 0),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,

  constraint product_variants_tenant_sku_key unique (tenant_id, sku),
  constraint product_variants_tenant_id_key  unique (tenant_id, id),
  constraint product_variants_product_fkey
    foreign key (tenant_id, product_id)
    references public.products(tenant_id, id) on delete cascade
);

create index idx_product_variants_tenant  on public.product_variants (tenant_id);
create index idx_product_variants_product on public.product_variants (product_id);
create index idx_product_variants_created_by on public.product_variants (created_by);

comment on column public.product_variants.unit_price is
  'Current list price. order_items snapshot this value at order time and never read it live afterwards.';


-- -----------------------------------------------------------------------------
-- 4. ingredients
-- -----------------------------------------------------------------------------
create table public.ingredients (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.organizations(id) on delete restrict,
  name            text not null check (length(btrim(name)) > 0),
  unit_of_measure text not null check (unit_of_measure in ('kg', 'g', 'l', 'ml', 'unit')),
  reorder_level   numeric(18,4) not null default 0 check (reorder_level >= 0),
  last_unit_cost  numeric(19,4) check (last_unit_cost >= 0),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id) on delete set null,

  constraint ingredients_tenant_name_key unique (tenant_id, name),
  constraint ingredients_tenant_id_key   unique (tenant_id, id)
);

create index idx_ingredients_tenant on public.ingredients (tenant_id);
create index idx_ingredients_created_by on public.ingredients (created_by);

comment on column public.ingredients.last_unit_cost is
  'Most recent purchase price per unit_of_measure. Maintained from purchase stock movements; used for batch costing.';


-- -----------------------------------------------------------------------------
-- 5. recipes — the bill of materials for one variant
-- -----------------------------------------------------------------------------
create table public.recipes (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.organizations(id) on delete restrict,
  product_variant_id uuid not null,
  name               text not null check (length(btrim(name)) > 0),
  yield_quantity     numeric(18,4) not null check (yield_quantity > 0),
  version            integer not null default 1 check (version > 0),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.profiles(id) on delete set null,

  constraint recipes_tenant_id_key unique (tenant_id, id),
  constraint recipes_variant_version_key unique (tenant_id, product_variant_id, version),
  constraint recipes_variant_fkey
    foreign key (tenant_id, product_variant_id)
    references public.product_variants(tenant_id, id) on delete restrict
);

-- Exactly one active recipe per variant. Superseding a recipe means
-- deactivating the old one and inserting a new version, never editing history.
create unique index recipes_one_active_per_variant
  on public.recipes (tenant_id, product_variant_id) where is_active;

create index idx_recipes_tenant  on public.recipes (tenant_id);
create index idx_recipes_variant on public.recipes (product_variant_id);
create index idx_recipes_created_by on public.recipes (created_by);

comment on column public.recipes.yield_quantity is
  'Units of the variant produced by one batch of this recipe. recipe_ingredients quantities are expressed per yield_quantity, not per unit.';


-- -----------------------------------------------------------------------------
-- 6. recipe_ingredients
-- -----------------------------------------------------------------------------
create table public.recipe_ingredients (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.organizations(id) on delete restrict,
  recipe_id     uuid not null,
  ingredient_id uuid not null,
  quantity      numeric(18,4) not null check (quantity > 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id) on delete set null,

  constraint recipe_ingredients_recipe_ingredient_key unique (recipe_id, ingredient_id),
  constraint recipe_ingredients_recipe_fkey
    foreign key (tenant_id, recipe_id)
    references public.recipes(tenant_id, id) on delete cascade,
  constraint recipe_ingredients_ingredient_fkey
    foreign key (tenant_id, ingredient_id)
    references public.ingredients(tenant_id, id) on delete restrict
);

create index idx_recipe_ingredients_tenant     on public.recipe_ingredients (tenant_id);
create index idx_recipe_ingredients_recipe     on public.recipe_ingredients (recipe_id);
create index idx_recipe_ingredients_ingredient on public.recipe_ingredients (ingredient_id);
create index idx_recipe_ingredients_created_by on public.recipe_ingredients (created_by);

comment on column public.recipe_ingredients.quantity is
  'Quantity of the ingredient, in the ingredient''s unit_of_measure, required to produce one full recipes.yield_quantity.';


-- -----------------------------------------------------------------------------
-- 7. updated_at triggers
-- -----------------------------------------------------------------------------
create trigger product_categories_set_updated_at
  before update on public.product_categories
  for each row execute function public.set_updated_at();

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

create trigger product_variants_set_updated_at
  before update on public.product_variants
  for each row execute function public.set_updated_at();

create trigger ingredients_set_updated_at
  before update on public.ingredients
  for each row execute function public.set_updated_at();

create trigger recipes_set_updated_at
  before update on public.recipes
  for each row execute function public.set_updated_at();

create trigger recipe_ingredients_set_updated_at
  before update on public.recipe_ingredients
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- 8. Row-Level Security — Pattern A (tenant-scoped)
-- -----------------------------------------------------------------------------
-- Every employee of the tenant reads the catalog; only owner, admin and
-- branch_manager write it; only owner and admin delete.

alter table public.product_categories enable row level security;
alter table public.product_categories force  row level security;
alter table public.products           enable row level security;
alter table public.products           force  row level security;
alter table public.product_variants   enable row level security;
alter table public.product_variants   force  row level security;
alter table public.ingredients        enable row level security;
alter table public.ingredients        force  row level security;
alter table public.recipes            enable row level security;
alter table public.recipes            force  row level security;
alter table public.recipe_ingredients enable row level security;
alter table public.recipe_ingredients force  row level security;

do $$
declare
  t text;
begin
  foreach t in array array['product_categories', 'products', 'product_variants',
                           'ingredients', 'recipes', 'recipe_ingredients']
  loop
    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated
        using (tenant_id = public.current_tenant_id());

      create policy %1$s_insert on public.%1$I
        for insert to authenticated
        with check (
          tenant_id = public.current_tenant_id()
          and public.has_role(array['owner', 'admin', 'branch_manager'])
        );

      -- USING decides which rows may be updated; WITH CHECK validates the NEW
      -- values. Without WITH CHECK a user could reassign tenant_id and move the
      -- row into another organization. Every UPDATE policy needs both.
      create policy %1$s_update on public.%1$I
        for update to authenticated
        using (tenant_id = public.current_tenant_id()
               and public.has_role(array['owner', 'admin', 'branch_manager']))
        with check (tenant_id = public.current_tenant_id());

      create policy %1$s_delete on public.%1$I
        for delete to authenticated
        using (tenant_id = public.current_tenant_id()
               and public.has_role(array['owner', 'admin']));
    $f$, t);
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 9. Grants
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['product_categories', 'products', 'product_variants',
                           'ingredients', 'recipes', 'recipe_ingredients']
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;


-- -----------------------------------------------------------------------------
-- 10. Phase gate
-- -----------------------------------------------------------------------------
do $$
begin
  perform public.assert_schema_invariants();
  raise notice 'BakeFlow phase 3: schema invariants OK';
end $$;
