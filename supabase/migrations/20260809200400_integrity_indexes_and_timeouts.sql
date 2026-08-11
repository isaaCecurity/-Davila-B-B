-- Findings B8, E4, F6, J1, J2, J4 — integrity, freshness and availability.

-- B8: soft-deleted platform roles remained listed to every authenticated user.
DROP POLICY IF EXISTS roles_select ON public.roles;
CREATE POLICY roles_select ON public.roles
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL);

-- F6: line_total had no lower bound. A negative line silently reduces a ticket total
-- through recalculate_ticket_totals(), which is a discount with no audit trail.
ALTER TABLE public.ticket_items
  ADD CONSTRAINT ticket_items_line_total_nonneg CHECK (line_total >= 0);

-- E4: these three carry updated_at with nothing maintaining it, so the column
-- records whatever the writer happened to supply — or never changes at all.
-- (payments, refunds, stock_movements and audit_log are append-only and correctly
-- have no such trigger.)
DROP TRIGGER IF EXISTS ingredient_stock_levels_set_updated_at ON public.ingredient_stock_levels;
CREATE TRIGGER ingredient_stock_levels_set_updated_at
  BEFORE UPDATE ON public.ingredient_stock_levels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS product_stock_levels_set_updated_at ON public.product_stock_levels;
CREATE TRIGGER product_stock_levels_set_updated_at
  BEFORE UPDATE ON public.product_stock_levels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS permissions_set_updated_at ON public.permissions;
CREATE TRIGGER permissions_set_updated_at
  BEFORE UPDATE ON public.permissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- J1: every RLS policy on this table filters tenant_id, with no index to serve it.
CREATE INDEX IF NOT EXISTS permanent_deletion_challenges_tenant_id_idx
  ON public.permanent_deletion_challenges (tenant_id);

-- J2: unindexed foreign keys — each makes the referenced parent's delete/update scan
-- the child table, and the tickets ones sit on the hottest table in the schema.
CREATE INDEX IF NOT EXISTS permanent_deletion_challenges_requested_by_idx
  ON public.permanent_deletion_challenges (requested_by);
CREATE INDEX IF NOT EXISTS permissions_deleted_by_idx ON public.permissions (deleted_by);
CREATE INDEX IF NOT EXISTS tickets_archived_by_idx    ON public.tickets (archived_by);
CREATE INDEX IF NOT EXISTS tickets_assigned_to_idx    ON public.tickets (assigned_to);

-- J4: without a statement timeout a single pathological request pins a PostgREST
-- connection indefinitely — the cheapest denial of service against the API.
ALTER ROLE anon          SET statement_timeout = '8s';
ALTER ROLE authenticated SET statement_timeout = '15s';
