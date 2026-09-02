-- Close the one unindexed FK-column gap from the previous migration (permission_id has no
-- index whose leftmost column is permission_id itself; the composite unique/profile indexes
-- both lead with tenant_id). Per supabase-postgres-best-practices: always index FK columns.
CREATE INDEX user_permission_overrides_permission_id_idx
  ON public.user_permission_overrides (permission_id);
