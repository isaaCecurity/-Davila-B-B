import { handleCors } from '../_shared/cors.ts';
import { authenticateCaller, assertCallerTenantMembership } from '../_shared/auth.ts';
import { handleFunctionError, HttpError, jsonResponse } from '../_shared/errors.ts';
import { getEmailProvider } from '../_shared/email/factory.ts';
import { renderInviteEmailHtml, renderInviteEmailText } from '../_shared/templates/invite.ts';

interface SendInviteRequestBody {
  invite_id: string;
  raw_token: string;
  app_url?: string;
}

// SHA-256 helper in Deno/Web Crypto
async function sha256Hex(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    // 1. Authenticate caller
    const { context, serviceClient } = await authenticateCaller(req);

    // 2. Parse payload
    let body: SendInviteRequestBody;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, 'bad_request', 'Invalid JSON body');
    }

    const { invite_id, raw_token, app_url } = body;

    if (!invite_id || typeof invite_id !== 'string') {
      throw new HttpError(400, 'validation_error', 'Missing or invalid invite_id');
    }
    if (!raw_token || typeof raw_token !== 'string') {
      throw new HttpError(400, 'validation_error', 'Missing or invalid raw_token');
    }

    // 3. Fetch invite with related organization, role, branch
    const { data: invite, error: fetchError } = await serviceClient
      .from('organization_invites')
      .select(`
        id,
        tenant_id,
        email,
        status,
        expires_at,
        token_hash,
        role_id,
        branch_id,
        organizations ( id, name ),
        roles ( id, name ),
        branches ( id, name )
      `)
      .eq('id', invite_id)
      .single();

    if (fetchError || !invite) {
      throw new HttpError(404, 'not_found', 'Invitation record not found');
    }

    // 4. Validate tenant authorization: caller must belong to invite's organization with manage privileges
    const { roles: callerRoles } = await assertCallerTenantMembership(
      serviceClient,
      context.userId,
      invite.tenant_id
    );

    const isAuthorizedRole = callerRoles.some((role) =>
      ['owner', 'admin', 'branch_manager'].includes(role.toLowerCase())
    );

    if (!isAuthorizedRole) {
      throw new HttpError(
        403,
        'forbidden',
        'Caller must be an owner, admin, or branch manager to send invitations'
      );
    }

    // 5. Check invite validity & state
    if (invite.status !== 'pending') {
      throw new HttpError(
        400,
        'invalid_state',
        `Cannot deliver invite with status '${invite.status}'`
      );
    }

    const expiresAt = new Date(invite.expires_at);
    if (expiresAt <= new Date()) {
      throw new HttpError(400, 'invite_expired', 'This invitation has already expired');
    }

    // 6. Security check: verify raw_token matches stored token_hash
    const computedHash = await sha256Hex(raw_token);
    if (computedHash !== invite.token_hash) {
      throw new HttpError(400, 'invalid_token', 'Supplied raw token does not match invitation record');
    }

    // 7. Calculate expiration days
    const diffMs = expiresAt.getTime() - Date.now();
    const expiresInDays = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

    // 8. Determine invite link
    const orgData = invite.organizations as unknown as { id: string; name: string } | null;
    const roleData = invite.roles as unknown as { id: string; name: string } | null;
    const branchData = invite.branches as unknown as { id: string; name: string } | null;

    const orgName = orgData?.name || 'BakeFlow Organization';
    const roleName = roleData?.name || 'Staff';
    const branchName = branchData?.name || null;

    const deepLinkScheme = Deno.env.get('MOBILE_DEEP_LINK_SCHEME') || 'bakeflow';
    const appBaseUrl = app_url || Deno.env.get('APP_BASE_URL');

    let inviteLink: string;
    if (appBaseUrl) {
      const trimmedBase = appBaseUrl.endsWith('/') ? appBaseUrl.slice(0, -1) : appBaseUrl;
      inviteLink = `${trimmedBase}/invite?token=${encodeURIComponent(raw_token)}`;
    } else {
      inviteLink = `${deepLinkScheme}://invite?token=${encodeURIComponent(raw_token)}`;
    }

    // 9. Render templates
    const templateData = {
      organizationName: orgName,
      roleName: roleName.replace(/_/g, ' ').toUpperCase(),
      branchName,
      inviteLink,
      expiresInDays,
      invitedEmail: invite.email,
    };

    const html = renderInviteEmailHtml(templateData);
    const text = renderInviteEmailText(templateData);

    // 10. Send Email
    const provider = getEmailProvider();
    const result = await provider.sendEmail({
      to: invite.email,
      subject: `You've been invited to join ${orgName} on BakeFlow`,
      html,
      text,
      tags: {
        type: 'organization_invitation',
        tenant_id: invite.tenant_id,
        invite_id: invite.id,
      },
    });

    console.log(`[send-invite-email] Successfully dispatched invite email to ${invite.email} (provider=${result.provider}, delivery_id=${result.id})`);

    return jsonResponse({
      success: true,
      invite_id: invite.id,
      recipient: invite.email,
      delivery: result,
    });
  } catch (err: unknown) {
    return handleFunctionError(err);
  }
});
