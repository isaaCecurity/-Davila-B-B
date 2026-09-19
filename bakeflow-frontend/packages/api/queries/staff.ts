/**
 * Staff read service — P9.6 driver picker.
 *
 * **Read path only, and there is no corresponding write path here.** Role assignment runs
 * through invite acceptance and `user_roles` RPCs entirely outside this module; this file
 * exists solely to answer "who in this tenant can be assigned a delivery."
 *
 * See `@bakeflow/types` `staff.ts` for the RLS/RPC provenance this query relies on.
 */

import type { AuditEvent, Driver, MyProfile, OrganizationInvite, StaffRole, Uuid } from '@bakeflow/types';
import { auditEventSchema, driverSchema, myProfileSchema, organizationInviteSchema, staffRoleSchema } from '@bakeflow/validation';

import type { BakeflowClient } from '../client';
import { parseRow, parseRows, run } from '../internal/read';

/**
 * The raw embed shape before flattening. `user_roles` carries three foreign keys into
 * `profiles` (`profile_id`, `created_by`, `deleted_by`), so the constraint name must be
 * given explicitly — `profiles(...)` alone is ambiguous and PostgREST refuses it.
 */
interface DriverEmbedRow {
  profile_id: Uuid;
  profiles: { full_name: string; phone: string | null } | null;
}

/**
 * Every active member of the tenant holding the `driver` role, ordered by name.
 *
 * `roles!inner` and `profiles!user_roles_profile_id_fkey!inner` both turn what PostgREST
 * would otherwise treat as a left embed into a row filter — without `!inner`, `.eq()` on an
 * embedded column filters what the *embed* contains, not which top-level rows come back, so
 * a suspended-and-driver row would still be returned with a null-shaped `profiles`.
 *
 * Unpaged, for the same reason `listMyOrganizations` is: a bakery's driver roster is a
 * handful of people, and a picker that paginated would be worse than one that scrolled.
 */
export async function listDrivers(client: BakeflowClient): Promise<Driver[]> {
  const data = await run(
    client
      .from('user_roles')
      .select(
        'profile_id,' +
          'profiles!user_roles_profile_id_fkey!inner(full_name,phone,status),' +
          'roles!inner(key)',
      )
      .eq('roles.key', 'driver')
      .eq('profiles.status', 'active')
      .is('deleted_at', null),
  );

  const rows = Array.isArray(data) ? (data as DriverEmbedRow[]) : [];
  const flattened = rows
    .filter((row) => row.profiles !== null)
    .map((row) => ({
      profile_id: row.profile_id,
      full_name: row.profiles?.full_name ?? '',
      phone: row.profiles?.phone ?? null,
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name) || a.profile_id.localeCompare(b.profile_id));

  return parseRows(driverSchema, flattened, 'listDrivers');
}

/* -------------------------------------------------------------------------- */
/* Staff directory and invitations — prototype port, `staff` / `invites`       */
/* -------------------------------------------------------------------------- */

interface StaffRoleEmbedRow {
  id: Uuid;
  profile_id: Uuid;
  branch_id: Uuid | null;
  created_at: string;
  profiles: { full_name: string | null; phone: string | null; status: string } | null;
  roles: { key: string; name: string; rank: number } | null;
}

/**
 * Every role held in the active organization, most senior first, then by name.
 *
 * `user_roles_select` is `profile_id = auth.uid() OR (tenant_id = current_tenant_id() AND
 * has_role(['owner','admin','branch_manager']))` (read live 2026-09-13), so a manager sees the
 * directory and anyone else sees only their own rows. Nothing here widens that. Unpaged: a
 * bakery's staff is dozens of rows at most.
 */
export async function listStaffRoles(client: BakeflowClient): Promise<StaffRole[]> {
  const data = await run(
    client
      .from('user_roles')
      .select(
        'id,profile_id,branch_id,created_at,' +
          'profiles!user_roles_profile_id_fkey!inner(full_name,phone,status),' +
          'roles!inner(key,name,rank)',
      )
      .is('deleted_at', null),
  );

  const rows = Array.isArray(data) ? (data as StaffRoleEmbedRow[]) : [];
  const flattened = rows
    .filter((r) => r.profiles !== null && r.roles !== null)
    .map((r) => ({
      user_role_id: r.id,
      profile_id: r.profile_id,
      full_name: r.profiles?.full_name ?? '',
      phone: r.profiles?.phone ?? null,
      status: r.profiles?.status,
      role_key: r.roles?.key,
      role_name: r.roles?.name,
      role_rank: r.roles?.rank,
      branch_id: r.branch_id,
      created_at: r.created_at,
    }))
    .sort((a, b) => (a.role_rank ?? 99) - (b.role_rank ?? 99) || a.full_name.localeCompare(b.full_name));

  return parseRows(staffRoleSchema, flattened, 'listStaffRoles');
}

interface InviteEmbedRow {
  id: Uuid;
  email: string | null;
  phone: string | null;
  status: string;
  branch_id: Uuid | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
  roles: { key: string; name: string } | null;
}

/**
 * The active organization's invitations, newest first. `token_hash` is deliberately not in
 * the projection. Owner/admin see all; a branch manager sees invites for the branches they manage
 * (`organization_invites_select`, AD-026); anyone else gets an empty list from RLS, not an error.
 */
export async function listOrganizationInvites(client: BakeflowClient): Promise<OrganizationInvite[]> {
  const data = await run(
    client
      .from('organization_invites')
      .select('id,email,phone,status,branch_id,expires_at,accepted_at,created_at,roles!inner(key,name)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(200),
  );

  const rows = Array.isArray(data) ? (data as InviteEmbedRow[]) : [];
  const flattened = rows.map((r) => ({
    id: r.id,
    email: r.email,
    phone: r.phone,
    status: r.status,
    role_key: r.roles?.key,
    role_name: r.roles?.name,
    branch_id: r.branch_id,
    expires_at: r.expires_at,
    accepted_at: r.accepted_at,
    created_at: r.created_at,
  }));

  return parseRows(organizationInviteSchema, flattened, 'listOrganizationInvites');
}

/**
 * The newest audit entries for the active organization. Owner/admin only by RLS;
 * others receive an empty list. `before`/`after` are not selected (see `AuditEvent`).
 */
export async function listAuditEvents(client: BakeflowClient, limit = 100): Promise<AuditEvent[]> {
  const data = await run(
    client
      .from('audit_log')
      .select('id,actor_id,entity_type,entity_id,action,occurred_at')
      .is('deleted_at', null)
      .order('occurred_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 200)),
  );
  return parseRows(auditEventSchema, data, 'listAuditEvents');
}

/**
 * The signed-in person's own profile (`profiles_select` always allows your own row), or null when
 * no profile exists yet.
 */
export async function getMyProfile(client: BakeflowClient, userId: Uuid): Promise<MyProfile | null> {
  const data = await run(
    client.from('profiles').select('id,full_name,phone,avatar_url').eq('id', userId).is('deleted_at', null).maybeSingle(),
  );
  return parseRow(myProfileSchema, data, 'getMyProfile');
}
