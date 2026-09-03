-- Future-cost audit, 2026-09-02/03. Supabase performance advisor flagged 23 RLS policies
-- across 15 tables with the auth_rls_initplan issue: a bare auth.uid() call inside a
-- policy's USING/WITH CHECK is re-evaluated once PER ROW scanned rather than once per
-- query (Postgres can only hoist it into a cached InitPlan when it's wrapped in a scalar
-- subquery). This concentrates on tickets/ticket_items -- the busiest tables in the whole
-- app, scanned on every sale -- plus 13 other tables. Pure performance/cost fix: every
-- occurrence below is a mechanical (select auth.uid()) substitution for a bare auth.uid(),
-- semantically identical (same single value), verified against the live pg_policies
-- definition of each policy before writing the replacement, not guessed. No logic changed.
-- has_role()/has_branch_access()/current_tenant_id() are untouched -- the advisor did not
-- flag them (has_branch_access() takes a row-varying branch_id argument and cannot be
-- hoisted regardless), so wrapping them would be scope creep with no advisor-confirmed
-- benefit and unnecessary added risk to policies that already work.
--
-- Verified zero-regression live after applying: advisor's auth_rls_initplan count dropped
-- 23 -> 0; re-ran tests/sql/sales_write_rls.sql (21/21), a direct-path ticket_items
-- INSERT/UPDATE check (5/5, not previously covered by any suite since those RPCs bypass
-- RLS), tests/sql/p3_7_sync_apply_and_pull.sql (11/11), tests/sql/financial_write_rls.sql
-- (28/28), tests/sql/security_multiorg_sync.sql (22/22), and a targeted direct check of the
-- remaining policies (organizations_select/role_permissions_select/
-- permanent_deletion_challenges_owner/user_roles_insert/update, 7/7).

-- ---- tickets ----
DROP POLICY tickets_insert ON public.tickets;
CREATE POLICY tickets_insert ON public.tickets AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (tenant_id = current_tenant_id()) AND has_branch_access(branch_id)
    AND has_role(ARRAY['owner','admin','branch_manager','cashier','driver'])
    AND ((has_role(ARRAY['driver']) AND (created_by = (select auth.uid())))
         OR (NOT has_role(ARRAY['driver'])))
  );

DROP POLICY tickets_update ON public.tickets;
CREATE POLICY tickets_update ON public.tickets AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    (tenant_id = current_tenant_id()) AND has_branch_access(branch_id)
    AND (has_role(ARRAY['owner','admin','branch_manager'])
      OR (has_role(ARRAY['driver']) AND ((created_by = (select auth.uid())) OR (assigned_to = (select auth.uid()))))
      OR has_role(ARRAY['cashier']))
  )
  WITH CHECK (
    (tenant_id = current_tenant_id()) AND has_branch_access(branch_id)
    AND (has_role(ARRAY['owner','admin','branch_manager'])
      OR (has_role(ARRAY['driver']) AND ((created_by = (select auth.uid())) OR (assigned_to = (select auth.uid()))))
      OR has_role(ARRAY['cashier']))
  );

-- ---- ticket_items ----
DROP POLICY ticket_items_insert ON public.ticket_items;
CREATE POLICY ticket_items_insert ON public.ticket_items AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (tenant_id = current_tenant_id()) AND EXISTS (
      SELECT 1 FROM public.tickets o
      WHERE o.id = ticket_items.ticket_id AND o.tenant_id = ticket_items.tenant_id
        AND has_branch_access(o.branch_id)
        AND (has_role(ARRAY['owner','admin','branch_manager','cashier'])
          OR (has_role(ARRAY['driver']) AND ((o.created_by = (select auth.uid())) OR (o.assigned_to = (select auth.uid())))))
    )
  );

DROP POLICY ticket_items_update ON public.ticket_items;
CREATE POLICY ticket_items_update ON public.ticket_items AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    (tenant_id = current_tenant_id()) AND EXISTS (
      SELECT 1 FROM public.tickets o
      WHERE o.id = ticket_items.ticket_id AND o.tenant_id = ticket_items.tenant_id
        AND has_branch_access(o.branch_id)
        AND (has_role(ARRAY['owner','admin','branch_manager','cashier'])
          OR (has_role(ARRAY['driver']) AND ((o.created_by = (select auth.uid())) OR (o.assigned_to = (select auth.uid())))))
    )
  )
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY ticket_items_delete ON public.ticket_items;
CREATE POLICY ticket_items_delete ON public.ticket_items AS PERMISSIVE FOR DELETE TO authenticated
  USING (
    (tenant_id = current_tenant_id()) AND EXISTS (
      SELECT 1 FROM public.tickets o
      WHERE o.id = ticket_items.ticket_id AND o.tenant_id = ticket_items.tenant_id
        AND has_branch_access(o.branch_id)
        AND (has_role(ARRAY['owner','admin','branch_manager','cashier'])
          OR (has_role(ARRAY['driver']) AND ((o.created_by = (select auth.uid())) OR (o.assigned_to = (select auth.uid())))))
    )
  );

