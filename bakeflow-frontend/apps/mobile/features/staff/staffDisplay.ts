/**
 * How staff and invitations present. Role keys are the live `roles.key` values; labels follow
 * CLAUDE.md's vocabulary ("Manager" means Branch Manager).
 */

import type { InviteStatus, OrganizationInvite } from '@bakeflow/types';
import type { BadgeTone, IconName, TileTone } from '@bakeflow/ui';
import { formatPhone } from '@bakeflow/validation';

import type { Persona } from '../../navigation/tabs';

export const INVITABLE_ROLES: readonly { key: string; label: string; hint: string }[] = [
  { key: 'cashier', label: 'Cashier', hint: 'Takes orders and payments, runs a till.' },
  { key: 'baker', label: 'Baker', hint: 'Works the production queue and records waste.' },
  { key: 'driver', label: 'Driver', hint: 'Runs delivery trips and sells from the vehicle.' },
  { key: 'supervisor', label: 'Supervisor', hint: 'Monitors operations; permissions set by the branch manager.' },
  { key: 'branch_manager', label: 'Branch manager', hint: 'Runs a branch: staff, cash, stock and orders.' },
  { key: 'admin', label: 'Admin', hint: 'Administers the whole bakery.' },
];

/** AD-026: the roles a branch manager may invite — never a peer manager or anyone above. */
export const CREW_ROLE_KEYS: ReadonlySet<string> = new Set(['cashier', 'baker', 'driver', 'supervisor']);

/**
 * The roles an inviter is offered, mirroring `create_organization_invite()`: an owner any listed
 * role, an admin anything below admin, a branch manager the crew roles, anyone else none.
 * Advisory — the RPC decides.
 */
export function invitableRolesFor(persona: Persona): readonly { key: string; label: string; hint: string }[] {
  if (persona === 'owner') return INVITABLE_ROLES;
  if (persona === 'admin') return INVITABLE_ROLES.filter((r) => r.key !== 'admin');
  if (persona === 'manager') return INVITABLE_ROLES.filter((r) => CREW_ROLE_KEYS.has(r.key));
  return [];
}

/** Personas that may open the invite sheet at all (AD-026). */
export function canInvite(persona: Persona): boolean {
  return persona === 'owner' || persona === 'admin' || persona === 'manager';
}

/** Who an invite was addressed to — its email, or its phone number grouped for reading. */
export function inviteRecipient(invite: Pick<OrganizationInvite, 'email' | 'phone'>): string {
  if (invite.email !== null) return invite.email;
  return invite.phone !== null ? formatPhone(invite.phone) : 'Unknown recipient';
}

/** Roles the database requires to be organization-wide (no branch). */
export const ORG_WIDE_ROLES: ReadonlySet<string> = new Set(['owner', 'admin']);

export type InviteView = { label: string; tone: BadgeTone; tile: TileTone; icon: IconName };

const VIEW: Record<InviteStatus, InviteView> = {
  pending: { label: 'Pending', tone: 'pending', tile: 'warn', icon: 'clock' },
  accepted: { label: 'Accepted', tone: 'ok', tile: 'ok', icon: 'checkCircle' },
  revoked: { label: 'Revoked', tone: 'neutral', tile: 'neutral', icon: 'close' },
  expired: { label: 'Expired', tone: 'bad', tile: 'bad', icon: 'alert' },
};

/**
 * An invite's state as a person would read it. A `pending` row past its `expires_at` cannot be
 * accepted (the RPC checks the time), so it reads as expired even while the stored status lags.
 */
export function inviteView(invite: OrganizationInvite, now: Date = new Date()): InviteView {
  if (invite.status === 'pending' && new Date(invite.expires_at) <= now) return VIEW.expired;
  return VIEW[invite.status];
}
