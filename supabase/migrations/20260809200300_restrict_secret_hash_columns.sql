-- Finding I2 — a hash is a verifier, not a secret-safe value.
--
-- organization_invites.token_hash and permanent_deletion_challenges
-- .confirmation_phrase_hash were readable by every client that satisfied the table's
-- SELECT policy. An Owner or Admin could read the invite token hash for their whole
-- organization; the deletion challenge phrase is short and human-chosen, so its hash
-- is brute-forceable offline in seconds.
--
-- Neither column is needed by any client: accept_organization_invite() takes the raw
-- token and hashes it server-side.
--
-- PostgreSQL has no way to subtract one column from a table-level SELECT grant, so
-- the table grant is replaced by an explicit column list. Audit check C7 will now
-- report these two column ACLs — that is expected, and they are listed in the
-- suppression block in tests/db_security_audit.sql.

REVOKE SELECT ON public.organization_invites FROM authenticated;
GRANT SELECT (
  id, tenant_id, email, role_id, branch_id, status, expires_at,
  accepted_by, accepted_at, created_at, updated_at, created_by,
  deleted_at, deleted_by
) ON public.organization_invites TO authenticated;

REVOKE SELECT ON public.permanent_deletion_challenges FROM authenticated;
GRANT SELECT (
  id, tenant_id, requested_by, target_table, target_id,
  expires_at, consumed_at, created_at
) ON public.permanent_deletion_challenges TO authenticated;
