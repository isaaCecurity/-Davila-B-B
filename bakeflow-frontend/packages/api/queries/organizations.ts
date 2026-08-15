/**
 * Organization membership read service — P8.1.
 *
 * Same mechanism as every other domain module: PostgREST + RLS, explicit column
 * projection, Zod-checked response gate. No new data-access pattern is introduced.
 *
 * ## This is the one read that works with a null tenant claim
 *
 * Every other query in this package returns an empty set when `tenant_id` is null, because
 * their policies compare against `current_tenant_id()`. `organizations_select` keys off
 * `auth.uid()` instead, so this list is populated for a user who has signed in but not yet
 * chosen an organization. The sign-in → switcher → catalog flow depends on that asymmetry.
 *
 * ## No write path
 *
 * Creating an organization is `create_organization_with_owner()` and joining one is
 * `accept_organization_invite()`; neither is part of P8.1, and invitation delivery is
 * blocked outright (BLOCKER-001). Switching the active organization lives in
 * `@bakeflow/auth` rather than here, because it is only half a database call — the other
 * half is a token refresh, and splitting those across two packages is how you end up with
 * a UI that switched and a database that did not.
 */

import type { OrganizationMembership, OrganizationRole, Uuid } from '@bakeflow/types';
import { organizationMembershipSchema, organizationRoleSchema } from '@bakeflow/validation';

import type { BakeflowClient } from '../client';
import { parseRows, projectionFor, run, type ReadEntity } from '../internal/read';

/** `organizations` holds no NUMERIC column, so the cast set is empty. */
const NO_TEXT_CASTS: ReadonlySet<string> = new Set<string>();

const ORGANIZATIONS: ReadEntity<OrganizationMembership> = {
  table: 'organizations',
  schema: organizationMembershipSchema,
  columns: projectionFor(organizationMembershipSchema, NO_TEXT_CASTS),
  softDeleted: true,
};

/**
 * Every organization the signed-in user belongs to, ordered by name.
 *
 * Unpaged: a user belongs to a handful of bakeries, and a switcher that paginated would be
 * a worse experience than one that scrolled.
 *
 * Ordered by `(name, id)` — `name` carries no unique constraint, and two organizations may
 * share one, so the id keeps the order stable across reloads rather than letting rows swap
 * places under the user's finger.
 */
export async function listMyOrganizations(
  client: BakeflowClient,
): Promise<OrganizationMembership[]> {
  const data = await run(
    client
      .from(ORGANIZATIONS.table)
      .select(ORGANIZATIONS.columns)
      .is('deleted_at', null)
      .order('name', { ascending: true })
      .order('id', { ascending: true }),
  );
  return parseRows(ORGANIZATIONS.schema, data, 'listMyOrganizations');
}

/** The raw shape of the `roles` embed, before flattening. */
interface RoleEmbedRow {
  tenant_id: Uuid;
  branch_id: Uuid | null;
  roles: { key: string; name: string; rank: number } | null;
}

/**
 * The signed-in user's roles, across every organization they belong to.
 *
 * A PostgREST embed is used here where the domain modules deliberately avoid one, and the
 * reason the embed is unsafe there does not apply: that objection is about `NUMERIC`
 * columns losing their `::text` cast inside a nested resource. `roles` has no numeric
 * column but `rank`, which is `smallint` — an integer small enough that JSON transport is
 * lossless.
 *
 * A row whose embed is null is **dropped rather than defaulted**. It would mean a
 * `user_roles` row pointing at a role the reader cannot see, and inventing a placeholder
 * role name would put a fiction on screen next to a real organization.
 */
export async function listMyOrganizationRoles(
  client: BakeflowClient,
): Promise<OrganizationRole[]> {
  const data = await run(
    client
      .from('user_roles')
      .select('tenant_id,branch_id,roles(key,name,rank)')
      .is('deleted_at', null),
  );

  if (!Array.isArray(data)) return [];
  const flattened = (data as RoleEmbedRow[])
    .filter((row) => row.roles !== null)
    .map((row) => ({
      tenant_id: row.tenant_id,
      role_key: row.roles?.key ?? '',
      role_name: row.roles?.name ?? '',
      role_rank: row.roles?.rank ?? 0,
      branch_id: row.branch_id,
    }));

  return parseRows(organizationRoleSchema, flattened, 'listMyOrganizationRoles');
}
