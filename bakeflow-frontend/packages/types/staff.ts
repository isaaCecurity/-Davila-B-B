/**
 * Staff read models — P9.6 driver picker.
 *
 * Verified live 2026-08-22 against `pg_policies`, `pg_constraint` and the body of
 * `transition_delivery()`.
 *
 * ## Why this exists: the `assigned` transition has always needed a query nothing wrote
 *
 * `transition_delivery(p_to_status := 'assigned', p_driver_id := …)` only requires that
 * `p_driver_id` hold the `driver` role **somewhere in this tenant** — read from the live
 * function body, the check is a plain `user_roles` ⋈ `roles` join on `r.key = 'driver'`
 * and `ur.tenant_id = current_tenant_id()`, with no `branch_id` condition at all. So a
 * driver picker that narrowed itself to "drivers assigned to this delivery's branch" would
 * be inventing a restriction the database does not have, not mirroring one. `branch_id` on
 * `user_roles` is therefore not surfaced here — there is nothing correct to do with it yet.
 *
 * ## RLS lets exactly the callers who need this see it
 *
 * `user_roles_select` and `profiles_select` are both
 * `profile_id/id = auth.uid() OR (tenant_id = current_tenant_id() AND
 * has_role(['owner','admin','branch_manager']))` (read live from `pg_policies`, byte-equal
 * on the privileged branch). `transition_delivery` itself only allows owner/admin/
 * branch_manager to move a delivery *into* `assigned`. So every caller who can reach this
 * screen's assign action already satisfies both SELECT policies for every other member's
 * row — nothing here needs a broader grant than what driving the mutation already requires.
 *
 * ## `status` is filtered, not surfaced
 *
 * `profiles_status_check` allows exactly `'active'` and `'suspended'` (read live). The RPC
 * itself does not check it — a suspended profile that still holds the `driver` role would
 * still pass the RPC's own guard — but offering a suspended member in an *assignment*
 * picker would be actively misleading, so the query excludes them. This is a UX narrowing
 * on top of the database's authority, not a substitute for it: nothing here is a security
 * boundary, and the RPC re-verifies the role membership regardless of what this list showed.
 */

import type { Uuid } from './scalars';

/**
 * One tenant member who currently holds the `driver` role, for populating the "assign
 * driver" picker on a pending delivery.
 *
 * `phone` is carried because a dispatcher's next move after assigning is usually calling
 * the driver, and `profiles.phone` is nullable in the schema — not every driver has one on
 * file.
 */
export interface Driver {
  profile_id: Uuid;
  full_name: string;
  phone: string | null;
}
