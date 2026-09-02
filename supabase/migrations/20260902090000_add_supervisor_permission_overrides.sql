-- BLOCKER-025: per-supervisor, Branch-Manager-configurable permission overrides.
-- Decisions (owner, 2026-09-02): general per-profile override table (not limited to
-- customers.update); both raise and lower supported (granted=true/false), clear via
-- granted=NULL reverts to role default; only Branch Manager may set an override, for a
-- profile that currently holds the 'supervisor' role in the same tenant; overrides are
-- restricted to a safe allowlist of Supervisor-relevant permission keys (owner decision) --
-- explicitly excluding tickets.update/tickets.cancel, which docs/ROLES-AND-PERMISSIONS.md
-- says must never be granted to ANY role, by any mechanism (enforced independently by the
-- ticket status-transition guard).

CREATE TABLE public.user_permission_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE RESTRICT,
  granted boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.user_permission_overrides IS
  'Per-profile permission overrides, set by a Branch Manager for an individual Supervisor. '
  'granted=true raises, granted=false lowers/revokes, absence (soft-deleted or no row) means '
  'the role default from role_permissions applies. See BLOCKER-025.';

CREATE UNIQUE INDEX user_permission_overrides_active_uq
  ON public.user_permission_overrides (tenant_id, profile_id, permission_id)
  WHERE deleted_at IS NULL;

