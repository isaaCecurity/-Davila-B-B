import { EmailDeliveryResult, EmailPayload, EmailProvider } from './types.ts';
import { HttpError } from '../errors.ts';

export interface ResendConfig {
  apiKey: string;
  defaultFromAddress?: string;
  defaultFromName?: string;
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  private apiKey: string;
  private defaultFrom: string;

  constructor(config: ResendConfig) {
    if (!config.apiKey) {
      throw new HttpError(500, 'configuration_error', 'Resend API key is not configured');
    }
    this.apiKey = config.apiKey;

    const fromAddress = config.defaultFromAddress || 'invites@bakeflow.app';
    const fromName = config.defaultFromName || 'BakeFlow';
    this.defaultFrom = `${fromName} <${fromAddress}>`;
  }

  async sendEmail(payload: EmailPayload): Promise<EmailDeliveryResult> {
    const to = Array.isArray(payload.to) ? payload.to : [payload.to];
    const from = payload.from || this.defaultFrom;

    const body: Record<string, unknown> = {
      from,
      to,
      subject: payload.subject,
      html: payload.html,
      ...(payload.text ? { text: payload.text } : {}),
      ...(payload.replyTo ? { reply_to: payload.replyTo } : {}),
    };

    if (payload.tags) {
      body.tags = Object.entries(payload.tags).map(([name, value]) => ({ name, value }));
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('[Resend Error]', response.status, data);
        const errorMessage = data?.message || data?.error || 'Failed to send email via Resend';
        throw new HttpError(502, 'provider_error', errorMessage, data);
      }

      return {
        id: data.id || `resend_${Date.now()}`,
        provider: this.name,
        status: 'sent',
      };
    } catch (err: unknown) {
      if (err instanceof HttpError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : 'Unknown network error when contacting Resend';
      console.error('[Resend Exception]', err);
      throw new HttpError(502, 'provider_error', message);
    }
  }
}
