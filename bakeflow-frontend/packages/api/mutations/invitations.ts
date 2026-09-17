/**
 * Invitation mutations — P6.2 (Email & Invitation Delivery), AD-025, AD-026.
 *
 * Exposes client methods to:
 * 1. Create an organization invite via the `create_organization_invite` RPC — by role, to an
 *    email OR a phone number (AD-026).
 * 2. Dispatch the invitation email via the `send-invite-email` Supabase Edge Function. A phone
 *    invite has no email to send; its link is shared by the inviter (WhatsApp, SMS).
 */

import type { Uuid } from '@bakeflow/types';
import type { BakeflowClient } from '../client';
import {
  BakeflowApiError,
  normalizeFunctionsError,
  normalizePostgrestError,
  normalizeThrown,
} from '../errors';

/**
 * Exactly one of `email` / `phone`. `phone` must already be E.164 (`toE164Phone` in
 * `@bakeflow/validation`).
 *
 * Who may invite (enforced by the RPC, AD-026): owner — any role; admin — any role below admin;
 * branch manager — cashier, baker, driver or supervisor, into a branch they manage.
 */
export interface CreateInviteInput {
  email?: string | null;
  phone?: string | null;
  roleKey: string;
  branchId?: Uuid | null;
  validDays?: number;
}

export interface CreateInviteResult {
  inviteId: Uuid;
  rawToken: string;
  expiresAt: string;
}

export interface SendInviteEmailInput {
  inviteId: Uuid;
  rawToken: string;
}

export interface SendInviteEmailResult {
  success: boolean;
  inviteId: Uuid;
  recipient: string;
  delivery: {
    id: string;
    provider: string;
    status: 'sent' | 'queued' | 'simulated';
  };
}

/**
 * Creates an organization invite in the active organization.
 * Mints the raw token, stores only its SHA-256 hash in the database, and returns the raw token.
 */
export async function createOrganizationInvite(
  client: BakeflowClient,
  input: CreateInviteInput
): Promise<CreateInviteResult> {
  const email = input.email?.trim().toLowerCase() || null;
  const phone = input.phone?.trim() || null;
  if ((email === null) === (phone === null)) {
    throw new BakeflowApiError({
      code: 'invalid_request',
      message: 'createOrganizationInvite: give exactly one of email or phone',
    });
  }
  if (input.roleKey.trim() === '') {
    throw new BakeflowApiError({ code: 'invalid_request', message: 'createOrganizationInvite: a role must be chosen' });
  }
  try {
    const { data, error } = await client.rpc('create_organization_invite', {
      p_email: email,
      p_phone: phone,
      p_role_key: input.roleKey,
      p_branch_id: input.branchId ?? null,
      p_valid_days: input.validDays ?? 7,
    });

    if (error) {
      throw normalizePostgrestError(error);
    }

    if (!data || typeof data !== 'object') {
      throw new BakeflowApiError({
        code: 'unexpected_error',
        message: 'The server returned an unexpected response when creating an invitation.',
        details: JSON.stringify(data),
      });
    }

    const payload = data as Record<string, unknown>;
    const invite = (payload.invite || {}) as Record<string, unknown>;
    const inviteId = (invite.id || payload.id || payload.invite_id) as string;
    const rawToken = (payload.raw_token || payload.token) as string;
    const expiresAt = (invite.expires_at || payload.expires_at || '') as string;

    if (!inviteId || !rawToken) {
      throw new BakeflowApiError({
        code: 'response_shape_invalid',
        message: 'The invitation was created but the response payload was missing required token data.',
        details: JSON.stringify(payload),
      });
    }

    return {
      inviteId: inviteId as Uuid,
      rawToken,
      expiresAt,
    };
  } catch (err) {
    if (err instanceof BakeflowApiError) {
      throw err;
    }
    throw normalizeThrown(err);
  }
}

/**
 * Triggers the `send-invite-email` Supabase Edge Function to deliver the invitation email.
 */
