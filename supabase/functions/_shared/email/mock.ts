import { EmailDeliveryResult, EmailPayload, EmailProvider } from './types.ts';

export class MockEmailProvider implements EmailProvider {
  readonly name = 'mock';

  public sentEmails: EmailPayload[] = [];

  async sendEmail(payload: EmailPayload): Promise<EmailDeliveryResult> {
    const id = `mock_mail_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    this.sentEmails.push(payload);

    console.log(`[MockEmailProvider] Simulated email to: ${Array.isArray(payload.to) ? payload.to.join(', ') : payload.to}`);
    console.log(`[MockEmailProvider] Subject: ${payload.subject}`);
    console.log(`[MockEmailProvider] ID: ${id}`);

    return {
      id,
      provider: this.name,
      status: 'simulated',
    };
  }
}
