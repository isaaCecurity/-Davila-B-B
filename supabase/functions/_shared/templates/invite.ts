export interface InviteEmailTemplateData {
  organizationName: string;
  roleName: string;
  branchName?: string | null;
  inviteLink: string;
  expiresInDays?: number;
  invitedEmail: string;
}

export function renderInviteEmailHtml(data: InviteEmailTemplateData): string {
  const branchRow = data.branchName
    ? `<p style="margin: 0 0 12px; font-size: 15px; color: #4B5563;"><strong>Branch:</strong> ${escapeHtml(data.branchName)}</p>`
    : '';

  const expiryText = data.expiresInDays
    ? `This invitation will expire in <strong>${data.expiresInDays} days</strong>.`
    : 'This invitation is valid for a limited time.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Join ${escapeHtml(data.organizationName)} on BakeFlow</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F9FAFB; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F9FAFB; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table width="100%" max-width="560" border="0" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: #FFFFFF; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03); border: 1px solid #E5E7EB;">
          
          <!-- Header Banner -->
          <tr>
            <td style="background-color: #D97706; padding: 32px 32px 24px; text-align: center;">
              <h1 style="margin: 0; color: #FFFFFF; font-size: 24px; font-weight: 700; letter-spacing: -0.5px;">BakeFlow</h1>
              <p style="margin: 6px 0 0; color: #FEF3C7; font-size: 14px;">Bakery Operations Platform</p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding: 36px 32px;">
              <h2 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #111827;">You've been invited!</h2>
              <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.5; color: #374151;">
                You have been invited to join <strong>${escapeHtml(data.organizationName)}</strong> on BakeFlow.
              </p>

              <div style="background-color: #F3F4F6; border-radius: 8px; padding: 20px; margin-bottom: 28px;">
                <p style="margin: 0 0 12px; font-size: 15px; color: #4B5563;"><strong>Role:</strong> <span style="display: inline-block; background-color: #E0E7FF; color: #3730A3; font-weight: 600; font-size: 13px; padding: 2px 10px; border-radius: 9999px;">${escapeHtml(data.roleName)}</span></p>
                ${branchRow}
                <p style="margin: 0; font-size: 13px; color: #6B7280;">${expiryText}</p>
              </div>

              <!-- Button CTA -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 28px;">
                <tr>
                  <td align="center">
                    <a href="${escapeHtml(data.inviteLink)}" style="display: inline-block; background-color: #D97706; color: #FFFFFF; font-size: 16px; font-weight: 600; text-decoration: none; padding: 14px 32px; border-radius: 8px; box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05); text-align: center;">
                      Accept Invitation
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 0 0 8px; font-size: 13px; color: #6B7280;">
                If the button above does not work, copy and paste this link into your browser or the BakeFlow app:
              </p>
              <p style="margin: 0; font-size: 13px; word-break: break-all; color: #D97706;">
                <a href="${escapeHtml(data.inviteLink)}" style="color: #D97706; text-decoration: underline;">${escapeHtml(data.inviteLink)}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #F9FAFB; padding: 20px 32px; text-align: center; border-top: 1px solid #E5E7EB;">
              <p style="margin: 0; font-size: 12px; color: #9CA3AF;">
                This invitation was sent to <strong>${escapeHtml(data.invitedEmail)}</strong>. If you were not expecting this invitation, you can safely ignore this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function renderInviteEmailText(data: InviteEmailTemplateData): string {
  const branch = data.branchName ? `\nBranch: ${data.branchName}` : '';
  const expiry = data.expiresInDays
    ? `\nThis invitation will expire in ${data.expiresInDays} days.`
    : '';

  return `Join ${data.organizationName} on BakeFlow

You have been invited to join ${data.organizationName} on BakeFlow.

Role: ${data.roleName}${branch}${expiry}

To accept your invitation, open the link below:
${data.inviteLink}

This invitation was sent to ${data.invitedEmail}. If you were not expecting this invitation, you can safely ignore this email.
`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
