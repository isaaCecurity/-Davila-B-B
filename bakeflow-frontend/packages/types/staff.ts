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

/** `profiles_status_check`, read live. */
export const PROFILE_STATUSES = ['active', 'suspended'] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

/**
 * One role a person holds in the active organization — a `user_roles` row joined to its
 * profile and role. A person with two roles appears twice; screens group by `profile_id`.
 *
 * Readable by the person themself and by owner/admin/branch_manager (`user_roles_select`,
 * `profiles_select`, read live 2026-09-13).
 */
export interface StaffRole {
  user_role_id: Uuid;
  profile_id: Uuid;
  full_name: string;
  phone: string | null;
  status: ProfileStatus;
  role_key: string;
  role_name: string;
  role_rank: number;
  /** Null for an organization-wide role (owner, admin). */
  branch_id: Uuid | null;
  created_at: string;
}

/** `organization_invites_status_check`, read live 2026-09-13. */
export const INVITE_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

/**
 * An invitation to the active organization. `token_hash` is never selected.
 *
 * Readable by owner/admin, and by a branch manager for the branches they manage
 * (`organization_invites_select`, AD-026). No client grant can update a row — there is no revoke
 * or resend path; a new invite is a new row.
 *
 * AD-026: an invite is addressed to exactly one of `email` or `phone` (E.164).
 */
export interface OrganizationInvite {
  id: Uuid;
  email: string | null;
  phone: string | null;
  status: InviteStatus;
  role_key: string;
  role_name: string;
  branch_id: Uuid | null;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

/**
 * One `audit_log` entry — who did what to which record, and when. `before`/`after` snapshots
 * are not carried: they can hold any column of any table, including money rendered as JSON
 * numbers, so the read model keeps only the identifying fields.
 *
 * Readable by owner/admin (`audit_log_select`, updated live 2026-09-20 — accountant removed).
 */
export interface AuditEvent {
  id: Uuid;
  actor_id: Uuid | null;
  entity_type: string;
  entity_id: Uuid | null;
  action: string;
  occurred_at: string;
}

/** The signed-in person's own profile — read from `profiles`, edited by `update_my_profile()` (Q8). */
export interface MyProfile {
  id: Uuid;
  full_name: string;
  /** Contact phone shown to the team (E.164), not the sign-in phone. */
  phone: string | null;
  avatar_url: string | null;
}
