import { EmailProvider } from './types.ts';
import { ResendEmailProvider } from './resend.ts';
import { MockEmailProvider } from './mock.ts';

export function getEmailProvider(): EmailProvider {
  const providerType = Deno.env.get('EMAIL_PROVIDER')?.toLowerCase();
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const fromAddress = Deno.env.get('EMAIL_FROM_ADDRESS');
  const fromName = Deno.env.get('EMAIL_FROM_NAME');

  if (providerType === 'mock' || (!resendApiKey && (!providerType || providerType === 'resend'))) {
    if (providerType === 'resend' && !resendApiKey) {
      console.warn('[EmailFactory] RESEND_API_KEY is not set. Falling back to MockEmailProvider.');
    }
    return new MockEmailProvider();
  }

  if (providerType === 'resend' || (!providerType && resendApiKey)) {
    return new ResendEmailProvider({
      apiKey: resendApiKey!,
      defaultFromAddress: fromAddress,
      defaultFromName: fromName,
    });
  }

  console.warn(`[EmailFactory] Unknown provider '${providerType}'. Defaulting to mock provider.`);
  return new MockEmailProvider();
}
