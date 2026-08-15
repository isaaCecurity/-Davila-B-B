/**
 * Organization membership types — P8.1.
 *
 * Verified live 2026-08-15 against `information_schema.columns` and `pg_policy`.
 *
 * ## The membership list needs no tenant claim, and that is the point
 *
 * `organizations_select` is
 *
 * ```sql
 * deleted_at IS NULL
 *   AND EXISTS (SELECT 1 FROM user_roles ur
 *                WHERE ur.profile_id = auth.uid()
 *                  AND ur.tenant_id = organizations.id
 *                  AND ur.deleted_at IS NULL)
 * ```
 *
 * It keys off `auth.uid()`, **not** `current_tenant_id()`. So a freshly signed-in user with
 * no active organization — whose `tenant_id` claim is null, and for whom every other table
 * in the schema therefore returns zero rows — can still enumerate the organizations they
 * belong to. Without that property the switcher would be unreachable and the app would
 * deadlock on first sign-in.
 *
 * `organizations` also carries `country_code`, `currency_code`, `timezone`, `status` and
 * `allow_negative_stock`. They are omitted here: P8.1 renders a chooser, and a read model
 * that carries settings nothing reads invites someone to branch on them client-side.
 */

import type { Timestamptz, Uuid } from './scalars';

/**
 * An organization the signed-in user belongs to.
 *
 * `status` is carried because a suspended organization must be visible-but-unselectable
 * rather than hidden — a user whose bakery was suspended needs to see why the app is empty,
 * not an unexplained blank switcher.
 */
export interface OrganizationMembership {
  id: Uuid;
  name: string;
  slug: string;
  status: string;
  created_at: Timestamptz;
  updated_at: Timestamptz;
}

/**
 * The signed-in user's role in one organization.
 *
 * Read from `user_roles` joined to `roles`, both of which the user can read for themselves
 * (`user_roles_select` admits `profile_id = auth.uid()`).
 *
 * **Advisory only.** AD-016 records that `has_permission()` gates **zero** of the 101 live
 * policies and that role-based RLS is the authority. A client that hid a screen based on
 * this would be adding an authorization rule the database does not have — which is both a
 * lie and a maintenance trap. Use it to label the UI, never to permit an action.
 */
export interface OrganizationRole {
  tenant_id: Uuid;
  role_key: string;
  role_name: string;
  /** Lower is more senior. Carried for sorting a multi-role display, not for comparison
   *  against a threshold. */
  role_rank: number;
  /** Null when the role is organization-wide rather than scoped to one branch. */
  branch_id: Uuid | null;
}
