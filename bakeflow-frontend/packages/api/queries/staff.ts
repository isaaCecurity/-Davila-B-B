/**
 * Staff read service — P9.6 driver picker.
 *
 * **Read path only, and there is no corresponding write path here.** Role assignment runs
 * through invite acceptance and `user_roles` RPCs entirely outside this module; this file
 * exists solely to answer "who in this tenant can be assigned a delivery."
 *
 * See `@bakeflow/types` `staff.ts` for the RLS/RPC provenance this query relies on.
 */

import type { Driver, Uuid } from '@bakeflow/types';
import { driverSchema } from '@bakeflow/validation';

import type { BakeflowClient } from '../client';
import { parseRows, run } from '../internal/read';

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
