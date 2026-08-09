-- 20260809190300_index_foreign_keys
--
-- 41 foreign keys have no index on their leading column. Postgres does not create one
-- for the referencing side, so every parent-row UPDATE/DELETE seq-scans each child, and
-- the natural lookups go unindexed too — tickets.assigned_to backs the driver's
-- "my orders" screen, and the sync_* keys back the offline replay path.
--
-- Most of the rest are deleted_by, which is null on nearly every row, so those get
-- partial indexes: same planner benefit, a fraction of the size.

do $$
declare
  r    record;
  name text;
begin
  for r in
    select c.conrelid::regclass::text as tbl,
           (select string_agg(quote_ident(a.attname), ', ' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols,
           (select string_agg(a.attname, '_' order by k.ord)
              from unnest(c.conkey) with ordinality k(attnum, ord)
              join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as colnames
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    where c.contype = 'f'
      and n.nspname = 'public'
      and not exists (
        select 1 from pg_index i
        where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
      )
  loop
    name := left('idx_' || replace(r.tbl, 'public.', '') || '_' || r.colnames, 63);

    if r.colnames = 'deleted_by' then
      execute format('create index if not exists %I on %s (%s) where deleted_by is not null',
                     name, r.tbl, r.cols);
    else
      execute format('create index if not exists %I on %s (%s)', name, r.tbl, r.cols);
    end if;
  end loop;
end $$;