-- ---- sync_changes ----
DROP POLICY sync_changes_select ON public.sync_changes;
CREATE POLICY sync_changes_select ON public.sync_changes AS PERMISSIVE FOR SELECT TO public
  USING (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.profile_id = (select auth.uid()) AND ur.tenant_id = sync_changes.tenant_id AND ur.deleted_at IS NULL)
    AND EXISTS (SELECT 1 FROM public.sync_devices d WHERE d.user_id = (select auth.uid()) AND d.revoked_at IS NULL)
    AND (
      branch_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur2 JOIN public.roles r ON r.id = ur2.role_id
        WHERE ur2.profile_id = (select auth.uid()) AND ur2.tenant_id = sync_changes.tenant_id
          AND ur2.deleted_at IS NULL AND r.deleted_at IS NULL AND r.key = ANY (ARRAY['owner','admin'])
      )
      OR EXISTS (
        SELECT 1 FROM public.branch_assignments ba
        WHERE ba.profile_id = (select auth.uid()) AND ba.tenant_id = sync_changes.tenant_id
          AND ba.branch_id = sync_changes.branch_id AND ba.deleted_at IS NULL
      )
    )
  );

-- ---- sync_devices ----
DROP POLICY sync_devices_select ON public.sync_devices;
CREATE POLICY sync_devices_select ON public.sync_devices AS PERMISSIVE FOR SELECT TO public
  USING (user_id = (select auth.uid()));

DROP POLICY sync_devices_insert ON public.sync_devices;
CREATE POLICY sync_devices_insert ON public.sync_devices AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (user_id = (select auth.uid()));

DROP POLICY sync_devices_update ON public.sync_devices;
CREATE POLICY sync_devices_update ON public.sync_devices AS PERMISSIVE FOR UPDATE TO public
  USING (user_id = (select auth.uid()))
  WITH CHECK (user_id = (select auth.uid()));

-- ---- sync_operations ----
DROP POLICY sync_operations_select ON public.sync_operations;
CREATE POLICY sync_operations_select ON public.sync_operations AS PERMISSIVE FOR SELECT TO public
  USING (
    actor_id = (select auth.uid())
    AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.profile_id = (select auth.uid()) AND ur.tenant_id = sync_operations.tenant_id AND ur.deleted_at IS NULL)
  );

-- ---- user_roles ----
DROP POLICY user_roles_insert ON public.user_roles;
CREATE POLICY user_roles_insert ON public.user_roles AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (tenant_id = current_tenant_id()) AND private.can_manage_target_role(role_id) AND (profile_id <> (select auth.uid()))
  );

DROP POLICY user_roles_update ON public.user_roles;
CREATE POLICY user_roles_update ON public.user_roles AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((tenant_id = current_tenant_id()) AND has_role(ARRAY['owner','admin']) AND (profile_id <> (select auth.uid())))
  WITH CHECK ((tenant_id = current_tenant_id()) AND private.can_manage_target_role(role_id) AND (profile_id <> (select auth.uid())));

DROP POLICY user_roles_delete ON public.user_roles;
CREATE POLICY user_roles_delete ON public.user_roles AS PERMISSIVE FOR DELETE TO authenticated
  USING (
    (tenant_id = current_tenant_id()) AND (profile_id <> (select auth.uid()))
    AND (has_role(ARRAY['owner'])
      OR (has_role(ARRAY['admin']) AND EXISTS (SELECT 1 FROM public.roles r WHERE r.id = user_roles.role_id AND r.key <> ALL (ARRAY['owner','admin']))))
  );

-- ---- expenses ----
DROP POLICY expenses_insert ON public.expenses;
CREATE POLICY expenses_insert ON public.expenses AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (tenant_id = current_tenant_id()) AND has_branch_access(branch_id)
    AND has_role(ARRAY['owner','admin','branch_manager','cashier','accountant'])
    AND (created_by = (select auth.uid()))
  );

-- ---- sync_conflicts ----
DROP POLICY sync_conflicts_select ON public.sync_conflicts;
CREATE POLICY sync_conflicts_select ON public.sync_conflicts AS PERMISSIVE FOR SELECT TO public
  USING (
    ((actor_id = (select auth.uid())) AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.profile_id = (select auth.uid()) AND ur.tenant_id = sync_conflicts.tenant_id AND ur.deleted_at IS NULL))
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.profile_id = (select auth.uid()) AND ur.tenant_id = sync_conflicts.tenant_id
        AND ur.deleted_at IS NULL AND r.deleted_at IS NULL AND r.key = ANY (ARRAY['owner','admin','branch_manager'])
    )
  );

