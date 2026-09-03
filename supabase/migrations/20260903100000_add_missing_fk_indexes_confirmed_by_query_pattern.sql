-- Future-cost audit, 2026-09-02/03. A blanket "index every unindexed FK" sweep would be noise
-- -- this codebase already deliberately indexes only FK columns actually used in a WHERE/
-- USING clause (audit-trail-only columns like archived_by/loading_verified_by/reconciled_by
-- are write-only, confirmed via grep across every migration, correctly left unindexed).
-- These three are the ones actually hit by a live RLS predicate today, verified by reading
-- each policy's own USING/qual clause before adding anything:
--   - sync_conflicts_select's own-actor branch: `actor_id = auth.uid()` with no other
--     predicate on this table in that branch (the tenant check is in a subquery against
--     user_roles, not against sync_conflicts) -- a driver checking their own sync conflicts
--     does a full scan of sync_conflicts today. This table only grows (one row per offline
--     write collision) on an offline-first app, so this compounds over time.
--   - permanent_deletion_challenges' RLS: `requested_by = auth.uid() AND tenant_id =
--     current_tenant_id()` -- both bound together, tenant_id-first composite matches this
--     codebase's established multi-tenant indexing convention.
--   - user_permission_overrides_select (BLOCKER-025, built earlier the same day): its
--     own-profile branch `profile_id = auth.uid()` has no tenant_id in that branch either --
--     the existing (tenant_id, profile_id) composite index doesn't help it.
CREATE INDEX sync_conflicts_actor_id_idx
  ON public.sync_conflicts (actor_id);

CREATE INDEX permanent_deletion_challenges_tenant_requested_by_idx
  ON public.permanent_deletion_challenges (tenant_id, requested_by);

CREATE INDEX user_permission_overrides_profile_id_idx
  ON public.user_permission_overrides (profile_id)
  WHERE deleted_at IS NULL;