export async function sendInviteEmail(
  client: BakeflowClient,
  input: SendInviteEmailInput
): Promise<SendInviteEmailResult> {
  try {
    const { data, error } = await client.functions.invoke('send-invite-email', {
      body: {
        invite_id: input.inviteId,
        raw_token: input.rawToken,
      },
    });

    if (error) {
      throw await normalizeFunctionsError(error);
    }

    if (!data || typeof data !== 'object' || !(data as any).success) {
      throw new BakeflowApiError({
        code: 'unexpected_error',
        message: (data as any)?.error?.message || 'Failed to deliver invitation email',
        details: JSON.stringify(data),
      });
    }

    return {
      success: true,
      inviteId: (data as any).invite_id,
      recipient: (data as any).recipient,
      delivery: (data as any).delivery,
    };
  } catch (err) {
    if (err instanceof BakeflowApiError) {
      throw err;
    }
    throw normalizeThrown(err);
  }
}

/**
 * Convenience orchestrator: creates an invitation record and, for an email invite, immediately
 * delivers the invite email. A phone invite returns `delivery: null` — no SMS provider sends
 * invites, so the inviter shares the link themselves.
 */
export async function createAndSendInvite(
  client: BakeflowClient,
  input: CreateInviteInput
): Promise<CreateInviteResult & { delivery: SendInviteEmailResult['delivery'] | null }> {
  const invite = await createOrganizationInvite(client, input);

  if (input.email == null || input.email.trim() === '') {
    return { ...invite, delivery: null };
  }

  const emailResult = await sendInviteEmail(client, {
    inviteId: invite.inviteId,
    rawToken: invite.rawToken,
  });

  return {
    ...invite,
    delivery: emailResult.delivery,
  };
}

export interface AcceptInviteResult {
  organizationId: Uuid;
  organizationName: string;
  roleName: string;
}

/**
 * Accept an invitation with the raw token from its link — `accept_organization_invite()`.
 *
 * The function adds the role (and branch assignment), marks the invite accepted, and adopts the
 * organization as the active one only when the user had none. It returns `refresh_session:
 * true`: the caller must then switch to the organization and refresh the token
 * (`setActiveOrganization` in `@bakeflow/auth`) before any tenant read will see it.
 *
 * Only the organization id, its name and the role name are read from the envelope — strings
 * that survive `to_jsonb` intact.
 *
 * AD-025 / AD-026: only the account the invite was sent to may accept it — its confirmed email,
 * or for a phone invite its phone verified by SMS sign-in. Any other account is refused with
 * `insufficient_role` and detail reason `email_mismatch` or `phone_mismatch` (read it with
 * `errorReason`).
 *
 * @throws {BakeflowApiError} `invalid_transition` for an unknown, used, revoked or expired token
 *   (reason `expired` when it lapsed); `insufficient_role` when not signed in or signed in as a
 *   different email.
 */
export async function acceptOrganizationInvite(
  client: BakeflowClient,
  rawToken: string
): Promise<AcceptInviteResult> {
  const token = rawToken.trim();
  if (!/^[0-9a-f]{64}$/.test(token)) {
    throw new BakeflowApiError({
      code: 'invalid_request',
      message: 'acceptOrganizationInvite: the invite token is not in the expected format',
    });
  }
  try {
    const { data, error } = await client.rpc('accept_organization_invite', { p_raw_token: token });
    if (error) throw normalizePostgrestError(error);

    const payload = (data ?? {}) as Record<string, unknown>;
    // AD-025: an expired invite is recorded as expired and reported in the envelope rather than
    // raised (a RAISE would roll the status change back).
    if (payload.accepted === false) {
      throw new BakeflowApiError({
        code: 'invalid_transition',
        message: 'acceptOrganizationInvite: the invite could not be accepted',
        details: JSON.stringify({ code: payload.code, reason: payload.status }),
      });
    }
    const org = (payload.organization ?? {}) as Record<string, unknown>;
    const role = (payload.role ?? {}) as Record<string, unknown>;
    if (typeof org.id !== 'string') {
      throw new BakeflowApiError({
        code: 'response_shape_invalid',
        message: 'acceptOrganizationInvite: the response carried no organization',
      });
    }
    return {
      organizationId: org.id as Uuid,
      organizationName: typeof org.name === 'string' ? org.name : 'your bakery',
      roleName: typeof role.name === 'string' ? role.name : 'team member',
    };
  } catch (err) {
    if (err instanceof BakeflowApiError) throw err;
    throw normalizeThrown(err);
  }
}