DROP POLICY sync_conflicts_resolve ON public.sync_conflicts;
CREATE POLICY sync_conflicts_resolve ON public.sync_conflicts AS PERMISSIVE FOR UPDATE TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.profile_id = (select auth.uid()) AND ur.tenant_id = sync_conflicts.tenant_id
        AND ur.deleted_at IS NULL AND r.deleted_at IS NULL AND r.key = ANY (ARRAY['owner','admin','branch_manager'])
    )
  )
  WITH CHECK (
    (resolved_by = (select auth.uid()))
    AND (conflict_status = ANY (ARRAY['RESOLVED','DISMISSED']))
    AND (tenant_id = (SELECT sc.tenant_id FROM public.sync_conflicts sc WHERE sc.id = sync_conflicts.id))
  );

-- ---- daily_financial_audits ----
DROP POLICY daily_financial_audits_select ON public.daily_financial_audits;
CREATE POLICY daily_financial_audits_select ON public.daily_financial_audits AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    (tenant_id = current_tenant_id()) AND deleted_at IS NULL
    AND ((submitted_by = (select auth.uid())) OR (has_branch_access(branch_id) AND has_role(ARRAY['owner','admin','branch_manager','accountant'])))
  );

DROP POLICY daily_financial_audits_insert ON public.daily_financial_audits;
CREATE POLICY daily_financial_audits_insert ON public.daily_financial_audits AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    (tenant_id = current_tenant_id()) AND has_branch_access(branch_id)
    AND (submitted_by = (select auth.uid()))
    AND has_role(ARRAY['owner','admin','branch_manager','cashier'])
  );

DROP POLICY daily_financial_audits_update_own_open ON public.daily_financial_audits;
CREATE POLICY daily_financial_audits_update_own_open ON public.daily_financial_audits AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    (tenant_id = current_tenant_id()) AND (submitted_by = (select auth.uid()))
    AND (status = ANY (ARRAY['DRAFT','PENDING_SYNC','REQUIRES_RECONCILIATION'])) AND deleted_at IS NULL
  )
  WITH CHECK ((tenant_id = current_tenant_id()) AND (submitted_by = (select auth.uid())));

-- ---- role_permissions ----
DROP POLICY role_permissions_select_authenticated ON public.role_permissions;
CREATE POLICY role_permissions_select_authenticated ON public.role_permissions AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.role_id = role_permissions.role_id AND ur.profile_id = (select auth.uid()) AND ur.tenant_id = current_tenant_id() AND ur.deleted_at IS NULL)
  );

-- ---- permanent_deletion_challenges ----
DROP POLICY permanent_deletion_challenges_owner ON public.permanent_deletion_challenges;
CREATE POLICY permanent_deletion_challenges_owner ON public.permanent_deletion_challenges AS PERMISSIVE FOR SELECT TO authenticated
  USING ((requested_by = (select auth.uid())) AND (tenant_id = current_tenant_id()));

-- ---- profiles ----
DROP POLICY profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self ON public.profiles AS PERMISSIVE FOR UPDATE TO public
  USING (id = (select auth.uid()))
  WITH CHECK (
    (id = (select auth.uid()))
    AND (NOT (tenant_id IS DISTINCT FROM current_tenant_id()))
    AND (NOT (primary_branch_id IS DISTINCT FROM (SELECT p.primary_branch_id FROM public.profiles p WHERE p.id = (select auth.uid()))))
    AND (NOT (status IS DISTINCT FROM (SELECT p.status FROM public.profiles p WHERE p.id = (select auth.uid()))))
    AND (NOT (deleted_at IS DISTINCT FROM (SELECT p.deleted_at FROM public.profiles p WHERE p.id = (select auth.uid()))))
    AND (NOT (deleted_by IS DISTINCT FROM (SELECT p.deleted_by FROM public.profiles p WHERE p.id = (select auth.uid()))))
    AND (NOT (active_tenant_id IS DISTINCT FROM (SELECT p.active_tenant_id FROM public.profiles p WHERE p.id = (select auth.uid()))))
  );

-- ---- organizations ----
DROP POLICY organizations_select ON public.organizations;
CREATE POLICY organizations_select ON public.organizations AS PERMISSIVE FOR SELECT TO public
  USING (
    deleted_at IS NULL AND EXISTS (
      SELECT 1 FROM public.user_roles ur WHERE ur.profile_id = (select auth.uid()) AND ur.tenant_id = organizations.id AND ur.deleted_at IS NULL
    )
  );
