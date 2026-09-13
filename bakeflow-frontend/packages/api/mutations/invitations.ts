/**
 * Invitation mutations — P6.2 (Email & Invitation Delivery).
 *
 * Exposes client methods to:
 * 1. Create an organization invite via the `create_organization_invite` RPC.
 * 2. Dispatch the invitation email via the `send-invite-email` Supabase Edge Function.
 */

import type { Uuid } from '@bakeflow/types';
import type { BakeflowClient } from '../client';
import {
  BakeflowApiError,
  normalizeFunctionsError,
  normalizePostgrestError,
  normalizeThrown,
} from '../errors';

export interface CreateInviteInput {
  email: string;
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
  try {
    const { data, error } = await client.rpc('create_organization_invite', {
      p_email: input.email.trim().toLowerCase(),
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
 * Convenience orchestrator: creates an invitation record and immediately delivers the invite email.
 */
export async function createAndSendInvite(
  client: BakeflowClient,
  input: CreateInviteInput
): Promise<CreateInviteResult & { delivery: SendInviteEmailResult['delivery'] }> {
  const invite = await createOrganizationInvite(client, {
    email: input.email,
    roleKey: input.roleKey,
    branchId: input.branchId,
    validDays: input.validDays,
  });

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
 * AD-025: only the account the invite was sent to may accept it — any other account is refused
 * with `insufficient_role` and detail reason `email_mismatch` (read it with `errorReason`).
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