export interface ResendInviteResult {
  inviteId: Uuid;
  rawToken: string;
  expiresAt: string;
  /** Who the new link is for — the invite's email or phone. */
  email: string | null;
  phone: string | null;
}

function inviteRpcPayload(context: string, data: unknown): Record<string, unknown> {
  if (data === null || typeof data !== 'object') {
    throw new BakeflowApiError({ code: 'response_shape_invalid', message: `${context}: the RPC returned no envelope` });
  }
  const invite = (data as Record<string, unknown>).invite;
  if (invite === null || typeof invite !== 'object' || typeof (invite as Record<string, unknown>).id !== 'string') {
    throw new BakeflowApiError({ code: 'response_shape_invalid', message: `${context}: the response carried no invite` });
  }
  return invite as Record<string, unknown>;
}

/**
 * Revoke an invite — P9.9 Q7, `revoke_organization_invite(p_invite_id)`. A pending or expired
 * invite becomes `revoked`; its link stops working. Nothing is deleted; the change is audited.
 *
 * Who may: whoever may create that invite (owner any; admin below admin; branch manager crew
 * invites for a branch they manage).
 *
 * @throws {BakeflowApiError} `insufficient_role` (also for an unknown id);
 *   `invalid_transition` when the invite is already accepted or revoked.
 */
export async function revokeOrganizationInvite(client: BakeflowClient, inviteId: Uuid): Promise<void> {
  try {
    const { data, error } = await client.rpc('revoke_organization_invite', { p_invite_id: inviteId });
    if (error) throw normalizePostgrestError(error);
    inviteRpcPayload('revokeOrganizationInvite', data);
  } catch (err) {
    if (err instanceof BakeflowApiError) throw err;
    throw normalizeThrown(err);
  }
}

/**
 * Resend an invite — P9.9 Q7, `resend_organization_invite(p_invite_id)`. A pending or expired invite
 * gets a NEW link and a fresh 7-day expiry; the previous link stops working. Only a hash of each
 * link is stored, so this is also how a lost link is replaced.
 *
 * @throws {BakeflowApiError} `insufficient_role`; `invalid_transition` for accepted or revoked
 *   invites; `duplicate_reference` when another pending invite already exists for the same person;
 *   `rate_limited`.
 */
export async function resendOrganizationInvite(client: BakeflowClient, inviteId: Uuid): Promise<ResendInviteResult> {
  try {
    const { data, error } = await client.rpc('resend_organization_invite', { p_invite_id: inviteId, p_valid_days: 7 });
    if (error) throw normalizePostgrestError(error);
    const invite = inviteRpcPayload('resendOrganizationInvite', data);
    const rawToken = (data as Record<string, unknown>).raw_token;
    if (typeof rawToken !== 'string' || !/^[0-9a-f]{64}$/.test(rawToken)) {
      throw new BakeflowApiError({ code: 'response_shape_invalid', message: 'resendOrganizationInvite: no new link in the response' });
    }
    return {
      inviteId: invite.id as Uuid,
      rawToken,
      expiresAt: typeof invite.expires_at === 'string' ? invite.expires_at : '',
      email: typeof invite.email === 'string' ? invite.email : null,
      phone: typeof invite.phone === 'string' ? invite.phone : null,
    };
  } catch (err) {
    if (err instanceof BakeflowApiError) throw err;
    throw normalizeThrown(err);
  }
}

/**
 * Resend, then for an email invite hand the new link to `send-invite-email`. A phone invite returns
 * `delivery: null`: the inviter shares the new link themselves (AD-026).
 */
export async function resendAndDeliverInvite(
  client: BakeflowClient,
  inviteId: Uuid,
): Promise<ResendInviteResult & { delivery: SendInviteEmailResult['delivery'] | null }> {
  const resent = await resendOrganizationInvite(client, inviteId);
  if (resent.email === null) return { ...resent, delivery: null };
  const sent = await sendInviteEmail(client, { inviteId: resent.inviteId, rawToken: resent.rawToken });
  return { ...resent, delivery: sent.delivery };
}
