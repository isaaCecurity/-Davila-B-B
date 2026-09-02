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