CREATE INDEX user_permission_overrides_profile_idx
  ON public.user_permission_overrides (tenant_id, profile_id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER user_permission_overrides_set_updated_at
  BEFORE UPDATE ON public.user_permission_overrides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_permission_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_permission_overrides FORCE ROW LEVEL SECURITY;

-- Read-only via RLS: a profile can see its own effective overrides; owner/admin/branch_manager
-- can see all of a tenant's. No INSERT/UPDATE/DELETE grant to `authenticated` at all -- every
-- write goes through set_supervisor_permission_override() below (SECURITY DEFINER), which
-- enforces the Branch-Manager-only + target-must-be-Supervisor + allowlist rules that plain
-- RLS can't express. Mirrors the existing ingredient-tables pattern (AD-022).
CREATE POLICY user_permission_overrides_select ON public.user_permission_overrides
  FOR SELECT
  USING (
    (profile_id = (select auth.uid())
      OR (tenant_id = public.current_tenant_id() AND public.has_role(ARRAY['owner','admin','branch_manager'])))
    AND deleted_at IS NULL
  );

GRANT SELECT ON public.user_permission_overrides TO authenticated;

-- has_permission(): override-aware. An active override for the caller wins outright
-- (COALESCE short-circuits to it); otherwise falls back to the existing role-level grant,
-- unchanged in substance from the prior definition. Branch-access check is unchanged in
-- effect (owner/admin bypass, everyone else needs a matching branch_assignments row) --
-- pulled out of the per-row EXISTS since an override has no role row of its own to check.
CREATE OR REPLACE FUNCTION public.has_permission(required_permission text, target_branch_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    COALESCE(
      (
        SELECT upo.granted
        FROM public.user_permission_overrides upo
        JOIN public.permissions p ON p.id = upo.permission_id
        WHERE upo.profile_id = auth.uid()
          AND upo.tenant_id = public.current_tenant_id()
          AND upo.deleted_at IS NULL
          AND p.key = required_permission
          AND p.deleted_at IS NULL
      ),
      EXISTS (
        SELECT 1
        FROM public.user_roles ur
        JOIN public.roles r ON r.id=ur.role_id
        JOIN public.role_permissions rp ON rp.role_id=r.id
        JOIN public.permissions p ON p.id=rp.permission_id
        WHERE ur.profile_id=auth.uid()
          AND ur.tenant_id=public.current_tenant_id()
          AND ur.deleted_at IS NULL
          AND r.deleted_at IS NULL
          AND p.deleted_at IS NULL
          AND p.key=required_permission
      )
    )
    AND (
      target_branch_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.profile_id = auth.uid()
          AND ur.tenant_id = public.current_tenant_id()
          AND ur.deleted_at IS NULL
          AND r.deleted_at IS NULL
          AND r.key IN ('owner','admin')
      )
      OR EXISTS (
        SELECT 1 FROM public.branch_assignments ba
        WHERE ba.profile_id=auth.uid()
          AND ba.tenant_id=public.current_tenant_id()
          AND ba.branch_id=target_branch_id
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.set_supervisor_permission_override(
  p_profile_id uuid,
  p_permission_key text,
  p_granted boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_permission_id uuid;
  v_override_id uuid;
  v_result jsonb;
  v_allowed_keys text[] := ARRAY[
    'branch.view','customers.create','customers.update','customers.delete',
    'financial.audit.confirm','financial.audit.submit',
    'financial.expense.create','financial.expense.update','financial.view',
    'reports.view','staff.view',
    'tickets.create','tickets.view','tickets.correct','tickets.archive'
  ];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required'
      USING errcode='28000', detail = json_build_object('code','session_expired')::text;
  END IF;

  v_tenant_id := public.current_tenant_id();

  IF NOT public.has_role_in(auth.uid(), v_tenant_id, ARRAY['branch_manager']) THEN
    RAISE EXCEPTION 'only a Branch Manager may set a per-supervisor permission override'
      USING errcode='42501', detail = json_build_object('code','insufficient_role')::text;
  END IF;

  IF NOT public.has_role_in(p_profile_id, v_tenant_id, ARRAY['supervisor']) THEN
    RAISE EXCEPTION 'target profile does not hold the supervisor role in this organization'
      USING errcode='P0001', detail = json_build_object('code','not_a_supervisor')::text;
  END IF;

  IF NOT (p_permission_key = ANY(v_allowed_keys)) THEN
    RAISE EXCEPTION 'permission key % is not eligible for per-supervisor override', p_permission_key
      USING errcode='42501', detail = json_build_object('code','permission_not_overridable')::text;
  END IF;

  SELECT id INTO v_permission_id
  FROM public.permissions
  WHERE key = p_permission_key AND deleted_at IS NULL;

  IF v_permission_id IS NULL THEN
    RAISE EXCEPTION 'unknown permission key: %', p_permission_key
      USING errcode='22023', detail = json_build_object('code','invalid_request')::text;
  END IF;

  IF p_granted IS NULL THEN
    UPDATE public.user_permission_overrides
       SET deleted_at = now(), deleted_by = auth.uid()
     WHERE tenant_id = v_tenant_id
       AND profile_id = p_profile_id
       AND permission_id = v_permission_id
       AND deleted_at IS NULL
     RETURNING id INTO v_override_id;

    v_result := jsonb_build_object(
      'profile_id', p_profile_id, 'permission_key', p_permission_key,
      'granted', null, 'cleared', v_override_id IS NOT NULL
    );

    IF v_override_id IS NOT NULL THEN
      PERFORM public.log_audit_event(v_tenant_id, 'user_permission_override', v_override_id, 'update',
        jsonb_build_object('granted', null),
        jsonb_build_object('cleared_at', now(), 'cleared_by', auth.uid()));
    END IF;

    RETURN v_result;
  END IF;

  INSERT INTO public.user_permission_overrides (tenant_id, profile_id, permission_id, granted, created_by)
  VALUES (v_tenant_id, p_profile_id, v_permission_id, p_granted, auth.uid())
  ON CONFLICT (tenant_id, profile_id, permission_id) WHERE deleted_at IS NULL
  DO UPDATE SET granted = EXCLUDED.granted, updated_at = now()
  RETURNING id, to_jsonb(user_permission_overrides.*) INTO v_override_id, v_result;

  PERFORM public.log_audit_event(v_tenant_id, 'user_permission_override', v_override_id, 'update',
    '{}'::jsonb, jsonb_build_object('permission_key', p_permission_key, 'granted', p_granted));

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_supervisor_permission_override(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_supervisor_permission_override(uuid, text, boolean) TO authenticated, service_role;
